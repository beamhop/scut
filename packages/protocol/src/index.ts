// Shared types and helpers for scut (Beamhop "beam your agent").
import { finalizeEvent, getPublicKey, verifyEvent, generateSecretKey, nip44, type Event } from "nostr-tools";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

export { bytesToHex, hexToBytes, generateSecretKey, getPublicKey };

export type HarnessKind = "pi" | "codex" | "copilot" | "opencode" | "mock";
export type Autonomy = "ask" | "risky" | "auto";

export interface ModelConfig {
  /** Provider id used by the harness, e.g. "anthropic", "openai", "ollama", or a custom id. */
  provider: string;
  /** Wire API: anthropic-messages | openai-completions | openai-responses */
  api: "anthropic-messages" | "openai-completions" | "openai-responses";
  baseUrl?: string;
  apiKey?: string;
  model: string;
}

/** Signing an agent in to a subscription (Codex: ChatGPT, Copilot CLI: GitHub Copilot) with a device code. */
export interface SigninState {
  harness: "codex" | "copilot";
  /** checking: being looked up · waiting: open `url` and enter `code` · error: the last try failed (see error). */
  state: "checking" | "signed-in" | "signed-out" | "waiting" | "error";
  url?: string;
  code?: string;
  expiresAt?: number;
  /** screen: the sign-in page is open in the agent's own browser (finish it with Take over) · code: a device code. */
  via?: "screen" | "code";
  /** "Logged in using ChatGPT", when the CLI says. */
  account?: string;
  error?: string;
}

export interface AgentSpec {
  id: string;
  name: string;
  harness: HarnessKind;
  model?: ModelConfig;
  /** On a subscription (no API brain): the model to ask for; unset = the CLI's own default (Copilot: auto). */
  subModel?: string;
  template?: "assistant" | "researcher" | "developer" | "custom";
  persona?: string;
  /** The owner's time zone (IANA), learned from the app; daily tasks the agent sets itself use it. */
  ownerTz?: string;
  mascot?: string;
  autonomy: Autonomy;
  ownerPubkey: string;
  agentPubkey: string;
  channels: {
    telegram?: { token: string; ownerChatId?: number };
    /** Slack Socket Mode: app-level token (xapp-) + bot token (xoxb-). */
    slack?: { appToken: string; botToken: string };
    discord?: { token: string };
    /** Nostr DMs (NIP-17). ownerPubkey receives approvals; defaults to the app owner key. */
    nostr?: { relays?: string[]; ownerPubkey?: string };
  };
  createdAt: number;
  /** Hard cap on model tokens per day (input + output). 0 or missing = no cap. */
  dailyTokenBudget?: number;
}

/** Ticket passed to a fresh instance via the BEAM_TICKET env var. Holds no secrets. */
export interface BeamTicket {
  beamId: string;
  mode: "create" | "beam";
  ownerPubkey: string;
  agentPubkey: string;
  /** sha256 hex of the encrypted bundle (beam mode). */
  bundleHash?: string;
  issuedAt: number;
}

/** Secrets handed to a new host, NIP-44 encrypted to its ephemeral host key. */
export interface Handoff {
  beamId: string;
  agentSk: string; // hex
  bundleKey?: string; // hex AES-256-GCM key (beam mode)
  spec?: AgentSpec; // create mode
  lease: Event; // signed by agent key, names the new holder
}

export const LEASE_KIND = 30333;
export const AUTH_KIND = 27235; // NIP-98 HTTP auth

export interface LeaseContent {
  holder: string; // host pubkey allowed to connect channels
  seq: number;
}

export function encodeTicket(t: BeamTicket): string {
  return Buffer.from(JSON.stringify(t)).toString("base64url");
}
export function decodeTicket(s: string): BeamTicket {
  return JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
}

export function signLease(agentSk: Uint8Array, agentId: string, content: LeaseContent): Event {
  return finalizeEvent(
    {
      kind: LEASE_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["d", `scut-lease:${agentId}`], ["p", content.holder]],
      content: JSON.stringify(content),
    },
    agentSk,
  );
}

