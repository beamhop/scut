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
  cyan: ["#38e1ff", "#0b6f85"], magenta: ["#ff4fd8", "#7d1f6b"], lime: ["#a8ff4f", "#4a7d1f"],
  amber: ["#ffb03b", "#85560b"], violet: ["#b06bff", "#4d1f85"], coral: ["#ff6b6b", "#852b2b"],
};

// ---------------- agent socket ----------------
type ChatLine = { from: string; channel: string; text: string; ts: number };
type Approval = { id: string; title: string; detail?: string; ts: number };
function useAgent(agent: Agent | undefined, frames: boolean) {
  const [frame, setFrame] = useState<string>();
  const [state, setState] = useState<AgentState>("starting");
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [narration, setNarration] = useState<{ text: string; ts: number }[]>([]);
  const [stats, setStats] = useState<Extract<ServerMsg, { t: "stats" }>>();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [agentCursor, setAgentCursor] = useState<{ x: number; y: number }>();
  const ws = useRef<WebSocket>();
  const endpoint = agent?.current.endpoint;
  const token = agent?.token;

  useEffect(() => {
    if (!endpoint || !token || agent?.beam && !["online", "failed"].includes(agent.beam.stage)) return;
    let closed = false;
    let url: string | undefined;
    let sock: WebSocket;
    const connect = () => {
      sock = new WebSocket(`${endpoint.replace(/^http/, "ws")}/ws?auth=${token}`);
      sock.binaryType = "blob";
      ws.current = sock;
      sock.onopen = () => sock.send(JSON.stringify({ t: "subscribe", frames }));
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
        else if (m.t === "chat") setChat((c) => [...c.slice(-200), m]);
        else if (m.t === "narration") setNarration((n) => [...n.slice(-100), m]);
        else if (m.t === "stats") setStats(m);
        else if (m.t === "cursor" && m.who === "agent") setAgentCursor({ x: m.x, y: m.y });
        else if (m.t === "approval.request") {
          setApprovals((a) => [...a, m]);
          if ("Notification" in window && Notification.permission === "granted") new Notification(`${agent?.name} needs approval`, { body: m.title });
        } else if (m.t === "approval.resolved") setApprovals((a) => a.filter((x) => x.id !== m.id));
      };
      sock.onclose = () => !closed && setTimeout(connect, 1500);
    };
    connect();
    return () => {
      closed = true;
      sock?.close();
      if (url) URL.revokeObjectURL(url);
    };
  }, [endpoint, token, frames, agent?.beam?.stage]);

  const send = useCallback((m: unknown) => ws.current?.readyState === 1 && ws.current.send(JSON.stringify(m)), []);
  return { frame, state, chat, narration, stats, approvals, agentCursor, send };
}

