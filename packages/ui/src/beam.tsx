import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ServerMsg, AgentState, Schedule, MemoryItem, TaskRun } from "@scut/protocol";
import { nip19 } from "nostr-tools";
import qrcode from "qrcode-generator";
import { Instance, Agent, Destination, api, SCREEN, MASCOT_COLORS, BEAM_STAGES, STAGE_LABEL, ChatLine, Approval, Settings, Pairing, Mascot, humanize, needsText, cost, STATE_META, StateChip, plural, bytesLabel, TEMPLATES, HARNESSES, PRESETS, npubToHex, KEYMAP, TELEGRAM_SETUP, CLOUD_SETUP, ago, Cursor, Toast, useToasts, helpOn, PROVIDERS, standaloneAgent } from "./lib.tsx";
import { useAgent } from "./useAgent.ts";
import { Tile, AutostartToggle, Dock, AddCloud, CrewRoomPanel, App, SoloAgent, CrewApp } from "./crew.tsx";
import { CreateAgent } from "./create.tsx";
import { AgentView, TelegramPairQr, PhoneLink } from "./agentView.tsx";
import { SettingsPanel, BrainSettings, PersonaSettings, RemoveAgent, safetyItems, SafetyCheck, SkillSettings, MemoryText, MemorySettings, ChannelStatus, ChannelSettings, SecretRow, RecentRuns, Schedules } from "./settings.tsx";


// ---------------- beam menu (non-drag alternative) ----------------
export function BeamMenu({ agent, dests, onBeam, onClose }: { agent: Agent; dests: Destination[]; onBeam: (to: string) => void; onClose: () => void }) {
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
      <button role="menuitem" onClick={() => { dispatchEvent(new CustomEvent("beamhop:export", { detail: agent.id })); onClose(); }}
        className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-panel2 focus:bg-panel2 focus:outline-none">
        <span>A file, for another computer…</span><span className="font-mono text-[11px] text-slate-400">offline</span>
      </button>
    </div>
  );
}

/** Move an agent into a passphrase-locked file. It stops here; the file is the agent until it's opened elsewhere. */
export function ExportDialog({ agent, onClose, onDone }: { agent: Agent; onClose: () => void; onDone: (filename: string) => void }) {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ok = p1.length >= 8 && p1 === p2;
  async function go() {
    setBusy(true); setError(undefined);
    const r = await fetch(`/api/agents/${agent.id}/export`, { method: "POST", body: JSON.stringify({ passphrase: p1 }) });
    if (!r.ok) { setBusy(false); setError((await r.json().catch(() => ({}))).error ?? `Export failed (${r.status})`); return; }
    const name = r.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `${agent.name}.beamhop`;
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    onDone(name);
  }
  const input = "w-full rounded-lg border border-white/10 bg-panel2 px-3 py-2 text-sm outline-none focus:border-beam";
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/70 p-6 backdrop-blur" role="dialog" aria-modal="true" aria-label={`Move ${agent.name} to a file`}>
      <div className="w-full max-w-md space-y-4 rounded-3xl bg-panel p-7 ring-1 ring-white/10">
        <div className="text-lg font-semibold">Move {agent.name} to a file</div>
        <p className="text-sm text-slate-300">{agent.name} stops here and goes into one encrypted file, with its files, logins, memory and chats. Open the file in Beamhop on any computer to bring {agent.name} back to life there — whoever opens it becomes its owner.</p>
        <input className={input} type="password" aria-label="Passphrase" placeholder="Passphrase (8+ characters)" value={p1} onChange={(e) => setP1(e.target.value)} />
        <input className={input} type="password" aria-label="Repeat passphrase" placeholder="Repeat it" value={p2} onChange={(e) => setP2(e.target.value)} />
        <p className="text-xs text-amber-200">Keep the file and the passphrase safe: until it's opened again, the file is {agent.name}. A lost passphrase can't be recovered.</p>
        {error && <div role="alert" className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">{error}</div>}
        <div className="flex justify-between">
          <button className="text-slate-400 hover:text-white" onClick={onClose}>Cancel</button>
          <button disabled={!ok || busy} onClick={go} className="rounded-full bg-beam px-5 py-2 font-semibold text-black disabled:opacity-50">{busy ? "Packing…" : "Move to file"}</button>
        </div>
      </div>
    </div>
  );
}