export function readLease(ev: Event, agentPubkey: string): LeaseContent | null {
  if (ev.kind !== LEASE_KIND || ev.pubkey !== agentPubkey || !verifyEvent(ev)) return null;
  try {
    return JSON.parse(ev.content) as LeaseContent;
  } catch {
    return null;
  }
}

/** Owner auth token (NIP-98 style) for an agent endpoint. Valid for 60s, scoped to a host. */
export function signAuth(ownerSk: Uint8Array, host: string): string {
  const ev = finalizeEvent(
    { kind: AUTH_KIND, created_at: Math.floor(Date.now() / 1000), tags: [["u", host]], content: "scut" },
    ownerSk,
  );
  return Buffer.from(JSON.stringify(ev)).toString("base64url");
}

/** Verify an owner token. When `host` is given, the token must have been signed for that host (no replay to other agents). */
export function verifyAuth(token: string, ownerPubkey: string, maxAgeSec = 900, host?: string): boolean {
  try {
    const ev = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Event;
    if (ev.kind !== AUTH_KIND || ev.pubkey !== ownerPubkey || !verifyEvent(ev)) return false;
    if (host && ev.tags.find((t) => t[0] === "u")?.[1] !== host) return false;
    return Math.abs(Date.now() / 1000 - ev.created_at) <= maxAgeSec;
  } catch {
    return false;
  }
}

export function seal(senderSk: Uint8Array, recipientPubkey: string, data: unknown): string {
  const key = nip44.v2.utils.getConversationKey(senderSk, recipientPubkey);
  return nip44.v2.encrypt(JSON.stringify(data), key);
}
export function unseal<T>(recipientSk: Uint8Array, senderPubkey: string, payload: string): T {
  const key = nip44.v2.utils.getConversationKey(recipientSk, senderPubkey);
  return JSON.parse(nip44.v2.decrypt(payload, key)) as T;
}

// ---- WebSocket messages between UI and agentd ----
export type ClientMsg =
  | { t: "subscribe"; frames: boolean; fps?: number; /** small 480 px frames, for tiles and phones */ small?: boolean; /** the owner's IANA time zone, for tasks the agent schedules */ tz?: string }
  | { t: "input"; kind: "move" | "click" | "dblclick" | "down" | "up" | "scroll" | "key" | "type"; x?: number; y?: number; button?: number; dy?: number; keys?: string; text?: string }
  | { t: "cursor"; x: number; y: number }
  | { t: "chat"; text: string }
  | { t: "approval"; id: string; ok: boolean; /** Optional reason with a "Don't" ("Wrong site"), passed to the agent and echoed in chat apps. */ reason?: string }
  | { t: "stop" }
  | { t: "settings"; autonomy?: Autonomy; dailyTokenBudget?: number; persona?: string;
      /** The agent software that thinks (Pi, opencode, Codex, Copilot CLI, Demo). Restarts it once the current task is done. */
      harness?: HarnessKind;
      /** The subscription's model (Codex, Copilot CLI); null = the CLI's default. */
      subModel?: string | null;
      /** A new brain; null drops it (e.g. Codex or Copilot on a subscription signed in on the agent's screen). */
      model?: { api: ModelConfig["api"]; baseUrl: string; model: string; apiKey?: string } | null; channels?: { telegram?: { token: string } | null; slack?: { appToken: string; botToken: string } | null; discord?: { token: string } | null; nostr?: { relays?: string[]; ownerPubkey?: string } | null } }
  /**
   * Pause or resume. `control` (default true): Take over / Give back — the owner has the screen ("You have control").
   * control:false = a plain pause/resume ("Pause all", "Resume all"): it never takes the screen from the owner or hands it back.
   */
  | { t: "pause"; paused: boolean; control?: boolean }
  | { t: "schedules"; schedules: Schedule[] }
  | { t: "run_schedule"; id: string }
  | { t: "crew"; members: CrewMember[] }
  | { t: "memory"; op: "add" | "delete" | "edit"; id?: string; text?: string }
  | { t: "skills"; op: "add" | "delete"; name?: string; content?: string; url?: string }
  /** Subscription sign-in: start a device-code login, cancel it, check again, or sign out. */
  | { t: "signin"; op: "start" | "cancel" | "check" | "signout"; /** start: in the agent's own browser (default), or a device code. */ mode?: "screen" | "code" };

