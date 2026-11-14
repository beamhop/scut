import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ServerMsg, AgentState, Schedule, MemoryItem } from "@scut/protocol";
import { nip19 } from "nostr-tools";
import qrcode from "qrcode-generator";

// ---------------- types + api ----------------
type Instance = { driver: string; instanceId: string; endpoint: string };
type Agent = {
  id: string; name: string; mascot: string; harness: string; agentPubkey: string;
  current: Instance; history: Instance[]; token: string;
  model?: { baseUrl?: string; model: string }; price?: { in: number; out: number };
  beam?: { to: string; stage: string; error?: string; startedAt: number };
};
type Destination = { id: string; label: string; isolation: "vm" | "container"; monthlyUsd: number };

const api = {
  agents: (): Promise<Agent[]> => fetch("/api/agents").then((r) => r.json()),
  destinations: (): Promise<Destination[]> => fetch("/api/destinations").then((r) => r.json()),
  create: (body: unknown) => fetch("/api/agents", { method: "POST", body: JSON.stringify(body) }).then((r) => r.json()),
  beam: (id: string, to: string) => fetch(`/api/agents/${id}/beam`, { method: "POST", body: JSON.stringify({ to }) }).then((r) => r.json()),
  remove: (id: string) => fetch(`/api/agents/${id}`, { method: "DELETE" }).then((r) => r.json()),
};

const SCREEN = { w: 1280, h: 800 };
const MASCOT_COLORS: Record<string, [string, string]> = {
  cyan: ["#38e1ff", "#0b5566"], magenta: ["#ff4fd8", "#661f57"], lime: ["#a8ff4f", "#3d661f"],
  amber: ["#ffb03b", "#664409"], violet: ["#b06bff", "#3f1f66"], coral: ["#ff6b6b", "#662424"],
};
const BEAM_STAGES = ["packing", "provisioning", "transferring", "restoring", "online"] as const;
const STAGE_LABEL: Record<string, string> = {
  packing: "Packing workspace, browser and memory", provisioning: "Starting the new computer", transferring: "Sending the encrypted bundle",
  restoring: "Restoring and handing over the keys", online: "Online at the destination",
};

// ---------------- agent socket ----------------
type ChatLine = { from: string; channel: string; text: string; ts: number };
type Approval = { id: string; title: string; detail?: string; ts: number; shot?: string };
type Settings = Extract<ServerMsg, { t: "settings" }>;
type Pairing = Omit<Extract<ServerMsg, { t: "pairing" }>, "t">;
function useAgent(agent: Agent | undefined, frames: boolean, fps = 8) {
  const [frame, setFrame] = useState<string>();
  const [state, setState] = useState<AgentState>("starting");
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [narration, setNarration] = useState<{ text: string; ts: number }[]>([]);
  const [stats, setStats] = useState<Extract<ServerMsg, { t: "stats" }>>();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [agentCursor, setAgentCursor] = useState<{ x: number; y: number }>();
  const [settings, setSettings] = useState<Settings>();
  const [pairing, setPairing] = useState<Pairing>();
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [memory, setMemory] = useState<MemoryItem[]>([]);
  const ws = useRef<WebSocket | null>(null);
  const outbox = useRef<string[]>([]);
  const endpoint = agent?.current.endpoint;
  const tokenRef = useRef(agent?.token);
  tokenRef.current = agent?.token;
  const token = agent?.token ? "y" : "";
  const beaming = !!agent?.beam && !["online", "failed"].includes(agent.beam.stage);

  useEffect(() => {
    if (!endpoint || !token || beaming) return;
    let closed = false;
    let url: string | undefined;
    let sock: WebSocket;
    const connect = () => {
      sock = new WebSocket(`${endpoint.replace(/^http/, "ws")}/ws?auth=${tokenRef.current}`);
      sock.binaryType = "blob";
      ws.current = sock;
      sock.onopen = () => {
        setConnected(true);
        sock.send(JSON.stringify({ t: "subscribe", frames, fps }));
        for (const m of outbox.current.splice(0)) sock.send(m);
      };
      sock.onmessage = (ev) => {
        if (ev.data instanceof Blob) {
          const next = URL.createObjectURL(ev.data);
          setFrame(next);
          if (url) URL.revokeObjectURL(url);
          url = next;
          return;
        }
        const m = JSON.parse(ev.data) as ServerMsg;
        if (m.t === "hello" || m.t === "state") setState(m.state);
        else if (m.t === "history") { setChat(m.chat); setNarration(m.narration); }
        else if (m.t === "chat") setChat((c) => [...c.slice(-300), m]);
        else if (m.t === "narration") setNarration((n) => [...n.slice(-150), m]);
        else if (m.t === "stats") setStats(m);
        else if (m.t === "settings") setSettings(m);
        else if (m.t === "pairing") setPairing(m);
        else if (m.t === "paused") setPaused(m.paused);
        else if (m.t === "schedules") setSchedules(m.schedules);
        else if (m.t === "memory") setMemory(m.items);
        else if (m.t === "cloud.key") {
          fetch("/api/providers", { method: "POST", body: JSON.stringify({ id: m.provider, token: m.token }) })
            .then((r) => r.json())
            .then((r) => window.dispatchEvent(new CustomEvent("scut:cloud", { detail: { provider: m.provider, ok: !r.error, error: r.error } })))
            .catch(() => {});
        }
        else if (m.t === "cursor" && m.who === "agent") setAgentCursor({ x: m.x, y: m.y });
        else if (m.t === "approval.request") {
          setApprovals((a) => [...a, m]);
          if ("Notification" in window && Notification.permission === "granted") new Notification(`${agent?.name} needs you`, { body: m.title });
        } else if (m.t === "approval.resolved") setApprovals((a) => a.filter((x) => x.id !== m.id));
      };
      sock.onclose = () => { setConnected(false); if (!closed) setTimeout(connect, 1500); };
    };
    connect();
    return () => {
      closed = true;
      sock?.close();
      if (url) URL.revokeObjectURL(url);
    };
  }, [endpoint, token, frames, beaming]);

  // Queue messages typed before the socket is open (or while it reconnects) instead of dropping them.
  const send = useCallback((m: unknown) => {
    if (ws.current?.readyState === 1) ws.current.send(JSON.stringify(m));
    else outbox.current.push(JSON.stringify(m));
  }, []);
  return { frame, state, chat, narration, stats, approvals, agentCursor, settings, pairing, connected, paused, schedules, memory, send };
}

