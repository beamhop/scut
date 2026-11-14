#!/usr/bin/env bun
// agentd — PID 1 of the agent image. Supervises the desktop, the harness and channels,
// serves the agent's own WSS endpoint (the agent is its own relay) and implements the beam protocol.
import {
  type AgentSpec, type AgentState, type BeamTicket, type ClientMsg, type Handoff, type ServerMsg,
  SCREEN, bytesToHex, decodeTicket, generateSecretKey, getPublicKey, hexToBytes, readLease, seal, unseal, verifyAuth,
} from "@scut/protocol";
import { makeBundle, openBundle } from "@scut/beam";
import { createHarness, systemPromptFor, type Harness } from "@scut/agent";
import { TelegramChannel, type Channel } from "@scut/channels";
import type { Event } from "nostr-tools";
import type { ServerWebSocket } from "bun";
import { mkdir, readFile } from "node:fs/promises";
import { Desktop } from "./desktop.ts";

const DATA = process.env.SCUT_DATA ?? "/data";
const PORT = Number(process.env.PORT ?? 8080);
const UI_DIR = process.env.SCUT_UI_DIR ?? "/opt/scut/ui";
const MCP_CMD = (process.env.SCUT_MCP_CMD ?? "bun /opt/scut/packages/agent/src/mcp-computer.ts").split(" ");
const INTERNAL_TOKEN = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[agentd]", ...a);

// ---------- persistent identity of this host (excluded from bundles) ----------
await mkdir(`${DATA}/.host`, { recursive: true });
const hostKeyFile = Bun.file(`${DATA}/.host/key`);
const hostSk = (await hostKeyFile.exists()) ? hexToBytes((await hostKeyFile.text()).trim()) : generateSecretKey();
if (!(await hostKeyFile.exists())) await Bun.write(hostKeyFile, bytesToHex(hostSk));
const hostPubkey = getPublicKey(hostSk);

const ticket: BeamTicket | null = process.env.BEAM_TICKET ? decodeTicket(process.env.BEAM_TICKET) : null;

let state: AgentState = "awaiting";
let spec: AgentSpec | null = null;
let agentSk: Uint8Array | null = null;
let lease: Event | null = null;
let desktop: Desktop | null = null;
let harness: Harness | null = null;
const channels: Channel[] = [];
const tokens = { input: 0, output: 0 };
let lastTelegramChat: string | undefined;

async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(p, "utf8")) as T;
  } catch {
    return null;
  }
}

function ownerPubkey() {
  return spec?.ownerPubkey ?? ticket?.ownerPubkey ?? "";
}
function holdsLease() {
  if (!spec || !lease) return false;
  return readLease(lease, spec.agentPubkey)?.holder === hostPubkey;
}
function setState(s: AgentState) {
  state = s;
  broadcast({ t: "state", state: s });
  log("state", s);
}

// ---------- WebSocket clients ----------
type WsData = { frames: boolean; id: string };
const clients = new Set<ServerWebSocket<WsData>>();
function broadcast(m: ServerMsg, except?: ServerWebSocket<WsData>) {
  const s = JSON.stringify(m);
  for (const c of clients) if (c !== except) c.send(s);
}
function narrate(text: string) {
  broadcast({ t: "narration", text, ts: Date.now() });
}

// ---------- approvals ----------
const approvals = new Map<string, (ok: boolean, by: string) => void>();
function requestApproval(title: string, detail?: string): Promise<boolean> {
  const id = bytesToHex(crypto.getRandomValues(new Uint8Array(6)));
  broadcast({ t: "approval.request", id, title, detail, ts: Date.now() });
  const chat = spec?.channels.telegram?.ownerChatId ? String(spec.channels.telegram.ownerChatId) : lastTelegramChat;
  const tg = channels.find((c) => c.name === "telegram");
  if (tg && chat) tg.askApproval(chat, id, title).catch(() => {});
  setState("stuck");
  narrate(`Waiting for approval: ${title}`);
  return new Promise((resolve) => {
    approvals.set(id, (ok, by) => {
      approvals.delete(id);
      broadcast({ t: "approval.resolved", id, ok, by });
      setState("busy");
      resolve(ok);
    });
  });
}
function resolveApproval(id: string, ok: boolean, by: string) {
  approvals.get(id)?.(ok, by); // first answer wins
}