export type ServerMsg =
  | { t: "hello"; agent: Pick<AgentSpec, "id" | "name" | "harness" | "mascot" | "autonomy">; state: AgentState; screen: { w: number; h: number } }
  | { t: "state"; state: AgentState; /** ms epoch when this state began */ since?: number }
  | { t: "chat"; from: "owner" | "agent" | string; channel: string; text: string; ts: number }
  | { t: "narration"; text: string; ts: number }
  | ApprovalRequest
  | {
      t: "approval.resolved"; id: string; ok: boolean;
      /** Human-readable decider: "you in Beamhop", "you on Telegram", "you on Slack", "you on Discord", "you on Nostr", or "timeout". */
      by: string;
      /** Machine-readable source of the decision. */
      via?: ApprovalVia;
      /** When it was decided (ms epoch). */
      at?: number;
      /** The owner's reason for a "Don't", if they gave one. */
      reason?: string;
    }
  | { t: "stats"; cpu: number; memMb: number; memTotalMb: number; tokens: { input: number; output: number }; /** model tokens used today (UTC day, input + output) */ dayTokens?: number }
  | StatusMsg
  | { t: "cursor"; x: number; y: number; who: string }
  | { t: "error"; message: string }
  | { t: "history"; chat: { from: string; channel: string; text: string; ts: number }[]; narration: { text: string; ts: number }[] }
  | { t: "settings"; /** Runs directly on its computer, without a sandbox. */ unsandboxed?: boolean; /** x11: a whole Linux desktop; cdp: a browser only (no sandbox). */ screen?: "x11" | "cdp"; harness: HarnessKind; /** On a subscription: the model asked for (unset = default) and the ones it offers. */ subModel?: string; subModels?: { id: string; name: string }[]; autonomy: Autonomy; dailyTokenBudget: number; persona?: string; model?: { api: string; baseUrl?: string; model: string; hasKey: boolean }; dayTokens: number; channels: { telegram: boolean; slack: boolean; discord: boolean; nostr: boolean }; /** Same as StatusMsg.problem (for the safety check). */ problem?: AgentProblem }
  | ({ t: "signin" } & SigninState)
  | { t: "paused"; paused: boolean; /** true when the owner has the screen (Take over), false for a plain pause */ control?: boolean }
  | { t: "memory"; items: MemoryItem[] }
  | { t: "skills"; items: { name: string; description: string }[]; error?: string }
  /** The agent obtained a cloud provider key during an assisted signup; the app (owner) stores it. */
  | { t: "cloud.key"; provider: "fly" | "render" | "railway"; token: string; ts: number }
  | { t: "runs"; items: TaskRun[] }
  | { t: "schedules"; schedules: Schedule[] }
  | { t: "pairing"; code?: string; channels?: Record<string, { bot?: string; owner?: string; error?: string }>; telegram?: { bot?: string; code?: string; owner?: string } };

export type AgentState = "awaiting" | "starting" | "running" | "busy" | "stuck" | "quiescing" | "retired";

// ---- structured approvals ----
export type ApprovalKind = "payment" | "message" | "login" | "delete" | "open" | "other";
export const APPROVAL_KINDS: readonly ApprovalKind[] = ["payment", "message", "login", "delete", "open", "other"];
export type Risk = "low" | "medium" | "high";
/** Where a decision came from: an app socket, a chat app, the expiry timer, or the owner pressing Stop. */
export type ApprovalVia = "app" | "telegram" | "slack" | "discord" | "nostr" | "timeout" | "stop";

