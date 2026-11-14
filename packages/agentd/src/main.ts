#!/usr/bin/env bun
// agentd — PID 1 of the agent image. Supervises the desktop, the harness and channels,
// serves the agent's own WSS endpoint (the agent is its own relay) and implements the beam protocol.
import {
  type AgentSpec, type AgentState, type BeamTicket, type ClientMsg, type Handoff, type ServerMsg,
  type Schedule, SCREEN, scheduleDue, bytesToHex, decodeTicket, generateSecretKey, getPublicKey, hexToBytes, readLease, seal, unseal, verifyAuth,
} from "@scut/protocol";
import { makeBundle, openBundle } from "@scut/beam";
import { createHarness, systemPromptFor, type Harness } from "@scut/agent";
import { TelegramChannel, type Channel } from "@scut/channels";
import type { Event } from "nostr-tools";
import type { ServerWebSocket } from "bun";
import { appendFile, mkdir, readFile } from "node:fs/promises";
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
// Telegram owner pairing: the owner proves themselves by sending "/pair <code>" to the bot.
let tgOwner: { userId: string; chatId: string; name: string } | null = null;
let tgPairCode = "";
let tgBot: string | undefined;
type ChatLine = { from: string; channel: string; text: string; ts: number };
const chatLog: ChatLine[] = [];
const narrationLog: { text: string; ts: number }[] = [];
let paused = false;
let schedules: Schedule[] = [];
let usageDay = new Date().toISOString().slice(0, 10);
let dayTokens = 0;

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
  const n = { text, ts: Date.now() };
  narrationLog.push(n);
  if (narrationLog.length > 200) narrationLog.shift();
  broadcast({ t: "narration", ...n });
}
function recordChat(line: ChatLine) {
  chatLog.push(line);
  if (chatLog.length > 500) chatLog.shift();
  broadcast({ t: "chat", ...line });
  appendFile(`${DATA}/chat.jsonl`, JSON.stringify(line) + "\n").catch(() => {});
}
function settingsMsg(): ServerMsg {
  return { t: "settings", autonomy: spec?.autonomy ?? "risky", dailyTokenBudget: spec?.dailyTokenBudget ?? 0, persona: spec?.persona, dayTokens };
}
function pairingMsg(): ServerMsg {
  return { t: "pairing", telegram: spec?.channels.telegram ? { bot: tgBot, code: tgOwner ? undefined : tgPairCode, owner: tgOwner?.name } : undefined };
}

