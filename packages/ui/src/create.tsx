import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ServerMsg, AgentState, Schedule, MemoryItem, TaskRun } from "@scut/protocol";
import { nip19 } from "nostr-tools";
import qrcode from "qrcode-generator";
import { Instance, Agent, Destination, api, SCREEN, MASCOT_COLORS, BEAM_STAGES, STAGE_LABEL, ChatLine, Approval, Settings, Pairing, Mascot, humanize, needsText, cost, STATE_META, StateChip, plural, bytesLabel, TEMPLATES, HARNESSES, PRESETS, npubToHex, KEYMAP, TELEGRAM_SETUP, CLOUD_SETUP, ago, Cursor, Toast, useToasts, helpOn, PROVIDERS, standaloneAgent } from "./lib.tsx";
import { useAgent } from "./useAgent.ts";
import { BeamMenu, ExportDialog, ImportDialog, BeamReceipt, BeamProgress } from "./beam.tsx";
import { Tile, AutostartToggle, Dock, AddCloud, CrewRoomPanel, App, SoloAgent, CrewApp } from "./crew.tsx";
import { AgentView, TelegramPairQr, PhoneLink } from "./agentView.tsx";
import { SettingsPanel, BrainSettings, PersonaSettings, RemoveAgent, safetyItems, SafetyCheck, SkillSettings, MemoryText, MemorySettings, ChannelStatus, ChannelSettings, SecretRow, RecentRuns, Schedules } from "./settings.tsx";