export interface ApprovalRequest {
  t: "approval.request";
  id: string;
  /** Verb-first, plain language: "Pay the invoice", "Open https://example.com". */
  title: string;
  /** Payload: the message text, amount, URL… (as given by the agent; selectable). */
  detail?: string;
  ts: number;
  /** small JPEG data URL of the screen when asked */
  shot?: string;
  /** What sort of action this is. The agent may suggest one; agentd upgrades it when the words say otherwise. */
  kind?: ApprovalKind;
  /** Computed by agentd from kind + keywords in title/detail. Never the agent's self-report. */
  risk?: Risk;
  /** ms epoch after which agentd denies it on its own (SCUT_APPROVAL_TTL_MIN, default 25). */
  expiresAt?: number;
  /** What started the task that asks: "app chat", "your Telegram message", "a Telegram message from @jan", "routine: HN digest", "crew room: Scout". */
  origin?: string;
}

/** Something the owner has to fix before the agent can work (fully or in one place), with where to fix it. */
export interface AgentProblem {
  /** One plain sentence, e.g. "Atlas has no brain yet. Add one in Settings → Brain." */
  text: string;
  /** Settings section that fixes it: brain = pick a brain, key = paste a new key for the brain, signin = sign in to the subscription brain, channel = a chat app's token. */
  fix?: "brain" | "channel" | "key" | "signin";
}

/** Bench data: what the agent is doing, in one place. Sent on connect and whenever any of it changes. */
export interface StatusMsg {
  t: "status";
  state: AgentState;
  /**
   * One plain sentence: the latest step while working, "Waiting for you: {title}" with an approval pending,
   * "You have control" / "Paused while you have control" while the owner drives, "Paused" for a plain pause,
   * "Needs a brain" / "Needs a new key" with a problem, "Skipped: {title} (you said no)" after a denial, "Ready" when idle.
   */
  headline: string;
  /** ms epoch when the current state began ("Free since 14:02"). */
  since: number;
  /** The task being worked on right now, if any. */
  task?: { prompt: string; origin?: string; startedAt: number };
  /** First line of the agent's last reply (≤ 120 chars) and when it was sent. ok:false = the task failed (no brain, key rejected, error). */
  lastResult?: { text: string; ts: number; ok?: boolean };
  /** The next scheduled task to run (see nextRunAt). */
  nextRun?: { id: string; prompt: string; at: number };
  /** Number of approvals waiting for the owner. */
  pending: number;
  /** Model tokens used today (input + output). */
  dayTokens: number;
  /** The agent is paused (by Take over or a plain Pause): it waits before its next action. */
  paused?: boolean;
  /** The owner has the screen (Take over). Implies paused. */
  control?: boolean;
  /** Something to fix (no brain, rejected key, a chat app that can't sign in). Absent when all is well. */
  problem?: AgentProblem;
  /** The page on the agent's screen (best effort, from the browser). Absent on its own start page or a blank tab. */
  url?: string;
}

const RISK_RANK: Record<Risk, number> = { low: 0, medium: 1, high: 2 };
const KIND_RISK: Record<ApprovalKind, Risk> = { payment: "high", login: "high", delete: "high", message: "medium", open: "medium", other: "low" };
const KIND_WORDS: [ApprovalKind, RegExp][] = [
  ["payment", /\b(pay|pays|paid|paying|payments?|purchases?|purchasing|buy|buying|checkout|check out|place (an |the |my )?order|invoices?|cards?|iban|bank|transfer|subscribe|donate)\b|[€$£]\s?\d|\d\s?(eur|usd|gbp|euros?)\b/i],
  ["login", /\b(log ?in|logging in|logon|sign ?in|signing in|passwords?|passcode|passphrase|credentials?|2fa|otp|one-time code|verification code)\b/i],
  ["delete", /\b(delete|deleting|remove|removing|erase|wipe|destroy|empty the trash|unsubscribe|cancel (my|the|your))\b/i],
  ["message", /\b(send|sending|messages?|e-?mails?|mail|reply|replying|respond|post|posting|tweet|dm|contact|invite|share)\b/i],
  ["open", /\b(open|opening|visit|go to|browse|navigate|download|install)\b|https?:\/\/|www\./i],
];
const HIGH_WORDS = /\b(pay|pays|paid|paying|payments?|purchases?|buy|checkout|send|sending|delete|deleting|log ?in|sign ?in|credentials?|cards?|passwords?|passcode|iban|transfer)\b|[€$£]\s?\d/i;
const MEDIUM_WORDS = /\b(messages?|e-?mails?|mail|reply|post|tweet|dm|contact|new site|unknown site|visit|open)\b|https?:\/\//i;