// ---------- computer actions (used by MCP server, mock harness and the human) ----------
async function computer(a: Record<string, any>, who: "agent" | "owner"): Promise<Response> {
  if (!desktop) return new Response("desktop not running", { status: 409 });
  if (a.kind === "screenshot") {
    const png = await desktop.screenshotPng();
    return new Response(png, { headers: { "content-type": "image/png" } });
  }
  if (a.kind === "approval") {
    const ok = await requestApproval(String(a.title), a.detail);
    return Response.json({ ok });
  }
  if (who === "agent") {
    if (spec?.autonomy === "ask") {
      const ok = await requestApproval(`${a.kind}${a.url ? " " + a.url : ""}${a.x !== undefined ? ` at ${a.x},${a.y}` : ""}${a.text ? ` "${String(a.text).slice(0, 40)}"` : ""}`);
      if (!ok) return new Response("denied by owner", { status: 403 });
    }
    narrate(`Now: ${describe(a)}`);
    if (a.x !== undefined) broadcast({ t: "cursor", x: a.x, y: a.y, who: "agent" });
  }
  await desktop.act(a as any);
  return Response.json({ ok: true });
}
function describe(a: Record<string, any>) {
  switch (a.kind) {
    case "open_url": return `opening ${a.url}`;
    case "type": return `typing "${String(a.text).slice(0, 30)}"`;
    case "key": return `pressing ${a.keys}`;
    case "click": return `clicking at ${a.x},${a.y}`;
    case "scroll": return "scrolling";
    default: return a.kind;
  }
}

// ---------- prompts (serialized) ----------
let queue: Promise<unknown> = Promise.resolve();
function prompt(text: string, origin: { channel: string; chatId?: string; from: string }) {
  broadcast({ t: "chat", from: origin.from, channel: origin.channel, text, ts: Date.now() });
  queue = queue.then(async () => {
    if (!harness || state === "retired" || state === "quiescing") return;
    setState("busy");
    try {
      const reply = await harness.prompt(text, (e) => {
        if (e.type === "tool" && !/computer/.test(e.name)) narrate(`Now: ${e.name}`);
        if (e.type === "usage") {
          tokens.input += e.input;
          tokens.output += e.output;
        }
        if (e.type === "error") narrate(`Problem: ${e.message.slice(0, 160)}`);
      });
      const out = reply || "(no reply)";
      broadcast({ t: "chat", from: "agent", channel: origin.channel, text: out, ts: Date.now() });
      if (origin.channel === "telegram" && origin.chatId) await channels.find((c) => c.name === "telegram")?.send(origin.chatId, out);
      setState("running");
      narrate("Idle");
    } catch (e: any) {
      setState("stuck");
      narrate(`Stuck: ${String(e?.message ?? e).slice(0, 200)} — reply or take over to help`);
    }
  });
}

// ---------- lifecycle ----------
async function startChannels() {
  if (!spec || !holdsLease()) return;
  const tg = spec.channels.telegram?.token;
  if (tg) {
    const c = new TelegramChannel(tg);
    c.start(
      (m) => {
        lastTelegramChat = m.chatId;
        prompt(m.text, { channel: "telegram", chatId: m.chatId, from: m.from });
      },
      resolveApproval,
    );
    channels.push(c);
    log("telegram connected");
  }
}
async function stopChannels() {
  await Promise.all(channels.splice(0).map((c) => c.stop()));
}

async function run() {
  spec = await readJson<AgentSpec>(`${DATA}/spec.json`);
  lease = await readJson<Event>(`${DATA}/lease.json`);
  const sk = Bun.file(`${DATA}/.secrets/agent.key`);
  agentSk = (await sk.exists()) ? hexToBytes((await sk.text()).trim()) : null;
  if (!spec) return setState("awaiting");
  if (!holdsLease()) return setState("retired");
  setState("starting");
  await mkdir(`${DATA}/workspace`, { recursive: true });
  desktop = new Desktop(DATA);
  await desktop.start();
  harness = createHarness(
    {
      spec,
      dataDir: DATA,
      mcpCommand: MCP_CMD,
      mcpEnv: { SCUT_CONTROL_URL: `http://127.0.0.1:${PORT}`, SCUT_INTERNAL_TOKEN: INTERNAL_TOKEN },
      systemPrompt: systemPromptFor(spec),
    },
    async (a) => {
      const r = await computer(a, "agent");
      if (a.kind === "screenshot") return { bytes: (await r.arrayBuffer()).byteLength };
      return r.json();
    },
  );
  await harness.start();
  await startChannels();
  setState("running");
  narrate("Idle");
}

async function quiesce() {
  setState("quiescing");
  await stopChannels();
  await harness?.stop();
  harness = null;
  desktop?.stop();
  desktop = null;
  await Bun.sleep(300);
}

