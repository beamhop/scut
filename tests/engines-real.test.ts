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

test.skipIf(!target)(`a whole agent on the real ${target ?? "engine"}: desktop, chat with screenshots`, async () => {
  process.env.SCUT_LOCAL_DRIVER = target!;
  const { Scut } = await import("../apps/app/src/core.ts");
  scut = await Scut.open();
  scut.startPrefetch();
  const t0 = Date.now();
  while (scut.prefetch.state === "pulling" && Date.now() - t0 < 1_800_000) await Bun.sleep(1000);
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
  expect(t).toContain("message #1");
  expect(t).toMatch(/screenshot \d{4,} bytes/);
}, 2_400_000);