/**
 * Classify an approval. `suggested` is the agent's own `kind` (a hint): agentd keeps it unless the words point to a
 * riskier kind. Risk is never taken from the agent: it is the higher of the kind's risk and the keyword risk.
 */
export function assessApproval(title: string, detail?: string, suggested?: string): { kind: ApprovalKind; risk: Risk } {
  const text = `${title}\n${detail ?? ""}`;
  const inferred = KIND_WORDS.find(([, re]) => re.test(text))?.[0] ?? "other";
  const hint = APPROVAL_KINDS.includes(suggested as ApprovalKind) ? (suggested as ApprovalKind) : "other";
  const kind = hint !== "other" && RISK_RANK[KIND_RISK[hint]] >= RISK_RANK[KIND_RISK[inferred]] ? hint : inferred;
  const words: Risk = HIGH_WORDS.test(text) ? "high" : MEDIUM_WORDS.test(text) ? "medium" : "low";
  const risk = RISK_RANK[words] > RISK_RANK[KIND_RISK[kind]] ? words : KIND_RISK[kind];
  return { kind, risk };
}

/** Risk as words (never colour alone): Low risk / Medium risk / High risk. */
export const RISK_WORD: Record<Risk, string> = { low: "Low risk", medium: "Medium risk", high: "High risk" };

/** "14:02" in the owner's time zone (UTC when unknown or invalid). */
export function clock(t: number, tz?: string): string {
  const f = (timeZone: string) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t);
  try {
    return f(tz || "UTC");
  } catch {
    return f("UTC");
  }
}

/** Text-first approval message for chat apps (screen readers in chat apps read text, not images). */
export function approvalText(req: Omit<ApprovalRequest, "t">, agentName: string, now = Date.now()): string {
  const lines = [`${agentName} wants to: ${req.title}`];
  if (req.risk || req.kind) lines.push([req.risk && RISK_WORD[req.risk], req.kind && req.kind !== "other" ? req.kind : undefined].filter(Boolean).join(" · "));
  if (req.detail) lines.push("", req.detail.slice(0, 1500), "");
  if (req.origin) lines.push(`Came from: ${req.origin}`);
  if (req.expiresAt) lines.push(`Decide within ${Math.max(1, Math.ceil((req.expiresAt - now) / 60_000))} min, then ${agentName} skips it.`);
  return lines.join("\n");
}

/** What a chat approval message is edited to once decided: "Allowed by you on Telegram · 14:02". */
export function approvalResolvedText(req: Pick<ApprovalRequest, "title">, agentName: string, ok: boolean, by: string, at: number, tz?: string, reason?: string): string {
  const verdict = by === "timeout" ? `Skipped: nobody answered in time, so ${agentName} didn't do it` : `${ok ? "Allowed" : "Not allowed"} by ${by}`;
  const why = !ok && reason?.trim() ? `\nReason: ${reason.trim().slice(0, 300)}` : "";
  return `${agentName} wanted to: ${req.title}\n${ok ? "✓" : "✕"} ${verdict} · ${clock(at, tz)}${why}`;
}

