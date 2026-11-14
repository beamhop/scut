#!/usr/bin/env bun
// agentd — PID 1 of the agent image. Supervises the desktop, the harness and channels,
// serves the agent's own WSS endpoint (the agent is its own relay) and implements the beam protocol.
import {
  type AgentSpec, type AgentState, type HarnessKind, type SigninState, type BeamTicket, type ClientMsg, type Handoff, type ServerMsg,
  type CrewMember, type MemoryItem, type Schedule, type TaskRun, type ApprovalRequest, type ApprovalVia, type StatusMsg, type AgentProblem,
  SCREEN, callsign, glyphCells, scheduleDue, nextScheduledRun, assessApproval, approvalBy, approvalText, approvalResolvedText, denialText, brainMissing, bytesToHex, decodeTicket, generateSecretKey, getPublicKey, hexToBytes, readLease, seal, unseal, verifyAuth,
} from "@scut/protocol";
import { makeBundle, openBundle } from "@scut/beam";
import { createHarness, systemPromptFor, signinStatus, startSignin, signOut, subscriptionModels, type Harness, type Signin, type SubscriptionKind } from "@scut/agent";
import { DiscordChannel, NostrChannel, SlackChannel, TelegramChannel, type Channel } from "@scut/channels";
import type { Event } from "nostr-tools";
import type { ServerWebSocket } from "bun";
import { appendFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { createScreen, type Screen } from "./screen.ts";

const DATA = process.env.SCUT_DATA ?? "/data";
const PORT = Number(process.env.PORT ?? 8080);
/** Which build of this code runs here: the app installs its own build into agents whose code differs (agent-code.ts). */
const CODE = "__SCUT_AGENT_CODE__";
const HARNESSES: HarnessKind[] = ["pi", "opencode", "codex", "copilot", "mock"];
const HARNESS_NAME: Record<HarnessKind, string> = { pi: "Pi", opencode: "opencode", codex: "Codex", copilot: "Copilot CLI", mock: "the demo brain" };
const UI_DIR = process.env.SCUT_UI_DIR ?? "/opt/scut/ui";
/** Running directly on a computer (no sandbox): said everywhere the agent is shown, and in its instructions. */
const UNSANDBOXED = process.env.SCUT_UNSANDBOXED === "1";
// A JSON array (paths with spaces, e.g. C:\Users\Jane Doe\…) or a plain space-separated command.
const MCP_RAW = process.env.SCUT_MCP_CMD ?? "bun /opt/scut/packages/agent/src/mcp-computer.ts";
const MCP_CMD: string[] = MCP_RAW.trim().startsWith("[") ? JSON.parse(MCP_RAW) : MCP_RAW.split(" ");
const INTERNAL_TOKEN = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[agentd]", ...a);

// ---------- persistent identity of this host (excluded from bundles) ----------
await mkdir(`${DATA}/.host`, { recursive: true });
// Without a sandbox, the app stops an agent by this pid (and everything it started: browser, harness).
await Bun.write(`${DATA}/.host/pid`, String(process.pid));
const hostKeyFile = Bun.file(`${DATA}/.host/key`);
const hostSk = (await hostKeyFile.exists()) ? hexToBytes((await hostKeyFile.text()).trim()) : generateSecretKey();
if (!(await hostKeyFile.exists())) await Bun.write(hostKeyFile, bytesToHex(hostSk));
const hostPubkey = getPublicKey(hostSk);

const ticket: BeamTicket | null = process.env.BEAM_TICKET ? decodeTicket(process.env.BEAM_TICKET) : null;

let state: AgentState = "awaiting";
let spec: AgentSpec | null = null;
let agentSk: Uint8Array | null = null;
let lease: Event | null = null;
let desktop: Screen | null = null;
let harness: Harness | null = null;
const channels: Channel[] = [];
const tokens = { input: 0, output: 0 };
let lastTelegramChat: string | undefined;
// Telegram owner pairing: the owner proves themselves by sending "/pair <code>" to the bot.
type ChannelOwner = { userId: string; chatId: string; name: string };
let owners: Record<string, ChannelOwner> = {};
let pairCode = "";
const bots: Record<string, string | undefined> = {};
/** Chat apps whose token didn't work (yet): shown to the owner, retried in the background. */
const channelErrors: Record<string, string | undefined> = {};
type ChatLine = { from: string; channel: string; text: string; ts: number };
const chatLog: ChatLine[] = [];
const narrationLog: { text: string; ts: number }[] = [];
let paused = false;
/** The owner has the screen (Take over), as opposed to a plain pause. */
let control = false;
let crew: CrewMember[] = [];
let memory: MemoryItem[] = [];
async function saveMemory() {
  await Bun.write(`${DATA}/memory.json`, JSON.stringify(memory, null, 2));
  broadcast({ t: "memory", items: memory });
}
function memoryPreamble() {
  if (!memory.length) return "";
  return `[Things you remember — use them when relevant]\n${memory.map((m) => `- ${m.text}`).join("\n")}\n[End of memories]\n\n`;
}
// Loop guard: at most CREW_AGENT_LIMIT replies to other agents per window; the owner is never rate limited.
const CREW_AGENT_LIMIT = Number(process.env.SCUT_CREW_AGENT_LIMIT ?? 4);
const CREW_WINDOW_MS = 10 * 60_000;
const crewAgentReplies: number[] = [];
let schedules: Schedule[] = [];
let runs: TaskRun[] = [];
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
let stateSince = Date.now();
function setState(s: AgentState) {
  if (s !== state) stateSince = Date.now();
  state = s;
  broadcast({ t: "state", state: s, since: stateSince });
  log("state", s);
  pushStatus();
}

// ---------- WebSocket clients ----------
type WsData = { frames: boolean; small?: boolean; id: string; fps: number; lastSent: number; lastHash?: number | bigint };
const clients = new Set<ServerWebSocket<WsData>>();
function broadcast(m: ServerMsg, except?: ServerWebSocket<WsData>) {
  const s = JSON.stringify(m);
  for (const c of clients) if (c !== except) c.send(s);
  if (m.t === "schedules" || m.t === "paused" || m.t === "approval.request" || m.t === "approval.resolved" || m.t === "pairing" || m.t === "settings") pushStatus();
}
function narrate(text: string) {
  const n = { text, ts: Date.now() };
  narrationLog.push(n);
  if (narrationLog.length > 200) narrationLog.shift();
  broadcast({ t: "narration", ...n });
  if (currentTask && !/^(Ready|Resumed|Waiting for approval:)/.test(text)) lastStep = n;
  pushStatus();
}
function recordChat(line: ChatLine) {
  chatLog.push(line);
  if (chatLog.length > 500) chatLog.shift();
  broadcast({ t: "chat", ...line });
  appendFile(`${DATA}/chat.jsonl`, JSON.stringify(line) + "\n").catch(() => {});
  if (line.from === "agent") {
    lastResult = { text: firstLine(line.text), ts: line.ts };
    pushStatus();
  }
}
/** The agent's reply for a task that couldn't be done: shown and sent like a reply, but recorded as a failure. */
function recordFailure(line: ChatLine) {
  recordChat(line);
  lastResult = { text: firstLine(line.text), ts: line.ts, ok: false };
  pushStatus();
}
const firstLine = (t: string) => {
  const l = t.trim().split("\n").find((x) => x.trim())?.trim() ?? "";
  return l.length > 120 ? `${l.slice(0, 119)}…` : l;
};

// ---------- bench status (headline, since, last result, next run) ----------
type TaskInfo = { prompt: string; origin?: string; startedAt: number };
let currentTask: TaskInfo | null = null;
let lastStep: { text: string; ts: number } | null = null;
let lastResult: StatusMsg["lastResult"];
function todayTokens() {
  return usageDay === new Date().toISOString().slice(0, 10) ? dayTokens : 0;
}
/** A task's approvals the owner said no to (or nobody answered): the task goes on, and the bench says what was skipped. */
let skipped: { title: string; why: "no" | "timeout" } | null = null;
/** The brain's key was rejected by the provider; cleared when the brain or key changes. */
let keyRejected = false;

// ---------- subscription sign-in (Codex: ChatGPT, Copilot CLI: GitHub Copilot) ----------
const SUB_NAME: Record<SubscriptionKind, string> = { codex: "ChatGPT", copilot: "GitHub Copilot" };
let signin: SigninState | null = null;
let signinRun: Signin | null = null;
let subModels: { id: string; name: string }[] = [];
/** The subscription this agent thinks with, if it uses one (a CLI harness without an API brain). */
function subKind(): SubscriptionKind | null {
  return spec && (spec.harness === "codex" || spec.harness === "copilot") && !spec.model?.baseUrl ? spec.harness : null;
}
function setSignin(s: SigninState | null) {
  signin = s;
  if (s) broadcast({ t: "signin", ...s });
  pushStatus();
}
/** Look the sign-in up again (after a switch, on start, before a task), and the models the subscription offers. */
async function refreshSignin(): Promise<SigninState | null> {
  const k = subKind();
  if (!k) { signinRun?.cancel(); signinRun = null; signin = null; subModels = []; pushStatus(); return null; }
  if (signinRun && signin?.harness === k && signin.state === "waiting") return signin;
  const s = await signinStatus(k, `${DATA}/home`);
  setSignin(s);
  if (k === "codex" && !subModels.length) subModels = await subscriptionModels(k, `${DATA}/home`);
  if (k !== "codex") subModels = [];
  broadcast(settingsMsg());
  return s;
}
function beginSignin(mode: "screen" | "code" = "screen") {
  const k = subKind();
  if (!k) return;
  signinRun?.cancel();
  setSignin({ harness: k, state: "checking" });
  const open = desktop ? async (url: string) => { await (desktop!.openTab ?? desktop!.navigate).call(desktop, url); } : undefined;
  const run = startSignin(k, `${DATA}/home`, (s) => {
    if (signinRun !== run) return; // a newer try replaced this one
    setSignin(s);
    if (s.state === "signed-in") narrate(`Signed in to ${SUB_NAME[k]}`);
    if (s.state === "waiting" && s.via === "screen") narrate(`Opened the ${SUB_NAME[k]} sign-in on my screen: take over to sign in`);
  }, { mode, open });
  signinRun = run;
  run.done.finally(() => { if (signinRun === run) signinRun = null; });
}
function problem(): AgentProblem | undefined {
  const name = spec?.name ?? "Your agent";
  if (spec && brainMissing(spec)) return { text: `${name} has no brain yet. Add one in Settings → Brain.`, fix: "brain" };
  const k = subKind();
  if (k && signin && signin.state !== "signed-in" && signin.state !== "checking") return { text: `${name} isn't signed in to ${SUB_NAME[k]} yet. Sign in in Settings → Brain.`, fix: "signin" };
  if (keyRejected) return { text: `The brain's key was rejected. Paste a new key in Settings → Brain.`, fix: "key" };
  const names: Record<string, string> = { telegram: "Telegram", slack: "Slack", discord: "Discord" };
  const bad = Object.keys(names).find((k) => channelErrors[k] && (spec?.channels as Record<string, unknown> | undefined)?.[k]);
  if (bad) return { text: `${names[bad]} can't sign in, so messages and approvals there don't arrive. Check its token in Settings → Chat apps.`, fix: "channel" };
  return undefined;
}
function headline(): string {
  const waiting = [...pendingApprovals.values()][0];
  if (waiting) return `Waiting for you: ${waiting.title}`;
  switch (state) {
    case "awaiting": return "Waiting to arrive";
    case "starting": return "Starting up";
    case "quiescing": return "Packing up to move";
    case "retired": return "Moved to another place";
  }
  // Paused comes before "Ready": an idle agent whose screen you have is not free for a task.
  if (paused) {
    if (control) return currentTask ? "Paused while you have control" : "You have control";
    return currentTask ? "Paused: it waits before its next step" : "Paused";
  }
  if (state === "running") {
    const p = problem();
    if (p?.fix === "brain") return "Needs a brain";
    if (p?.fix === "key") return "Needs a new key";
    if (skipped) return `Skipped: ${firstLine(skipped.title).slice(0, 100)} (${skipped.why === "no" ? "you said no" : "nobody answered in time"})`;
    return "Ready";
  }
  if (state === "stuck" && !currentTask) {
    const last = narrationLog.at(-1)?.text;
    return last?.startsWith("Stuck") ? firstLine(last.replace(/ — reply or take over to help$/, "")) : "Stuck: reply or take over to help";
  }
  if (lastStep) {
    const t = lastStep.text.replace(/^Now:\s*/, "");
    return firstLine(t.charAt(0).toUpperCase() + t.slice(1));
  }
  return currentTask ? `Working on: ${firstLine(currentTask.prompt.replace(/^\[crew room\] /, "")).slice(0, 100)}` : "Working";
}
function statusMsg(): StatusMsg {
  return {
    t: "status", state, headline: headline(), since: stateSince,
    task: currentTask ? { ...currentTask, prompt: currentTask.prompt.slice(0, 300) } : undefined,
    lastResult, nextRun: nextScheduledRun(schedules), pending: pendingApprovals.size, dayTokens: todayTokens(), paused,
    ...(paused && control ? { control: true } : {}), problem: problem(), url: screenUrl,
  };
}
let lastStatus = "";
let statusTimer: ReturnType<typeof setTimeout> | undefined;
/** Broadcast the status when it changed; coalesces bursts (narration, usage, state) into one message. */
function pushStatus() {
  if (statusTimer) return;
  statusTimer = setTimeout(() => {
    statusTimer = undefined;
    const s = JSON.stringify(statusMsg());
    if (s === lastStatus) return;
    lastStatus = s;
    for (const c of clients) c.send(s);
  }, 50);
}
setInterval(pushStatus, 30_000); // "next run" and the day's tokens move with the clock too

/** Where the agent's screen is (for the bezel bar). Its own start page and blank tabs count as nowhere. */
let screenUrl: string | undefined;
setInterval(async () => {
  if (!desktop) return;
  const u = await desktop.currentUrl().catch(() => undefined);
  const shown = u && /^https?:/.test(u) && !u.startsWith(`http://127.0.0.1:${PORT}/`) && !u.startsWith(`http://localhost:${PORT}/`) ? u.slice(0, 2000) : undefined;
  if (shown !== screenUrl) {
    screenUrl = shown;
    pushStatus();
  }
}, 1500);
function settingsMsg(): ServerMsg {
  return { t: "settings", unsandboxed: UNSANDBOXED, screen: desktop?.kind ?? (process.env.SCUT_SCREEN === "cdp" ? "cdp" : "x11"), harness: spec?.harness ?? "mock", subModel: spec?.subModel, subModels, autonomy: spec?.autonomy ?? "risky", dailyTokenBudget: spec?.dailyTokenBudget ?? 0, persona: spec?.persona, model: spec?.model && { api: spec.model.api, baseUrl: spec.model.baseUrl, model: spec.model.model, hasKey: !!spec.model.apiKey }, dayTokens, channels: { telegram: !!spec?.channels.telegram, slack: !!spec?.channels.slack, discord: !!spec?.channels.discord, nostr: !!spec?.channels.nostr }, problem: problem() };
}
function pairingMsg(): ServerMsg {
  const chans = (["telegram", "slack", "discord"] as const).filter((n) => !!spec?.channels[n]);
  return {
    t: "pairing",
    code: chans.some((n) => !owners[n]) ? pairCode : undefined,
    channels: Object.fromEntries(chans.map((n) => [n, { bot: bots[n], owner: owners[n]?.name, error: channelErrors[n] }])),
    telegram: spec?.channels.telegram ? { bot: bots.telegram, code: owners.telegram ? undefined : pairCode, owner: owners.telegram?.name } : undefined,
  };
}

// ---------- approvals ----------
const APPROVAL_TTL_MIN = Number(process.env.SCUT_APPROVAL_TTL_MIN ?? 25);
type Decision = { ok: boolean; via: ApprovalVia; reason?: string };
const approvals = new Map<string, (ok: boolean, via: ApprovalVia, reason?: string) => void>();
const pendingApprovals = new Map<string, ApprovalRequest>();
/** Chat messages that carry an approval's buttons, so they can be edited once it's decided. */
type Posted = { channel: Channel; chatId: string; ref: Promise<string | undefined> };
function requestApproval(title: string, detail?: string, suggestedKind?: string): Promise<Decision> {
  const id = bytesToHex(crypto.getRandomValues(new Uint8Array(6)));
  const shot = desktop?.latest ? `data:image/jpeg;base64,${Buffer.from(desktop.latest).toString("base64")}` : undefined;
  title = String(title).trim().slice(0, 300) || "Do something";
  detail = detail ? String(detail).slice(0, 4000) : undefined;
  const ts = Date.now();
  // Risk comes from what the action is, never from the agent's own say-so.
  const { kind, risk } = assessApproval(title, detail, suggestedKind);
  const req: ApprovalRequest = { t: "approval.request", id, title, detail, ts, shot, kind, risk, expiresAt: ts + APPROVAL_TTL_MIN * 60_000, origin: currentTask?.origin };
  pendingApprovals.set(id, req);
  broadcast(req);
  const name = spec?.name ?? "Your agent";
  const text = approvalText(req, name);
  const posted: Posted[] = [];
  for (const c of channels) {
    const chatId = c.name === "nostr" ? nostrOwner() : owners[c.name]?.chatId;
    if (chatId) posted.push({ channel: c, chatId, ref: c.askApproval(chatId, id, text).catch(() => undefined) });
  }
  setState("stuck");
  narrate(`Waiting for approval: ${title}`);
  // Nobody answered in time: don't leave the agent hanging forever, and don't do the risky thing.
  const expire = setTimeout(() => {
    if (!approvals.has(id)) return;
    narrate(`No answer about "${title}" in ${APPROVAL_TTL_MIN} minutes — not doing it`);
    resolveApproval(id, false, "timeout");
  }, APPROVAL_TTL_MIN * 60_000);
  return new Promise((resolve) => {
    approvals.set(id, (ok, via, reason) => {
      clearTimeout(expire);
      approvals.delete(id);
      pendingApprovals.delete(id);
      const by = approvalBy(via);
      const at = Date.now();
      reason = !ok && typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 300) : undefined;
      broadcast({ t: "approval.resolved", id, ok, by, via, at, ...(reason ? { reason } : {}) });
      // Echo the decision in every chat that got the buttons, and take the buttons away so they can't fire twice.
      const done = approvalResolvedText(req, name, ok, by, at, spec?.ownerTz, reason);
      for (const p of posted) p.ref.then((ref) => (ref ? p.channel.closeApproval?.(p.chatId, ref, done) : undefined)).catch(() => {});
      // Saying no is a normal outcome: the task goes on without this step, and the bench says what was skipped.
      if (!ok && currentTask && via !== "stop") {
        skipped = { title, why: via === "timeout" ? "timeout" : "no" };
        lastStep = { text: `Skipped: ${title} (${via === "timeout" ? "nobody answered in time" : "you said no"})`, ts: at };
      }
      setState(currentTask ? "busy" : "running");
      resolve({ ok, via, reason });
    });
  });
}
function resolveApproval(id: string, ok: boolean, via: ApprovalVia, reason?: string) {
  approvals.get(id)?.(ok, via, reason); // first answer wins
}

