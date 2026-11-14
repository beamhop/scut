import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ServerMsg, AgentState, Schedule, MemoryItem, TaskRun } from "@scut/protocol";
import { nip19 } from "nostr-tools";
import qrcode from "qrcode-generator";
import { Instance, Agent, Destination, api, SCREEN, MASCOT_COLORS, BEAM_STAGES, STAGE_LABEL, ChatLine, Approval, Settings, Pairing, Mascot, humanize, needsText, cost, STATE_META, StateChip, plural, bytesLabel, TEMPLATES, HARNESSES, PRESETS, npubToHex, KEYMAP, TELEGRAM_SETUP, CLOUD_SETUP, ago, Cursor, Toast, useToasts, helpOn, PROVIDERS, standaloneAgent } from "./lib.tsx";
import { useAgent } from "./useAgent.ts";
import { BeamMenu, ExportDialog, ImportDialog, BeamReceipt, BeamProgress } from "./beam.tsx";
import { CreateAgent } from "./create.tsx";
import { AgentView, TelegramPairQr, PhoneLink } from "./agentView.tsx";
import { SettingsPanel, BrainSettings, PersonaSettings, RemoveAgent, safetyItems, SafetyCheck, SkillSettings, MemoryText, MemorySettings, ChannelStatus, ChannelSettings, SecretRow, RecentRuns, Schedules } from "./settings.tsx";


// ---------------- tile ----------------
export function Tile({ agent, dests, onOpen, onBeam, onStatus }: { agent: Agent; dests: Destination[]; onOpen: () => void; onBeam: (to: string) => void; onStatus: (id: string, s: string) => void }) {
  const a = useAgent(agent, true, 2, true); // tiles: small 480 px frames
  const [menu, setMenu] = useState(false);
  const beaming = !!agent.beam && !["online", "failed"].includes(agent.beam.stage);
  // A chat app that can't sign in is quiet trouble (messages never arrive): surface it on the tile when idle.
  const broken = Object.entries(a.pairing?.channels ?? {}).find(([, c]) => c.error)?.[0];
  const brokenText = broken && a.state === "running" ? `${broken[0].toUpperCase()}${broken.slice(1)} can't sign in — fix it in Settings` : undefined;
  const now = needsText(a) ?? brokenText ?? a.narration.at(-1)?.text ?? STATE_META[a.state]?.label;
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
            <span className="min-w-0 truncate font-semibold">{agent.name}</span>
            <span className="shrink-0 whitespace-nowrap rounded-full bg-white/5 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-slate-300">{where}</span>
          </div>
          <div className="truncate font-mono text-[12px] text-slate-400">{now}</div>
        </div>
        {a.stats && <div className="text-right font-mono text-[11px] leading-4 text-slate-400 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">{a.stats.cpu}% CPU · {(a.stats.memMb / 1024).toFixed(1)} GB<br />{cost(agent, a.stats.tokens)}</div>}
      </div>
      <BeamReceipt agent={agent} where={where} from={dests.find((d) => d.id === agent.beam?.from)?.label ?? agent.beam?.from ?? "here"} />
      {agent.beam?.stage === "failed" && <div className="bg-red-500/15 px-3 py-1.5 text-xs text-red-300">Beam failed, {agent.name} stayed put: {agent.beam.error?.slice(0, 120)}</div>}
    </div>
  );
}

// ---------------- destination dock ----------------
/** Agents on this computer come back when Beamhop starts; starting it at login keeps them going after a reboot. */
export function AutostartToggle() {
  const [on, setOn] = useState<boolean>();
  useEffect(() => { fetch("/api/autostart").then((r) => r.json()).then((j) => setOn(j.on)).catch(() => {}); }, []);
  if (on === undefined) return null;
  return (
    <label className="ml-auto flex cursor-pointer items-center gap-2 normal-case tracking-normal">
      <input type="checkbox" checked={on} onChange={async (e) => { const j = await (await fetch("/api/autostart", { method: "POST", body: JSON.stringify({ on: e.target.checked }) })).json(); setOn(j.on); }} className="accent-cyan-400" />
      Open Beamhop when I log in
    </label>
  );
}

