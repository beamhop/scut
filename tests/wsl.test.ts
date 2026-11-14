// The Windows engine (WSL2), against tests/fixtures/fake-wsl.sh: a stand-in wsl.exe where a distro is a folder and
// running in it is chroot. Everything Beamhop does is real: UTF-16 output, pulling the image without Docker,
// building one root filesystem by piping layers in (whiteouts applied by APPLY_LAYER inside the distro), export,
// one import per agent, starting agentd with its own ports and X display, a whole agent (desktop, chat, beam to
// Docker and back), revive, and removal. What it can't prove is WSL itself; that needs Windows.
// Needs Linux + root (chroot, mounts). Run: bun test tests/wsl.test.ts --timeout 900000
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const IMAGE = process.env.SCUT_GVISOR_IMAGE ?? "localhost:5000/scut-agent:dev";
const canRun = process.platform === "linux" && process.getuid?.() === 0;
process.env.SCUT_WSL_EXE = new URL("./fixtures/fake-wsl.sh", import.meta.url).pathname;
process.env.FAKE_WSL = mkdtempSync(`${tmpdir()}/fake-wsl-`);
process.env.SCUT_HOME = process.env.SCUT_WSL_HOME ?? "/tmp/scut-wsl-home";
mkdirSync(process.env.SCUT_HOME, { recursive: true });
process.env.SCUT_LOCAL_DRIVER = "wsl";
process.env.SCUT_SIM_CLOUD = "1";
process.env.SCUT_NO_AUTO_UPDATE = "1";
process.env.SCUT_IMAGE = IMAGE;
const { WslDriver, decodeWsl } = await import("../packages/drivers/src/wsl.ts");
const { Scut } = await import("../apps/app/src/core.ts");
const docker = Bun.spawnSync(["docker", "image", "inspect", IMAGE], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;

let scut: InstanceType<typeof Scut>;
let id = "";
async function chat(text: string) {
  const a = scut.get(id);
  const ws = new WebSocket(`${a.current.endpoint.replace(/^http/, "ws")}/ws?auth=${scut.auth(a.current.endpoint)}`);
  const reply = new Promise<string>((resolve) => {
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      const m = JSON.parse(e.data);
      if (m.t === "chat" && m.from === "agent") resolve(m.text);
    };
  });
  await new Promise((r) => (ws.onopen = r));
  ws.send(JSON.stringify({ t: "chat", text }));
  const t = await reply;
  ws.close();
  return t;
}

beforeAll(async () => {
  if (canRun) scut = await Scut.open();
});
afterAll(async () => {
  for (const a of [...(scut?.agents ?? [])]) await scut.remove(a.id).catch(() => {});
});

test("wsl.exe's UTF-16 output is read correctly", () => {
  const u16 = new Uint8Array(Buffer.from("Default Version: 2\r\n", "utf16le"));
  expect(decodeWsl(u16)).toBe("Default Version: 2\n");
  expect(decodeWsl(new TextEncoder().encode("plain\n"))).toBe("plain\n");
});

test.skipIf(!canRun)("availability: on, off (with the one-step fix), and missing", () => {
  expect(WslDriver.availability()).toEqual({ available: true });
  process.env.FAKE_WSL_OFF = "1";
  const off = WslDriver.availability();
  expect(off.available).toBe(false);
  expect(off.action).toBe("enable-wsl");
  delete process.env.FAKE_WSL_OFF;
  const keep = process.env.SCUT_WSL_EXE;
  process.env.SCUT_WSL_EXE = "/nonexistent/wsl.exe";
  expect(WslDriver.availability()).toMatchObject({ available: false, action: "enable-wsl" });
  process.env.SCUT_WSL_EXE = keep;
});

test.skipIf(!canRun)("startArgs: own port, DevTools port and X display; env cleared, image env kept", () => {
  const d = new WslDriver({ home: "/x" });
  const args = d.startArgs({ distro: "beamhop-a", env: { BEAM_TICKET: "t" }, port: 41000, cdp: 41001, display: 321, digest: "sha256:x" }, ["PATH=/usr/bin", "SCUT_DATA=/data"], ["/usr/bin/tini", "--", "bun", "main.ts"]);
  expect(args.slice(0, 7)).toEqual(["-d", "beamhop-a", "-u", "root", "--cd", "/", "--exec"]);
  expect(args).toContain("-i");
  for (const e of ["PATH=/usr/bin", "BEAM_TICKET=t", "PORT=41000", "SCUT_CDP_PORT=41001", "SCUT_DISPLAY=:321", "SCUT_DATA=/data", "HOME=/root"]) expect(args).toContain(e);
  expect(args.slice(-4)).toEqual(["/usr/bin/tini", "--", "bun", "main.ts"]);
});