// ---------------- mascot: one base bot, silhouettes differ per variant, visor shows status ----------------
function Mascot({ variant = "cyan", size = 40, state = "running" }: { variant?: string; size?: number; state?: string }) {
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
function humanize(title: string) {
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
function needsText(a: { approvals: { title: string }[]; state: string }) {
  return a.approvals.length || a.state === "stuck" ? "Waiting for you" : undefined;
}

function cost(agent: Agent, t: { input: number; output: number }) {
  if (!agent.price) return t.input + t.output ? `${((t.input + t.output) / 1000).toFixed(1)}k tokens` : "";
  const usd = (t.input * agent.price.in + t.output * agent.price.out) / 1e6;
  return `$${usd.toFixed(2)} spent`;
}

const STATE_META: Record<string, { label: string; icon: string; tone: string }> = {
  awaiting: { label: "Beaming in", icon: "◌", tone: "text-sky-300" },
  starting: { label: "Booting", icon: "◌", tone: "text-sky-300" },
  running: { label: "Ready", icon: "●", tone: "text-slate-400" },
  busy: { label: "Working", icon: "◆", tone: "text-beam" },
  stuck: { label: "Needs you", icon: "▲", tone: "text-amber-300" },
  quiescing: { label: "Packing up", icon: "◌", tone: "text-sky-300" },
  retired: { label: "Beamed away", icon: "○", tone: "text-slate-400" },
};
function StateChip({ state }: { state: string }) {
  const m = STATE_META[state] ?? STATE_META.running;
  return <span className={`inline-flex items-center gap-1 rounded-full bg-[#070912e6] px-2 py-0.5 text-[11px] font-medium ring-1 ring-white/10 backdrop-blur ${m.tone}`}><span aria-hidden>{m.icon}</span>{m.label}</span>;
}

// ---------------- beam menu (non-drag alternative) ----------------
function BeamMenu({ agent, dests, onBeam, onClose }: { agent: Agent; dests: Destination[]; onBeam: (to: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector("button")?.focus(); }, []);
  return (
    <div ref={ref} role="menu" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}
      className="absolute right-3 top-3 z-10 w-64 rounded-xl border border-white/10 bg-panel p-2 shadow-2xl">
      <div className="px-2 pb-1 text-[11px] uppercase tracking-widest text-slate-400">Beam {agent.name} to…</div>
      {dests.map((d) => {
        const here = d.id === agent.current.driver;
        return (
          <button key={d.id} role="menuitem" disabled={here} onClick={() => { onBeam(d.id); onClose(); }}
            className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-panel2 focus:bg-panel2 focus:outline-none disabled:opacity-40">
            <span>{d.label}{here && " (here)"}</span>
            <span className="font-mono text-[11px] text-slate-400">{d.monthlyUsd ? `~$${d.monthlyUsd}/mo` : "free"}</span>
          </button>
        );
      })}
    </div>
  );
}

function BeamProgress({ agent }: { agent: Agent }) {
  const b = agent.beam!;
  const idx = BEAM_STAGES.indexOf(b.stage as any);
  return (
    <div className="beam-overlay absolute inset-0 grid place-items-center">
      <div className="w-72 rounded-xl bg-black/80 p-4 font-mono text-[12px]">
        <div className="mb-2 text-beam">Beaming to {b.to}</div>
        {BEAM_STAGES.map((s, i) => (
          <div key={s} className={i < idx ? "text-slate-400" : i === idx ? "text-white" : "text-slate-600"}>
            {i < idx ? "✓" : i === idx ? "›" : "·"} {STAGE_LABEL[s]}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- tile ----------------
function Tile({ agent, dests, onOpen, onBeam, onStatus }: { agent: Agent; dests: Destination[]; onOpen: () => void; onBeam: (to: string) => void; onStatus: (id: string, s: string) => void }) {
  const a = useAgent(agent, true, 1);
  const [menu, setMenu] = useState(false);
  const beaming = !!agent.beam && !["online", "failed"].includes(agent.beam.stage);
  const now = needsText(a) ?? a.narration.at(-1)?.text ?? STATE_META[a.state]?.label;
  const where = dests.find((d) => d.id === agent.current.driver)?.label ?? agent.current.driver;
  const needs = a.state === "stuck" || a.approvals.length > 0;
  useEffect(() => { onStatus(agent.id, needs ? "stuck" : a.state); }, [needs, a.state]);
  return (
    <div
      tabIndex={0}
      draggable={!beaming}
      onDragStart={(e) => e.dataTransfer.setData("text/agent", agent.id)}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); if (e.key.toLowerCase() === "b") { e.preventDefault(); setMenu(true); } }}
      aria-label={`${agent.name}, ${STATE_META[a.state]?.label}, on ${where}. Enter to open, B to beam.`}
      className={`group relative cursor-pointer overflow-hidden rounded-2xl bg-panel outline-none transition focus-visible:ring-2 focus-visible:ring-beam ${needs ? "glow-stuck" : "ring-1 ring-white/10"}`}
    >
      <div className="relative aspect-[16/10] bg-black">
        {a.frame ? <img src={a.frame} alt="" className="h-full w-full object-cover" draggable={false} /> : <div className="grid h-full place-items-center font-mono text-sm text-slate-600">{`Starting ${agent.name}'s screen…`}</div>}
        <div className="absolute left-2 top-2"><StateChip state={needs ? "stuck" : a.state} /></div>
        <button onClick={(e) => { e.stopPropagation(); setMenu(!menu); }} className="absolute right-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-beam opacity-80 transition hover:opacity-100 focus:opacity-100" aria-haspopup="menu">Beam to…</button>
        {menu && <BeamMenu agent={agent} dests={dests} onBeam={onBeam} onClose={() => setMenu(false)} />}
        {beaming && <BeamProgress agent={agent} />}
        {a.approvals.length > 0 && (
          <div onClick={(e) => e.stopPropagation()} className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-lg bg-amber-400 px-3 py-2 text-sm text-black shadow-lg">
            <span className="min-w-0 flex-1 truncate font-medium">{agent.name} wants to {humanize(a.approvals[0].title)}</span>
            <button className="rounded-full bg-black px-3 py-1 text-amber-300" onClick={() => a.send({ t: "approval", id: a.approvals[0].id, ok: true })}>Allow</button>
            <button className="rounded-full border border-black px-3 py-1" onClick={() => a.send({ t: "approval", id: a.approvals[0].id, ok: false })}>Don't</button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 p-3">
        <Mascot variant={agent.mascot} state={needs ? "stuck" : a.state} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{agent.name}</span>
            <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-slate-300">{where}</span>
          </div>
          <div className="truncate font-mono text-[12px] text-slate-400">{now}</div>
        </div>
        {a.stats && <div className="text-right font-mono text-[11px] leading-4 text-slate-400 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">{a.stats.cpu}% CPU · {(a.stats.memMb / 1024).toFixed(1)} GB<br />{cost(agent, a.stats.tokens)}</div>}
      </div>
      {agent.beam?.stage === "failed" && <div className="bg-red-500/15 px-3 py-1.5 text-xs text-red-300">Beam failed, {agent.name} stayed put: {agent.beam.error?.slice(0, 120)}</div>}
    </div>
  );
}

// ---------------- destination dock ----------------
function Dock({ dests, onDrop, dragging, onAddCloud }: { dests: Destination[]; onDrop: (dest: string, agentId: string) => void; dragging: boolean; onAddCloud: () => void }) {
  const [hot, setHot] = useState<string>();
  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-white/5 bg-panel/90 px-8 py-4 backdrop-blur">
      <div className="mb-2 font-mono text-[11px] uppercase tracking-widest text-slate-400">Where your agents live · drag one here to move it</div>
      <div className="flex gap-3 overflow-x-auto">
        {dests.map((d) => (
          <div key={d.id}
            onDragOver={(e) => { e.preventDefault(); setHot(d.id); }}
            onDragLeave={() => setHot(undefined)}
            onDrop={(e) => { e.preventDefault(); setHot(undefined); onDrop(d.id, e.dataTransfer.getData("text/agent")); }}
            className={`min-w-48 rounded-xl border bg-panel2 px-4 py-3 transition ${hot === d.id ? "drop-hot border-beam" : dragging ? "border-beam/40" : "border-white/10"}`}>
            <div className="font-semibold">{d.label}</div>
            <div className="font-mono text-[11px] text-slate-400">{d.monthlyUsd ? `~$${d.monthlyUsd}/month per agent` : d.id === "local" ? "Free · runs on this computer" : "Free"}</div>
          </div>
        ))}
        <button onClick={onAddCloud} className="grid min-w-48 place-items-center rounded-xl border border-dashed border-white/15 px-4 py-3 text-sm text-slate-400 hover:border-beam/50 hover:text-white">+ Add a cloud</button>
      </div>
    </div>
  );
}

// ---------------- create / first run ----------------
const TEMPLATES = [
  { id: "assistant", title: "Personal assistant", blurb: "Email, calendar and errands in its own browser", example: "Keep an eye on my inbox and draft replies for me to approve" },
  { id: "researcher", title: "Researcher", blurb: "Web research and sourced reports", example: "Research the best e-bikes under €2,000 and send me a short list" },
  { id: "developer", title: "Developer", blurb: "Codes with Pi, Codex, Copilot CLI or opencode", example: "Build a small landing page for my side project" },
];
const HARNESSES = [
  { id: "pi", label: "Pi", note: "default" }, { id: "codex", label: "Codex CLI", note: "sign in on its screen" }, { id: "copilot", label: "Copilot CLI", note: "sign in on its screen" },
  { id: "opencode", label: "opencode", note: "" }, { id: "mock", label: "Demo", note: "no model" },
];
const PRESETS: Record<string, { label: string; baseUrl: string; model: string; api: string; keyHint: string }> = {
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-haiku-5.5", api: "openai-completions", keyHint: "sk-or-…" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-5.6-luna", api: "openai-completions", keyHint: "sk-…" },
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com", model: "claude-haiku-5-5", api: "anthropic-messages", keyHint: "sk-ant-…" },
  ollama: { label: "Local (Ollama)", baseUrl: "http://host.docker.internal:11434/v1", model: "qwen3.8:8b", api: "openai-completions", keyHint: "not needed" },
};

function npubToHex(s: string): string | undefined {
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

function CreateAgent({ firstRun, onDone }: { firstRun: boolean; onDone: () => void }) {
  const [step, setStep] = useState(firstRun ? 0 : 1);
  const [kind, setKind] = useState("openrouter");
  const [model, setModel] = useState({ baseUrl: PRESETS.openrouter.baseUrl, apiKey: "", model: PRESETS.openrouter.model });
  const [harness, setHarness] = useState("pi");
  const [template, setTemplate] = useState("assistant");
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("");
  const [telegram, setTelegram] = useState("");
  const [nostr, setNostr] = useState(false);
  const [npub, setNpub] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const last = 1;

  async function go() {
    setBusy(true);
    setError(undefined);
    const p = PRESETS[kind];
    const r = await api.create({
      name: name || prompt.match(/\b([A-Z][a-z]+)\b/)?.[1] || ["Nova", "Scout", "Atlas", "Orbit", "Pixel", "Comet"][Math.floor(Math.random() * 6)],
      harness, template, persona: prompt || undefined, telegramToken: telegram || undefined,
      nostr: nostr ? { ownerPubkey: npubToHex(npub) } : undefined,
      model: harness === "mock" ? undefined : { provider: "scut", api: p.api, baseUrl: model.baseUrl, apiKey: model.apiKey || undefined, model: model.model },
      driver: "local",
    }).catch((e) => ({ error: String(e) }));
    setBusy(false);
    if (r.error) setError(r.error);
    else onDone();
  }

  const card = "rounded-xl border bg-panel2 p-3 text-left transition hover:border-beam/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-beam";
  const input = "w-full rounded-lg border border-white/10 bg-panel2 px-3 py-2 text-sm outline-none focus:border-beam";
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-black/70 p-6 backdrop-blur" role="dialog" aria-modal="true" aria-label="Create an agent">
      <div className="w-full max-w-2xl rounded-3xl bg-panel p-8 ring-1 ring-white/10">
        <div className="mb-6 flex items-center gap-3">
          <Mascot variant="violet" size={48} state={busy ? "busy" : "running"} />
          <div>
            <div className="text-xl font-semibold">{firstRun ? "Welcome to Beamhop" : "New agent"}</div>
            <div className="text-sm text-slate-400">{step === 0 ? "Step 1 of 2 · Pick a brain" : `${firstRun ? "Step 2 of 2 · " : ""}What should your agent do?`}</div>
          </div>
        </div>

        {step === 0 && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(PRESETS).map(([k, p]) => (
                <button key={k} className={`${card} ${kind === k ? "border-beam" : "border-white/10"}`} onClick={() => { setKind(k); setModel({ ...model, baseUrl: p.baseUrl, model: p.model }); }}>
                  <div className="text-sm font-medium">{p.label}</div>
                </button>
              ))}
            </div>
            <input className={input} aria-label="API key" placeholder={`API key (${PRESETS[kind].keyHint}) — stays inside your agent`} type="password" value={model.apiKey} onChange={(e) => setModel({ ...model, apiKey: e.target.value })} />
            <details className="text-sm text-slate-400">
              <summary className="cursor-pointer">Advanced: endpoint and model</summary>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input className={input} aria-label="Base URL" value={model.baseUrl} onChange={(e) => setModel({ ...model, baseUrl: e.target.value })} />
                <input className={input} aria-label="Model" value={model.model} onChange={(e) => setModel({ ...model, model: e.target.value })} />
              </div>
            </details>
            <p className="text-xs text-slate-400">Have a Claude or ChatGPT subscription? Choose Codex or Copilot CLI under More options next, then sign in on the agent's own screen.</p>
          </div>
        )}
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {TEMPLATES.map((t) => (
                <button key={t.id} className={`${card} ${template === t.id ? "border-beam" : "border-white/10"}`} onClick={() => setTemplate(t.id)}>
                  <div className="font-medium">{t.title}</div>
                  <div className="text-xs text-slate-400">{t.blurb}</div>
                </button>
              ))}
            </div>
            <textarea className={`${input} h-20`} aria-label="Describe your agent" placeholder={TEMPLATES.find((t) => t.id === template)?.example} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            <input className={input} aria-label="Name" placeholder="Name (optional — we'll pick one)" value={name} onChange={(e) => setName(e.target.value)} />
            <details className="text-sm text-slate-300" open={template === "developer"}>
              <summary className="cursor-pointer text-slate-400">More options</summary>
              <div className="mt-3 space-y-3">
                <div>
                  <div className="mb-1 text-xs uppercase tracking-widest text-slate-400">Coding tool</div>
                  <div className="flex flex-wrap gap-2">
                    {HARNESSES.map((h) => (
                      <button key={h.id} onClick={() => setHarness(h.id)} title={h.note} className={`rounded-full px-3 py-1 ${harness === h.id ? "bg-white text-black" : "bg-panel2 hover:bg-white/10"}`}>{h.label}</button>
                    ))}
                  </div>
                </div>
                <input className={input} aria-label="Telegram bot token" placeholder="Telegram bot token (you can add this later in Settings)" value={telegram} onChange={(e) => setTelegram(e.target.value)} />
                <div className="flex items-center gap-2">
                  <label className="flex shrink-0 items-center gap-2"><input type="checkbox" checked={nostr} onChange={(e) => setNostr(e.target.checked)} className="accent-cyan-400" /> Nostr messages</label>
                  {nostr && <input className={input} aria-label="Your npub for approvals" placeholder="Your npub, to get approval requests (optional)" value={npub} onChange={(e) => setNpub(e.target.value)} />}
                </div>
              </div>
            </details>
          </div>
        )}
        {error && <div className="mt-4 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">Couldn't start the agent: {error}</div>}
        <div className="mt-6 flex justify-between">
          <button className="text-slate-400 hover:text-white" onClick={() => (firstRun && step > 0 ? setStep(step - 1) : onDone())}>{firstRun && step > 0 ? "Back" : "Cancel"}</button>
          {step < last ? (
            <button className="rounded-full bg-beam px-6 py-2 font-semibold text-black" onClick={() => setStep(step + 1)}>Next</button>
          ) : (
            <button disabled={busy || (!prompt.trim() && !name.trim())} className="rounded-full bg-gradient-to-r from-beam to-beam2 px-6 py-2 font-semibold text-black disabled:opacity-50" onClick={go}>
              {busy ? "Beaming in… (~10 s)" : "Create agent"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- agent view ----------------
const KEYMAP: Record<string, string> = {
  Enter: "Return", Backspace: "BackSpace", Tab: "Tab", Escape: "Escape", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left",
  ArrowRight: "Right", Delete: "Delete", Home: "Home", End: "End", PageUp: "Prior", PageDown: "Next", " ": "space",
};
function AgentView({ agent, dests, onBack, onBeam, standalone = false }: { agent: Agent; dests: Destination[]; onBack: () => void; onBeam: (to: string) => void; standalone?: boolean }) {
  const [phone, setPhone] = useState<{ url: string; local: boolean } | null>(null);
  const a = useAgent(agent, true);
  const [text, setText] = useState("");
  const [myCursor, setMyCursor] = useState<{ x: number; y: number }>();
  const [menu, setMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const lastMove = useRef(0);
  const pos = (e: React.MouseEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.round(((e.clientX - r.left) / r.width) * SCREEN.w), y: Math.round(((e.clientY - r.top) / r.height) * SCREEN.h) };
  };
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [a.chat.length]);
  const where = dests.find((d) => d.id === agent.current.driver)?.label ?? agent.current.driver;
  const beaming = !!agent.beam && !["online", "failed"].includes(agent.beam.stage);

  function onKey(e: React.KeyboardEvent) {
    e.preventDefault();
    const mods = [e.ctrlKey && "ctrl", e.altKey && "alt", e.metaKey && "super"].filter(Boolean) as string[];
    if (e.key.length === 1 && mods.length === 0) return a.send({ t: "input", kind: "type", text: e.key });
    const k = KEYMAP[e.key] ?? (e.key.length === 1 ? e.key.toLowerCase() : undefined);
    if (!k || ["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
    a.send({ t: "input", kind: "key", keys: [...mods, e.shiftKey && e.key.length > 1 ? "shift" : "", k].filter(Boolean).join("+") });
  }

  return (
    <div className="flex min-h-screen flex-col lg:h-screen">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/5 px-5 py-3">
        {!standalone && <button onClick={onBack} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-panel2 hover:text-white">← Crew</button>}
        <Mascot variant={agent.mascot} size={32} state={a.state} />
        <div className="font-semibold">{agent.name}</div>
        <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-slate-300">{where}</span>
        <StateChip state={a.state} />
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden font-mono text-[11px] text-slate-400 lg:inline">
            {a.stats && `${a.stats.cpu}% CPU · ${(a.stats.memMb / 1024).toFixed(1)}/${(a.stats.memTotalMb / 1024).toFixed(1)} GB · ${cost(agent, a.stats.tokens)}`}
          </span>
          {a.state === "busy" && <button onClick={() => a.send({ t: "stop" })} className="rounded-full border border-red-400/50 px-3 py-1 text-sm text-red-300 hover:bg-red-500/10">Stop</button>}
          {!standalone && <div className="relative">
            <button onClick={() => setMenu(!menu)} disabled={beaming} className="rounded-full bg-panel2 px-3 py-1 text-sm text-beam hover:bg-white/10 disabled:opacity-50" aria-haspopup="menu">Beam to…</button>
            {menu && <BeamMenu agent={agent} dests={dests} onBeam={onBeam} onClose={() => setMenu(false)} />}
          </div>}
          <button onClick={() => setShowSettings(!showSettings)} aria-pressed={showSettings} className={`rounded-full px-3 py-1 text-sm ${showSettings ? "bg-white/15 text-white" : "bg-panel2 hover:bg-white/10"}`}>Settings</button>
          {!standalone && <button onClick={async () => setPhone(await (await fetch(`/api/agents/${agent.id}/phone`)).json())} title="Open on phone" aria-label="Open on phone" className="rounded-full bg-panel2 px-3 py-1 text-sm hover:bg-white/10">📱</button>}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col p-4">
          {a.state === "busy" || a.state === "stuck" || a.paused ? (
            <div className="mb-2 flex items-center gap-2 rounded-lg bg-panel2 px-3 py-1.5 font-mono text-[13px] text-slate-200" aria-live="polite">
              <span className="text-slate-400">NOW</span> {a.paused ? `Paused — you're driving` : (a.narration.at(-1)?.text ?? STATE_META[a.state]?.label)}
            </div>
          ) : <div className="mb-2 h-[30px]" />}
          <div
            ref={box}
            tabIndex={0}
            onKeyDown={onKey}
            onMouseMove={(e) => {
              const p = pos(e);
              setMyCursor(p);
              if (Date.now() - lastMove.current > 60) { lastMove.current = Date.now(); a.send({ t: "cursor", ...p }); }
            }}
            onMouseLeave={() => setMyCursor(undefined)}
            onClick={(e) => { box.current?.focus(); a.send({ t: "input", kind: "click", ...pos(e), button: 1 }); }}
            onDoubleClick={(e) => a.send({ t: "input", kind: "dblclick", ...pos(e) })}
            onContextMenu={(e) => { e.preventDefault(); a.send({ t: "input", kind: "click", ...pos(e), button: 3 }); }}
            onWheel={(e) => a.send({ t: "input", kind: "scroll", ...pos(e), dy: e.deltaY })}
            aria-label={`${agent.name}'s screen. Click to interact; keys go to the agent's computer.`}
            className={`relative mx-auto aspect-[16/10] w-full max-w-[1280px] cursor-none overflow-hidden rounded-xl bg-black outline-none focus:ring-2 focus:ring-beam ${a.state === "stuck" ? "glow-stuck" : "ring-1 ring-white/10"}`}
          >
            {a.frame && <img src={a.frame} alt="" className="h-full w-full select-none" draggable={false} />}
            {a.agentCursor && a.state === "busy" && <Cursor p={a.agentCursor} color="#b06bff" label={agent.name} />}
            {myCursor && <Cursor p={myCursor} color="#38e1ff" label="you" />}
            {beaming && <BeamProgress agent={agent} />}
            {a.paused && <div className="pointer-events-none absolute inset-x-0 top-0 bg-beam py-1 text-center text-xs font-semibold text-black">You're driving · {agent.name} is waiting</div>}
            <button onClick={(e) => { e.stopPropagation(); a.send({ t: "pause", paused: !a.paused }); }} onDoubleClick={(e) => e.stopPropagation()}
              className={`absolute bottom-3 left-3 cursor-pointer rounded-full px-3 py-1.5 text-sm font-medium shadow-lg ${a.paused ? "bg-beam text-black" : "bg-black/75 text-white hover:bg-black/90"}`}>
              {a.paused ? `Let ${agent.name} continue` : "Pause & let me drive"}
            </button>
          </div>
          <div className="mt-2 text-center text-xs text-slate-400">This is {agent.name}'s computer. Click to use it together; do logins and payments yourself.</div>
        </div>
        <aside className="flex min-h-[60vh] w-full flex-col border-t border-white/5 bg-panel lg:min-h-0 lg:w-96 lg:border-l lg:border-t-0">
          {showSettings ? <SettingsPanel a={a} agent={agent} onClose={() => setShowSettings(false)} /> : <>
          {a.pairing?.code && (
            <div className="m-3 rounded-xl border border-beam/30 bg-beam/5 p-3 text-sm">
              <div className="font-semibold">Pair your chat apps</div>
              <div className="text-slate-400">
                Send <span className="font-mono text-beam">/pair {a.pairing.code}</span> to {agent.name} on{" "}
                {Object.entries(a.pairing.channels ?? {}).filter(([, v]) => !v.owner).map(([k, v], i) => (
                  <span key={k}>{i ? ", " : ""}{k === "telegram" && v.bot ? <a className="text-beam underline" target="_blank" href={`https://t.me/${v.bot}`}>Telegram @{v.bot}</a> : <span className="capitalize text-slate-200">{k}{v.bot ? ` (@${v.bot})` : ""}</span>}</span>
                ))}{" "}so approvals reach you there. Only you can approve; anyone in a channel can chat.
              </div>
            </div>
          )}
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {a.chat.length === 0 && <div className="mt-10 text-center text-sm text-slate-400">Say hi to {agent.name}. Try “open wikipedia and find today's featured article”.</div>}
            {a.chat.map((m, i) => (
              <div key={i} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.from === "agent" ? "bg-panel2" : "ml-auto bg-beam/15"}`}>
                <div className="mb-0.5 font-mono text-[11px] uppercase tracking-wider text-slate-400">{m.from === "agent" ? agent.name : m.from === "owner" ? "You" : m.from}{m.channel !== "app" ? ` · ${m.channel}` : ""}</div>
                <div className="whitespace-pre-wrap">{m.text}</div>
              </div>
            ))}
            <div ref={chatEnd} />
          </div>
          <details className="border-t border-white/5">
            <summary className="cursor-pointer px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-slate-400">Activity ({a.narration.length})</summary>
            <div className="max-h-40 overflow-y-auto px-3 pb-2 font-mono text-[11px] text-slate-400">
              {a.narration.slice(-30).map((n, i) => <div key={i}>{new Date(n.ts).toLocaleTimeString()} {n.text}</div>)}
            </div>
          </details>
          <form className="flex gap-2 border-t border-white/5 p-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { a.send({ t: "chat", text }); setText(""); } }}>
            <input value={text} onChange={(e) => setText(e.target.value)} aria-label={`Message ${agent.name}`} className="flex-1 rounded-full border border-white/10 bg-panel2 px-4 py-2 text-sm outline-none focus:border-beam" placeholder={`Message ${agent.name}…`} />
            <button className="rounded-full bg-white px-4 text-sm font-semibold text-black">Send</button>
          </form>
          </>}
        </aside>
      </div>
      {phone && <PhoneLink phone={phone} name={agent.name} onClose={() => setPhone(null)} />}
      <div className="fixed right-4 top-16 z-30 space-y-2" aria-live="assertive">
        {a.approvals.map((ap) => (
          <div key={ap.id} role="alertdialog" aria-label="Approval needed" className="w-80 rounded-xl bg-amber-400 p-3 text-black shadow-xl">
            <div className="text-xs font-bold uppercase">{agent.name} wants to</div>
            <div className="my-1 font-medium">{humanize(ap.title)}</div>
            {ap.shot && <img src={ap.shot} alt="What the screen looked like when it asked" className="my-2 w-full rounded-md ring-1 ring-black/20" />}
            {ap.detail && <div className="text-sm">{ap.detail}</div>}
            <div className="mt-2 flex gap-2">
              <button className="rounded-full bg-black px-3 py-1 text-sm text-amber-300" onClick={() => a.send({ t: "approval", id: ap.id, ok: true })}>Approve</button>
              <button className="rounded-full border border-black px-3 py-1 text-sm" onClick={() => a.send({ t: "approval", id: ap.id, ok: false })}>Deny</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PhoneLink({ phone, name, onClose }: { phone: { url: string; local: boolean }; name: string; onClose: () => void }) {
  const svg = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(phone.url);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [phone.url]);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-6" role="dialog" aria-modal="true" aria-label="Open on phone" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-panel p-6 text-center ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-lg font-semibold">Open {name} on your phone</div>
        {phone.local ? (
          <p className="mb-3 text-sm text-amber-300">{name} runs on this computer, so the link only works here. Beam it to a cloud to reach it from anywhere.</p>
        ) : (
          <p className="mb-3 text-sm text-slate-400">Scan within 15 minutes. The link signs you in to this one agent.</p>
        )}
        <div className="mx-auto w-56 rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: svg }} />
        <button className="mt-3 font-mono text-[11px] text-beam underline" onClick={() => navigator.clipboard?.writeText(phone.url)}>Copy link</button>
      </div>
    </div>
  );
}

function SettingsPanel({ a, agent, onClose }: { a: ReturnType<typeof useAgent>; agent: Agent; onClose: () => void }) {
  const s = a.settings;
  const [budget, setBudget] = useState(String(s?.dailyTokenBudget ?? 0));
  if (!s) return null;
  const levels = [
    { id: "ask", label: "Ask me first", note: "every action needs approval" },
    { id: "risky", label: "Risky only", note: "payments, messages, deletes, logins" },
    { id: "auto", label: "Never ask", note: "acts on its own — not recommended for email or payments" },
  ];
  return (
    <div className="flex-1 space-y-5 overflow-y-auto p-5 text-sm">
      <div className="flex items-center"><div className="text-base font-semibold">Settings</div><button onClick={onClose} className="ml-auto rounded-full bg-white px-3 py-1 text-sm font-semibold text-black">Done</button></div>
      <div className="font-mono text-[11px] uppercase tracking-widest text-slate-400">Autonomy</div>
      <div className="space-y-1">
        {levels.map((l) => (
          <label key={l.id} className="flex cursor-pointer items-start gap-2">
            <input type="radio" name="autonomy" checked={s.autonomy === l.id} onChange={() => a.send({ t: "settings", autonomy: l.id })} className="mt-1 accent-cyan-400" />
            <span><span className="font-medium">{l.label}</span> <span className="text-slate-400">— {l.note}</span></span>
          </label>
        ))}
      </div>
      <MemorySettings a={a} />
      <ChannelSettings a={a} />
      <Schedules a={a} />
      {agent.agentPubkey && (
        <div className="space-y-1">
          <div className="font-mono text-[11px] uppercase tracking-widest text-slate-400">Nostr address</div>
          <button className="truncate font-mono text-[12px] text-slate-200 hover:underline" title="Copy" onClick={() => navigator.clipboard?.writeText(nip19.npubEncode(agent.agentPubkey))}>{nip19.npubEncode(agent.agentPubkey).slice(0, 30)}… (copy)</button>
        </div>
      )}
      <div className="font-mono text-[11px] uppercase tracking-widest text-slate-400">Daily token limit</div>
      <div className="flex items-center gap-2">
        <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="numeric" className="w-32 rounded-lg border border-white/10 bg-panel2 px-2 py-1 font-mono" aria-label="Daily token budget, 0 for none" />
        <button onClick={() => a.send({ t: "settings", dailyTokenBudget: Number(budget) || 0 })} className="rounded-full bg-panel2 px-3 py-1 hover:bg-white/10">Save</button>
        <span className="font-mono text-[11px] text-slate-400">{s.dayTokens.toLocaleString()} used today{s.dailyTokenBudget ? ` of ${s.dailyTokenBudget.toLocaleString()}` : ""}</span>
      </div>
    </div>
  );
}

const TELEGRAM_SETUP = [
  "Please set yourself up on Telegram:",
  "1. Open https://web.telegram.org/k/#@BotFather in your browser.",
  "2. If Telegram asks me to log in, call request_approval with the title \"Please log in to Telegram on my screen\" and wait until I approve.",
  "3. Send /newbot to BotFather, call the bot by your name, and pick a username ending in \"bot\".",
  "4. Copy the token BotFather gives you and call connect_channel with channel \"telegram\" and that token. Never write the token in chat.",
  "5. Tell me your bot's @username and the pairing code connect_channel returned.",
].join("\n");

const CLOUD_SETUP = (provider: string, url: string) => [
  `Please help me connect ${provider} so I can move agents to the cloud:`,
  `1. Open ${url} in your browser.`,
  `2. If I need to sign up or log in, call request_approval with the title "Please sign in to ${provider} on my screen" and wait. I'll do any payment details myself.`,
  "3. Create an API key/token named \"beamhop\".",
  `4. Call give_cloud_key with provider "${provider.toLowerCase().replace(".io", "")}" and the key. Never write the key in chat.`,
].join("\n");

function MemorySettings({ a }: { a: ReturnType<typeof useAgent> }) {
  const [text, setText] = useState("");
  return (
    <div className="space-y-2">
      <div className="font-mono text-[11px] uppercase tracking-widest text-slate-400">Memory · {a.memory.length}</div>
      {a.memory.length === 0 && <div className="text-slate-400">Nothing yet. Your agent saves things it learns about you here, and you can add your own.</div>}
      <div className="max-h-48 space-y-1 overflow-y-auto">
        {a.memory.map((m) => (
          <div key={m.id} className="group flex items-start gap-2 rounded-lg bg-panel2 px-2 py-1.5">
            <span className="min-w-0 flex-1">{m.text}</span>
            <span className="font-mono text-[11px] text-slate-400">{m.source === "owner" ? "you" : "agent"}</span>
            <button aria-label="Forget" onClick={() => a.send({ t: "memory", op: "delete", id: m.id })} className="text-slate-400 hover:text-red-300">✕</button>
          </div>
        ))}
      </div>
      <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { a.send({ t: "memory", op: "add", text }); setText(""); } }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. I prefer replies in Dutch" aria-label="Add a memory" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-panel2 px-2 py-1" />
        <button className="rounded-full bg-panel2 px-3 py-1 hover:bg-white/10">Add</button>
      </form>
    </div>
  );
}

function ChannelSettings({ a }: { a: ReturnType<typeof useAgent> }) {
  const [tg, setTg] = useState("");
  const ch = a.settings?.channels;
  return (
    <div className="space-y-2">
      <div className="font-mono text-[11px] uppercase tracking-widest text-slate-400">Chat with {"this agent"} from…</div>
      <div className="flex items-center gap-2">
        <span className="w-20">Telegram</span>
        {ch?.telegram ? (
          <><span className="text-emerald-300">connected</span><button onClick={() => a.send({ t: "settings", channels: { telegram: null } })} className="ml-auto text-slate-400 hover:text-red-300">Disconnect</button></>
        ) : (
          <><button onClick={() => a.send({ t: "chat", text: TELEGRAM_SETUP })} className="rounded-full bg-beam/90 px-3 py-1 text-sm font-semibold text-black hover:bg-beam" title="Your agent opens Telegram on its screen and creates its own bot">Set it up for me</button>
          <input value={tg} onChange={(e) => setTg(e.target.value)} placeholder="or paste a token from @BotFather" aria-label="Telegram bot token" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-panel2 px-2 py-1" />
          <button onClick={() => { if (tg.trim()) a.send({ t: "settings", channels: { telegram: { token: tg.trim() } } }); setTg(""); }} className="rounded-full bg-panel2 px-3 py-1 hover:bg-white/10">Connect</button></>
        )}
      </div>
      <SecretRow label="Slack" connected={!!ch?.slack} fields={["App token (xapp-…)", "Bot token (xoxb-…)"]}
        onConnect={([appToken, botToken]) => a.send({ t: "settings", channels: { slack: { appToken, botToken } } })}
        onDisconnect={() => a.send({ t: "settings", channels: { slack: null } })} />
      <SecretRow label="Discord" connected={!!ch?.discord} fields={["Bot token"]}
        onConnect={([token]) => a.send({ t: "settings", channels: { discord: { token } } })}
        onDisconnect={() => a.send({ t: "settings", channels: { discord: null } })} />
      <div className="flex items-center gap-2">
        <span className="w-20">Nostr</span>
        {ch?.nostr ? <span className="text-emerald-300">DMs on</span> : <span className="text-slate-400">off</span>}
        <button onClick={() => a.send({ t: "settings", channels: { nostr: ch?.nostr ? null : {} } })} className="ml-auto text-slate-400 hover:text-white">{ch?.nostr ? "Turn off" : "Turn on"}</button>
      </div>
    </div>
  );
}

function SecretRow({ label, connected, fields, onConnect, onDisconnect }: { label: string; connected: boolean; fields: string[]; onConnect: (v: string[]) => void; onDisconnect: () => void }) {
  const [vals, setVals] = useState(fields.map(() => ""));
  if (connected) return <div className="flex items-center gap-2"><span className="w-20">{label}</span><span className="text-emerald-300">connected</span><button onClick={onDisconnect} className="ml-auto text-slate-400 hover:text-red-300">Disconnect</button></div>;
  return (
    <div className="flex items-start gap-2">
      <span className="w-20 pt-1">{label}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {fields.map((f, i) => <input key={f} value={vals[i]} onChange={(e) => setVals(vals.map((v, j) => (j === i ? e.target.value : v)))} placeholder={f} aria-label={`${label} ${f}`} className="rounded-lg border border-white/10 bg-panel2 px-2 py-1" />)}
      </div>
      <button onClick={() => { if (vals.every((v) => v.trim())) { onConnect(vals.map((v) => v.trim())); setVals(fields.map(() => "")); } }} className="rounded-full bg-panel2 px-3 py-1 hover:bg-white/10">Connect</button>
    </div>
  );
}

function Schedules({ a }: { a: ReturnType<typeof useAgent> }) {
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<"daily" | "every">("daily");
  const [time, setTime] = useState("08:00");
  const [minutes, setMinutes] = useState("60");
  const save = (list: Schedule[]) => a.send({ t: "schedules", schedules: list });
  const add = () => {
    if (!prompt.trim()) return;
    const [h, m] = time.split(":").map(Number);
    const local = new Date();
    local.setHours(h, m, 0, 0);
    const minuteOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
    save([...a.schedules, { id: Math.random().toString(36).slice(2, 8), prompt, kind, minuteOfDay, minutes: Number(minutes) || 60, enabled: true }]);
    setPrompt("");
  };
  const label = (s: Schedule) => {
    if (s.kind === "every") return `every ${s.minutes} min`;
    const d = new Date();
    d.setUTCHours(Math.floor((s.minuteOfDay ?? 0) / 60), (s.minuteOfDay ?? 0) % 60, 0, 0);
    return `daily ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  };
  return (
    <div className="space-y-2">
      <div className="font-mono text-[11px] uppercase tracking-widest text-slate-400">Scheduled tasks</div>
      {a.schedules.map((s) => (
        <div key={s.id} className="flex items-center gap-2 rounded-lg bg-panel2 px-2 py-1.5">
          <input type="checkbox" checked={s.enabled} aria-label="Enabled" onChange={() => save(a.schedules.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)))} className="accent-cyan-400" />
          <div className="min-w-0 flex-1"><div className="truncate">{s.prompt}</div><div className="font-mono text-[11px] text-slate-400">{label(s)}{s.lastRun ? ` · last ${new Date(s.lastRun).toLocaleString()}` : ""}</div></div>
          <button aria-label="Delete task" onClick={() => save(a.schedules.filter((x) => x.id !== s.id))} className="text-slate-400 hover:text-red-300">✕</button>
        </div>
      ))}
      <div className="flex gap-1">
        <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. Check Hacker News and send me the top 3" aria-label="Task" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-panel2 px-2 py-1" />
      </div>
      <div className="flex items-center gap-1">
        <select value={kind} onChange={(e) => setKind(e.target.value as any)} aria-label="Repeat" className="rounded-lg bg-panel2 px-2 py-1"><option value="daily">Daily at</option><option value="every">Every (min)</option></select>
        {kind === "daily" ? <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" className="rounded-lg bg-panel2 px-2 py-1" /> : <input value={minutes} onChange={(e) => setMinutes(e.target.value)} inputMode="numeric" aria-label="Minutes" className="w-20 rounded-lg bg-panel2 px-2 py-1" />}
        <button onClick={add} className="ml-auto rounded-full bg-panel2 px-3 py-1 hover:bg-white/10">Add</button>
      </div>
    </div>
  );
}

function Cursor({ p, color, label }: { p: { x: number; y: number }; color: string; label: string }) {
  return (
    <div className="pointer-events-none absolute transition-all duration-150" style={{ left: `${(p.x / SCREEN.w) * 100}%`, top: `${(p.y / SCREEN.h) * 100}%` }}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden><path d="M1 1 L1 15 L5 11 L8 17 L10 16 L7 10 L13 10 Z" fill={color} stroke="#000" strokeWidth="1" /></svg>
      <span className="ml-3 rounded px-1 text-[11px] font-semibold text-black" style={{ background: color }}>{label}</span>
    </div>
  );
}

// ---------------- toasts ----------------
type Toast = { id: number; text: string; tone: "ok" | "err" };
function useToasts() {
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
function helpOn(agent: Agent, text: string) {
  const ws = new WebSocket(`${agent.current.endpoint.replace(/^http/, "ws")}/ws?auth=${agent.token}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ t: "chat", text }));
    setTimeout(() => ws.close(), 500);
  };
  location.hash = `#/agent/${agent.id}`;
}
const PROVIDERS = [
  { id: "fly", label: "Fly.io", price: "~$21/mo per agent", isolation: "microVM", tokenUrl: "https://fly.io/user/personal_access_tokens", hint: "Create a token, copy it, paste it here." },
  { id: "render", label: "Render", price: "~$85/mo per agent", isolation: "container", tokenUrl: "https://dashboard.render.com/u/settings#api-keys", hint: "Account settings → API keys → Create." },
  { id: "railway", label: "Railway", price: "~$80/mo per agent", isolation: "container", tokenUrl: "https://railway.com/account/tokens", hint: "Account → Tokens → Create (no team)." },
];
function AddCloud({ onClose, onAdded, helpers }: { onClose: () => void; onAdded: (label: string) => void; helpers: Agent[] }) {
  const [pick, setPick] = useState("fly");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const p = PROVIDERS.find((x) => x.id === pick)!;
  async function connect() {
    setBusy(true);
    setError(undefined);
    const r = await fetch("/api/providers", { method: "POST", body: JSON.stringify({ id: pick, token }) }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
    setBusy(false);
    if (r.error) setError(r.error);
    else onAdded(p.label);
  }
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-6 backdrop-blur" role="dialog" aria-modal="true" aria-label="Add a cloud" onClick={onClose}>
      <div className="w-full max-w-lg rounded-3xl bg-panel p-7 ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
        <div className="text-xl font-semibold">Add a cloud</div>
        <p className="mb-4 text-sm text-slate-400">Run agents on your own cloud account, even when this computer is off. You pay the provider directly.</p>
        <div className="grid grid-cols-3 gap-2">
          {PROVIDERS.map((x) => (
            <button key={x.id} onClick={() => setPick(x.id)} className={`rounded-xl border bg-panel2 p-3 text-left ${pick === x.id ? "border-beam" : "border-white/10 hover:border-beam/50"}`}>
              <div className="font-medium">{x.label}</div>
              <div className="mt-1 text-sm text-slate-200">{x.price}</div>
            </button>
          ))}
        </div>
        <ol className="mt-4 space-y-2 text-sm">
          <li>1. <a className="text-beam underline" href={p.tokenUrl} target="_blank">Get your {p.label} key</a> — {p.hint}</li>
          <li>2. Paste your key here:</li>
        </ol>
        <input value={token} onChange={(e) => setToken(e.target.value)} type="password" aria-label={`${p.label} token`} placeholder={`${p.label} token`} className="mt-2 w-full rounded-lg border border-white/10 bg-panel2 px-3 py-2 text-sm outline-none focus:border-beam" />
        {error && <div className="mt-3 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">{error}</div>}
        {helpers.length > 0 && (
          <div className="mt-4 rounded-xl bg-panel2 p-3 text-sm">
            <div className="mb-2 text-slate-300">Or let an agent do the signup on its screen while you watch:</div>
            <div className="flex flex-wrap gap-2">
              {helpers.slice(0, 4).map((h) => (
                <button key={h.id} onClick={() => { helpOn(h, CLOUD_SETUP(p.label, p.tokenUrl)); onClose(); }} className="rounded-full bg-white/10 px-3 py-1 hover:bg-white/20">Ask {h.name}</button>
              ))}
            </div>
          </div>
        )}
        <div className="mt-5 flex justify-between">
          <button onClick={onClose} className="text-slate-400 hover:text-white">Cancel</button>
          <button disabled={busy || !token.trim()} onClick={connect} className="rounded-full bg-beam px-6 py-2 font-semibold text-black disabled:opacity-50">{busy ? "Checking…" : "Connect"}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------- crew room ----------------
function CrewRoomPanel({ onClose, agentNames }: { onClose: () => void; agentNames: string[] }) {
  const [data, setData] = useState<{ enabled: boolean; lines: { name: string; text: string; ts: number }[]; members: { name: string; kind: string }[] }>();
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const load = () => fetch("/api/crew").then((r) => r.json()).then(setData).catch(() => {});
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [data?.lines.length]);
  return (
    <aside className="fixed inset-y-0 right-0 z-30 flex w-[420px] flex-col border-l border-white/10 bg-panel shadow-2xl" aria-label="Crew room">
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
        <div className="font-semibold">Crew room</div>
        <div className="font-mono text-[11px] text-slate-400">{agentNames.length} agents · end-to-end encrypted</div>
        <button onClick={onClose} className="ml-auto text-slate-400 hover:text-white" aria-label="Close crew room">✕</button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {data && !data.lines.length && (
          <div className="mt-10 space-y-3 text-center text-sm text-slate-400">
            <div>Talk to all your agents at once. Mention one to give it a task:</div>
            <div className="flex flex-wrap justify-center gap-2">{agentNames.map((n) => <button key={n} onClick={() => setText(`@${n} `)} className="rounded-full bg-panel2 px-3 py-1 text-slate-200 hover:bg-white/10">@{n}</button>)}</div>
          </div>
        )}
        {data?.lines.map((l, i) => (
          <div key={i} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${l.name === "You" || l.name === "Owner" ? "ml-auto bg-beam/15" : "bg-panel2"}`}>
            <div className="mb-0.5 font-mono text-[11px] uppercase tracking-wider text-slate-400">{l.name}</div>
            <div className="whitespace-pre-wrap">{l.text}</div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="flex gap-2 border-t border-white/5 p-3" onSubmit={async (e) => { e.preventDefault(); if (!text.trim()) return; const t = text; setText(""); await fetch("/api/crew", { method: "POST", body: JSON.stringify({ text: t }) }); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} aria-label="Message the crew" className="flex-1 rounded-full border border-white/10 bg-panel2 px-4 py-2 text-sm outline-none focus:border-beam" placeholder="Message everyone…" />
        <button className="rounded-full bg-white px-4 text-sm font-semibold text-black">Send</button>
      </form>
    </aside>
  );
}

// ---------------- app ----------------
/** When the UI is served by an agent itself (phone link), show just that agent. */
function standaloneAgent(): Agent | null {
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

export function App() {
  const solo = useMemo(standaloneAgent, []);
  if (solo) return <SoloAgent agent={solo} />;
  return <CrewApp />;
}

function SoloAgent({ agent }: { agent: Agent }) {
  const [info, setInfo] = useState({ name: agent.name, mascot: agent.mascot, agentPubkey: "" });
  useEffect(() => {
    fetch(`/status?auth=${agent.token}`).then((r) => r.json()).then((s) => s.spec && setInfo({ name: s.spec.name, mascot: s.spec.mascot ?? "cyan", agentPubkey: s.spec.agentPubkey })).catch(() => {});
  }, []);
  return <AgentView agent={{ ...agent, ...info }} dests={[]} onBack={() => {}} onBeam={() => {}} standalone />;
}

function CrewApp() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [dests, setDests] = useState<Destination[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [route, setRoute] = useState(location.hash);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  const [crewOpen, setCrewOpen] = useState(false);
  const [addCloud, setAddCloud] = useState(false);
  const toasts = useToasts();
  const prevStages = useRef<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const list = await api.agents().catch(() => null);
    if (!list) return;
    for (const ag of list) {
      const prev = prevStages.current[ag.id];
      const now = ag.beam?.stage;
      if (prev && prev !== now && now === "online") {
        const to = dests.find((d) => d.id === ag.current.driver)?.label ?? ag.current.driver;
        toasts.push(`${ag.name} beamed to ${to}. Came along: workspace, browser profile, chat and memory. A cold copy stays behind as a backup.`);
      }
      if (prev && prev !== now && now === "failed") toasts.push(`Beam of ${ag.name} failed; it's still running where it was.`, "err");
      if (now) prevStages.current[ag.id] = now;
    }
    setAgents(list);
    setLoaded(true);
  }, [dests]);
  useEffect(() => {
    api.destinations().then(setDests);
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1500);
    const h = () => setRoute(location.hash);
    addEventListener("hashchange", h);
    const dragOn = () => setDragging(true), dragOff = () => setDragging(false);
    addEventListener("dragstart", dragOn); addEventListener("dragend", dragOff);
    return () => { clearInterval(t); removeEventListener("hashchange", h); removeEventListener("dragstart", dragOn); removeEventListener("dragend", dragOff); };
  }, [refresh]);
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    const onCloud = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.ok) { api.destinations().then(setDests); toasts.push(`Your agent connected ${d.provider}. Drag an agent onto it to beam it there.`); }
      else toasts.push(`The ${d.provider} key from your agent didn't work: ${d.error}`, "err");
    };
    addEventListener("scut:cloud", onCloud);
    return () => removeEventListener("scut:cloud", onCloud);
  }, []);

  const beam = useCallback(async (id: string, to: string) => {
    const r = await api.beam(id, to);
    if (r.error) toasts.push(r.error, "err");
    refresh();
  }, [refresh]);
  const onStatus = useCallback((id: string, s: string) => setStatus((x) => (x[id] === s ? x : { ...x, [id]: s })), []);
  const sorted = useMemo(() => {
    const rank = (s?: string) => (s === "stuck" ? 0 : s === "busy" ? 1 : 2);
    return [...agents].sort((a, b) => rank(status[a.id]) - rank(status[b.id]));
  }, [agents, status]);
  const open = useMemo(() => agents.find((x) => route === `#/agent/${x.id}`), [agents, route]);
  const needCount = Object.values(status).filter((s) => s === "stuck").length;

  if (open) return <>{toasts.view}<AgentView agent={open} dests={dests} onBack={() => (location.hash = "")} onBeam={(to) => beam(open.id, to)} /></>;

  return (
    <div className="stars min-h-screen pb-40">
      <header className="flex items-center gap-3 px-8 py-6">
        <Mascot variant="cyan" size={36} />
        <div className="text-2xl font-bold tracking-tight">Beam<span className="text-beam">hop</span></div>
        <div className="font-mono text-[11px] uppercase tracking-widest text-slate-400">
          {agents.length} agent{agents.length === 1 ? "" : "s"}{needCount ? <span className="text-amber-300"> · {needCount} need{needCount === 1 ? "s" : ""} you</span> : ""}
        </div>
        <button onClick={() => setCrewOpen(!crewOpen)} className="ml-auto rounded-full bg-panel2 px-4 py-2 text-sm hover:bg-white/10">Talk to all agents</button>
        <button onClick={() => setCreating(true)} className="rounded-full bg-gradient-to-r from-beam to-beam2 px-5 py-2 font-semibold text-black">+ New agent</button>
      </header>
      <main className={`grid grid-cols-1 gap-6 px-8 md:grid-cols-2 xl:grid-cols-3 ${crewOpen ? "xl:pr-[440px]" : ""}`}>
        {sorted.map((ag) => (
          <Tile key={ag.id} agent={ag} dests={dests} onOpen={() => (location.hash = `#/agent/${ag.id}`)} onBeam={(to) => beam(ag.id, to)} onStatus={onStatus} />
        ))}
      </main>
      {loaded && agents.length === 0 && !creating && <CreateAgent firstRun onDone={refresh} />}
      {creating && <CreateAgent firstRun={false} onDone={() => { setCreating(false); refresh(); }} />}
      <Dock dests={dests} dragging={dragging} onDrop={(to, id) => id && beam(id, to)} onAddCloud={() => setAddCloud(true)} />
      {addCloud && <AddCloud helpers={agents} onClose={() => setAddCloud(false)} onAdded={(label) => { setAddCloud(false); api.destinations().then(setDests); toasts.push(`${label} added. Drag an agent onto it to beam it there.`); }} />}
      {crewOpen && <CrewRoomPanel onClose={() => setCrewOpen(false)} agentNames={agents.map((x) => x.name)} />}
      {toasts.view}
    </div>
  );
}
