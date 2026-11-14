import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ServerMsg, AgentState, Schedule, MemoryItem, TaskRun } from "@scut/protocol";
import { nip19 } from "nostr-tools";
import qrcode from "qrcode-generator";
import { useAgent } from "./useAgent.ts";
import { BeamMenu, ExportDialog, ImportDialog, BeamReceipt, BeamProgress } from "./beam.tsx";
import { Tile, AutostartToggle, Dock, AddCloud, CrewRoomPanel, App, SoloAgent, CrewApp } from "./crew.tsx";
import { CreateAgent } from "./create.tsx";
import { AgentView, TelegramPairQr, PhoneLink } from "./agentView.tsx";
import { SettingsPanel, BrainSettings, PersonaSettings, RemoveAgent, safetyItems, SafetyCheck, SkillSettings, MemoryText, MemorySettings, ChannelStatus, ChannelSettings, SecretRow, RecentRuns, Schedules } from "./settings.tsx";

export type Instance = { driver: string; instanceId: string; endpoint: string };
export type Agent = {
  id: string; name: string; mascot: string; harness: string; agentPubkey: string;
  current: Instance; history: Instance[]; token: string;
  model?: { baseUrl?: string; model: string }; price?: { in: number; out: number };
  beam?: { to: string; from?: string; stage: string; error?: string; startedAt: number; doneAt?: number; summary?: { bytes: number; carried: Record<string, number | undefined> } };
};
export type Destination = { id: string; label: string; isolation: "vm" | "container"; monthlyUsd: number };

export const api = {
  agents: (): Promise<Agent[]> => fetch("/api/agents").then((r) => r.json()),
  destinations: (): Promise<Destination[]> => fetch("/api/destinations").then((r) => r.json()),
  create: (body: unknown) => fetch("/api/agents", { method: "POST", body: JSON.stringify(body) }).then((r) => r.json()),
  beam: (id: string, to: string) => fetch(`/api/agents/${id}/beam`, { method: "POST", body: JSON.stringify({ to }) }).then((r) => r.json()),
  remove: (id: string) => fetch(`/api/agents/${id}`, { method: "DELETE" }).then((r) => r.json()),
  brain: (): Promise<{ api: string; baseUrl: string; model: string; hasKey: boolean } | null> => fetch("/api/brain").then((r) => r.json()).catch(() => null),
  verifyBrain: (m: unknown): Promise<{ ok: boolean; error?: string; modelFound?: boolean; models?: string[] }> =>
    fetch("/api/brain/verify", { method: "POST", body: JSON.stringify(m) }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) })),
};

export const SCREEN = { w: 1280, h: 800 };
export const MASCOT_COLORS: Record<string, [string, string]> = {
  cyan: ["#38e1ff", "#0b5566"], magenta: ["#ff4fd8", "#661f57"], lime: ["#a8ff4f", "#3d661f"],
  amber: ["#ffb03b", "#664409"], violet: ["#b06bff", "#3f1f66"], coral: ["#ff6b6b", "#662424"],
};
export const BEAM_STAGES = ["packing", "provisioning", "transferring", "restoring", "online"] as const;
export const STAGE_LABEL: Record<string, string> = {
  packing: "Packing workspace, browser and memory", provisioning: "Starting the new computer", transferring: "Sending the encrypted bundle",
  restoring: "Restoring and handing over the keys", online: "Online at the destination",
};

// ---------------- agent socket ----------------
export type ChatLine = { from: string; channel: string; text: string; ts: number };
export type Approval = {
  id: string; title: string; detail?: string; ts: number; shot?: string;
  /** Structured approval fields (protocol ApprovalRequest): what kind of action, risk word, expiry, where the task came from. */
  kind?: import("@scut/protocol").ApprovalKind; risk?: import("@scut/protocol").Risk; expiresAt?: number; origin?: string;
};
/** An approval that was decided (approval.resolved), kept briefly so cards can echo "Allowed by you on Telegram, 14:02". */
export type ResolvedApproval = Approval & { ok: boolean; by: string; via?: string; at: number };
export type Settings = Extract<ServerMsg, { t: "settings" }>;
export type Pairing = Omit<Extract<ServerMsg, { t: "pairing" }>, "t">;

