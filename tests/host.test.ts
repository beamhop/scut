// No sandbox (the last rung): the agent runs as a normal process with a headless browser of its own. Same
// surface as in a sandbox: health, auth, live frames, chat that uses the computer, Take over input, settings that
// say "no sandbox", a revive after the process dies, beams to a sandbox (Docker, as the simulated cloud) and back
// with chat, memory and the browser profile (a cookie) intact, and a clean removal.
// Run: SCUT_IMAGE=ghcr.io/beamhop/scut-agent:dev bun test tests/host.test.ts --timeout 600000
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { ServerMsg } from "@scut/protocol";

process.env.SCUT_HOME = mkdtempSync(`${tmpdir()}/scut-host-`);
process.env.SCUT_LOCAL_DRIVER = "host";
process.env.SCUT_HOST_SERVICE = "none";
process.env.SCUT_SIM_CLOUD = "1";
process.env.SCUT_NO_AUTO_UPDATE = "1";
process.env.SCUT_IMAGE ??= "ghcr.io/beamhop/scut-agent:dev";
const { Scut } = await import("../apps/app/src/core.ts");
const docker = Bun.spawnSync(["docker", "info"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;

let scut: InstanceType<typeof Scut>;
let id = "";
// A page that sets a cookie and one that reports which cookies came back.
const seen: string[] = [];
const site = Bun.serve({
  port: 0,
  hostname: "0.0.0.0",
  fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/set") return new Response("<title>set</title>set", { headers: { "content-type": "text/html", "set-cookie": "beam=kept; Max-Age=86400; Path=/" } });
    seen.push(`${u.pathname} ${req.headers.get("cookie") ?? ""}`);
    return new Response("<title>echo</title>echo", { headers: { "content-type": "text/html" } });
  },
});

async function ws(endpoint: string, token: string) {
  const sock = new WebSocket(`${endpoint.replace(/^http/, "ws")}/ws?auth=${token}`);
  sock.binaryType = "arraybuffer";
  const msgs: ServerMsg[] = [];
  let frames = 0;
  sock.onmessage = (ev) => (typeof ev.data === "string" ? msgs.push(JSON.parse(ev.data)) : frames++);
  await new Promise<void>((r, j) => { sock.onopen = () => r(); sock.onerror = j; });
  sock.send(JSON.stringify({ t: "subscribe", frames: true }));
  return {
    sock, msgs, frames: () => frames,
    async waitFor<T = any>(pred: (m: any) => boolean, ms = 60_000): Promise<T> {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const m = msgs.find(pred);
        if (m) return m as T;
        await Bun.sleep(100);
      }
      throw new Error(`timeout; last: ${JSON.stringify(msgs.slice(-4))}`);
    },
  };
}
const chat = async (text: string) => {
  const a = scut.get(id);
  const c = await ws(a.current.endpoint, scut.auth(a.current.endpoint));
  const before = c.msgs.length;
  c.sock.send(JSON.stringify({ t: "chat", text }));
  const r = await c.waitFor((m) => m.t === "chat" && m.from === "agent" && c.msgs.indexOf(m) >= before, 90_000);
  c.sock.close();
  return r.text as string;
};
/** Listening sockets on a port, from /proc/net/tcp: local address and the owning pid. */
function listeners(port: string): { addr: string; pid?: string }[] {
  const hex = Number(port).toString(16).toUpperCase().padStart(4, "0");
  const rows = readFileSync("/proc/net/tcp", "utf8").split("\n").slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c[1]?.endsWith(`:${hex}`) && c[3] === "0A");
  return rows.map((c) => {
    const ip = c[1].split(":")[0].match(/../g)!.reverse().map((h) => parseInt(h, 16)).join(".");
    const inode = c[9];
    const pid = Bun.spawnSync(["sh", "-c", `for p in /proc/[0-9]*; do ls -l $p/fd 2>/dev/null | grep -q "socket:\\[${inode}\\]" && basename $p && break; done`], { stdout: "pipe" }).stdout.toString().trim() || undefined;
    return { addr: ip, pid };
  });
}
const hostFile = () => JSON.parse(readFileSync(`${process.env.SCUT_HOME}/hosts/${scut.get(id).current.meta!.name}/host.json`, "utf8")) as { pid: number; port: number };

