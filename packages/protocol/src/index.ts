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
  mascot?: string;
  autonomy: Autonomy;
  ownerPubkey: string;
  agentPubkey: string;
  channels: {
    telegram?: { token: string; ownerChatId?: number };
    nostr?: { relays: string[] };
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

export function verifyAuth(token: string, ownerPubkey: string, maxAgeSec = 300): boolean {
  try {
    const ev = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Event;
    if (ev.kind !== AUTH_KIND || ev.pubkey !== ownerPubkey || !verifyEvent(ev)) return false;
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
  | { t: "subscribe"; frames: boolean; fps?: number }
  | { t: "input"; kind: "move" | "click" | "dblclick" | "down" | "up" | "scroll" | "key" | "type"; x?: number; y?: number; button?: number; dy?: number; keys?: string; text?: string }
  | { t: "cursor"; x: number; y: number }
  | { t: "chat"; text: string }
  | { t: "approval"; id: string; ok: boolean }
  | { t: "stop" }
  | { t: "settings"; autonomy?: Autonomy; dailyTokenBudget?: number; persona?: string };

export type ServerMsg =
  | { t: "hello"; agent: Pick<AgentSpec, "id" | "name" | "harness" | "mascot" | "autonomy">; state: AgentState; screen: { w: number; h: number } }
  | { t: "state"; state: AgentState }
  | { t: "chat"; from: "owner" | "agent" | string; channel: string; text: string; ts: number }
  | { t: "narration"; text: string; ts: number }
  | { t: "approval.request"; id: string; title: string; detail?: string; ts: number }
  | { t: "approval.resolved"; id: string; ok: boolean; by: string }
  | { t: "stats"; cpu: number; memMb: number; memTotalMb: number; tokens: { input: number; output: number } }
  | { t: "cursor"; x: number; y: number; who: string }
  | { t: "error"; message: string }
  | { t: "history"; chat: { from: string; channel: string; text: string; ts: number }[]; narration: { text: string; ts: number }[] }
  | { t: "settings"; autonomy: Autonomy; dailyTokenBudget: number; persona?: string; dayTokens: number }
  | { t: "pairing"; telegram?: { bot?: string; code?: string; owner?: string } };

export type AgentState = "awaiting" | "starting" | "running" | "busy" | "stuck" | "quiescing" | "retired";

export const SCREEN = { w: 1280, h: 800 };
