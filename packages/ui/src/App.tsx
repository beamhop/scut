import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ServerMsg, AgentState } from "@scut/protocol";

// ---------------- types + api ----------------
type Instance = { driver: string; instanceId: string; endpoint: string };
type Agent = {
  id: string; name: string; mascot: string; harness: string; agentPubkey: string;
  current: Instance; history: Instance[]; token: string;
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
type Approval = { id: string; title: string; detail?: string; ts: number };
type Settings = Extract<ServerMsg, { t: "settings" }>;
type Pairing = Extract<ServerMsg, { t: "pairing" }>["telegram"];
function useAgent(agent: Agent | undefined, frames: boolean) {
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
  const ws = useRef<WebSocket | null>(null);
  const endpoint = agent?.current.endpoint;
  const token = agent?.token;
  const beaming = !!agent?.beam && !["online", "failed"].includes(agent.beam.stage);

  useEffect(() => {
    if (!endpoint || !token || beaming) return;
    let closed = false;
    let url: string | undefined;
    let sock: WebSocket;
    const connect = () => {
      sock = new WebSocket(`${endpoint.replace(/^http/, "ws")}/ws?auth=${token}`);
      sock.binaryType = "blob";
      ws.current = sock;
      sock.onopen = () => { setConnected(true); sock.send(JSON.stringify({ t: "subscribe", frames })); };
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
        else if (m.t === "pairing") setPairing(m.telegram);
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

  const send = useCallback((m: unknown) => ws.current?.readyState === 1 && ws.current.send(JSON.stringify(m)), []);
  return { frame, state, chat, narration, stats, approvals, agentCursor, settings, pairing, connected, send };
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

const STATE_META: Record<string, { label: string; icon: string; tone: string }> = {
  awaiting: { label: "Beaming in", icon: "◌", tone: "text-sky-300" },
  starting: { label: "Booting", icon: "◌", tone: "text-sky-300" },
  running: { label: "Idle", icon: "●", tone: "text-slate-400" },
  busy: { label: "Working", icon: "◆", tone: "text-beam" },
  stuck: { label: "Needs you", icon: "▲", tone: "text-amber-300" },
  quiescing: { label: "Packing up", icon: "◌", tone: "text-sky-300" },
  retired: { label: "Beamed away", icon: "○", tone: "text-slate-500" },
};
function StateChip({ state }: { state: string }) {
  const m = STATE_META[state] ?? STATE_META.running;
  return <span className={`inline-flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-[11px] font-medium ${m.tone}`}><span aria-hidden>{m.icon}</span>{m.label}</span>;
}

// ---------------- beam menu (non-drag alternative) ----------------
function BeamMenu({ agent, dests, onBeam, onClose }: { agent: Agent; dests: Destination[]; onBeam: (to: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector("button")?.focus(); }, []);
  return (
    <div ref={ref} role="menu" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}
      className="absolute right-3 top-3 z-10 w-64 rounded-xl border border-white/10 bg-panel p-2 shadow-2xl">
      <div className="px-2 pb-1 text-[11px] uppercase tracking-widest text-slate-500">Beam {agent.name} to…</div>
      {dests.map((d) => {
        const here = d.id === agent.current.driver;
        return (
          <button key={d.id} role="menuitem" disabled={here} onClick={() => { onBeam(d.id); onClose(); }}
            className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-panel2 focus:bg-panel2 focus:outline-none disabled:opacity-40">
            <span>{d.label}{here && " (here)"}</span>
            <span className="font-mono text-[11px] text-slate-500">{d.monthlyUsd ? `~$${d.monthlyUsd}/mo` : "free"}</span>
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
  const a = useAgent(agent, true);
  const [menu, setMenu] = useState(false);
  const beaming = !!agent.beam && !["online", "failed"].includes(agent.beam.stage);
  const now = a.narration.at(-1)?.text ?? STATE_META[a.state]?.label;
  const where = dests.find((d) => d.id === agent.current.driver)?.label ?? agent.current.driver;
  const needs = a.state === "stuck" || a.approvals.length > 0;
  useEffect(() => onStatus(agent.id, needs ? "stuck" : a.state), [needs, a.state]);
  return (
    <div
      tabIndex={0}
      draggable={!beaming}
      onDragStart={(e) => e.dataTransfer.setData("text/agent", agent.id)}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); if (e.key.toLowerCase() === "b") { e.preventDefault(); setMenu(true); } }}
      aria-label={`${agent.name}, ${STATE_META[a.state]?.label}, on ${where}. Enter to open, B to beam.`}
      className={`group relative cursor-pointer overflow-hidden rounded-2xl bg-panel outline-none transition focus-visible:ring-2 focus-visible:ring-beam ${needs ? "glow-stuck" : "ring-1 ring-white/10"} ${a.state === "running" && !needs ? "opacity-85 hover:opacity-100" : ""}`}
    >
      <div className="relative aspect-[16/10] bg-black">
        {a.frame ? <img src={a.frame} alt="" className="h-full w-full object-cover" draggable={false} /> : <div className="grid h-full place-items-center font-mono text-sm text-slate-600">{a.connected ? "waiting for picture…" : "connecting…"}</div>}
        <div className="absolute left-2 top-2"><StateChip state={needs ? "stuck" : a.state} /></div>
        <button onClick={(e) => { e.stopPropagation(); setMenu(!menu); }} className="absolute right-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-beam opacity-0 transition group-hover:opacity-100 focus:opacity-100" aria-haspopup="menu">Beam to…</button>
        {menu && <BeamMenu agent={agent} dests={dests} onBeam={onBeam} onClose={() => setMenu(false)} />}
        {beaming && <BeamProgress agent={agent} />}
        {a.approvals.length > 0 && <div className="absolute inset-x-2 bottom-2 rounded-lg bg-amber-400 px-3 py-1.5 text-sm font-medium text-black">Approve? {a.approvals[0].title}</div>}
      </div>
      <div className="flex items-center gap-3 p-3">
        <Mascot variant={agent.mascot} state={needs ? "stuck" : a.state} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{agent.name}</span>
            <span className="rounded-full bg-panel2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-beam">{where}</span>
          </div>
          <div className="truncate font-mono text-[12px] text-slate-400">{now}</div>
        </div>
        {a.stats && <div className="text-right font-mono text-[10px] leading-4 text-slate-500">{a.stats.cpu}% CPU<br />{(a.stats.memMb / 1024).toFixed(1)} GB</div>}
      </div>
      {agent.beam?.stage === "failed" && <div className="bg-red-500/15 px-3 py-1.5 text-xs text-red-300">Beam failed, {agent.name} stayed put: {agent.beam.error?.slice(0, 120)}</div>}
    </div>
  );
}

// ---------------- destination dock ----------------
function Dock({ dests, onDrop, dragging }: { dests: Destination[]; onDrop: (dest: string, agentId: string) => void; dragging: boolean }) {
  const [hot, setHot] = useState<string>();
  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-white/5 bg-panel/90 px-8 py-4 backdrop-blur">
      <div className="mb-2 font-mono text-[11px] uppercase tracking-widest text-slate-500">Destinations · drag an agent here, or press B on a tile</div>
      <div className="flex gap-3 overflow-x-auto">
        {dests.map((d) => (
          <div key={d.id}
            onDragOver={(e) => { e.preventDefault(); setHot(d.id); }}
            onDragLeave={() => setHot(undefined)}
            onDrop={(e) => { e.preventDefault(); setHot(undefined); onDrop(d.id, e.dataTransfer.getData("text/agent")); }}
            className={`min-w-48 rounded-xl border bg-panel2 px-4 py-3 transition ${hot === d.id ? "drop-hot border-beam" : dragging ? "border-beam/40" : "border-white/10"}`}>
            <div className="font-semibold">{d.label}</div>
            <div className="font-mono text-[11px] text-slate-400">{d.isolation === "vm" ? "microVM" : "container"} · {d.monthlyUsd ? `~$${d.monthlyUsd}/mo` : "free"}</div>
          </div>
        ))}
        <a href="https://github.com/beamhop/scut#clouds" target="_blank" className="grid min-w-48 place-items-center rounded-xl border border-dashed border-white/15 px-4 py-3 text-sm text-slate-400 hover:text-white">+ Add a cloud</a>
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

function CreateAgent({ firstRun, onDone }: { firstRun: boolean; onDone: () => void }) {
  const [step, setStep] = useState(firstRun ? 0 : 1);
  const [kind, setKind] = useState("openrouter");
  const [model, setModel] = useState({ baseUrl: PRESETS.openrouter.baseUrl, apiKey: "", model: PRESETS.openrouter.model });
  const [harness, setHarness] = useState("pi");
  const [template, setTemplate] = useState("assistant");
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("");
  const [telegram, setTelegram] = useState("");
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
            <p className="text-xs text-slate-500">Have a Claude or ChatGPT subscription? Pick Codex or Copilot CLI as the harness later and sign in on the agent's own screen.</p>
          </div>
        )}
        {step === 1 && (
          <div className="space-y-4">
            <textarea className={`${input} h-20`} aria-label="Describe your agent" placeholder={TEMPLATES.find((t) => t.id === template)?.example} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            <div className="grid grid-cols-3 gap-2">
              {TEMPLATES.map((t) => (
                <button key={t.id} className={`${card} ${template === t.id ? "border-beam" : "border-white/10"}`} onClick={() => setTemplate(t.id)}>
                  <div className="font-medium">{t.title}</div>
                  <div className="text-xs text-slate-400">{t.blurb}</div>
                </button>
              ))}
            </div>
            <div>
              <div className="mb-1 text-xs uppercase tracking-widest text-slate-500">Harness</div>
              <div className="flex flex-wrap gap-2 text-sm">
                {HARNESSES.map((h) => (
                  <button key={h.id} onClick={() => setHarness(h.id)} title={h.note} className={`rounded-full px-3 py-1 ${harness === h.id ? "bg-beam text-black" : "bg-panel2 hover:bg-white/10"}`}>{h.label}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className={input} aria-label="Name" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
              <input className={input} aria-label="Telegram bot token" placeholder="Telegram bot token (optional)" value={telegram} onChange={(e) => setTelegram(e.target.value)} />
            </div>
          </div>
        )}
        {error && <div className="mt-4 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">Couldn't start the agent: {error}</div>}
        <div className="mt-6 flex justify-between">
          <button className="text-slate-400 hover:text-white" onClick={() => (firstRun && step > 0 ? setStep(step - 1) : onDone())}>{firstRun && step > 0 ? "Back" : "Cancel"}</button>
          {step < last ? (
            <button className="rounded-full bg-beam px-6 py-2 font-semibold text-black" onClick={() => setStep(step + 1)}>Next</button>
          ) : (
            <button disabled={busy} className="rounded-full bg-gradient-to-r from-beam to-beam2 px-6 py-2 font-semibold text-black disabled:opacity-60" onClick={go}>
              {busy ? "Beaming in… (~10 s)" : "Beam it in"}
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
function AgentView({ agent, dests, onBack, onBeam }: { agent: Agent; dests: Destination[]; onBack: () => void; onBeam: (to: string) => void }) {
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
  useEffect(() => chatEnd.current?.scrollIntoView({ behavior: "smooth" }), [a.chat.length]);
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
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-white/5 px-5 py-3">
        <button onClick={onBack} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-panel2 hover:text-white">← Crew</button>
        <Mascot variant={agent.mascot} size={32} state={a.state} />
        <div className="font-semibold">{agent.name}</div>
        <span className="rounded-full bg-panel2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-beam">{where}</span>
        <StateChip state={a.state} />
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden font-mono text-[11px] text-slate-500 lg:inline">
            {a.stats && `${a.stats.cpu}% CPU · ${(a.stats.memMb / 1024).toFixed(1)}/${(a.stats.memTotalMb / 1024).toFixed(1)} GB · ${(a.stats.tokens.input + a.stats.tokens.output).toLocaleString()} tokens`}
          </span>
          {a.state === "busy" && <button onClick={() => a.send({ t: "stop" })} className="rounded-full border border-red-400/50 px-3 py-1 text-sm text-red-300 hover:bg-red-500/10">Stop</button>}
          <div className="relative">
            <button onClick={() => setMenu(!menu)} disabled={beaming} className="rounded-full bg-panel2 px-3 py-1 text-sm text-beam hover:bg-white/10 disabled:opacity-50" aria-haspopup="menu">Beam to…</button>
            {menu && <BeamMenu agent={agent} dests={dests} onBeam={onBeam} onClose={() => setMenu(false)} />}
          </div>
          <button onClick={() => setShowSettings(!showSettings)} className="rounded-full bg-panel2 px-3 py-1 text-sm hover:bg-white/10">Settings</button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col p-4">
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-panel2 px-3 py-1.5 font-mono text-[13px] text-beam" aria-live="polite">
            <span className="text-slate-500">NOW</span> {a.narration.at(-1)?.text ?? STATE_META[a.state]?.label}
          </div>
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
          </div>
          <div className="mt-2 text-center text-xs text-slate-500">Shared screen: you and {agent.name} can both act. Click into it to type; logins and payments are yours to do.</div>
        </div>
        <aside className="flex w-96 flex-col border-l border-white/5 bg-panel">
          {showSettings && <SettingsPanel a={a} />}
          {a.pairing && !a.pairing.owner && a.pairing.code && (
            <div className="m-3 rounded-xl border border-beam/30 bg-beam/5 p-3 text-sm">
              <div className="font-semibold">Pair your Telegram</div>
              <div className="text-slate-400">Send <span className="font-mono text-beam">/pair {a.pairing.code}</span> to <a className="text-beam underline" target="_blank" href={`https://t.me/${a.pairing.bot}`}>@{a.pairing.bot}</a> so approvals reach you there.</div>
            </div>
          )}
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {a.chat.length === 0 && <div className="mt-10 text-center text-sm text-slate-500">Say hi to {agent.name}. Try “open wikipedia and find today's featured article”.</div>}
            {a.chat.map((m, i) => (
              <div key={i} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.from === "agent" ? "bg-panel2" : "ml-auto bg-beam/15"}`}>
                <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">{m.from === "agent" ? agent.name : m.from} · {m.channel}</div>
                <div className="whitespace-pre-wrap">{m.text}</div>
              </div>
            ))}
            <div ref={chatEnd} />
          </div>
          <details className="border-t border-white/5">
            <summary className="cursor-pointer px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-slate-500">Activity ({a.narration.length})</summary>
            <div className="max-h-40 overflow-y-auto px-3 pb-2 font-mono text-[11px] text-slate-500">
              {a.narration.slice(-30).map((n, i) => <div key={i}>{new Date(n.ts).toLocaleTimeString()} {n.text}</div>)}
            </div>
          </details>
          <form className="flex gap-2 border-t border-white/5 p-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { a.send({ t: "chat", text }); setText(""); } }}>
            <input value={text} onChange={(e) => setText(e.target.value)} aria-label={`Message ${agent.name}`} className="flex-1 rounded-full border border-white/10 bg-panel2 px-4 py-2 text-sm outline-none focus:border-beam" placeholder={`Message ${agent.name}…`} />
            <button className="rounded-full bg-beam px-4 text-sm font-semibold text-black">Send</button>
          </form>
        </aside>
      </div>
      <div className="fixed right-4 top-16 z-30 space-y-2" aria-live="assertive">
        {a.approvals.map((ap) => (
          <div key={ap.id} role="alertdialog" aria-label="Approval needed" className="w-80 rounded-xl bg-amber-400 p-3 text-black shadow-xl">
            <div className="text-xs font-bold uppercase">{agent.name} wants to</div>
            <div className="my-1 font-medium">{ap.title}</div>
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

function SettingsPanel({ a }: { a: ReturnType<typeof useAgent> }) {
  const s = a.settings;
  const [budget, setBudget] = useState(String(s?.dailyTokenBudget ?? 0));
  if (!s) return null;
  const levels = [
    { id: "ask", label: "Ask me first", note: "every action needs approval" },
    { id: "risky", label: "Risky only", note: "payments, messages, deletes, logins" },
    { id: "auto", label: "Autonomous", note: "never asks" },
  ];
  return (
    <div className="space-y-3 border-b border-white/5 p-4 text-sm">
      <div className="font-mono text-[11px] uppercase tracking-widest text-slate-500">Autonomy</div>
      <div className="space-y-1">
        {levels.map((l) => (
          <label key={l.id} className="flex cursor-pointer items-start gap-2">
            <input type="radio" name="autonomy" checked={s.autonomy === l.id} onChange={() => a.send({ t: "settings", autonomy: l.id })} className="mt-1 accent-cyan-400" />
            <span><span className="font-medium">{l.label}</span> <span className="text-slate-500">— {l.note}</span></span>
          </label>
        ))}
      </div>
      <div className="font-mono text-[11px] uppercase tracking-widest text-slate-500">Daily token budget</div>
      <div className="flex items-center gap-2">
        <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="numeric" className="w-32 rounded-lg border border-white/10 bg-panel2 px-2 py-1 font-mono" aria-label="Daily token budget, 0 for none" />
        <button onClick={() => a.send({ t: "settings", dailyTokenBudget: Number(budget) || 0 })} className="rounded-full bg-panel2 px-3 py-1 hover:bg-white/10">Save</button>
        <span className="font-mono text-[11px] text-slate-500">{s.dayTokens.toLocaleString()} used today{s.dailyTokenBudget ? ` of ${s.dailyTokenBudget.toLocaleString()}` : ""}</span>
      </div>
    </div>
  );
}

function Cursor({ p, color, label }: { p: { x: number; y: number }; color: string; label: string }) {
  return (
    <div className="pointer-events-none absolute transition-all duration-150" style={{ left: `${(p.x / SCREEN.w) * 100}%`, top: `${(p.y / SCREEN.h) * 100}%` }}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden><path d="M1 1 L1 15 L5 11 L8 17 L10 16 L7 10 L13 10 Z" fill={color} stroke="#000" strokeWidth="1" /></svg>
      <span className="ml-3 rounded px-1 text-[10px] font-semibold text-black" style={{ background: color }}>{label}</span>
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

// ---------------- app ----------------
export function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [dests, setDests] = useState<Destination[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [route, setRoute] = useState(location.hash);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
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
        <div className="font-mono text-[11px] uppercase tracking-widest text-slate-500">
          {agents.length} agent{agents.length === 1 ? "" : "s"}{needCount ? <span className="text-amber-300"> · {needCount} need{needCount === 1 ? "s" : ""} you</span> : ""}
        </div>
        <button onClick={() => setCreating(true)} className="ml-auto rounded-full bg-gradient-to-r from-beam to-beam2 px-5 py-2 font-semibold text-black">+ New agent</button>
      </header>
      <main className="grid grid-cols-1 gap-6 px-8 md:grid-cols-2 xl:grid-cols-3">
        {sorted.map((ag) => (
          <Tile key={ag.id} agent={ag} dests={dests} onOpen={() => (location.hash = `#/agent/${ag.id}`)} onBeam={(to) => beam(ag.id, to)} onStatus={onStatus} />
        ))}
      </main>
      {loaded && agents.length === 0 && !creating && <CreateAgent firstRun onDone={refresh} />}
      {creating && <CreateAgent firstRun={false} onDone={() => { setCreating(false); refresh(); }} />}
      <Dock dests={dests} dragging={dragging} onDrop={(to, id) => id && beam(id, to)} />
      {toasts.view}
    </div>
  );
}