// ---------- computer actions (used by MCP server, mock harness and the human) ----------
async function computer(a: Record<string, any>, who: "agent" | "owner"): Promise<Response> {
  if (!desktop) return new Response("desktop not running", { status: 409 });
  if (a.kind === "screenshot") {
    const png = await desktop.screenshotPng();
    return new Response(png as Uint8Array<ArrayBuffer>, { headers: { "content-type": "image/png" } });
  }
  if (a.kind === "crew_post") {
    const ok = await postCrew(String(a.text ?? ""));
    return Response.json({ ok });
  }
  if (a.kind === "remember") {
    const item: MemoryItem = { id: bytesToHex(crypto.getRandomValues(new Uint8Array(4))), text: String(a.text ?? "").slice(0, 500), ts: Date.now(), source: "agent" };
    if (item.text) {
      memory.push(item);
      if (memory.length > 200) memory.shift();
      await saveMemory();
      narrate(`Remembered: ${item.text.slice(0, 60)}`);
    }
    return Response.json({ ok: true, id: item.id });
  }
  if (a.kind === "forget") {
    memory = memory.filter((m) => m.id !== a.id);
    await saveMemory();
    return Response.json({ ok: true });
  }
  if (a.kind === "connect_channel") {
    if (!spec) return new Response("no spec", { status: 409 });
    const kind = String(a.channel);
    if (kind === "telegram" && a.token) spec.channels.telegram = { token: String(a.token).trim() };
    else if (kind === "discord" && a.token) spec.channels.discord = { token: String(a.token).trim() };
    else if (kind === "slack" && a.appToken && a.botToken) spec.channels.slack = { appToken: String(a.appToken).trim(), botToken: String(a.botToken).trim() };
    else return new Response("need channel + token(s)", { status: 400 });
    await Bun.write(`${DATA}/spec.json`, JSON.stringify(spec, null, 2));
    await stopChannels();
    await startChannels();
    broadcast(settingsMsg());
    broadcast(pairingMsg());
    narrate(`Connected ${kind}`);
    return Response.json({ ok: true, bot: bots[kind], pairCode: owners[kind] ? undefined : pairCode });
  }
  if (a.kind === "cloud_key") {
    const provider = String(a.provider);
    if (!["fly", "render", "railway"].includes(provider) || !a.token) return new Response("need provider + token", { status: 400 });
    // Handed to the owner's app over the authenticated socket; never stored in the agent.
    broadcast({ t: "cloud.key", provider: provider as any, token: String(a.token).trim(), ts: Date.now() });
    narrate(`Gave you a ${provider} key`);
    return Response.json({ ok: true, delivered: clients.size > 0 });
  }
  if (a.kind === "memories") return Response.json({ items: memory });
  if (a.kind === "schedule_task") {
    // The agent can set up its own routines ("every morning at 8 …"), in the owner's local time.
    const prompt = String(a.prompt ?? "").trim().slice(0, 2000);
    const at = String(a.daily_at ?? "").match(/^(\d{1,2}):(\d{2})$/);
    const every = Number(a.every_minutes ?? 0);
    if (!prompt || (!at && !(every >= 5))) return new Response("need prompt and daily_at (HH:MM) or every_minutes (>= 5)", { status: 400 });
    const s: Schedule = at
      ? { id: bytesToHex(crypto.getRandomValues(new Uint8Array(3))), prompt, kind: "daily", minuteOfDay: Math.min(23, +at[1]) * 60 + Math.min(59, +at[2]), enabled: true, createdAt: Date.now(), ...(spec?.ownerTz ? { tz: spec.ownerTz } : {}) }
      : { id: bytesToHex(crypto.getRandomValues(new Uint8Array(3))), prompt, kind: "every", minutes: Math.round(every), enabled: true, createdAt: Date.now(), lastRun: Date.now() };
    schedules = [...schedules, s].slice(-50);
    await Bun.write(`${DATA}/schedules.json`, JSON.stringify(schedules, null, 2));
    broadcast({ t: "schedules", schedules });
    narrate(`Scheduled: ${prompt.slice(0, 50)}`);
    return Response.json({ ok: true, id: s.id, timeZone: s.tz ?? "UTC" });
  }
  if (a.kind === "list_tasks") return Response.json({ tasks: schedules.map((s) => ({ id: s.id, prompt: s.prompt, when: s.kind === "daily" ? `daily ${String(Math.floor((s.minuteOfDay ?? 0) / 60)).padStart(2, "0")}:${String((s.minuteOfDay ?? 0) % 60).padStart(2, "0")} ${s.tz ?? "UTC"}` : `every ${s.minutes} min`, enabled: s.enabled })) });
  if (a.kind === "cancel_task") {
    const before = schedules.length;
    schedules = schedules.filter((s) => s.id !== String(a.id));
    await Bun.write(`${DATA}/schedules.json`, JSON.stringify(schedules, null, 2));
    broadcast({ t: "schedules", schedules });
    return Response.json({ ok: schedules.length < before });
  }
  if (a.kind === "crew_list") return Response.json({ members: crew.map((c) => ({ name: c.name, kind: c.kind })) });
  if (a.kind === "approval") {
    const d = await requestApproval(String(a.title ?? ""), a.detail, a.approval_kind);
    return Response.json({ ok: d.ok, by: d.via === "timeout" ? "timeout" : "owner", ...(d.ok ? {} : { reason: d.reason, message: denialText(d.via, d.reason) }) });
  }
  if (who === "agent") {
    if (paused) {
      narrate("Paused — waiting for you to hand back control");
      while (paused) await Bun.sleep(300);
      narrate("Resumed");
    }
    if (spec?.autonomy === "ask") {
      const ask = askTitle(a);
      const d = await requestApproval(ask.title, ask.detail, ask.kind);
      // Not an error: a plain answer the agent can act on (JSON, so every caller can read it).
      if (!d.ok) return Response.json({ ok: false, denied: true, by: d.via === "timeout" ? "timeout" : "owner", reason: d.reason, message: denialText(d.via, d.reason) }, { status: 403 });
    }
    narrate(`Now: ${describe(a)}`);
    if (a.x !== undefined) broadcast({ t: "cursor", x: a.x, y: a.y, who: "agent" });
  }
  await desktop.act(a as any);
  return Response.json({ ok: true });
}
/** A plain, verb-first approval title for one computer action (autonomy "ask"). */
function askTitle(a: Record<string, any>): { title: string; detail?: string; kind?: string } {
  const text = a.text !== undefined ? String(a.text) : "";
  switch (a.kind) {
    case "open_url": return { title: `Open ${a.url}`, kind: "open" };
    case "type": return { title: `Type "${text.length > 40 ? `${text.slice(0, 40)}…` : text}"`, detail: text.length > 40 ? text.slice(0, 2000) : undefined };
    case "key": return { title: `Press ${a.keys}` };
    case "click": return { title: `Click at ${a.x},${a.y}` };
    case "dblclick": return { title: `Double-click at ${a.x},${a.y}` };
    case "scroll": return { title: "Scroll the page" };
    default: return { title: String(a.kind) };
  }
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
type PromptOrigin = { channel: string; chatId?: string; from: string; fromId?: string; notify?: boolean; label?: string; onDone?: (r: { ok: boolean; text: string; tokens: number }) => void };
/** Where a task came from, in words, so the owner can spot a prompt that didn't come from them. */
function originLabel(o: PromptOrigin): string {
  if (o.label) return o.label;
  const app = { telegram: "Telegram", slack: "Slack", discord: "Discord", nostr: "Nostr" }[o.channel];
  if (o.channel === "app") return "app chat";
  if (app) {
    const mine = o.channel === "nostr" ? o.fromId === nostrOwner() : !!o.fromId && owners[o.channel]?.userId === o.fromId;
    return mine ? `your ${app} message` : `a ${app} message from ${o.from}`;
  }
  return o.channel;
}
function prompt(text: string, origin: PromptOrigin) {
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
      origin.onDone?.({ ok: false, text: msg, tokens: 0 });
      if (origin.chatId) await channels.find((c) => c.name === origin.channel)?.send(origin.chatId, msg).catch(() => {});
      narrate("Budget reached");
      return;
    }
    const reply = async (out: string) => {
      if (origin.notify) {
        // scheduled task: tell the owner wherever they paired
        for (const c of channels) {
          const owner = owners[c.name];
          if (owner) await c.send(owner.chatId, `⏰ ${text}\n\n${out}`).catch(() => {});
        }
      } else if (origin.chatId) {
        await channels.find((c) => c.name === origin.channel)?.send(origin.chatId, out).catch((e) => log(`${origin.channel} send failed`, e?.message));
      }
      if (origin.channel === "crew") await postCrew(out);
    };
    skipped = null;
    // No brain: say so plainly, and record a failure (never "(no reply)" reported as done).
    if (spec && brainMissing(spec)) {
      const msg = `${spec.name} has no brain yet, so it can't do this. Add one in Settings → Brain.`;
      recordFailure({ from: "agent", channel: origin.channel, text: msg, ts: Date.now() });
      origin.onDone?.({ ok: false, text: msg, tokens: 0 });
      narrate(`Problem: ${spec.name} has no brain yet`);
      await reply(msg);
      return;
    }
    // On a subscription that isn't signed in, the CLI would only retry its connection and fail: say what to do instead.
    const k = subKind();
    if (spec && k && (await refreshSignin())?.state !== "signed-in") {
      const msg = `${spec.name} isn't signed in to ${SUB_NAME[k]} yet, so it can't do this. Sign in in Settings → Brain.`;
      recordFailure({ from: "agent", channel: origin.channel, text: msg, ts: Date.now() });
      origin.onDone?.({ ok: false, text: msg, tokens: 0 });
      narrate(`Problem: not signed in to ${SUB_NAME[k]}`);
      await reply(msg);
      return;
    }
    currentTask = { prompt: text, origin: originLabel(origin), startedAt: Date.now() };
    lastStep = null;
    setState("busy");
    const t0 = dayTokens;
    const errors: string[] = [];
    try {
      const out0 = await harness.prompt(memoryPreamble() + text, (e) => {
        if (e.type === "tool" && !/computer/.test(e.name)) narrate(`Now: ${toolPhrase(e.name)}`);
        if (e.type === "usage") {
          tokens.input += e.input;
          tokens.output += e.output;
          dayTokens += e.input + e.output;
          Bun.write(`${DATA}/usage.json`, JSON.stringify({ tokens, usageDay, dayTokens })).catch(() => {});
          pushStatus();
        }
        if (e.type === "error") {
          errors.push(e.message);
          narrate(`Problem: ${e.message.slice(0, 160)}`);
        }
      });
      currentTask = null;
      const failed = !out0.trim() && errors.length > 0;
      if (failed) {
        // The brain answered with an error and no text: an honest failure, in plain words.
        const name = spec?.name ?? "Your agent";
        const keyBad = errors.some((m) => KEY_REJECTED.test(m));
        if (keyBad && !keyRejected) {
          keyRejected = true;
          broadcast(settingsMsg());
        }
        const msg = keyBad
          ? `${name} couldn't do this: its brain's key was rejected. Paste a new key in Settings → Brain.`
          : `${name} couldn't do this: its brain answered with an error (${firstLine(errors.at(-1)!).slice(0, 160)}).`;
        recordFailure({ from: "agent", channel: origin.channel, text: msg, ts: Date.now() });
        origin.onDone?.({ ok: false, text: msg, tokens: dayTokens - t0 });
        await reply(msg);
        setState("running");
        return;
      }
      if (keyRejected) {
        keyRejected = false; // it works again
        broadcast(settingsMsg());
      }
      const out = out0 || `${spec?.name ?? "Your agent"} finished without saying anything.`;
      recordChat({ from: "agent", channel: origin.channel, text: out, ts: Date.now() });
      origin.onDone?.({ ok: true, text: out, tokens: dayTokens - t0 });
      await reply(out);
      setState("running");
      narrate("Ready");
    } catch (e: any) {
      origin.onDone?.({ ok: false, text: String(e?.message ?? e), tokens: dayTokens - t0 });
      currentTask = null;
      narrate(`Stuck: ${String(e?.message ?? e).slice(0, 200)} — reply or take over to help`);
      setState("stuck");
    }
  });
}
/** Provider answers that mean "this key is no good". */
const KEY_REJECTED = /\b(401|403)\b|unauthori[sz]ed|invalid[^.]{0,20}(api[ _-]?)?key|incorrect api key|no auth credentials|authentication|api key (is )?(missing|invalid|not valid)/i;
/** Tool names as words, for narration and the bench headline. */
function toolPhrase(name: string) {
  const n = name.replace(/^mcp__\w+__/, "");
  const words: Record<string, string> = {
    screenshot: "looking at the screen", remember: "saving a memory", forget: "forgetting a memory", list_memories: "checking its memory",
    schedule_task: "setting up a routine", list_tasks: "checking its routines", cancel_task: "cancelling a routine",
    request_approval: "asking you first", crew_post: "posting to the crew room", crew_list: "checking the crew",
    connect_channel: "connecting a chat app", give_cloud_key: "handing you a cloud key", bash: "running a command",
    read: "reading a file", write: "writing a file", edit: "editing a file",
  };
  return words[n] ?? n.replace(/_/g, " ");
}