// ---------------- mascot: one base bot, silhouettes differ per variant, visor shows status ----------------
export function Mascot({ variant = "cyan", size = 40, state = "running" }: { variant?: string; size?: number; state?: string }) {
  const [c, d] = MASCOT_COLORS[variant] ?? MASCOT_COLORS.cyan;
  const top =
    variant === "magenta" ? <path d="M20 18 L14 6 M44 18 L50 6" stroke={c} strokeWidth="3" strokeLinecap="round" />
    : variant === "lime" ? <path d="M22 17 Q32 2 42 17" fill="none" stroke={c} strokeWidth="3" />
    : variant === "amber" ? <rect x="26" y="6" width="12" height="10" rx="3" fill={c} />
    : variant === "violet" ? <path d="M32 4 L36 16 L28 16 Z" fill={c} />
    : variant === "coral" ? <><circle cx="20" cy="12" r="4" fill={c} /><circle cx="44" cy="12" r="4" fill={c} /></>
    : <><line x1="32" y1="6" x2="32" y2="17" stroke={c} strokeWidth="3" strokeLinecap="round" /><circle cx="32" cy="6" r="4" fill={c} /></>;
  const body = variant === "amber" || variant === "lime" ? <rect x="10" y="17" width="44" height="34" rx="8" fill={d} stroke={c} strokeWidth="3" /> : <rect x="10" y="17" width="44" height="34" rx="17" fill={d} stroke={c} strokeWidth="3" />;
  const visor =
    state === "stuck" ? <text x="32" y="38.5" textAnchor="middle" fontSize="13" fontWeight="800" fill="#ffb03b">!</text>
    : state === "busy" ? <rect x="21" y="31" width="22" height="3" rx="1.5" fill={c}><animate attributeName="x" values="21;29;21" dur="1.2s" repeatCount="indefinite" /><animate attributeName="width" values="8;14;8" dur="1.2s" repeatCount="indefinite" /></rect>
    : state === "retired" || state === "awaiting" ? <path d="M23 33 h6 M35 33 h6" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
    : <><circle cx="26" cy="33" r="3.5" fill={c} /><circle cx="38" cy="33" r="3.5" fill={c} /></>;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`${variant} bot, ${state}`}>
      {top}
      {body}
      <rect x="17" y="26" width="30" height="14" rx="7" fill="#070912" />
      {visor}
      <path d="M22 51 l-3 8 M42 51 l3 8" stroke={c} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Plain-language version of an approval title like "open_url https://example.com at 3,4". */
export function humanize(title: string) {
  const m = title.match(/^(\w+)\s*(.*)$/);
  if (!m) return title;
  const [, kind, rest] = m;
  const host = rest.match(/https?:\/\/([^/\s]+)/)?.[1];
  switch (kind) {
    case "open_url": return `open ${host ?? rest}`;
    case "click": return "click on the screen";
    case "dblclick": return "double-click on the screen";
    case "type": return `type ${rest.match(/"(.*)"/)?.[0] ?? "text"}`;
    case "key": return `press ${rest}`;
    case "scroll": return "scroll";
    default: return title.charAt(0).toLowerCase() + title.slice(1);
  }
}
export function needsText(a: { approvals: { title: string }[]; state: string }) {
  return a.approvals.length || a.state === "stuck" ? "Waiting for you" : undefined;
}

export function cost(agent: Agent, t: { input: number; output: number }) {
  if (!agent.price) return t.input + t.output ? `${((t.input + t.output) / 1000).toFixed(1)}k tokens` : "";
  const usd = (t.input * agent.price.in + t.output * agent.price.out) / 1e6;
  return `$${usd.toFixed(2)} spent`;
}

export const STATE_META: Record<string, { label: string; icon: string; tone: string }> = {
  awaiting: { label: "Beaming in", icon: "◌", tone: "text-sky-300" },
  starting: { label: "Booting", icon: "◌", tone: "text-sky-300" },
  running: { label: "Ready", icon: "●", tone: "text-slate-400" },
  busy: { label: "Working", icon: "◆", tone: "text-beam" },
  stuck: { label: "Needs you", icon: "▲", tone: "text-amber-300" },
  quiescing: { label: "Packing up", icon: "◌", tone: "text-sky-300" },
  retired: { label: "Beamed away", icon: "○", tone: "text-slate-400" },
};
export function StateChip({ state }: { state: string }) {
  const m = STATE_META[state] ?? STATE_META.running;
  return <span className={`inline-flex items-center gap-1 rounded-full bg-[#070912e6] px-2 py-0.5 text-[11px] font-medium ring-1 ring-white/10 backdrop-blur ${m.tone}`}><span aria-hidden>{m.icon}</span>{m.label}</span>;
}

