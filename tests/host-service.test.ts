// No sandbox, with this computer's real per-user service manager (systemd --user, a LaunchAgent, or a Windows logon
// task): the agent is registered, works (its own headless browser, screenshots), comes back after it crashes, and is
// unregistered on removal. Portable: Linux, macOS and Windows (CI runs it on all three).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SCUT_HOME = mkdtempSync(join(tmpdir(), "scut-svc-"));
process.env.SCUT_LOCAL_DRIVER = "host";
delete process.env.SCUT_HOST_SERVICE;
process.env.SCUT_NO_AUTO_UPDATE = "1";
const { Scut } = await import("../apps/app/src/core.ts");
const { HostProcessDriver } = await import("@scut/drivers");

let scut: InstanceType<typeof Scut>;
let id = "";
let kind = "none";
const sh = (cmd: string[]) => {
  const p = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
};
const unit = () => scut.get(id).current.meta!.name;
function registered(): boolean {
  if (kind === "systemd") return sh(["systemctl", "--user", "is-active", `beamhop-${unit()}.service`]).out.trim() === "active";
  if (kind === "launchd") return sh(["launchctl", "print", `gui/${process.getuid!()}/com.beamhop.${unit()}`]).code === 0;
  if (kind === "schtasks") return sh(["schtasks", "/Query", "/TN", `Beamhop\\${unit()}`]).code === 0;
  return false;
}
async function health(ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ep = scut.get(id).current.endpoint;
    const h = await fetch(`${ep}/health`, { signal: AbortSignal.timeout(2000) }).then((r) => (r.ok ? r.json() : null), () => null);
    if (h?.state === "running") return h;
    await Bun.sleep(500);
  }
  return null;
}
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
  scut = await Scut.open();
  kind = (scut.drivers.get("local") as InstanceType<typeof HostProcessDriver>).service;
  console.log(`platform ${process.platform}/${process.arch}, service manager: ${kind}`);
});
afterAll(async () => {
  for (const a of [...scut.agents]) await scut.remove(a.id).catch(() => {});
});

test("create registers the agent with the service manager and it runs", async () => {
  const rec = await scut.create({ name: "Svc", harness: "mock" });
  id = rec.id;
  const h = await health();
  expect(h?.unsandboxed).toBe(true);
  if (kind !== "none") expect(registered()).toBe(true);
  const r = await chat("hello");
  expect(r).toContain("message #1");
  expect(r).toMatch(/screenshot \d{4,} bytes/);
}, 300_000);

test("after a crash it comes back: by itself (systemd, launchd) or when the app starts (logon task, plain process)", async () => {
  const before = await health();
  const name = unit();
  if (kind === "systemd") sh(["systemctl", "--user", "kill", "-s", "SIGKILL", `beamhop-${name}.service`]);
  else if (kind === "launchd") sh(["launchctl", "kill", "SIGKILL", `gui/${process.getuid!()}/com.beamhop.${name}`]);
  else if (kind === "schtasks") sh(["schtasks", "/End", "/TN", `Beamhop\\${name}`]);
  else return;
  await Bun.sleep(1500);
  if (kind === "schtasks") {
    // Ending the task may leave agentd running on Windows; either way the app's revive makes sure it is up.
    await scut.reviveLocalHosts();
  }
  const after = await health(90_000);
  expect(after?.hostPubkey).toBe(before?.hostPubkey);
  expect(await chat("back?")).toContain("message #2");
}, 300_000);

test("remove unregisters it and stops it", async () => {
  const a = scut.get(id);
  const name = unit();
  await scut.remove(id);
  expect(existsSync(join(process.env.SCUT_HOME!, "hosts", name))).toBe(false);
  expect(await fetch(`${a.current.endpoint}/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false)).toBe(false);
  if (kind === "systemd") expect(sh(["systemctl", "--user", "is-active", `beamhop-${name}.service`]).out.trim()).not.toBe("active");
  if (kind === "launchd") expect(sh(["launchctl", "print", `gui/${process.getuid!()}/com.beamhop.${name}`]).code).not.toBe(0);
  if (kind === "schtasks") expect(sh(["schtasks", "/Query", "/TN", `Beamhop\\${name}`]).code).not.toBe(0);
}, 120_000);