// ---------------- mascot ----------------
function Mascot({ variant = "cyan", size = 40, busy = false }: { variant?: string; size?: number; busy?: boolean }) {
  const [c, d] = MASCOT_COLORS[variant] ?? MASCOT_COLORS.cyan;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label={`${variant} beambot`}>
      <line x1="32" y1="6" x2="32" y2="16" stroke={c} strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="6" r="4" fill={c} className={busy ? "teleport" : ""} />
      <rect x="10" y="16" width="44" height="36" rx="16" fill={d} stroke={c} strokeWidth="3" />
      <rect x="18" y="26" width="28" height="14" rx="7" fill="#070912" />
      <circle cx="26" cy="33" r="3.5" fill={c} />
      <circle cx="38" cy="33" r="3.5" fill={c} />
      <path d="M22 52 l-4 8 M42 52 l4 8" stroke={c} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const STATE_LABEL: Record<string, string> = {
  awaiting: "Beaming in…", starting: "Booting", running: "Idle", busy: "Working", stuck: "Needs you",
  quiescing: "Packing up", retired: "Beamed away",
};

// ---------------- tile ----------------
function Tile({ agent, onOpen, onDragStart, dests }: { agent: Agent; onOpen: () => void; onDragStart: (e: React.DragEvent) => void; dests: Destination[] }) {
  const a = useAgent(agent, true);
  const beaming = agent.beam && !["online", "failed"].includes(agent.beam.stage);
  const now = a.narration.at(-1)?.text ?? STATE_LABEL[a.state];
  const where = dests.find((d) => d.id === agent.current.driver)?.label ?? agent.current.driver;
  return (
    <div
      draggable={!beaming}
      onDragStart={onDragStart}
      onClick={onOpen}
      className={`group relative cursor-pointer overflow-hidden rounded-2xl bg-panel transition hover:-translate-y-0.5 ${a.state === "stuck" ? "glow-stuck" : "glow"}`}
    >
      <div className="relative aspect-[16/10] bg-black">
        {a.frame ? <img src={a.frame} className="h-full w-full object-cover" draggable={false} /> : <div className="grid h-full place-items-center text-slate-500">no signal</div>}
        {beaming && (
          <div className="beam-overlay absolute inset-0 grid place-items-center">
            <div className="rounded-full bg-black/70 px-4 py-2 font-mono text-sm text-beam">
              beaming → {agent.beam!.to} · {agent.beam!.stage}
            </div>
          </div>
        )}
        {a.approvals.length > 0 && (
          <div className="absolute inset-x-2 bottom-2 rounded-lg bg-amber-500/90 px-3 py-1.5 text-sm font-medium text-black">Approval needed: {a.approvals[0].title}</div>
        )}
      </div>
      <div className="flex items-center gap-3 p-3">
        <Mascot variant={agent.mascot} busy={a.state === "busy"} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{agent.name}</span>
            <span className="rounded-full bg-panel2 px-2 py-0.5 text-[11px] text-beam">{where}</span>
          </div>
          <div className="truncate text-sm text-slate-400">{now}</div>
        </div>
        {a.stats && <div className="text-right font-mono text-[11px] text-slate-500">{a.stats.cpu}% cpu<br />{a.stats.memMb} MB</div>}
      </div>
      {agent.beam?.stage === "failed" && <div className="bg-red-500/20 px-3 py-1 text-xs text-red-300">Beam failed: {agent.beam.error}</div>}
    </div>
  );
}

// ---------------- destination dock ----------------
function Dock({ dests, onDrop }: { dests: Destination[]; onDrop: (dest: string, agentId: string) => void }) {
  const [hot, setHot] = useState<string>();
  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-white/5 bg-panel/90 px-6 py-4 backdrop-blur">
      <div className="mb-2 text-xs uppercase tracking-widest text-slate-500">Drag an agent here to beam it</div>
      <div className="flex gap-3 overflow-x-auto">
        {dests.map((d) => (
          <div
            key={d.id}
            onDragOver={(e) => { e.preventDefault(); setHot(d.id); }}
            onDragLeave={() => setHot(undefined)}
            onDrop={(e) => { e.preventDefault(); setHot(undefined); onDrop(d.id, e.dataTransfer.getData("text/agent")); }}
            className={`min-w-44 rounded-xl border border-white/10 bg-panel2 px-4 py-3 transition ${hot === d.id ? "drop-hot scale-105" : ""}`}
          >
            <div className="font-semibold">{d.label}</div>
            <div className="text-xs text-slate-400">
              {d.isolation === "vm" ? "microVM" : "container"} · {d.monthlyUsd ? `~$${d.monthlyUsd}/mo` : "free"}
            </div>
          </div>
        ))}
        <div className="grid min-w-44 place-items-center rounded-xl border border-dashed border-white/15 px-4 py-3 text-sm text-slate-400">+ Add a cloud</div>
      </div>
    </div>
  );
}

// ---------------- create / first run ----------------
const TEMPLATES = [
  { id: "assistant", title: "Personal assistant", blurb: "Email, calendar and errands in its own browser" },
  { id: "researcher", title: "Researcher", blurb: "Web research and sourced reports" },
  { id: "developer", title: "Developer", blurb: "Codes with Pi, Codex, Copilot CLI or opencode" },
];
const HARNESSES = [
  { id: "pi", label: "Pi (default)" }, { id: "codex", label: "Codex CLI" }, { id: "copilot", label: "Copilot CLI" },
  { id: "opencode", label: "opencode" }, { id: "mock", label: "Demo (no model)" },
];

