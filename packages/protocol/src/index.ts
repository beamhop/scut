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

export interface AgentSpec {
  id: string;
  name: string;
  harness: HarnessKind;
  model?: ModelConfig;
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
  | { t: "approval"; id: string; ok: boolean }
  | { t: "stop" }
  | { t: "settings"; autonomy?: Autonomy; dailyTokenBudget?: number; persona?: string; model?: { api: ModelConfig["api"]; baseUrl: string; model: string; apiKey?: string }; channels?: { telegram?: { token: string } | null; slack?: { appToken: string; botToken: string } | null; discord?: { token: string } | null; nostr?: { relays?: string[]; ownerPubkey?: string } | null } }
  | { t: "pause"; paused: boolean }
  | { t: "schedules"; schedules: Schedule[] }
  | { t: "run_schedule"; id: string }
  | { t: "crew"; members: CrewMember[] }
  | { t: "memory"; op: "add" | "delete" | "edit"; id?: string; text?: string }
  | { t: "skills"; op: "add" | "delete"; name?: string; content?: string; url?: string };

export type ServerMsg =
  | { t: "hello"; agent: Pick<AgentSpec, "id" | "name" | "harness" | "mascot" | "autonomy">; state: AgentState; screen: { w: number; h: number } }
  | { t: "state"; state: AgentState }
  | { t: "chat"; from: "owner" | "agent" | string; channel: string; text: string; ts: number }
  | { t: "narration"; text: string; ts: number }
  | { t: "approval.request"; id: string; title: string; detail?: string; ts: number; /** small JPEG data URL of the screen when asked */ shot?: string }
  | { t: "approval.resolved"; id: string; ok: boolean; by: string }
  | { t: "stats"; cpu: number; memMb: number; memTotalMb: number; tokens: { input: number; output: number } }
  | { t: "cursor"; x: number; y: number; who: string }
  | { t: "error"; message: string }
  | { t: "history"; chat: { from: string; channel: string; text: string; ts: number }[]; narration: { text: string; ts: number }[] }
  | { t: "settings"; autonomy: Autonomy; dailyTokenBudget: number; persona?: string; model?: { api: string; baseUrl?: string; model: string; hasKey: boolean }; dayTokens: number; channels: { telegram: boolean; slack: boolean; discord: boolean; nostr: boolean } }
  | { t: "paused"; paused: boolean }
  | { t: "memory"; items: MemoryItem[] }
  | { t: "skills"; items: { name: string; description: string }[]; error?: string }
  /** The agent obtained a cloud provider key during an assisted signup; the app (owner) stores it. */
  | { t: "cloud.key"; provider: "fly" | "render" | "railway"; token: string; ts: number }
  | { t: "runs"; items: TaskRun[] }
  | { t: "schedules"; schedules: Schedule[] }
  | { t: "pairing"; code?: string; channels?: Record<string, { bot?: string; owner?: string; error?: string }>; telegram?: { bot?: string; code?: string; owner?: string } };

export type AgentState = "awaiting" | "starting" | "running" | "busy" | "stuck" | "quiescing" | "retired";

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
function localParts(t: number, tz: string): { day: number; mod: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(t).map((x) => [x.type, x.value]));
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