// ---------- lifecycle ----------
async function startChannels() {
  if (!spec || !holdsLease()) return;
  // Owner pairing is shared by all chat channels: one 6-digit code, "/pair <code>" (or "pair <code>") on any of them.
  owners = (await readJson(`${DATA}/channel-owners.json`)) ?? {};
  const legacy = await readJson<{ userId: string; chatId: string; name: string }>(`${DATA}/telegram-owner.json`);
  if (legacy && !owners.telegram) owners.telegram = legacy;
  const pf = (await readJson<{ code: string }>(`${DATA}/pair.json`)) ?? (await readJson<{ code: string }>(`${DATA}/telegram-pair.json`));
  pairCode = pf?.code ?? String(100000 + Math.floor(Math.random() * 900000));
  await Bun.write(`${DATA}/pair.json`, JSON.stringify({ code: pairCode }));
  const chatChannels: (Channel & { botName(): Promise<string | undefined> })[] = [];
  if (spec.channels.telegram?.token) chatChannels.push(new TelegramChannel(spec.channels.telegram.token));
  if (spec.channels.slack?.appToken && spec.channels.slack.botToken) chatChannels.push(new SlackChannel(spec.channels.slack.appToken, spec.channels.slack.botToken));
  if (spec.channels.discord?.token) chatChannels.push(new DiscordChannel(spec.channels.discord.token));
  for (const c of chatChannels) {
    bots[c.name] = await c.botName().catch(() => undefined);
    channelErrors[c.name] = bots[c.name] ? undefined : "Couldn't sign in with this token. Check it, or disconnect and paste a new one.";
    if (!bots[c.name]) {
      // Maybe just offline (laptop waking up): keep trying quietly, and clear the warning once it works.
      const retry = setInterval(async () => {
        if (!channels.includes(c)) return clearInterval(retry);
        const name = await c.botName().catch(() => undefined);
        if (!name) return;
        bots[c.name] = name;
        channelErrors[c.name] = undefined;
        clearInterval(retry);
        broadcast(pairingMsg());
      }, Number(process.env.SCUT_CHANNEL_RETRY_MS ?? 30_000));
    }
    c.start(
      async (m) => {
        if (c.name === "telegram") lastTelegramChat = m.chatId;
        const pair = m.text.match(/^\/?(?:pair|start)\s+(\d{6})\b/i);
        if (pair) {
          const owner = owners[c.name];
          if (!owner && pair[1] === pairCode) {
            owners[c.name] = { userId: m.fromId, chatId: m.chatId, name: m.from };
            await Bun.write(`${DATA}/channel-owners.json`, JSON.stringify(owners));
            await c.send(m.chatId, `Paired! I'm ${spec?.name}. You'll get my approval requests here.`);
            broadcast(pairingMsg());
          } else await c.send(m.chatId, owner ? "I already have an owner." : "That code doesn't match.");
          return;
        }
        if (m.text === "/start") {
          await c.send(m.chatId, `Hi, I'm ${spec?.name}. ${owners[c.name] ? "Ask me anything." : "My owner can pair with /pair <code> from the Beamhop app."}`);
          return;
        }
        prompt(m.text, { channel: c.name, chatId: m.chatId, from: m.from, fromId: m.fromId });
      },
      (id, ok, byId) => {
        const owner = owners[c.name];
        if (owner && byId === owner.userId) resolveApproval(id, ok, c.name as ApprovalVia);
      },
    );
    channels.push(c);
    log(`${c.name} connected`);
  }
  if (spec.channels.nostr && agentSk) {
    const n = new NostrChannel(agentSk, spec.channels.nostr.relays, `${DATA}/nostr-cursor`, {
      name: spec.name,
      about: `A Beamhop agent (${spec.template ?? "assistant"}). DM me.`,
    });
    n.onCrew = (m) => {
      const who = crew.find((c) => c.pubkey === m.from);
      const mentions = (n: string) => new RegExp(`(^|\\W)@${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\W|$)`, "i").test(m.text);
      const mentioned = mentions(spec!.name);
      const anyAgentMentioned = crew.some((c) => c.kind === "agent" && mentions(c.name));
      log("crew message", { from: who?.name ?? m.from.slice(0, 8), mentioned, anyAgentMentioned, crew: crew.length });
      // Owner: everyone answers unless the owner @mentions specific agents. Other agents: only when they @mention me.
      if (who?.kind !== "owner" && mentioned) {
        const now = Date.now();
        while (crewAgentReplies.length && now - crewAgentReplies[0] > CREW_WINDOW_MS) crewAgentReplies.shift();
        if (crewAgentReplies.length >= CREW_AGENT_LIMIT) {
          narrate(`Ignoring crew chatter from ${who?.name ?? "another agent"} to avoid a loop`);
          return;
        }
        crewAgentReplies.push(now);
      }
      if ((who?.kind === "owner" && (!anyAgentMentioned || mentioned)) || (who?.kind !== "owner" && mentioned)) prompt(`[crew room] ${who?.name ?? m.from.slice(0, 8)}: ${m.text}`, { channel: "crew", from: who?.name ?? "crew", label: `crew room: ${who?.kind === "owner" ? "you" : (who?.name ?? m.from.slice(0, 8))}` });
    };
    n.start(
      (m) => prompt(m.text, { channel: "nostr", chatId: m.chatId, from: m.from, fromId: m.fromId }),
      (id, ok, byId) => {
        if (byId === nostrOwner()) resolveApproval(id, ok, "nostr");
      },
    );
    channels.push(n);
    log("nostr connected");
  }
}
function nostrOwner() {
  return spec?.channels.nostr?.ownerPubkey ?? spec?.ownerPubkey;
}

