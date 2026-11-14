// What this computer really offers: runs the real ladder probes and reports them, then, where the real engine is
// available, boots a whole agent on it (WSL2 on Windows, smolvm on Apple Silicon / Linux with KVM). CI runs it on
// Linux, macOS (Apple Silicon) and Windows runners; on a runner without nested virtualization the boot is skipped,
// and the report says why.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SCUT_HOME = mkdtempSync(join(tmpdir(), "scut-real-"));
delete process.env.SCUT_LOCAL_DRIVER;
process.env.SCUT_NO_AUTO_UPDATE = "1";
process.env.SCUT_IMAGE ??= "ghcr.io/beamhop/scut-agent:latest";
const { chooseLocal, ladder, WslDriver, SmolvmDriver } = await import("@scut/drivers");

const choice = await chooseLocal(process.env.SCUT_HOME!);
console.log(`ladder on ${process.platform}/${process.arch}: picked ${choice.engine}`);
for (const p of choice.probes) console.log(`  ${p.engine}: ${p.available ? "available" : "no"}${p.reason ? ` (${p.reason})` : ""}`);
const wsl = process.platform === "win32" ? WslDriver.availability() : { available: false };
const smol = await SmolvmDriver.availability();
const target = wsl.available ? "wsl" : smol.available ? "smolvm" : null;

test("the ladder answers on this platform, in its order, with reasons", () => {
  expect(choice.probes.map((p) => p.engine)).toEqual(ladder().slice(0, choice.probes.length));
  for (const p of choice.probes) if (!p.available) expect(p.reason).toBeTruthy();
  if (choice.engine) expect(choice.probes.find((p) => p.engine === choice.engine)?.available).toBe(true);
});

let scut: any;
afterAll(async () => {
  for (const a of [...(scut?.agents ?? [])]) await scut.remove(a.id).catch(() => {});
});

test.skipIf(!target)(`the real ${target ?? "engine"}: a whole agent if it can run here, else the app notices and moves on`, async () => {
  process.env.SCUT_LOCAL_DRIVER = "";
  delete process.env.SCUT_LOCAL_DRIVER;
  const { Scut } = await import("../apps/app/src/core.ts");
  scut = await Scut.open();
  expect(scut.local.engine).toBe(target);
  scut.startPrefetch();
  const t0 = Date.now();
  while (Date.now() - t0 < 1_800_000 && (scut.prefetch.state === "pulling" || (scut.prefetch.state === "idle"))) await Bun.sleep(1000);
  await Bun.sleep(2000); // a fallback restarts the setup for the next engine
  while (scut.prefetch.state === "pulling" && Date.now() - t0 < 1_800_000) await Bun.sleep(1000);
  const saved = JSON.parse(require("node:fs").readFileSync(join(process.env.SCUT_HOME!, "engine.json"), "utf8"));
  if (scut.local.engine !== target) {
    // It said "available" but can't run anything here (e.g. a CI VM without nested virtualization).
    console.log(`${target} can't run here: ${saved.broken?.[target!]?.reason}`);
    console.log(`now: ${scut.local.engine ?? "no engine"}; setup: ${scut.prefetch.state}${scut.prefetch.error ? ` (${scut.prefetch.error})` : ""}`);
    expect(saved.broken?.[target!]?.reason).toBeTruthy();
    if (!scut.local.engine) expect(scut.prefetch.error).toContain("sandbox");
    return;
  }
  expect(scut.prefetch.state).toBe("ready");
  const rec = await scut.create({ name: "Real", harness: "mock" });
  const ws = new WebSocket(`${rec.current.endpoint.replace(/^http/, "ws")}/ws?auth=${scut.auth(rec.current.endpoint)}`);
  const reply = new Promise<string>((resolve) => {
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      const m = JSON.parse(e.data);
      if (m.t === "chat" && m.from === "agent") resolve(m.text);
    };
  });
  await new Promise((r) => (ws.onopen = r));
  ws.send(JSON.stringify({ t: "chat", text: "hello real engine" }));
  const t = await reply;
  ws.close();
  console.log(`booted a whole agent on ${target}: ${t}`);
  expect(t).toContain("message #1");
  expect(t).toMatch(/screenshot \d{4,} bytes/);
}, 2_400_000);