export function plural(n: number, one: string, many = one + "s") { return `${n} ${n === 1 ? one : many}`; }
export function bytesLabel(n: number) { return n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`; }

// ---------------- create / first run ----------------
export const TEMPLATES = [
  { id: "assistant", title: "Personal assistant", blurb: "Email, calendar and errands in its own browser", example: "Keep an eye on my inbox and draft replies for me to approve" },
  { id: "researcher", title: "Researcher", blurb: "Web research and sourced reports", example: "Research the best e-bikes under €2,000 and send me a short list" },
  { id: "developer", title: "Developer", blurb: "Codes with Pi, Codex, Copilot CLI or opencode", example: "Build a small landing page for my side project" },
];
export const HARNESSES = [
  { id: "pi", label: "Pi", note: "default" }, { id: "codex", label: "Codex CLI", note: "sign in on its screen" }, { id: "copilot", label: "Copilot CLI", note: "sign in on its screen" },
  { id: "opencode", label: "opencode", note: "" }, { id: "mock", label: "Demo", note: "no model" },
];
export const PRESETS: Record<string, { label: string; baseUrl: string; model: string; api: string; keyHint: string }> = {
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-haiku-5.5", api: "openai-completions", keyHint: "sk-or-…" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-5.6-luna", api: "openai-completions", keyHint: "sk-…" },
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com", model: "claude-haiku-5-5", api: "anthropic-messages", keyHint: "sk-ant-…" },
  ollama: { label: "Local (Ollama)", baseUrl: "http://host.docker.internal:11434/v1", model: "qwen3.8:8b", api: "openai-completions", keyHint: "not needed" },
};

export function npubToHex(s: string): string | undefined {
  const v = s.trim();
  if (!v) return undefined;
  if (/^[0-9a-f]{64}$/.test(v)) return v;
  try {
    const d = nip19.decode(v);
    return d.type === "npub" ? (d.data as string) : undefined;
  } catch {
    return undefined;
  }
}

// ---------------- agent view ----------------
export const KEYMAP: Record<string, string> = {
  Enter: "Return", Backspace: "BackSpace", Tab: "Tab", Escape: "Escape", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left",
  ArrowRight: "Right", Delete: "Delete", Home: "Home", End: "End", PageUp: "Prior", PageDown: "Next", " ": "space",
};

export const TELEGRAM_SETUP = [
  "Please set yourself up on Telegram:",
  "1. Open https://web.telegram.org/k/#@BotFather in your browser.",
  "2. If Telegram asks me to log in, call request_approval with the title \"Please log in to Telegram on my screen\" and wait until I approve.",
  "3. Send /newbot to BotFather, call the bot by your name, and pick a username ending in \"bot\".",
  "4. Copy the token BotFather gives you and call connect_channel with channel \"telegram\" and that token. Never write the token in chat.",
  "5. Tell me your bot's @username and the pairing code connect_channel returned.",
].join("\n");

export const CLOUD_SETUP = (provider: string, url: string) => [
  `Please help me connect ${provider} so I can move agents to the cloud:`,
  `1. Open ${url} in your browser.`,
  `2. If I need to sign up or log in, call request_approval with the title "Please sign in to ${provider} on my screen" and wait. I'll do any payment details myself.`,
  "3. Create an API key/token named \"beamhop\".",
  `4. Call give_cloud_key with provider "${provider.toLowerCase().replace(".io", "")}" and the key. Never write the key in chat.`,
].join("\n");

export function ago(ts: number) {
  const m = Math.round((Date.now() - ts) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(ts).toLocaleDateString();
}

export function Cursor({ p, color, label }: { p: { x: number; y: number }; color: string; label: string }) {
  return (
    <div className="pointer-events-none absolute transition-all duration-150" style={{ left: `${(p.x / SCREEN.w) * 100}%`, top: `${(p.y / SCREEN.h) * 100}%` }}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden><path d="M1 1 L1 15 L5 11 L8 17 L10 16 L7 10 L13 10 Z" fill={color} stroke="#000" strokeWidth="1" /></svg>
      <span className="ml-3 rounded px-1 text-[11px] font-semibold text-black" style={{ background: color }}>{label}</span>
    </div>
  );
}

// ---------------- toasts ----------------
export type Toast = { id: number; text: string; tone: "ok" | "err" };
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 7000);
  }, []);
  const view = (
    <div className="fixed bottom-32 right-6 z-40 space-y-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`max-w-sm rounded-xl px-4 py-3 text-sm shadow-xl ring-1 ${t.tone === "ok" ? "bg-panel2 ring-beam/40" : "bg-red-950 ring-red-400/40"}`}>{t.text}</div>
      ))}
    </div>
  );
  return { push, view };
}

// ---------------- add a cloud ----------------
/** Send a one-off task to an agent over its socket, then open its view so the owner can watch. */
export function helpOn(agent: Agent, text: string) {
  const ws = new WebSocket(`${agent.current.endpoint.replace(/^http/, "ws")}/ws?auth=${agent.token}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ t: "chat", text }));
    setTimeout(() => ws.close(), 500);
  };
  location.hash = `#/agent/${agent.id}`;
}
export const PROVIDERS = [
  { id: "fly", label: "Fly.io", price: "~$21/mo per agent", isolation: "microVM", tokenUrl: "https://fly.io/user/personal_access_tokens", hint: "Create a token, copy it, paste it here." },
  { id: "render", label: "Render", price: "~$85/mo per agent", isolation: "container", tokenUrl: "https://dashboard.render.com/u/settings#api-keys", hint: "Account settings → API keys → Create." },
  { id: "railway", label: "Railway", price: "~$80/mo per agent", isolation: "container", tokenUrl: "https://railway.com/account/tokens", hint: "Account → Tokens → Create (no team)." },
];

// ---------------- app ----------------
/** When the UI is served by an agent itself (phone link), show just that agent. */
export function standaloneAgent(): Agent | null {
  const qs = new URLSearchParams(location.search);
  let token = qs.get("auth");
  if (token) {
    try { sessionStorage.setItem("scut-auth", token); } catch {}
    history.replaceState(null, "", location.pathname + location.hash);
  } else {
    try { token = sessionStorage.getItem("scut-auth"); } catch {}
  }
  if (!token) return null;
  return { id: "self", name: "Agent", mascot: "cyan", harness: "", agentPubkey: "", current: { driver: "cloud", instanceId: "", endpoint: location.origin }, history: [], token };
}