export function Dock({ dests, onDrop, dragging, onAddCloud }: { dests: Destination[]; onDrop: (dest: string, agentId: string) => void; dragging: boolean; onAddCloud: () => void }) {
  const [hot, setHot] = useState<string>();
  return (
    <nav aria-label="Where your agents live" className="fixed inset-x-0 bottom-0 border-t border-white/5 bg-panel/90 px-8 py-4 backdrop-blur">
      <div className="mb-2 flex items-center font-mono text-[11px] uppercase tracking-widest text-slate-400">
        <span>Where your agents live · drag one here to move it</span>
        <AutostartToggle />
      </div>
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
        <button onClick={() => dispatchEvent(new Event("beamhop:import"))} className="grid min-w-48 place-items-center rounded-xl border border-dashed border-white/15 px-4 py-3 text-sm text-slate-400 hover:border-beam/50 hover:text-white">Open an agent file</button>
      </div>
    </nav>
  );
}
export function AddCloud({ onClose, onAdded, helpers }: { onClose: () => void; onAdded: (label: string) => void; helpers: Agent[] }) {
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
export function CrewRoomPanel({ onClose, agentNames }: { onClose: () => void; agentNames: string[] }) {
  const [data, setData] = useState<{ enabled: boolean; lines: { name: string; text: string; ts: number }[]; members: { name: string; kind: string }[] }>();
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const load = () => fetch("/api/crew").then((r) => r.json()).then(setData).catch(() => {});
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { const box = end.current?.parentElement; if (box) box.scrollTop = box.scrollHeight; }, [data?.lines.length]);
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

export function App() {
  const solo = useMemo(standaloneAgent, []);
  if (solo) return <SoloAgent agent={solo} />;
  return <CrewApp />;
}

export function SoloAgent({ agent }: { agent: Agent }) {
  const [info, setInfo] = useState({ name: agent.name, mascot: agent.mascot, agentPubkey: "" });
  useEffect(() => {
    fetch(`/status?auth=${agent.token}`).then((r) => r.json()).then((s) => s.spec && setInfo({ name: s.spec.name, mascot: s.spec.mascot ?? "cyan", agentPubkey: s.spec.agentPubkey })).catch(() => {});
  }, []);
  return <AgentView agent={{ ...agent, ...info }} dests={[]} onBack={() => {}} onBeam={() => {}} standalone />;
}

export function CrewApp() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [dests, setDests] = useState<Destination[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [route, setRoute] = useState(location.hash);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  const [crewOpen, setCrewOpen] = useState(false);
  const [addCloud, setAddCloud] = useState(false);
  const [exportId, setExportId] = useState<string>();
  const [importing, setImporting] = useState(false);
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
    const onExport = (e: Event) => setExportId((e as CustomEvent).detail);
    const onImport = () => setImporting(true);
    addEventListener("beamhop:export", onExport);
    addEventListener("beamhop:import", onImport);
    return () => { removeEventListener("scut:cloud", onCloud); removeEventListener("beamhop:export", onExport); removeEventListener("beamhop:import", onImport); };
  }, []);
  const exportAgent = agents.find((x) => x.id === exportId);
  const fileDialogs = <>
    {exportAgent && <ExportDialog agent={exportAgent} onClose={() => setExportId(undefined)} onDone={(name) => { setExportId(undefined); location.hash = ""; refresh(); toasts.push(`${exportAgent.name} is now in ${name}. Open it in Beamhop on the other computer.`); }} />}
    {importing && <ImportDialog dests={dests} onClose={() => setImporting(false)} onDone={(name) => { setImporting(false); refresh(); toasts.push(`${name} is here.`); }} />}
  </>;

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
  // The window title carries the count, so a waiting approval shows in the taskbar/dock while you're elsewhere.
  useEffect(() => { document.title = needCount ? `(${needCount}) Beamhop — ${needCount === 1 ? "an agent needs" : "agents need"} you` : "Beamhop"; }, [needCount]);

  if (open) return <>{toasts.view}{fileDialogs}<AgentView agent={open} dests={dests} onBack={() => (location.hash = "")} onBeam={(to) => beam(open.id, to)} /></>;

  return (
    <div className="stars min-h-screen pb-40">
      <header className="flex items-center gap-3 px-8 py-6">
        <Mascot variant="cyan" size={36} />
        <h1 className="text-2xl font-bold tracking-tight">Beam<span className="text-beam">hop</span></h1>
        <div className="font-mono text-[11px] uppercase tracking-widest text-slate-400">
          {agents.length} agent{agents.length === 1 ? "" : "s"}{needCount ? <span className="text-amber-300"> · {needCount} need{needCount === 1 ? "s" : ""} you</span> : ""}
        </div>
        <button onClick={() => setCrewOpen(!crewOpen)} className="ml-auto rounded-full bg-panel2 px-4 py-2 text-sm hover:bg-white/10">Talk to all agents</button>
        <button onClick={() => setCreating(true)} className="rounded-full bg-gradient-to-r from-beam to-beam2 px-5 py-2 font-semibold text-black">+ New agent</button>
      </header>
      <main className={`grid grid-cols-1 items-start gap-6 px-8 md:grid-cols-2 xl:grid-cols-3 ${crewOpen ? "xl:pr-[440px]" : ""}`}>
        {sorted.map((ag) => (
          <Tile key={ag.id} agent={ag} dests={dests} onOpen={() => (location.hash = `#/agent/${ag.id}`)} onBeam={(to) => beam(ag.id, to)} onStatus={onStatus} />
        ))}
      </main>
      {loaded && agents.length === 0 && !creating && !importing && <CreateAgent firstRun onDone={refresh} />}
      {creating && <CreateAgent firstRun={false} onDone={() => { setCreating(false); refresh(); }} />}
      <Dock dests={dests} dragging={dragging} onDrop={(to, id) => id && beam(id, to)} onAddCloud={() => setAddCloud(true)} />
      {addCloud && <AddCloud helpers={agents} onClose={() => setAddCloud(false)} onAdded={(label) => { setAddCloud(false); api.destinations().then(setDests); toasts.push(`${label} added. Drag an agent onto it to beam it there.`); }} />}
      {crewOpen && <CrewRoomPanel onClose={() => setCrewOpen(false)} agentNames={agents.map((x) => x.name)} />}
      {fileDialogs}
      {toasts.view}
    </div>
  );
}