// ---------- approvals ----------
const approvals = new Map<string, (ok: boolean, by: string) => void>();
const pendingApprovals = new Map<string, Extract<ServerMsg, { t: "approval.request" }>>();
function requestApproval(title: string, detail?: string): Promise<boolean> {
  const id = bytesToHex(crypto.getRandomValues(new Uint8Array(6)));
  const req = { t: "approval.request" as const, id, title, detail, ts: Date.now() };
  pendingApprovals.set(id, req);
  broadcast(req);
  const chat = tgOwner?.chatId;
  const tg = channels.find((c) => c.name === "telegram");
  if (tg && chat) tg.askApproval(chat, id, title).catch(() => {});
  setState("stuck");
  narrate(`Waiting for approval: ${title}`);
  return new Promise((resolve) => {
    approvals.set(id, (ok, by) => {
      approvals.delete(id);
      pendingApprovals.delete(id);
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
    if (paused) {
      narrate("Paused — waiting for you to hand back control");
      while (paused) await Bun.sleep(300);
      narrate("Resumed");
    }
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
function prompt(text: string, origin: { channel: string; chatId?: string; from: string; notify?: boolean }) {
  recordChat({ from: origin.from, channel: origin.channel, text, ts: Date.now() });
  queue = queue.then(async () => {
    if (!harness || state === "retired" || state === "quiescing") return;
    const today = new Date().toISOString().slice(0, 10);
    if (today !== usageDay) {
      usageDay = today;
      dayTokens = 0;
    }
    const budget = spec?.dailyTokenBudget ?? 0;
    if (budget > 0 && dayTokens >= budget) {
      const msg = `I've used today's token budget (${dayTokens.toLocaleString()} of ${budget.toLocaleString()}). Raise it in my settings or try again tomorrow.`;
      recordChat({ from: "agent", channel: origin.channel, text: msg, ts: Date.now() });
      if (origin.channel === "telegram" && origin.chatId) await channels.find((c) => c.name === "telegram")?.send(origin.chatId, msg);
      narrate("Budget reached");
      return;
    }
    setState("busy");
    try {
      const reply = await harness.prompt(text, (e) => {
        if (e.type === "tool" && !/computer/.test(e.name)) narrate(`Now: ${e.name}`);
        if (e.type === "usage") {
          tokens.input += e.input;
          tokens.output += e.output;
          dayTokens += e.input + e.output;
          Bun.write(`${DATA}/usage.json`, JSON.stringify({ tokens, usageDay, dayTokens })).catch(() => {});
        }
        if (e.type === "error") narrate(`Problem: ${e.message.slice(0, 160)}`);
      });
      const out = reply || "(no reply)";
      recordChat({ from: "agent", channel: origin.channel, text: out, ts: Date.now() });
      if ((origin.channel === "telegram" || origin.notify) && origin.chatId) await channels.find((c) => c.name === "telegram")?.send(origin.chatId, origin.notify ? `⏰ ${text}\n\n${out}` : out);
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
    tgOwner = await readJson(`${DATA}/telegram-owner.json`);
    const pf = await readJson<{ code: string }>(`${DATA}/telegram-pair.json`);
    tgPairCode = pf?.code ?? String(100000 + Math.floor(Math.random() * 900000));
    if (!pf) await Bun.write(`${DATA}/telegram-pair.json`, JSON.stringify({ code: tgPairCode }));
    tgBot = await c.botName();
    c.start(
      async (m) => {
        lastTelegramChat = m.chatId;
        const pair = m.text.match(/^\/(?:pair|start)\s+(\d{6})/);
        if (pair) {
          if (!tgOwner && pair[1] === tgPairCode) {
            tgOwner = { userId: m.fromId, chatId: m.chatId, name: m.from };
            await Bun.write(`${DATA}/telegram-owner.json`, JSON.stringify(tgOwner));
            await c.send(m.chatId, `Paired! I'm ${spec?.name}. You'll get my approval requests here.`);
            broadcast(pairingMsg());
          } else await c.send(m.chatId, tgOwner ? "I already have an owner." : "That code doesn't match.");
          return;
        }
        if (m.text === "/start") {
          await c.send(m.chatId, `Hi, I'm ${spec?.name}. ${tgOwner ? "Ask me anything." : "My owner can pair with /pair <code> from the Beamhop app."}`);
          return;
        }
        prompt(m.text, { channel: "telegram", chatId: m.chatId, from: m.from });
      },
      (id, ok, byId) => {
        if (tgOwner && byId === tgOwner.userId) resolveApproval(id, ok, `telegram:${tgOwner.name}`);
      },
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
  const usage = await readJson<{ tokens: typeof tokens; usageDay: string; dayTokens: number }>(`${DATA}/usage.json`);
  if (usage) {
    Object.assign(tokens, usage.tokens);
    usageDay = usage.usageDay;
    dayTokens = usage.dayTokens;
  }
  schedules = (await readJson<Schedule[]>(`${DATA}/schedules.json`)) ?? [];
  try {
    const lines = (await readFile(`${DATA}/chat.jsonl`, "utf8")).trim().split("\n").filter(Boolean).slice(-500);
    chatLog.splice(0, chatLog.length, ...lines.map((l) => JSON.parse(l)));
  } catch {}
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

// ---------- scheduled tasks ----------
setInterval(async () => {
  if (state !== "running" || !holdsLease()) return;
  let changed = false;
  for (const s of schedules) {
    if (!scheduleDue(s)) continue;
    s.lastRun = Date.now();
    changed = true;
    prompt(s.prompt, { channel: "schedule", from: "schedule", chatId: tgOwner?.chatId, notify: true });
  }
  if (changed) {
    await Bun.write(`${DATA}/schedules.json`, JSON.stringify(schedules, null, 2));
    broadcast({ t: "schedules", schedules });
  }
}, Number(process.env.SCUT_SCHEDULE_TICK_MS ?? 20_000));

// ---------- HTTP / WS server ----------
function authed(req: Request, url: URL) {
  const tok = url.searchParams.get("auth") ?? req.headers.get("authorization")?.replace(/^Scut /, "") ?? "";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? undefined;
  return !!ownerPubkey() && verifyAuth(tok, ownerPubkey(), 900, host);
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
      ws.send(JSON.stringify({ t: "history", chat: chatLog.slice(-100), narration: narrationLog.slice(-30) } satisfies ServerMsg));
      ws.send(JSON.stringify(pairingMsg()));
      ws.send(JSON.stringify(settingsMsg()));
      for (const req of pendingApprovals.values()) ws.send(JSON.stringify(req));
      ws.send(JSON.stringify({ t: "paused", paused } satisfies ServerMsg));
      ws.send(JSON.stringify({ t: "schedules", schedules } satisfies ServerMsg));
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
      } else if (m.t === "settings" && spec) {
        if (m.autonomy && ["ask", "risky", "auto"].includes(m.autonomy)) spec.autonomy = m.autonomy;
        if (typeof m.dailyTokenBudget === "number" && m.dailyTokenBudget >= 0) spec.dailyTokenBudget = Math.floor(m.dailyTokenBudget);
        if (typeof m.persona === "string") spec.persona = m.persona.slice(0, 2000);
        await Bun.write(`${DATA}/spec.json`, JSON.stringify(spec, null, 2));
        broadcast(settingsMsg());
      } else if (m.t === "pause") {
        paused = !!m.paused;
        narrate(paused ? "You have control — agent paused" : "Control handed back");
        broadcast({ t: "paused", paused });
      } else if (m.t === "schedules" && Array.isArray(m.schedules)) {
        schedules = m.schedules.slice(0, 50).map((s) => ({ ...s, prompt: String(s.prompt).slice(0, 2000) }));
        await Bun.write(`${DATA}/schedules.json`, JSON.stringify(schedules, null, 2));
        broadcast({ t: "schedules", schedules });
      } else if (m.t === "stop") {
        harness?.abort?.();
        for (const [id] of approvals) resolveApproval(id, false, "owner");
        narrate("Stopped by you");
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