/** What the agent is told when the owner says no (or nobody answers): a normal outcome, not an error. */
export function denialText(via: ApprovalVia | "timeout", reason?: string): string {
  if (via === "timeout") return "No answer from your owner in time. Don't do it: skip this step and tell them you skipped it.";
  const why = reason?.trim() ? ` Their reason: ${reason.trim().slice(0, 300)}` : "";
  return `Your owner said no. Skip this step and tell them.${why}`;
}

/** An endpoint on this computer or a private network (Ollama, LM Studio…), which may work without a key. */
export function isLocalEndpoint(baseUrl: string): boolean {
  try {
    const h = new URL(baseUrl).hostname;
    return /^(localhost|127\.|0\.0\.0\.0|host\.docker\.internal|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/.test(h) || h.endsWith(".local") || h.endsWith(".internal");
  } catch {
    return false;
  }
}

/**
 * Does this agent have nothing to think with? Pi needs a model endpoint, and a key unless the endpoint is local.
 * The CLI harnesses (Codex, Copilot, opencode) can use a subscription signed in on the agent's screen; mock is a demo brain.
 */
export function brainMissing(spec: Pick<AgentSpec, "harness" | "model">): boolean {
  if (spec.harness !== "pi") return false;
  const m = spec.model;
  if (!m?.baseUrl || !m.model) return true;
  return !m.apiKey && !isLocalEndpoint(m.baseUrl);
}

/** Human-readable decider for approval.resolved `by`. */
export function approvalBy(via: ApprovalVia): string {
  switch (via) {
    case "app": case "stop": return "you in Beamhop";
    case "timeout": return "timeout";
    default: return `you on ${via.charAt(0).toUpperCase()}${via.slice(1)}`;
  }
}

export const SCREEN = { w: 1280, h: 800 };

/** A recurring task. `daily` runs at minuteOfDay (UTC); `every` runs every `minutes`. */
export interface MemoryItem {
  id: string;
  text: string;
  ts: number;
  source: "agent" | "owner";
}

export interface CrewMember {
  pubkey: string;
  name: string;
  kind: "agent" | "owner";
}

/** One finished run of a scheduled task, kept so the owner can see what happened while away. */
export interface TaskRun {
  id: string;
  scheduleId: string;
  prompt: string;
  startedAt: number;
  endedAt: number;
  ok: boolean;
  result: string;
  tokens: number;
  shot?: string; // data: URL of the screen when it finished
}

export interface Schedule {
  id: string;
  prompt: string;
  kind: "daily" | "every";
  minuteOfDay?: number;
  minutes?: number;
  lastRun?: number;
  /** When the task was added; a daily task added after today's time first runs tomorrow. */
  createdAt?: number;
  /** IANA time zone of the owner. When set, minuteOfDay is local wall-clock time there (DST-safe); otherwise UTC. */
  tz?: string;
  enabled: boolean;
}

/** Local date (as a UTC-midnight number) and minute of day of instant t in time zone tz. */
const partsFmt = new Map<string, Intl.DateTimeFormat>();
function localParts(t: number, tz: string): { day: number; mod: number } {
  let fmt = partsFmt.get(tz);
  if (!fmt) partsFmt.set(tz, (fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })));
  const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, x.value]));
  return { day: Date.UTC(+p.year, +p.month - 1, +p.day), mod: +p.hour * 60 + +p.minute };
}

export function scheduleDue(s: Schedule, now = Date.now()): boolean {
  if (!s.enabled) return false;
  if (s.kind === "every") return !s.lastRun || now - s.lastRun >= (s.minutes ?? 60) * 60_000;
  if (s.tz) {
    // Which day's run does an instant belong to? The latest local HH:MM at or before it.
    const m = s.minuteOfDay ?? 0;
    const slot = (t: number) => { const { day, mod } = localParts(t, s.tz!); return mod >= m ? day : day - 86_400_000; };
    const ref = s.lastRun ?? s.createdAt;
    return ref === undefined ? localParts(now, s.tz).mod >= m : slot(now) > slot(ref);
  }
  const d = new Date(now);
  const mod = d.getUTCHours() * 60 + d.getUTCMinutes();
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const at = today + (s.minuteOfDay ?? 0) * 60_000;
  return mod >= (s.minuteOfDay ?? 0) && (s.lastRun ?? s.createdAt ?? 0) < at;
}

