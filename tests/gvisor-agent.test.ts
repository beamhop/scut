// A whole agent on the gVisor engine (Linux without KVM, no Docker needed): the X11 desktop, Chromium and ffmpeg
// run inside gVisor; chat uses the computer; it beams to a Docker sandbox and back.
// Run: SCUT_GVISOR_IMAGE=localhost:5000/scut-agent:dev bun test tests/gvisor-agent.test.ts --timeout 900000
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";

const IMAGE = process.env.SCUT_GVISOR_IMAGE ?? "localhost:5000/scut-agent:dev";
process.env.SCUT_HOME = process.env.SCUT_GVISOR_HOME ?? "/tmp/scut-gv-home";
mkdirSync(process.env.SCUT_HOME, { recursive: true });
process.env.SCUT_LOCAL_DRIVER = "gvisor";
process.env.SCUT_SIM_CLOUD = "1";
process.env.SCUT_NO_AUTO_UPDATE = "1";
process.env.SCUT_IMAGE = IMAGE;
const { Scut } = await import("../apps/app/src/core.ts");
const linux = process.platform === "linux";
const docker = Bun.spawnSync(["docker", "image", "inspect", IMAGE], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;

let scut: InstanceType<typeof Scut>;
let id = "";
async function chat(text: string) {
  const a = scut.get(id);
  const ws = new WebSocket(`${a.current.endpoint.replace(/^http/, "ws")}/ws?auth=${scut.auth(a.current.endpoint)}`);
  ws.binaryType = "arraybuffer";
  let frames = 0;
  const reply = new Promise<string>((resolve) => {
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return void frames++;
      const m = JSON.parse(e.data);
      if (m.t === "chat" && m.from === "agent") resolve(m.text);
    };
  });
  await new Promise((r) => (ws.onopen = r));
  ws.send(JSON.stringify({ t: "subscribe", frames: true }));
  ws.send(JSON.stringify({ t: "chat", text }));
  const t = await reply;
  await Bun.sleep(1500);
  ws.close();
  return { text: t, frames };
}

beforeAll(async () => {
  scut = await Scut.open();
});
afterAll(async () => {
  for (const a of [...(scut?.agents ?? [])]) await scut.remove(a.id).catch(() => {});
});

test.skipIf(!linux)("prefetch prepares the engine and the image (progress reported)", async () => {
  expect(scut.local.engine).toBe("gvisor");
  scut.startPrefetch();
  const t0 = Date.now();
  while (scut.prefetch.state === "pulling" && Date.now() - t0 < 600_000) await Bun.sleep(500);
  expect(scut.prefetch.state).toBe("ready");
}, 700_000);

test.skipIf(!linux)("an agent runs its whole desktop inside gVisor", async () => {
  const rec = await scut.create({ name: "Gvis", harness: "mock" });
  id = rec.id;
  expect(rec.current.meta?.engine).toBe("gvisor");
  const h = await (await fetch(`${rec.current.endpoint}/health`)).json();
  expect(h.state).toBe("running");
  expect(h.unsandboxed).toBeUndefined();
  const r = await chat("hello from the test");
  expect(r.text).toContain("message #1");
  expect(r.text).toMatch(/screenshot \d{4,} bytes/); // ffmpeg x11grab of Xvfb, inside gVisor
  expect(r.frames).toBeGreaterThan(0);
}, 300_000);

test.skipIf(!linux || !docker)("beams to a Docker sandbox and back to gVisor", async () => {
  await scut.beam(id, "sim-cloud");
  expect(scut.get(id).current.driver).toBe("sim-cloud");
  expect((await chat("in docker")).text).toContain("message #2");
  await scut.beam(id, "local", { destroySource: true });
  expect(scut.get(id).current.meta?.engine).toBe("gvisor");
  expect((await chat("back in gvisor")).text).toContain("message #3");
}, 600_000);