function CreateAgent({ firstRun, onDone, dests }: { firstRun: boolean; onDone: () => void; dests: Destination[] }) {
  const [step, setStep] = useState(firstRun ? 0 : 2);
  const [model, setModel] = useState({ kind: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4.1-mini" });
  const [harness, setHarness] = useState("pi");
  const [template, setTemplate] = useState("assistant");
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("");
  const [telegram, setTelegram] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const presets: Record<string, { baseUrl: string; model: string; api: string }> = {
    openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", api: "openai-completions" },
    anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-5", api: "anthropic-messages" },
    ollama: { baseUrl: "http://host.docker.internal:11434/v1", model: "qwen2.5vl:7b", api: "openai-completions" },
    custom: { baseUrl: "", model: "", api: "openai-completions" },
  };

  async function go() {
    setBusy(true);
    setError(undefined);
    const p = presets[model.kind];
    const r = await api.create({
      name: name || prompt.split(/\s+/).slice(0, 2).join(" ") || "Nova",
      harness,
      template,
      persona: prompt || undefined,
      telegramToken: telegram || undefined,
      model: harness === "mock" ? undefined : { provider: "scut", api: p.api, baseUrl: model.baseUrl, apiKey: model.apiKey || undefined, model: model.model },
      driver: "local",
    });
    setBusy(false);
    if (r.error) setError(r.error);
    else onDone();
  }

  const card = "rounded-xl border border-white/10 bg-panel2 p-4 text-left transition hover:border-beam/60";
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-black/70 p-6 backdrop-blur">
      <div className="w-full max-w-2xl rounded-3xl bg-panel p-8 glow">
        <div className="mb-6 flex items-center gap-3">
          <Mascot variant="violet" size={48} busy={busy} />
          <div>
            <div className="text-xl font-semibold">{firstRun ? "Welcome to Beamhop" : "New agent"}</div>
            <div className="text-sm text-slate-400">{["Pick a brain", "Pick a harness", "What should your agent do?"][step]}</div>
          </div>
        </div>

        {step === 0 && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-2">
              {Object.keys(presets).map((k) => (
                <button key={k} className={`${card} ${model.kind === k ? "border-beam" : ""}`} onClick={() => setModel({ ...model, kind: k, baseUrl: presets[k].baseUrl, model: presets[k].model })}>
                  <div className="font-medium capitalize">{k === "ollama" ? "Local (Ollama)" : k}</div>
                </button>
              ))}
            </div>
            <input className="w-full rounded-lg bg-panel2 px-3 py-2" placeholder="Base URL" value={model.baseUrl} onChange={(e) => setModel({ ...model, baseUrl: e.target.value })} />
            <input className="w-full rounded-lg bg-panel2 px-3 py-2" placeholder="API key (stays with the agent)" type="password" value={model.apiKey} onChange={(e) => setModel({ ...model, apiKey: e.target.value })} />
            <input className="w-full rounded-lg bg-panel2 px-3 py-2" placeholder="Model" value={model.model} onChange={(e) => setModel({ ...model, model: e.target.value })} />
            <p className="text-xs text-slate-500">Subscription logins (Claude, ChatGPT) happen on the agent's own screen after it boots.</p>
          </div>
        )}
        {step === 1 && (
          <div className="grid grid-cols-2 gap-2">
            {HARNESSES.map((h) => (
              <button key={h.id} className={`${card} ${harness === h.id ? "border-beam" : ""}`} onClick={() => setHarness(h.id)}>{h.label}</button>
            ))}
          </div>
        )}
        {step === 2 && (
          <div className="space-y-4">
            <textarea className="h-20 w-full rounded-lg bg-panel2 px-3 py-2" placeholder="Describe your agent in one sentence…" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            <div className="grid grid-cols-3 gap-2">
              {TEMPLATES.map((t) => (
                <button key={t.id} className={`${card} ${template === t.id ? "border-beam" : ""}`} onClick={() => setTemplate(t.id)}>
                  <div className="font-medium">{t.title}</div>
                  <div className="text-xs text-slate-400">{t.blurb}</div>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="rounded-lg bg-panel2 px-3 py-2" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
              <input className="rounded-lg bg-panel2 px-3 py-2" placeholder="Telegram bot token (optional)" value={telegram} onChange={(e) => setTelegram(e.target.value)} />
            </div>
            {!firstRun && (
              <div className="flex gap-2 text-sm">
                {HARNESSES.map((h) => (
                  <button key={h.id} onClick={() => setHarness(h.id)} className={`rounded-full px-3 py-1 ${harness === h.id ? "bg-beam text-black" : "bg-panel2"}`}>{h.label}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {error && <div className="mt-4 rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-300">{error}</div>}
        <div className="mt-6 flex justify-between">
          <button className="text-slate-400" onClick={() => (step > (firstRun ? 0 : 2) ? setStep(step - 1) : onDone())}>{step > (firstRun ? 0 : 2) ? "Back" : "Cancel"}</button>
          {step < 2 ? (
            <button className="rounded-full bg-beam px-6 py-2 font-semibold text-black" onClick={() => setStep(step + 1)}>Next</button>
          ) : (
            <button disabled={busy} className="rounded-full bg-gradient-to-r from-beam to-beam2 px-6 py-2 font-semibold text-black disabled:opacity-60" onClick={go}>
              {busy ? "Beaming in…" : "Beam it in"}
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
function AgentView({ agent, onBack }: { agent: Agent; onBack: () => void }) {
  const a = useAgent(agent, true);
  const [text, setText] = useState("");
  const [myCursor, setMyCursor] = useState<{ x: number; y: number }>();
  const box = useRef<HTMLDivElement>(null);
  const lastMove = useRef(0);
  const pos = (e: React.MouseEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.round(((e.clientX - r.left) / r.width) * SCREEN.w), y: Math.round(((e.clientY - r.top) / r.height) * SCREEN.h) };
  };
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => chatEnd.current?.scrollIntoView({ behavior: "smooth" }), [a.chat.length]);

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
        <button onClick={onBack} className="text-slate-400 hover:text-white">← Crew</button>
        <Mascot variant={agent.mascot} size={32} busy={a.state === "busy"} />
        <div className="font-semibold">{agent.name}</div>
        <span className="rounded-full bg-panel2 px-2 py-0.5 text-xs text-beam">{agent.current.driver}</span>
        <span className="text-sm text-slate-400">{STATE_LABEL[a.state]}</span>
        <div className="ml-auto font-mono text-xs text-slate-500">
          {a.stats && `${a.stats.cpu}% cpu · ${a.stats.memMb}/${a.stats.memTotalMb} MB · ${a.stats.tokens.input + a.stats.tokens.output} tokens`}
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col p-4">
          <div className="mb-2 rounded-lg bg-panel2 px-3 py-1.5 font-mono text-sm text-beam">{a.narration.at(-1)?.text ?? "…"}</div>
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
            className={`relative mx-auto aspect-[16/10] w-full max-w-[1280px] cursor-none overflow-hidden rounded-xl bg-black outline-none focus:ring-2 focus:ring-beam ${a.state === "stuck" ? "glow-stuck" : "glow"}`}
          >
            {a.frame && <img src={a.frame} className="h-full w-full select-none" draggable={false} />}
            {a.agentCursor && <Cursor p={a.agentCursor} color="#b06bff" label={agent.name} />}
            {myCursor && <Cursor p={myCursor} color="#38e1ff" label="you" />}
          </div>
          <div className="mt-2 text-center text-xs text-slate-500">Shared screen: you and {agent.name} can both act. Click into it to type.</div>
        </div>
        <aside className="flex w-96 flex-col border-l border-white/5 bg-panel">
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {a.chat.map((m, i) => (
              <div key={i} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.from === "agent" ? "bg-panel2" : "ml-auto bg-beam/20"}`}>
                <div className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">{m.from === "agent" ? agent.name : m.from} · {m.channel}</div>
                <div className="whitespace-pre-wrap">{m.text}</div>
              </div>
            ))}
            <div ref={chatEnd} />
          </div>
          <div className="max-h-40 overflow-y-auto border-t border-white/5 p-3 font-mono text-[11px] text-slate-500">
            {a.narration.slice(-12).map((n, i) => <div key={i}>{new Date(n.ts).toLocaleTimeString()} {n.text}</div>)}
          </div>
          <form className="flex gap-2 border-t border-white/5 p-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { a.send({ t: "chat", text }); setText(""); } }}>
            <input value={text} onChange={(e) => setText(e.target.value)} className="flex-1 rounded-full bg-panel2 px-4 py-2 text-sm" placeholder={`Message ${agent.name}…`} />
            <button className="rounded-full bg-beam px-4 text-sm font-semibold text-black">Send</button>
          </form>
        </aside>
      </div>
      <div className="fixed right-4 top-16 z-30 space-y-2">
        {a.approvals.map((ap) => (
          <div key={ap.id} className="w-80 rounded-xl bg-amber-400 p-3 text-black shadow-xl">
            <div className="text-xs font-bold uppercase">Approval needed</div>
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

function Cursor({ p, color, label }: { p: { x: number; y: number }; color: string; label: string }) {
  return (
    <div className="pointer-events-none absolute" style={{ left: `${(p.x / SCREEN.w) * 100}%`, top: `${(p.y / SCREEN.h) * 100}%` }}>
      <svg width="18" height="18" viewBox="0 0 18 18"><path d="M1 1 L1 15 L5 11 L8 17 L10 16 L7 10 L13 10 Z" fill={color} stroke="#000" strokeWidth="1" /></svg>
      <span className="ml-3 rounded px-1 text-[10px] font-semibold text-black" style={{ background: color }}>{label}</span>
    </div>
  );
}

// ---------------- app ----------------
export function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [dests, setDests] = useState<Destination[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [route, setRoute] = useState(location.hash);

  const refresh = useCallback(async () => {
    setAgents(await api.agents());
    setLoaded(true);
  }, []);
  useEffect(() => {
    refresh();
    api.destinations().then(setDests);
    const t = setInterval(refresh, 2000);
    const h = () => setRoute(location.hash);
    addEventListener("hashchange", h);
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    return () => { clearInterval(t); removeEventListener("hashchange", h); };
  }, [refresh]);

  const open = useMemo(() => agents.find((x) => route === `#/agent/${x.id}`), [agents, route]);
  if (open) return <AgentView agent={open} onBack={() => (location.hash = "")} />;

  return (
    <div className="stars min-h-screen pb-40">
      <header className="flex items-center gap-3 px-8 py-6">
        <Mascot variant="cyan" size={36} />
        <div className="text-2xl font-bold tracking-tight">Beam<span className="text-beam">hop</span></div>
        <div className="text-sm text-slate-500">your crew</div>
        <button onClick={() => setCreating(true)} className="ml-auto rounded-full bg-gradient-to-r from-beam to-beam2 px-5 py-2 font-semibold text-black">+ New agent</button>
      </header>
      <main className="grid grid-cols-1 gap-6 px-8 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((ag) => (
          <Tile key={ag.id} agent={ag} dests={dests} onOpen={() => (location.hash = `#/agent/${ag.id}`)} onDragStart={(e) => e.dataTransfer.setData("text/agent", ag.id)} />
        ))}
      </main>
      {loaded && agents.length === 0 && !creating && <CreateAgent firstRun dests={dests} onDone={refresh} />}
      {creating && <CreateAgent firstRun={false} dests={dests} onDone={() => { setCreating(false); refresh(); }} />}
      <Dock dests={dests} onDrop={async (to, id) => { if (id) { await api.beam(id, to); refresh(); } }} />
    </div>
  );
}