/**
 * When `scheduleDue` will next turn true for this schedule (ms epoch): `now` if it is due already, undefined if disabled.
 * Follows scheduleDue exactly (UTC or the schedule's time zone, DST included) by searching forward, so the two never disagree.
 */
export function nextRunAt(s: Schedule, now = Date.now()): number | undefined {
  if (!s.enabled) return undefined;
  if (scheduleDue(s, now)) return now;
  if (s.kind === "every") return (s.lastRun ?? now) + (s.minutes ?? 60) * 60_000;
  // Daily: step forward in half hours (DST shifts are whole or half hours) for up to 3 days, then narrow down.
  const STEP = 30 * 60_000;
  let lo = now;
  for (let t = now + STEP; t <= now + 3 * 86_400_000; t += STEP) {
    if (scheduleDue(s, t)) {
      let hi = t;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (scheduleDue(s, mid)) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    lo = t;
  }
  return undefined;
}

/** The soonest enabled schedule and when it runs. */
export function nextScheduledRun(schedules: Schedule[], now = Date.now()): { id: string; prompt: string; at: number } | undefined {
  let best: { id: string; prompt: string; at: number } | undefined;
  for (const s of schedules) {
    const at = nextRunAt(s, now);
    if (at !== undefined && (!best || at < best.at)) best = { id: s.id, prompt: s.prompt, at };
  }
  return best;
}

// ---------- agent identity plate (shared by the app UI and the agent's own start page) ----------
/** 3-letter callsign: first letter + following consonants; falls back to the first three letters. */
export function callsign(name: string, fallbackHex = ""): string {
  const words = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  if (!words.length) return (fallbackHex.slice(0, 3) || "AGT").toUpperCase();
  if (words.length >= 3) return words.slice(0, 3).map((w) => w[0]).join("");
  const w = words[0]!;
  if (words.length === 2) return (w[0] + words[1][0] + (w.slice(1).replace(/[AEIOU]/g, "")[0] ?? words[1][1] ?? w[1] ?? "X")).slice(0, 3);
  const cons = w.slice(1).replace(/[AEIOUY]/g, "");
  if (cons.length >= 2) return w[0] + cons.slice(0, 2);
  return (w + "XXX").slice(0, 3);
}

function bytesOf(key: string): number[] {
  const hex = key.trim().toLowerCase();
  if (/^[0-9a-f]{16,}$/.test(hex)) return hex.match(/../g)!.map((b) => parseInt(b, 16));
  // Not a hex key (e.g. no key yet): FNV-1a over the string, stretched to 16 bytes.
  const out: number[] = [];
  let h = 0x811c9dc5;
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
    h = Math.imul(h ^ round, 0x01000193) >>> 0;
    out.push(h & 255, (h >>> 8) & 255, (h >>> 16) & 255, h >>> 24);
  }
  return out;
}

/** 25 booleans (row-major, 5×5), left half mirrored onto the right. Deterministic for a given key. */
export function glyphCells(key: string): boolean[] {
  const b = bytesOf(key || "beamhop");
  let best: number[] = [];
  // Use the first 15-bit window with a balanced amount of ink (6–11 of 15 dots); otherwise the last tried.
  for (let off = 0; off + 2 <= b.length; off += 2) {
    const bits = ((b[off] << 8) | b[off + 1]) & 0x7fff;
    const cells = Array.from({ length: 15 }, (_, i) => (bits >> i) & 1);
    best = cells;
    const on = cells.reduce((s, x) => s + x, 0);
    if (on >= 6 && on <= 11) break;
  }
  const grid: boolean[] = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) grid.push(!!best[r * 3 + (c < 3 ? c : 4 - c)]);
  return grid;
}