test.skipIf(!canRun)("prepare builds one root filesystem from the image (layers piped in, build distro removed)", async () => {
  expect(scut.local.engine).toBe("wsl");
  scut.startPrefetch();
  const t0 = Date.now();
  while (scut.prefetch.state === "pulling" && Date.now() - t0 < 900_000) await Bun.sleep(500);
  expect(scut.prefetch).toMatchObject({ state: "ready" });
  const reg = Bun.spawnSync(["ls", `${process.env.FAKE_WSL}/reg`], { stdout: "pipe" }).stdout.toString().trim();
  expect(reg).toBe(""); // the build distro is gone
  const tars = Bun.spawnSync(["sh", "-c", `ls ${process.env.SCUT_HOME}/images/*.wsl.tar`], { stdout: "pipe" }).stdout.toString().trim();
  expect(tars).toMatch(/\.wsl\.tar$/);
  // The assembled filesystem has the image's files, and no whiteout markers.
  const list = Bun.spawnSync(["sh", "-c", `tar -tf ${tars} | grep -c '/\\.wh\\.' || true`], { stdout: "pipe" }).stdout.toString().trim();
  expect(list).toBe("0");
  expect(Bun.spawnSync(["sh", "-c", `tar -tf ${tars} ./opt/scut/packages/agentd/src/main.ts`]).exitCode).toBe(0);
}, 900_000);

test.skipIf(!canRun)("a whole agent runs in its distro: desktop, chat with screenshots", async () => {
  const rec = await scut.create({ name: "Winnie", harness: "mock" });
  id = rec.id;
  expect(rec.current.meta?.engine).toBe("wsl");
  expect(rec.current.meta?.distro).toMatch(/^beamhop-winnie-/);
  expect(existsSync(`${process.env.FAKE_WSL}/reg/${rec.current.meta!.distro}`)).toBe(true);
  const r = await chat("hello windows");
  expect(r).toContain("message #1");
  expect(r).toMatch(/screenshot \d{4,} bytes/);
}, 300_000);

test.skipIf(!canRun)("after a restart, revive starts it again in the same distro with its data", async () => {
  const a = scut.get(id);
  const before = await (await fetch(`${a.current.endpoint}/health`)).json();
  Bun.spawnSync([process.env.SCUT_WSL_EXE!, "--terminate", a.current.meta!.distro], { env: { ...process.env } });
  await Bun.sleep(1000);
  expect(await fetch(`${a.current.endpoint}/health`).then((r) => r.ok, () => false)).toBe(false);
  await scut.reviveLocalHosts();
  await scut.waitState(scut.get(id).current.endpoint, ["running"], 120_000);
  const after = await (await fetch(`${scut.get(id).current.endpoint}/health`)).json();
  expect(after.hostPubkey).toBe(before.hostPubkey);
  expect(await chat("still here")).toContain("message #2");
}, 300_000);

test.skipIf(!canRun || !docker)("beams to a Docker sandbox and back into a new distro", async () => {
  await scut.beam(id, "sim-cloud");
  expect(await chat("in docker")).toContain("message #3");
  await scut.beam(id, "local", { destroySource: true });
  expect(scut.get(id).current.meta?.engine).toBe("wsl");
  expect(await chat("back on windows")).toContain("message #4");
}, 600_000);

test.skipIf(!canRun)("remove unregisters the distro and deletes its folder", async () => {
  const a = scut.get(id);
  const distro = a.current.meta!.distro;
  await scut.remove(id);
  expect(existsSync(`${process.env.FAKE_WSL}/reg/${distro}`)).toBe(false);
  expect(existsSync(`${process.env.SCUT_HOME}/wsl/${a.current.meta!.name}`)).toBe(false);
}, 120_000);