async function postCrew(text: string) {
  const n = channels.find((c) => c.name === "nostr") as NostrChannel | undefined;
  if (!n || !crew.length) return false;
  await n.sendCrew(crew.map((c) => c.pubkey), text).catch((e) => log("crew send failed", e?.message));
  return true;
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
  runs = (await readJson<TaskRun[]>(`${DATA}/runs.json`)) ?? [];
  crew = (await readJson<CrewMember[]>(`${DATA}/crew.json`)) ?? [];
  memory = (await readJson<MemoryItem[]>(`${DATA}/memory.json`)) ?? [];
  try {
    const lines = (await readFile(`${DATA}/chat.jsonl`, "utf8")).trim().split("\n").filter(Boolean).slice(-500);
    chatLog.splice(0, chatLog.length, ...lines.map((l) => JSON.parse(l)));
  } catch {}
  const last = [...chatLog].reverse().find((l) => l.from === "agent");
  if (last) lastResult = { text: firstLine(last.text), ts: last.ts };
  setState("starting");
  await mkdir(`${DATA}/workspace`, { recursive: true });
  desktop = await createScreen(DATA, `http://127.0.0.1:${PORT}/start?name=${encodeURIComponent(spec!.name)}`);
  await desktop.start();
  harness = makeHarness();
  await harness.start();
  void refreshSignin().catch((e) => log("sign-in check failed", e?.message));
  await startChannels();
  setState("running");
  narrate("Ready");
}