beforeAll(async () => {
  scut = await Scut.open();
});
afterAll(async () => {
  for (const a of [...scut.agents]) await scut.remove(a.id).catch(() => {});
  site.stop(true);
});

test("the ladder can be forced to no sandbox, and says so", async () => {
  expect(scut.local.engine).toBe("host");
  const d = scut.drivers.get("local")!;
  expect(d.isolation).toBe("none");
  expect(d.label).toBe("This computer (no sandbox)");
});

test("create: a normal process on 127.0.0.1 with its own headless browser", async () => {
  const rec = await scut.create({ name: "Hosty", harness: "mock", autonomy: "risky" });
  id = rec.id;
  expect(rec.current.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(rec.current.meta?.engine).toBe("host");
  const h = await (await fetch(`${rec.current.endpoint}/health`)).json();
  expect(h.state).toBe("running");
  expect(h.unsandboxed).toBe(true);
  // Only this computer can reach it.
  const port = new URL(rec.current.endpoint).port;
  expect(listeners(port).map((l) => l.addr)).toEqual(["127.0.0.1"]);
  expect((await fetch(`${rec.current.endpoint}/status`)).status).toBe(401);
  // Its data lives in Beamhop's folder, not in the person's files.
  expect(existsSync(`${process.env.SCUT_HOME}/hosts/${rec.current.meta!.name}/data/spec.json`)).toBe(true);
}, 120_000);

test("live frames, settings say no sandbox, and Take over input reaches its screen", async () => {
  const a = scut.get(id);
  const c = await ws(a.current.endpoint, scut.auth(a.current.endpoint));
  const hello = await c.waitFor((m) => m.t === "hello");
  expect(hello.agent.name).toBe("Hosty");
  const settings = await c.waitFor((m) => m.t === "settings");
  expect(settings.unsandboxed).toBe(true);
  expect(settings.screen).toBe("cdp");
  c.sock.send(JSON.stringify({ t: "input", kind: "open_url", url: `http://127.0.0.1:${site.port}/takeover` }));
  c.sock.send(JSON.stringify({ t: "input", kind: "click", x: 640, y: 400, button: 1 }));
  c.sock.send(JSON.stringify({ t: "input", kind: "type", text: "hi" }));
  c.sock.send(JSON.stringify({ t: "input", kind: "key", keys: "ctrl+a" }));
  await Bun.sleep(2500);
  expect(c.frames()).toBeGreaterThan(0);
  expect(c.msgs.find((m: any) => m.t === "error")).toBeUndefined();
  expect(seen.some((s) => s.startsWith("/takeover"))).toBe(true);
  c.sock.close();
});

test("chat uses the computer: opens a page (sets a cookie) and takes a screenshot", async () => {
  const r = await chat(`please open http://127.0.0.1:${site.port}/set`);
  expect(r).toContain("message #1");
  expect(r).toMatch(/screenshot \d{4,} bytes/);
  const r2 = await chat(`check http://127.0.0.1:${site.port}/echo`);
  expect(r2).toContain("message #2");
  expect(seen.some((s) => s === "/echo beam=kept")).toBe(true);
}, 120_000);

test("instructions tell it there is no sandbox", async () => {
  const a = scut.get(id);
  const agents = readFileSync(`${process.env.SCUT_HOME}/hosts/${a.current.meta!.name}/data/workspace/mock-log.txt`, "utf8");
  expect(agents).toContain("please open");
  // The system prompt is written for every harness; mock doesn't write AGENTS.md, so check the prompt function.
  const { systemPromptFor } = await import("@scut/agent");
  expect(systemPromptFor({ name: "X" } as any, { unsandboxed: true })).toContain("not in a sandbox");
  expect(systemPromptFor({ name: "X" } as any)).not.toContain("not in a sandbox");
});

test("it keeps running when the app closes; after a restart revive brings it back", async () => {
  const a = scut.get(id);
  const port = new URL(a.current.endpoint).port;
  void port;
  const pid = String(hostFile().pid);
  expect(pid).toMatch(/^\d+$/);
  const before = await (await fetch(`${a.current.endpoint}/health`)).json();
  // "Restart": the agent's whole process group goes away.
  // It was started in its own process group (pgid = pid).
  process.kill(-Number(pid), "SIGKILL");
  await Bun.sleep(1000);
  expect(await fetch(`${a.current.endpoint}/health`).then((r) => r.ok, () => false)).toBe(false);
  await scut.reviveLocalHosts();
  const now = scut.get(id).current;
  await scut.waitState(now.endpoint, ["running"], 60_000);
  const after = await (await fetch(`${now.endpoint}/health`)).json();
  expect(after.hostPubkey).toBe(before.hostPubkey);
  const r = await chat("still there?");
  expect(r).toMatch(/message #\d+ received \("still there\?"\)/);
}, 120_000);

test.skipIf(!docker)("beam to a sandbox and back: chat, memory and browser profile come along", async () => {
  const a = scut.get(id);
  const c = await ws(a.current.endpoint, scut.auth(a.current.endpoint));
  // remember something (owner-side memory edit)
  c.sock.send(JSON.stringify({ t: "memory", op: "add", text: "Owner likes tea" }));
  await c.waitFor((m) => m.t === "memory" && JSON.stringify(m.items).includes("Owner likes tea"));
  c.sock.close();
  // (Set again: the crash test above killed the browser before it wrote cookies to disk, as a real crash would.)
  await chat(`open http://127.0.0.1:${site.port}/set`);
  const hostInst = scut.get(id).current;
  const via = process.env.HOST_TEST_VIA ?? "sim-cloud";
  await scut.beam(id, via);
  const cloud = scut.get(id).current;
  expect(cloud.driver).toBe(via);
  expect(await chat("in the sandbox now")).toMatch(/message #\d+ received .*screenshot \d{4,} bytes/s);
  // the host copy retired
  const old = await (await fetch(`${hostInst.endpoint}/health`)).json();
  expect(old.state).toBe("retired");
  await scut.beam(id, "local", { destroySource: true });
  const back = scut.get(id).current;
  expect(back.meta?.engine).toBe("host");
  expect(await chat("home again")).toMatch(/message #\d+ received .*screenshot \d{4,} bytes/s);
  // The cookie set before the trip is still sent: the profile opened in the sandbox's Chromium and here again.
  seen.length = 0;
  await chat(`check http://127.0.0.1:${site.port}/echo-after`);
  expect(seen).toContain("/echo-after beam=kept");
  const c2 = await ws(back.endpoint, scut.auth(back.endpoint));
  const mem = await c2.waitFor((m) => m.t === "memory");
  expect(JSON.stringify(mem.items)).toContain("Owner likes tea");
  c2.sock.close();
}, 600_000);

test("after the app is updated, an idle agent restarts on the new code and keeps its data", async () => {
  const a = scut.get(id);
  const f = `${process.env.SCUT_HOME}/hosts/${a.current.meta!.name}/host.json`;
  const h = JSON.parse(readFileSync(f, "utf8"));
  const before = await (await fetch(`${a.current.endpoint}/health`)).json();
  await Bun.write(f, JSON.stringify({ ...h, version: "older-app" }));
  const r = await scut.updateOutdatedHosts();
  expect(r.updated).toEqual(["Hosty"]);
  const now = scut.get(id).current;
  const after = await (await fetch(`${now.endpoint}/health`)).json();
  expect(after.state).toBe("running");
  expect(after.hostPubkey).toBe(before.hostPubkey);
  expect(JSON.parse(readFileSync(f, "utf8")).version).not.toBe("older-app");
  expect((await scut.updateOutdatedHosts()).updated).toEqual([]);
}, 120_000);

test("remove stops the process, frees the port and deletes its folder", async () => {
  const a = scut.get(id);
  const port = new URL(a.current.endpoint).port;
  const dir = `${process.env.SCUT_HOME}/hosts/${a.current.meta!.name}`;
  await scut.remove(id);
  expect(existsSync(dir)).toBe(false);
  expect(listeners(port)).toEqual([]);
  expect(await fetch(`${a.current.endpoint}/health`).then((r) => r.ok, () => false)).toBe(false);
}, 60_000);