/** Bring an agent in from a .beamhop file. */
export function ImportDialog({ dests, onClose, onDone }: { dests: Destination[]; onClose: () => void; onDone: (name: string) => void }) {
  const [file, setFile] = useState<File>();
  const [pass, setPass] = useState("");
  const [to, setTo] = useState("local");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function go() {
    if (!file) return;
    setBusy(true); setError(undefined);
    const r = await fetch(`/api/import?to=${encodeURIComponent(to)}`, { method: "POST", headers: { "x-passphrase": encodeURIComponent(pass) }, body: file });
    const j = await r.json().catch(() => ({ error: `Import failed (${r.status})` }));
    setBusy(false);
    if (j.error) setError(j.error); else onDone(j.name);
  }
  const input = "w-full rounded-lg border border-white/10 bg-panel2 px-3 py-2 text-sm outline-none focus:border-beam";
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/70 p-6 backdrop-blur" role="dialog" aria-modal="true" aria-label="Open an agent file">
      <div className="w-full max-w-md space-y-4 rounded-3xl bg-panel p-7 ring-1 ring-white/10">
        <div className="text-lg font-semibold">Open an agent file</div>
        <p className="text-sm text-slate-300">Bring an agent here from a <span className="font-mono">.beamhop</span> file made on another computer. You'll be its owner.</p>
        <input className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-full file:border-0 file:bg-panel2 file:px-3 file:py-1.5 file:text-slate-100" type="file" accept=".beamhop" aria-label="Agent file" onChange={(e) => setFile(e.target.files?.[0])} />
        <input className={input} type="password" aria-label="Passphrase" placeholder="Passphrase" value={pass} onChange={(e) => setPass(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-slate-300">Run it on
          <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Run it on" className="rounded-lg bg-panel2 px-2 py-1">{dests.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select>
        </label>
        {error && <div role="alert" className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">{error}</div>}
        <div className="flex justify-between">
          <button className="text-slate-400 hover:text-white" onClick={onClose}>Cancel</button>
          <button disabled={!file || !pass || busy} onClick={go} className="rounded-full bg-beam px-5 py-2 font-semibold text-black disabled:opacity-50">{busy ? "Bringing it in… (~15 s)" : "Open"}</button>
        </div>
      </div>
    </div>
  );
}

/** "What came along": shown on a tile once after a beam lands. */
export function BeamReceipt({ agent, where, from }: { agent: Agent; where: string; from: string }) {
  const b = agent.beam;
  const key = `receipt:${agent.id}:${b?.doneAt}`;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === "1"; } catch { return false; } });
  if (!b || b.stage !== "online" || !b.doneAt || !b.summary || hidden || Date.now() - b.doneAt > 30 * 60_000) return null;
  const c = b.summary.carried;
  const items = [
    c.chat ? plural(c.chat, "message") : null, c.memory ? plural(c.memory, "memory", "memories") : null,
    c.skills ? plural(c.skills, "skill") : null, c.schedules ? plural(c.schedules, "scheduled task") : null,
    "browser logins", "files",
  ].filter(Boolean);
  const secs = Math.max(1, Math.round((b.doneAt - b.startedAt) / 1000));
  return (
    <div role="status" onClick={(e) => e.stopPropagation()} className="flex items-start gap-2 bg-beam/10 px-3 py-2 text-xs text-slate-200">
      <span className="text-beam">✓</span>
      <div className="min-w-0 flex-1">
        <div><span className="font-semibold">Arrived on {where}</span> from {from} in {secs}s · {bytesLabel(b.summary.bytes)}</div>
        <div className="text-slate-400">Came along: {items.join(", ")}.{c.channels ? ` ${plural(c.channels, "chat app")} reconnected.` : ""}</div>
      </div>
      <button aria-label="Dismiss" className="text-slate-400 hover:text-white" onClick={() => { try { localStorage.setItem(key, "1"); } catch {} setHidden(true); }}>✕</button>
    </div>
  );
}

export function BeamProgress({ agent }: { agent: Agent }) {
  const b = agent.beam!;
  const idx = BEAM_STAGES.indexOf(b.stage as any);
  return (
    <div className="beam-overlay absolute inset-0 grid place-items-center">
      <div className="w-72 rounded-xl bg-black/80 p-4 font-mono text-[12px]">
        <div className="mb-2 text-beam">Beaming {b.from ? `from ${b.from} ` : ""}to {b.to}</div>
        <div className="mb-2 text-slate-400">Stays here until it lands safely</div>
        {BEAM_STAGES.map((s, i) => (
          <div key={s} className={i < idx ? "text-slate-400" : i === idx ? "text-white" : "text-slate-600"}>
            {i < idx ? "✓" : i === idx ? "›" : "·"} {STAGE_LABEL[s]}
          </div>
        ))}
      </div>
    </div>
  );
}