function makeHarness() {
  // Without a sandbox, "this computer" is simply localhost (host.docker.internal is how sandboxes reach it).
  const own = UNSANDBOXED && spec!.model?.baseUrl ? { ...spec!, model: { ...spec!.model, baseUrl: spec!.model.baseUrl.replace("host.docker.internal", "127.0.0.1") } } : spec!;
  return createHarness(
    {
      spec: own,
      dataDir: DATA,
      mcpCommand: MCP_CMD,
      mcpEnv: { SCUT_CONTROL_URL: `http://127.0.0.1:${PORT}`, SCUT_INTERNAL_TOKEN: INTERNAL_TOKEN },
      systemPrompt: systemPromptFor(spec!, { unsandboxed: UNSANDBOXED }),
    },
    async (a) => {
      const r = await computer(a, "agent");
      if (a.kind === "screenshot") return { bytes: (await r.arrayBuffer()).byteLength };
      // A "no" from the owner is JSON too; anything else that isn't JSON becomes a plain error object, never a parse error.
      const body = await r.text();
      try {
        return JSON.parse(body);
      } catch {
        return { ok: false, error: body.slice(0, 300) };
      }
    },
  );
}

// ---------- skills (Agent Skills: ~/.agents/skills/<name>/SKILL.md, read by Pi; mirrored for Codex) ----------
const SKILLS_DIR = `${DATA}/home/.agents/skills`;
function parseSkill(md: string): { name: string; description: string } | null {
  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const name = fm[1].match(/^name:\s*["']?([a-z0-9-]{1,64})["']?\s*$/m)?.[1];
  const description = fm[1].match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1];
  return name && description ? { name, description: description.slice(0, 1024) } : null;
}
async function listSkills() {
  const out: { name: string; description: string }[] = [];
  try {
    for (const d of await readdir(SKILLS_DIR)) {
      const f = Bun.file(`${SKILLS_DIR}/${d}/SKILL.md`);
      if (await f.exists()) {
        const meta = parseSkill(await f.text());
        if (meta) out.push(meta);
      }
    }
  } catch {}
  return out;
}
function rawUrl(u: string) {
  // github.com/<o>/<r>/blob/<branch>/<path> -> raw.githubusercontent.com/<o>/<r>/<branch>/<path>
  const m = u.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|tree)\/([^/]+)\/(.+)$/);
  if (!m) return u;
  const path = m[4].endsWith("SKILL.md") ? m[4] : `${m[4].replace(/\/$/, "")}/SKILL.md`;
  return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${path}`;
}
async function restartHarnessWhenIdle() {
  await queue; // let any running prompt finish
  if (!harness || !spec) return;
  await harness.stop();
  harness = makeHarness();
  await harness.start();
}

async function quiesce() {
  setState("quiescing");
  await stopChannels();
  await harness?.stop();
  harness = null;
  await desktop?.stop();
  desktop = null;
}

// ---------- incoming beam (awaiting state) ----------
let pendingHandoff: Handoff | null = null;
let pendingBundle: Uint8Array | null = null;
async function tryComplete() {
  if (!ticket || !pendingHandoff) return;
  if (ticket.mode === "beam" && !pendingBundle) return;
  const h = pendingHandoff;
  if (ticket.mode === "beam") await openBundle(DATA, pendingBundle!, h.bundleKey!, ticket.bundleHash);
  // Moved by file to someone else's Beamhop (or a reinstalled one): whoever holds the agent's own key and the
  // bundle key may take ownership. The bundled spec names the old owner; hand it to the one who beamed it in.
  const bundled = ticket.mode === "beam" ? await readJson<AgentSpec>(`${DATA}/spec.json`) : null;
  if (bundled && !h.spec && bundled.ownerPubkey !== ticket.ownerPubkey) {
    if (bundled.agentPubkey !== ticket.agentPubkey || getPublicKey(hexToBytes(h.agentSk)) !== bundled.agentPubkey) throw new Error("agent key mismatch");
    log("new owner", ticket.ownerPubkey.slice(0, 12));
    bundled.ownerPubkey = ticket.ownerPubkey;
    await Bun.write(`${DATA}/spec.json`, JSON.stringify(bundled, null, 2));
  }
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
  broadcast({ t: "stats", cpu: Math.round(cpu * 100), memMb: Math.round(memMb), memTotalMb: Math.round(memTotalMb), tokens, dayTokens: todayTokens() });
}
setInterval(() => clients.size && stats().catch(() => {}), 2000);

// ---------- scheduled tasks ----------
setInterval(async () => {
  if (state !== "running" || paused || !holdsLease()) return; // paused (or driven): routines wait until resumed
  let changed = false;
  for (const s of schedules) {
    if (!scheduleDue(s)) continue;
    s.lastRun = Date.now();
    changed = true;
    runSchedule(s);
  }
  if (changed) {
    await Bun.write(`${DATA}/schedules.json`, JSON.stringify(schedules, null, 2));
    broadcast({ t: "schedules", schedules });
  }
}, Number(process.env.SCUT_SCHEDULE_TICK_MS ?? 20_000));

function runSchedule(s: Schedule) {
  const startedAt = Date.now();
  prompt(s.prompt, {
    channel: "schedule", from: "schedule", notify: true, label: `routine: ${firstLine(s.prompt).slice(0, 60)}`,
    onDone: (r) => {
      const shot = desktop?.latest ? `data:image/jpeg;base64,${Buffer.from(desktop.latest).toString("base64")}` : undefined;
      runs.push({ id: bytesToHex(crypto.getRandomValues(new Uint8Array(6))), scheduleId: s.id, prompt: s.prompt, startedAt, endedAt: Date.now(), ok: r.ok, result: r.text.slice(0, 4000), tokens: r.tokens, shot });
      runs = runs.slice(-10);
      Bun.write(`${DATA}/runs.json`, JSON.stringify(runs)).catch(() => {});
      broadcast({ t: "runs", items: runs });
    },
  });
}

// ---------- HTTP / WS server ----------
function authed(req: Request, url: URL) {
  const tok = url.searchParams.get("auth") ?? req.headers.get("authorization")?.replace(/^Scut /, "") ?? "";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? undefined;
  return !!ownerPubkey() && verifyAuth(tok, ownerPubkey(), 900, host);
}

Bun.serve<WsData>({
  port: PORT,
  // In a sandbox the host maps the port; directly on a computer (no sandbox) only this computer may reach it.
  hostname: process.env.SCUT_BIND ?? "0.0.0.0",
  idleTimeout: 255,
  // Beam bundles carry the whole workspace + browser profile; Bun's default request limit is 128 MB.
  maxRequestBodySize: Number(process.env.SCUT_MAX_BUNDLE_MB ?? 8192) * 1024 * 1024,
  async fetch(req, server) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p === "/health") return Response.json({ state, hostPubkey, mode: ticket?.mode ?? null, agent: spec?.id ?? ticket?.agentPubkey ?? null, code: CODE, ...(UNSANDBOXED ? { unsandboxed: true } : {}) });
      if (p === "/beam/hello") return Response.json({ hostPubkey, state, ticket });
      if (p === "/start") return new Response(startPage(spec?.name ?? "", spec?.agentPubkey ?? ""), { headers: { "content-type": "text/html; charset=utf-8", ...UI_HEADERS } });

      if (p === "/internal/computer" && req.method === "POST") {
        if (!sameToken(req.headers.get("x-internal-token"), INTERNAL_TOKEN)) return new Response("forbidden", { status: 403 });
        return computer((await req.json()) as Record<string, any>, "agent");
      }

      if (p === "/beam/handoff" && req.method === "POST") {
        if (state !== "awaiting" || !ticket) return new Response("not awaiting", { status: 409 });
        if (!smallBody(req)) return new Response("too large", { status: 413 });
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
        // The UI shell and its static files (fonts too: the start page and the phone page use them) are public.
        if (p === "/" || p.startsWith("/assets") || p.startsWith("/fonts/") || p.endsWith(".js") || p.endsWith(".css")) return serveUi(p);
        return new Response("unauthorized", { status: 401 });
      }

      if (p === "/ws") {
        if (server.upgrade(req, { data: { frames: false, fps: 8, lastSent: 0, id: bytesToHex(crypto.getRandomValues(new Uint8Array(4))) } })) return;
        return new Response("upgrade failed", { status: 400 });
      }
      if (p === "/status") return Response.json({ state, hostPubkey, spec: spec && { ...spec, model: spec.model && { ...spec.model, apiKey: undefined }, channels: Object.keys(spec.channels) }, holdsLease: holdsLease(), lease, tokens });
      if (p === "/screenshot") {
        if (!desktop?.latest) return new Response("no frame", { status: 404 });
        return new Response(desktop.latest as Uint8Array<ArrayBuffer>, { headers: { "content-type": "image/jpeg" } });
      }
      if (p === "/beam/prepare" && req.method === "POST") {
        if (!spec || !agentSk || state === "retired" || state === "awaiting") return new Response(`cannot beam from ${state}`, { status: 409 });
        await quiesce();
        const b = await makeBundle(DATA);
        const bundleId = bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
        outgoing.set(bundleId, b.cipher);
        const sealed = seal(hostSk, spec.ownerPubkey, { bundleKey: b.key, agentSk: bytesToHex(agentSk) });
        log("bundle ready", bundleId, b.cipher.length, "bytes");
        const carried = {
          chat: chatLog.length, memory: memory.length, schedules: schedules.length,
          skills: (await listSkills()).length, channels: Object.keys(spec.channels ?? {}).filter((k) => (spec!.channels as any)[k]).length,
        };
        return Response.json({ bundleId, hash: b.hash, size: b.cipher.length, sealed, hostPubkey, lease, carried });
      }
      if (p.startsWith("/beam/bundle/") && req.method === "GET") {
        const c = outgoing.get(p.split("/").pop()!);
        return c ? new Response(c as Uint8Array<ArrayBuffer>, { headers: { "content-type": "application/octet-stream" } }) : new Response("no bundle", { status: 404 });
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
    async open(ws) {
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
      if (signin && subKind()) ws.send(JSON.stringify({ t: "signin", ...signin } satisfies ServerMsg));
      for (const req of pendingApprovals.values()) ws.send(JSON.stringify(req));
      ws.send(JSON.stringify(statusMsg()));
      ws.send(JSON.stringify({ t: "paused", paused, control } satisfies ServerMsg));
      ws.send(JSON.stringify({ t: "schedules", schedules } satisfies ServerMsg));
      ws.send(JSON.stringify({ t: "runs", items: runs } satisfies ServerMsg));
      ws.send(JSON.stringify({ t: "memory", items: memory } satisfies ServerMsg));
      ws.send(JSON.stringify({ t: "skills", items: await listSkills() } satisfies ServerMsg));
    },
    async message(ws, raw) {
      let m: ClientMsg;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (m.t === "subscribe") {
        if (spec && typeof m.tz === "string" && m.tz.length < 64 && m.tz !== spec.ownerTz) {
          spec.ownerTz = m.tz;
          await Bun.write(`${DATA}/spec.json`, JSON.stringify(spec, null, 2));
        }
        ws.data.frames = m.frames;
        ws.data.small = !!m.small;
        ws.data.fps = Math.max(0.2, Math.min(15, Number(m.fps ?? 8)));
        ws.data.lastHash = undefined;
        updateThumbs();
        // first paint right away: a big frame is fine even for a small viewer (the small stream needs a moment to start)
        const first = m.small ? (desktop?.latestThumb ?? desktop?.latest) : desktop?.latest;
        if (m.frames && first) ws.send(first);
      } else if (m.t === "input") {
        if (desktop) await desktop.act(m as any).catch((e) => ws.send(JSON.stringify({ t: "error", message: String(e.message) })));
      } else if (m.t === "cursor") {
        broadcast({ t: "cursor", x: m.x, y: m.y, who: "owner" }, ws);
      } else if (m.t === "chat") {
        prompt(m.text, { channel: "app", from: "owner" });
      } else if (m.t === "approval") {
        resolveApproval(m.id, m.ok, "app", typeof m.reason === "string" ? m.reason : undefined);
      } else if (m.t === "settings" && spec) {
        if (m.autonomy && ["ask", "risky", "auto"].includes(m.autonomy)) spec.autonomy = m.autonomy;
        if (typeof m.dailyTokenBudget === "number" && m.dailyTokenBudget >= 0) spec.dailyTokenBudget = Math.floor(m.dailyTokenBudget);
        if (typeof m.persona === "string" && m.persona.slice(0, 2000) !== (spec.persona ?? "")) {
          spec.persona = m.persona.slice(0, 2000);
          // the job description lives in the system prompt: reload the harness once it's free
          restartHarnessWhenIdle().catch((e) => log("harness restart failed", e?.message));
        }
        let rebrain = false;
        if (m.harness && HARNESSES.includes(m.harness) && m.harness !== spec.harness) {
          spec.harness = m.harness;
          rebrain = true;
        }
        if (m.subModel !== undefined && (m.subModel ?? undefined) !== spec.subModel) {
          if (m.subModel) spec.subModel = String(m.subModel).slice(0, 120); else delete spec.subModel;
        }
        if (m.model === null && spec.model) {
          delete spec.model;
          rebrain = true;
        }
        if (m.model?.model && m.model.baseUrl && ["openai-completions", "anthropic-messages", "openai-responses"].includes(m.model.api)) {
          // A new brain: keep the old key unless a new one is given for the same endpoint.
          const keep = m.model.baseUrl === spec.model?.baseUrl ? spec.model?.apiKey : undefined;
          spec.model = { provider: spec.model?.provider ?? "scut", api: m.model.api, baseUrl: m.model.baseUrl, model: m.model.model.slice(0, 200), apiKey: m.model.apiKey || keep };
          rebrain = true;
        }
        if (rebrain) {
          keyRejected = false; // a new brain, key or agent software: give it a chance
          pushStatus();
          // Mid-task the old one finishes first, then the new one takes over.
          restartHarnessWhenIdle().then(() => { narrate(`Now thinking with ${HARNESS_NAME[spec!.harness]}`); subModels = []; return refreshSignin(); }).catch((e) => log("harness restart failed", e?.message));
        }
        if (m.channels) {
          const ch = { ...spec.channels };
          if (m.channels.telegram === null) delete ch.telegram;
          else if (m.channels.telegram?.token) ch.telegram = { token: m.channels.telegram.token };
          if (m.channels.slack === null) delete ch.slack;
          else if (m.channels.slack?.appToken && m.channels.slack.botToken) ch.slack = m.channels.slack;
          if (m.channels.discord === null) delete ch.discord;
          else if (m.channels.discord?.token) ch.discord = m.channels.discord;
          if (m.channels.nostr === null) delete ch.nostr;
          else if (m.channels.nostr) ch.nostr = { ...(ch.nostr ?? {}), ...m.channels.nostr };
          spec.channels = ch;
          if (holdsLease()) {
            await stopChannels();
            await startChannels();
            broadcast(pairingMsg());
          }
        }
        await Bun.write(`${DATA}/spec.json`, JSON.stringify(spec, null, 2));
        broadcast(settingsMsg());
      } else if (m.t === "signin") {
        const k = subKind();
        if (!k) ws.send(JSON.stringify({ t: "error", message: "This agent doesn't use a subscription" } satisfies ServerMsg));
        else if (m.op === "start") beginSignin(m.mode === "code" ? "code" : "screen");
        else if (m.op === "cancel") { signinRun?.cancel(); signinRun = null; await refreshSignin(); }
        else if (m.op === "check") await refreshSignin();
        else if (m.op === "signout") { signinRun?.cancel(); signinRun = null; setSignin(await signOut(k, `${DATA}/home`)); }
      } else if (m.t === "crew" && Array.isArray(m.members)) {
        crew = m.members.slice(0, 50);
        await Bun.write(`${DATA}/crew.json`, JSON.stringify(crew, null, 2));
      } else if (m.t === "memory") {
        if (m.op === "add" && m.text?.trim()) memory.push({ id: bytesToHex(crypto.getRandomValues(new Uint8Array(4))), text: m.text.trim().slice(0, 500), ts: Date.now(), source: "owner" });
        if (m.op === "delete") memory = memory.filter((x) => x.id !== m.id);
        if (m.op === "edit" && m.text?.trim()) memory = memory.map((x) => (x.id === m.id ? { ...x, text: m.text!.trim().slice(0, 500) } : x));
        await saveMemory();
      } else if (m.t === "skills") {
        let error: string | undefined;
        try {
          if (m.op === "add") {
            const md = m.content?.trim() ? m.content : m.url ? await (await fetch(rawUrl(m.url), { signal: AbortSignal.timeout(15_000) })).text() : "";
            const meta = parseSkill(md ?? "");
            if (!meta) throw new Error("That doesn't look like a SKILL.md (needs name and description frontmatter)");
            await mkdir(`${SKILLS_DIR}/${meta.name}`, { recursive: true });
            await Bun.write(`${SKILLS_DIR}/${meta.name}/SKILL.md`, md!);
            await mkdir(`${DATA}/home/.codex/skills`, { recursive: true });
            await Bun.write(`${DATA}/home/.codex/skills/${meta.name}.md`, md!);
            narrate(`Learned the skill "${meta.name}"`);
          } else if (m.op === "delete" && m.name && /^[a-z0-9-]+$/.test(m.name)) {
            await rm(`${SKILLS_DIR}/${m.name}`, { recursive: true, force: true });
            await rm(`${DATA}/home/.codex/skills/${m.name}.md`, { force: true });
          }
          restartHarnessWhenIdle().catch((e) => log("harness restart failed", e?.message));
        } catch (e: any) {
          error = String(e?.message ?? e);
        }
        broadcast({ t: "skills", items: await listSkills(), error });
      } else if (m.t === "pause") {
        const was = { paused, control };
        // A plain pause/resume (control:false, e.g. "Pause all" / "Resume all") never takes the screen from the owner
        // or hands it back: only Take over / Give back do that.
        const plain = m.control === false;
        if (!(plain && was.control)) {
          paused = !!m.paused;
          control = paused && !plain;
        }
        if (paused !== was.paused || control !== was.control) {
          if (paused) narrate(control ? "You have control — agent paused" : "Paused by you");
          else narrate(was.control ? "Control handed back" : "Resumed by you");
        }
        broadcast({ t: "paused", paused, control });
      } else if (m.t === "schedules" && Array.isArray(m.schedules)) {
        const known = new Map(schedules.map((s) => [s.id, s]));
        schedules = m.schedules.slice(0, 50).map((s) => ({ ...s, prompt: String(s.prompt).slice(0, 2000), createdAt: s.createdAt ?? known.get(s.id)?.createdAt ?? Date.now() }));
        await Bun.write(`${DATA}/schedules.json`, JSON.stringify(schedules, null, 2));
        broadcast({ t: "schedules", schedules });
      } else if (m.t === "run_schedule") {
        const s = schedules.find((x) => x.id === m.id);
        if (s) { s.lastRun = Date.now(); runSchedule(s); broadcast({ t: "schedules", schedules }); }
      } else if (m.t === "stop") {
        harness?.abort?.();
        for (const [id] of approvals) resolveApproval(id, false, "stop");
        narrate("Stopped by you");
      }
    },
    close(ws) {
      clients.delete(ws);
      updateThumbs();
    },
  },
});

// frames fan-out with simple backpressure
let frameHooked = false;
function updateThumbs() {
  desktop?.setThumbs([...clients].some((c) => c.data.frames && c.data.small));
}
setInterval(updateThumbs, 3000); // also catches viewers that left
setInterval(() => {
  if (desktop && !frameHooked) {
    frameHooked = true;
    const fanOut = (small: boolean) => (jpeg: Uint8Array) => {
      // Per-viewer frame rate, and skip frames identical to the last one sent (idle screens cost ~nothing).
      const hash = Bun.hash(jpeg);
      const now = Date.now();
      for (const c of clients) {
        const d = c.data;
        if (!d.frames || !!d.small !== small || c.getBufferedAmount() > 1_000_000) continue;
        if (now - d.lastSent < 1000 / d.fps - 20) continue;
        if (d.lastHash === hash && now - d.lastSent < 5000) continue;
        d.lastSent = now;
        d.lastHash = hash;
        c.send(jpeg);
      }
    };
    desktop.frameListeners.add(fanOut(false));
    desktop.thumbListeners.add(fanOut(true));
  }
  if (!desktop) frameHooked = false;
}, 200);

/** The agent's browser home page: what you see on its screen while it waits for a task. Self-contained (fonts come
 * from this same server), same Instrument look as the app, and deliberately still: an animated idle screen would turn
 * every preview into a constant video stream. Shows the agent's plate (key-derived glyph + callsign) and its name. */
function startPage(name: string, pubkey: string): string {
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const dots = glyphCells(pubkey || name)
    .map((on, i) => `<circle cx="${1.5 + (i % 5)}" cy="${1.5 + Math.floor(i / 5)}" r="${on ? 0.4 : 0.13}" fill="${on ? "#2b2924" : "#d6d3cc"}"/>`)
    .join("");
  const n = esc(name || "Your agent");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${n} is ready</title><style>