export function CreateAgent({ firstRun, onDone }: { firstRun: boolean; onDone: () => void }) {
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
  const [brain, setBrain] = useState<Awaited<ReturnType<typeof api.brain>>>();
  const [check, setCheck] = useState<{ busy?: boolean; error?: string; failed?: boolean }>({});
  const [models, setModels] = useState<string[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pf, setPf] = useState<{ state: string; done: number; total: number; error?: string }>();
  const [dests, setDests] = useState<Destination[]>([]);
  const [where, setWhere] = useState("local");
  useEffect(() => { api.destinations().then(setDests).catch(() => {}); }, []);
  // This computer can't run agents (no engine): start the agent on a connected cloud instead.
  useEffect(() => {
    const cloud = dests.find((d) => d.id !== "local");
    if (pf?.state === "error" && where === "local" && cloud) setWhere(cloud.id);
  }, [pf?.state, dests]);
  useEffect(() => {
    let t: any;
    const poll = async () => {
      const p = await fetch("/api/prefetch").then((r) => r.json()).catch(() => null);
      setPf(p);
      if (p?.state === "pulling") t = setTimeout(poll, 2000);
    };
    poll();
    return () => clearTimeout(t);
  }, []);
  const last = 1;
  useEffect(() => {
    api.brain().then((b) => {
      setBrain(b);
      if (!b) { if (!firstRun) setStep(0); return; }
      const k = Object.entries(PRESETS).find(([, p]) => p.baseUrl === b.baseUrl)?.[0];
      if (k) setKind(k);
      setModel({ baseUrl: b.baseUrl, model: b.model, apiKey: "" });
    });
  }, []);
  const usesSavedKey = !!brain?.hasKey && brain.baseUrl === model.baseUrl && !model.apiKey;
  async function next() {
    if (check.failed) { setCheck({}); setStep(1); return; } // "Continue anyway"
    setCheck({ busy: true });
    const r = await api.verifyBrain({ provider: "scut", api: PRESETS[kind].api, baseUrl: model.baseUrl, apiKey: model.apiKey || undefined, model: model.model });
    if (r.models?.length) setModels(r.models);
    if (r.ok && r.modelFound !== false) { setCheck({}); setStep(1); return; }
    if (r.ok) setDetailsOpen(true);
    setCheck({ failed: true, error: r.ok ? `The key works, but "${model.model}" isn't offered there. Pick another model below.` : r.error });
  }
  /** Local models: look at what's installed as soon as Ollama is picked. */
  async function pickOllama(baseUrl: string) {
    setCheck({ busy: true });
    const r = await api.verifyBrain({ provider: "scut", api: "openai-completions", baseUrl, model: "" });
    setModels(r.models ?? []);
    if (!r.ok) return setCheck({ failed: true, error: r.error });
    if (!r.models?.length) return setCheck({ failed: true, error: "Ollama is running but has no models yet. Run: ollama pull qwen3.8:8b" });
    setModel((m) => ({ ...m, baseUrl, model: r.models!.includes(m.model) ? m.model : r.models![0] }));
    setCheck({});
  }

  async function go() {
    setBusy(true);
    setError(undefined);
    const p = PRESETS[kind];
    const r = await api.create({
      name: name || prompt.match(/\b([A-Z][a-z]+)\b/)?.[1] || ["Nova", "Scout", "Atlas", "Orbit", "Pixel", "Comet"][Math.floor(Math.random() * 6)],
      harness, template, persona: prompt || undefined, telegramToken: telegram || undefined,
      nostr: nostr ? { ownerPubkey: npubToHex(npub) } : undefined,
      model: harness === "mock" ? undefined : { provider: "scut", api: p.api, baseUrl: model.baseUrl, apiKey: model.apiKey || undefined, model: model.model },
      driver: where,
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
            <div className="text-sm text-slate-400">{step === 0 ? (firstRun ? "Step 1 of 2 · Pick a brain" : "Pick a brain") : `${firstRun ? "Step 2 of 2 · " : ""}What should your agent do?`}</div>
          </div>
        </div>

        {step === 0 && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(PRESETS).map(([k, p]) => (
                <button key={k} className={`${card} ${kind === k ? "border-beam" : "border-white/10"}`} onClick={() => { setKind(k); setModels([]); setCheck({}); setModel({ ...model, baseUrl: p.baseUrl, model: p.model }); if (k === "ollama") pickOllama(p.baseUrl); }}>
                  <div className="text-sm font-medium">{p.label}</div>
                </button>
              ))}
            </div>
            {kind !== "ollama" && <input className={input} aria-label="API key" placeholder={usesSavedKey ? "Using your saved key — paste a new one to replace it" : `API key (${PRESETS[kind].keyHint}) — stays on this computer and inside your agents`} type="password" value={model.apiKey} onChange={(e) => { setModel({ ...model, apiKey: e.target.value }); setCheck({}); }} />}
            {check.error && <div role="alert" className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-200">{check.error}</div>}
            {kind === "ollama" && !check.error && models.length > 0 && <div className="text-sm text-slate-300">Found {models.length} local model{models.length > 1 ? "s" : ""}. Using <span className="font-mono">{model.model}</span>.</div>}
            <details className="text-sm text-slate-400" open={detailsOpen} onToggle={(e) => setDetailsOpen((e.target as HTMLDetailsElement).open)}>
              <summary className="cursor-pointer">Advanced: endpoint and model</summary>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input className={input} aria-label="Base URL" value={model.baseUrl} onChange={(e) => setModel({ ...model, baseUrl: e.target.value })} />
                <input className={input} aria-label="Model" list="model-options" value={model.model} onChange={(e) => { setModel({ ...model, model: e.target.value }); setCheck({}); }} />
                <datalist id="model-options">{models.map((m) => <option key={m} value={m} />)}</datalist>
              </div>
            </details>
            {firstRun && <p className="text-xs text-slate-400">Moving an agent from another computer? <button onClick={() => dispatchEvent(new Event("beamhop:import"))} className="text-beam hover:underline">Open its file</button>.</p>}
            <p className="text-xs text-slate-400">Have a ChatGPT or GitHub Copilot subscription instead? <button onClick={() => { setCheck({}); setStep(1); }} className="text-beam hover:underline">Skip this</button>, choose Codex or Copilot CLI under More options, then sign in on the agent's own screen.</p>
          </div>
        )}
        {step === 1 && (
          <div className="space-y-4">
            {!firstRun && brain && (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <span>Brain: <span className="text-slate-200">{Object.values(PRESETS).find((p) => p.baseUrl === model.baseUrl)?.label ?? model.baseUrl}</span> · <span className="font-mono text-[12px]">{model.model}</span></span>
                <button onClick={() => setStep(0)} className="text-beam hover:underline">Change</button>
              </div>
            )}
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
                {dests.length > 1 && (
                  <label className="flex items-center gap-2">Runs on
                    <select value={where} onChange={(e) => setWhere(e.target.value)} aria-label="Runs on" className="rounded-lg bg-panel2 px-2 py-1">
                      {dests.map((d) => <option key={d.id} value={d.id}>{d.label}{d.monthlyUsd ? ` (~$${d.monthlyUsd}/mo)` : ""}</option>)}
                    </select>
                  </label>
                )}
                <input className={input} aria-label="Telegram bot token" placeholder="Telegram bot token (you can add this later in Settings)" value={telegram} onChange={(e) => setTelegram(e.target.value)} />
                <div className="flex items-center gap-2">
                  <label className="flex shrink-0 items-center gap-2"><input type="checkbox" checked={nostr} onChange={(e) => setNostr(e.target.checked)} className="accent-cyan-400" /> Nostr messages</label>
                  {nostr && <input className={input} aria-label="Your npub for approvals" placeholder="Your npub, to get approval requests (optional)" value={npub} onChange={(e) => setNpub(e.target.value)} />}
                </div>
              </div>
            </details>
          </div>
        )}
        {pf?.state === "pulling" && (
          <div className="mt-4 space-y-1 text-xs text-slate-400" role="status">
            <div>Getting your agents' computer ready (first time only){pf.total ? `: ${pf.done} of ${pf.total} parts` : "…"}</div>
            <div className="h-1 overflow-hidden rounded bg-white/10"><div className="h-full bg-beam transition-all" style={{ width: `${pf.total ? Math.round((100 * pf.done) / pf.total) : 5}%` }} /></div>
          </div>
        )}
        {pf?.state === "error" && <div className="mt-4 rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-200">{pf.error}</div>}
        {error && <div className="mt-4 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">Couldn't start the agent: {error}</div>}
        <div className="mt-6 flex justify-between">
          {/* On the very first screen there's nothing to cancel back to */}
          {firstRun && step === 0 ? <span /> : <button className="text-slate-400 hover:text-white" onClick={() => (firstRun && step > 0 ? setStep(step - 1) : !firstRun && step === 0 && brain ? setStep(1) : onDone())}>{(firstRun && step > 0) || (!firstRun && step === 0 && brain) ? "Back" : "Cancel"}</button>}
          {step < last ? (
            <button disabled={check.busy || (!model.apiKey && !usesSavedKey && kind !== "ollama")} className="rounded-full bg-beam px-6 py-2 font-semibold text-black disabled:opacity-50" onClick={next}>{check.busy ? "Checking…" : check.failed ? "Continue anyway" : "Next"}</button>
          ) : (
            <button disabled={busy || (!prompt.trim() && !name.trim())} className="rounded-full bg-gradient-to-r from-beam to-beam2 px-6 py-2 font-semibold text-black disabled:opacity-50" onClick={go}>
              {busy ? (pf?.state === "pulling" ? "Waiting for the download…" : "Beaming in… (~10 s)") : "Create agent"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