// ---------- incoming beam (awaiting state) ----------
let pendingHandoff: Handoff | null = null;
let pendingBundle: Uint8Array | null = null;
async function tryComplete() {
  if (!ticket || !pendingHandoff) return;
  if (ticket.mode === "beam" && !pendingBundle) return;
  const h = pendingHandoff;
  if (ticket.mode === "beam") await openBundle(DATA, pendingBundle!, h.bundleKey!, ticket.bundleHash);
  if (h.spec) await Bun.write(`${DATA}/spec.json`, JSON.stringify(h.spec, null, 2));
  await mkdir(`${DATA}/.secrets`, { recursive: true });
  await Bun.write(`${DATA}/.secrets/agent.key`, h.agentSk);
  await Bun.write(`${DATA}/lease.json`, JSON.stringify(h.lease));
  pendingHandoff = null;
  pendingBundle = null;
  log("beam complete", ticket.beamId);
  await run();
}

// ---------- outgoing beam ----------
const outgoing = new Map<string, Uint8Array>();

// ---------- stats ----------
let lastCpu: { idle: number; total: number } | null = null;
async function stats() {
  const line = (await readFile("/proc/stat", "utf8")).split("\n")[0].split(/\s+/).slice(1).map(Number);
  const idle = line[3] + (line[4] ?? 0);
  const total = line.reduce((a, b) => a + b, 0);
  const cpu = lastCpu ? 1 - (idle - lastCpu.idle) / Math.max(1, total - lastCpu.total) : 0;
  lastCpu = { idle, total };
  let memMb = 0;
  let memTotalMb = 0;
  try {
    memMb = Number(await readFile("/sys/fs/cgroup/memory.current", "utf8")) / 1048576;
    const max = (await readFile("/sys/fs/cgroup/memory.max", "utf8")).trim();
    memTotalMb = max === "max" ? 0 : Number(max) / 1048576;
  } catch {}
  if (!memTotalMb) {
    const mi = await readFile("/proc/meminfo", "utf8");
    const get = (k: string) => Number(mi.match(new RegExp(`${k}:\\s+(\\d+)`))?.[1] ?? 0) / 1024;
    memTotalMb = get("MemTotal");
    if (!memMb) memMb = memTotalMb - get("MemAvailable");
  }
  broadcast({ t: "stats", cpu: Math.round(cpu * 100), memMb: Math.round(memMb), memTotalMb: Math.round(memTotalMb), tokens });
}
setInterval(() => clients.size && stats().catch(() => {}), 2000);

// ---------- HTTP / WS server ----------
function authed(req: Request, url: URL) {
  const tok = url.searchParams.get("auth") ?? req.headers.get("authorization")?.replace(/^Scut /, "") ?? "";
  return !!ownerPubkey() && verifyAuth(tok, ownerPubkey());
}

