import type { ServerMsg } from "@scut/protocol";
import { nip19 } from "nostr-tools";

export type Instance = { driver: string; instanceId: string; endpoint: string; meta?: Record<string, string> };
export type Agent = {
  id: string; name: string; mascot: string; harness: string; agentPubkey: string;
  current: Instance; history: Instance[]; token: string;
  model?: { baseUrl?: string; model: string }; price?: { in: number; out: number };
  beam?: { to: string; from?: string; stage: string; error?: string; startedAt: number; doneAt?: number; summary?: { bytes: number; carried: Record<string, number | undefined> } };
};
export type Destination = { id: string; label: string; isolation: "vm" | "container" | "sandbox" | "none"; monthlyUsd: number };
/** How agents run on this computer (GET /api/local): the engine the ladder picked, and why the others weren't. */
export type LocalState = {
  engine: "smolvm" | "wsl" | "gvisor" | "docker" | "podman" | "host" | null;
  probes: { engine: string; available: boolean; reason?: string; action?: "enable-wsl" }[];
  hostAllowed: boolean; unsupported?: string; label?: string; isolation?: Destination["isolation"]; clouds?: string[];
};
/** Runs directly on its computer, without a sandbox (said wherever the agent's place is shown). */
export const unsandboxed = (i?: Instance) => i?.meta?.engine === "host" || i?.meta?.isolation === "none";

export const api = {
  agents: (): Promise<Agent[]> => fetch("/api/agents").then((r) => r.json()),
  destinations: (): Promise<Destination[]> => fetch("/api/destinations").then((r) => r.json()),
  create: (body: unknown) => fetch("/api/agents", { method: "POST", body: JSON.stringify(body) }).then((r) => r.json()),
  beam: (id: string, to: string) => fetch(`/api/agents/${id}/beam`, { method: "POST", body: JSON.stringify({ to }) }).then((r) => r.json()),
  remove: (id: string) => fetch(`/api/agents/${id}`, { method: "DELETE" }).then((r) => r.json()),
  local: (): Promise<LocalState> => fetch("/api/local").then((r) => r.json()),
  allowHost: (allow: boolean): Promise<LocalState> => fetch("/api/local", { method: "POST", body: JSON.stringify({ allowHost: allow }) }).then((r) => r.json()),
  enableWsl: (): Promise<{ started: boolean; error?: string }> => fetch("/api/local/enable-wsl", { method: "POST" }).then((r) => r.json()),
  brain: (): Promise<{ api: string; baseUrl: string; model: string; hasKey: boolean } | null> => fetch("/api/brain").then((r) => r.json()).catch(() => null),
  verifyBrain: (m: unknown): Promise<{ ok: boolean; error?: string; modelFound?: boolean; models?: string[] }> =>
    fetch("/api/brain/verify", { method: "POST", body: JSON.stringify(m) }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) })),
};

export const SCREEN = { w: 1280, h: 800 };
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