@font-face{font-family:Mona;src:url(/fonts/mona-sans-latin-wdth-normal.woff2) format("woff2-variations");font-weight:200 900;font-stretch:75% 125%}
html,body{margin:0;height:100%;background:#ebe9e4;color:#2b2924;font:16px/1.5 Mona,system-ui,sans-serif}
body{display:grid;place-items:center}
.c{display:flex;flex-direction:column;align-items:center;gap:20px;text-align:center}
.p{display:flex;align-items:center;gap:14px}.cs{font-weight:700;font-stretch:115%;letter-spacing:.05em;font-size:22px}
.n{font-size:44px;font-weight:650;letter-spacing:-.02em;line-height:1.1;margin:0}
.s{color:#68655e;max-width:30em;margin:0}
.f{position:fixed;left:0;right:0;bottom:28px;text-align:center;color:#7a776f;font-size:13px}
</style></head><body><main class="c">
<div class="p" aria-hidden="true"><svg width="64" height="64" viewBox="0 0 7 7"><rect x=".25" y=".25" width="6.5" height="6.5" rx="1.1" fill="#f6f5f2" stroke="#d6d3cc" stroke-width=".08"/>${dots}</svg><span class="cs">${esc(callsign(name, pubkey))}</span></div>
<h1 class="n">${n}</h1>
<p class="s">Ready for a task. Message ${n} in Beamhop or in a chat app.</p>
</main><p class="f">${UNSANDBOXED ? `This is ${n}'s own browser. ${n} runs on this computer without a sandbox, and asks before touching anything outside its folder.` : `This is ${n}'s own computer. Anything it does happens here, away from your files.`}</p></body></html>`;
}
const UI_HEADERS = { "x-content-type-options": "nosniff", "x-frame-options": "DENY", "content-security-policy": "frame-ancestors 'none'", "referrer-policy": "no-referrer" };
async function serveUi(p: string) {
  const f = Bun.file(`${UI_DIR}${p === "/" || p.includes("..") ? "/index.html" : p}`);
  if (await f.exists()) return new Response(f, { headers: UI_HEADERS });
  const idx = Bun.file(`${UI_DIR}/index.html`);
  return (await idx.exists()) ? new Response(idx, { headers: UI_HEADERS }) : new Response("scut agent", { status: 200 });
}
const smallBody = (req: Request) => Number(req.headers.get("content-length") ?? 0) <= 1024 * 1024;
const sameToken = (a: string | null, b: string) => !!a && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

log(`listening on :${PORT} host=${hostPubkey.slice(0, 12)} ticket=${ticket?.mode ?? "none"}`);
await run();