Bun.serve<WsData>({
  port: PORT,
  hostname: "0.0.0.0",
  idleTimeout: 120,
  async fetch(req, server) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p === "/health") return Response.json({ state, hostPubkey, mode: ticket?.mode ?? null, agent: spec?.id ?? ticket?.agentPubkey ?? null });
      if (p === "/beam/hello") return Response.json({ hostPubkey, state, ticket });

      if (p === "/internal/computer" && req.method === "POST") {
        if (req.headers.get("x-internal-token") !== INTERNAL_TOKEN) return new Response("forbidden", { status: 403 });
        return computer((await req.json()) as Record<string, any>, "agent");
      }

      if (p === "/beam/handoff" && req.method === "POST") {
        if (state !== "awaiting" || !ticket) return new Response("not awaiting", { status: 409 });
        const { sealed } = (await req.json()) as { sealed: string };
        const h = unseal<Handoff>(hostSk, ticket.ownerPubkey, sealed); // only the owner can produce this
        if (h.beamId !== ticket.beamId) return new Response("wrong beam", { status: 400 });
        if (readLease(h.lease, ticket.agentPubkey)?.holder !== hostPubkey) return new Response("lease not for this host", { status: 400 });
        pendingHandoff = h;
        await tryComplete();
        return Response.json({ ok: true, state });
      }
      if (p === "/beam/bundle" && req.method === "PUT") {
        if (state !== "awaiting" || !ticket) return new Response("not awaiting", { status: 409 });
        if (!authed(req, url)) return new Response("unauthorized", { status: 401 });
        pendingBundle = new Uint8Array(await req.arrayBuffer());
        await tryComplete();
        return Response.json({ ok: true, state });
      }

      // everything below requires the owner's signature
      if (!authed(req, url)) {
        if (p === "/" || p.startsWith("/assets") || p.endsWith(".js") || p.endsWith(".css")) return serveUi(p);
        return new Response("unauthorized", { status: 401 });
      }

      if (p === "/ws") {
        if (server.upgrade(req, { data: { frames: false, id: bytesToHex(crypto.getRandomValues(new Uint8Array(4))) } })) return;
        return new Response("upgrade failed", { status: 400 });
      }
      if (p === "/status") return Response.json({ state, hostPubkey, spec: spec && { ...spec, model: spec.model && { ...spec.model, apiKey: undefined }, channels: Object.keys(spec.channels) }, holdsLease: holdsLease(), tokens });
      if (p === "/screenshot") {
        if (!desktop?.latest) return new Response("no frame", { status: 404 });
        return new Response(desktop.latest, { headers: { "content-type": "image/jpeg" } });
      }
      if (p === "/beam/prepare" && req.method === "POST") {
        if (!spec || !agentSk || state === "retired" || state === "awaiting") return new Response(`cannot beam from ${state}`, { status: 409 });
        await quiesce();
        const b = await makeBundle(DATA);
        const bundleId = bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
        outgoing.set(bundleId, b.cipher);
        const sealed = seal(hostSk, spec.ownerPubkey, { bundleKey: b.key, agentSk: bytesToHex(agentSk) });
        log("bundle ready", bundleId, b.cipher.length, "bytes");
        return Response.json({ bundleId, hash: b.hash, size: b.cipher.length, sealed, hostPubkey, lease });
      }
      if (p.startsWith("/beam/bundle/") && req.method === "GET") {
        const c = outgoing.get(p.split("/").pop()!);
        return c ? new Response(c, { headers: { "content-type": "application/octet-stream" } }) : new Response("no bundle", { status: 404 });
      }
      if (p === "/beam/commit" && req.method === "POST") {
        const { lease: next } = (await req.json()) as { lease: Event };
        const cur = lease && spec ? readLease(lease, spec.agentPubkey) : null;
        const nl = spec ? readLease(next, spec.agentPubkey) : null;
        if (!nl || (cur && nl.seq <= cur.seq)) return new Response("invalid lease", { status: 400 });
        lease = next;
        await Bun.write(`${DATA}/lease.json`, JSON.stringify(next));
        outgoing.clear();
        setState("retired");
        return Response.json({ ok: true });
      }
      if (p === "/beam/abort" && req.method === "POST") {
        outgoing.clear();
        if (state === "quiescing") await run();
        return Response.json({ ok: true, state });
      }
      return serveUi(p);
    } catch (e: any) {
      log("error", p, e?.message);
      return new Response(String(e?.message ?? e), { status: 500 });
    }
  },
  websocket: {
    open(ws) {
      clients.add(ws);
      ws.send(
        JSON.stringify({
          t: "hello",
          agent: { id: spec?.id ?? "", name: spec?.name ?? "", harness: spec?.harness ?? "mock", mascot: spec?.mascot, autonomy: spec?.autonomy ?? "risky" },
          state,
          screen: SCREEN,
        } satisfies ServerMsg),
      );
    },
    async message(ws, raw) {
      let m: ClientMsg;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (m.t === "subscribe") {
        ws.data.frames = m.frames;
        if (m.frames && desktop?.latest) ws.send(desktop.latest);
      } else if (m.t === "input") {
        if (desktop) await desktop.act(m as any).catch((e) => ws.send(JSON.stringify({ t: "error", message: String(e.message) })));
      } else if (m.t === "cursor") {
        broadcast({ t: "cursor", x: m.x, y: m.y, who: "owner" }, ws);
      } else if (m.t === "chat") {
        prompt(m.text, { channel: "app", from: "owner" });
      } else if (m.t === "approval") {
        resolveApproval(m.id, m.ok, "owner");
      }
    },
    close(ws) {
      clients.delete(ws);
    },
  },
});

// frames fan-out with simple backpressure
let frameHooked = false;
setInterval(() => {
  if (desktop && !frameHooked) {
    frameHooked = true;
    desktop.frameListeners.add((jpeg) => {
      for (const c of clients) if (c.data.frames && c.getBufferedAmount() < 1_000_000) c.send(jpeg);
    });
  }
  if (!desktop) frameHooked = false;
}, 200);

async function serveUi(p: string) {
  const f = Bun.file(`${UI_DIR}${p === "/" ? "/index.html" : p}`);
  if (await f.exists()) return new Response(f);
  const idx = Bun.file(`${UI_DIR}/index.html`);
  return (await idx.exists()) ? new Response(idx) : new Response("scut agent", { status: 200 });
}

log(`listening on :${PORT} host=${hostPubkey.slice(0, 12)} ticket=${ticket?.mode ?? "none"}`);
await run();
