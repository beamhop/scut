import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ServerMsg, AgentState, Schedule, MemoryItem, TaskRun } from "@scut/protocol";
import { nip19 } from "nostr-tools";
import qrcode from "qrcode-generator";
import { Instance, Agent, Destination, api, SCREEN, MASCOT_COLORS, BEAM_STAGES, STAGE_LABEL, ChatLine, Approval, Settings, Pairing, Mascot, humanize, needsText, cost, STATE_META, StateChip, plural, bytesLabel, TEMPLATES, HARNESSES, PRESETS, npubToHex, KEYMAP, TELEGRAM_SETUP, CLOUD_SETUP, ago, Cursor, Toast, useToasts, helpOn, PROVIDERS, standaloneAgent } from "./lib.tsx";
import { useAgent } from "./useAgent.ts";
import { BeamMenu, ExportDialog, ImportDialog, BeamReceipt, BeamProgress } from "./beam.tsx";
import { Tile, AutostartToggle, Dock, AddCloud, CrewRoomPanel, App, SoloAgent, CrewApp } from "./crew.tsx";
import { CreateAgent } from "./create.tsx";
import { AgentView, TelegramPairQr, PhoneLink } from "./agentView.tsx";


export function SettingsPanel({ a, agent, onClose }: { a: ReturnType<typeof useAgent>; agent: Agent; onClose: () => void }) {
  const s = a.settings;
  const [budget, setBudget] = useState(String(s?.dailyTokenBudget ?? 0));
  if (!s) return null;
  const levels = [
    { id: "ask", label: "Ask me first", note: "every action needs approval" },
    { id: "risky", label: "Risky only", note: "payments, messages, deletes, logins" },
    { id: "auto", label: "Never ask", note: "acts on its own — not recommended for email or payments" },
  ];
  const heading = "font-mono text-[11px] uppercase tracking-widest text-slate-400";
  // Order: is it safe → what it does and thinks with → how free it is → where to reach it → routines → what it knows → the end.
  return (
    <div className="flex-1 space-y-5 overflow-y-auto p-5 text-sm">
      <div className="flex items-center"><div className="text-base font-semibold">Settings</div><button onClick={onClose} className="ml-auto rounded-full bg-white px-3 py-1 text-sm font-semibold text-black">Done</button></div>
      <SafetyCheck a={a} agent={agent} />
      <PersonaSettings a={a} name={agent.name} />
      <BrainSettings a={a} name={agent.name} id={agent.id} />
      <div className="space-y-2">
        <div className={heading}>Autonomy</div>
        <div className="space-y-1">
          {levels.map((l) => (
            <label key={l.id} className="flex cursor-pointer items-start gap-2">
              <input type="radio" name="autonomy" checked={s.autonomy === l.id} onChange={() => a.send({ t: "settings", autonomy: l.id })} className="mt-1 accent-cyan-400" />
              <span><span className="font-medium">{l.label}</span> <span className="text-slate-400">— {l.note}</span></span>
            </label>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <div className={heading}>Daily token limit</div>
        <div className="flex items-center gap-2">
          <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="numeric" className="w-32 rounded-lg border border-white/10 bg-panel2 px-2 py-1 font-mono" aria-label="Daily token budget, 0 for none" />
          <button onClick={() => a.send({ t: "settings", dailyTokenBudget: Number(budget) || 0 })} className="rounded-full bg-panel2 px-3 py-1 hover:bg-white/10">Save</button>
          <span className="font-mono text-[11px] text-slate-400">{s.dayTokens.toLocaleString()} used today{s.dailyTokenBudget ? ` of ${s.dailyTokenBudget.toLocaleString()}` : ""}</span>
        </div>
        {agent.price && Number(budget) > 0 && (
          // tokens mean nothing to most people: say roughly what the cap is in money (mostly input tokens in agent work)
          <div className="text-[12px] text-slate-400">≈ ${((Number(budget) * (agent.price.in * 0.8 + agent.price.out * 0.2)) / 1e6).toFixed(2)} a day at most with {agent.model?.model ?? "this model"}. 0 means no limit.</div>
        )}
      </div>
      <ChannelSettings a={a} />
      {s.channels.nostr && agent.agentPubkey && (
        <div className="space-y-1">
          <div className={heading}>Nostr address</div>
          <button className="truncate font-mono text-[12px] text-slate-200 hover:underline" title="Copy" onClick={() => navigator.clipboard?.writeText(nip19.npubEncode(agent.agentPubkey))}>{nip19.npubEncode(agent.agentPubkey).slice(0, 30)}… (copy)</button>
        </div>
      )}
      <Schedules a={a} />
      <MemorySettings a={a} />
      <SkillSettings a={a} />
      <RemoveAgent agent={agent} />
    </div>
  );
}

/** Change the model or key an agent thinks with (an expired key shouldn't strand an agent). */
export function BrainSettings({ a, name, id }: { a: ReturnType<typeof useAgent>; name: string; id: string }) {
  const m = a.settings?.model;
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("openrouter");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [check, setCheck] = useState<{ busy?: boolean; error?: string; ok?: boolean }>({});
  const [models, setModels] = useState<string[]>([]);
  const label = m ? Object.values(PRESETS).find((p) => p.baseUrl === m.baseUrl)?.label ?? m.baseUrl : "a subscription (signed in on its screen)";
  const start = () => {
    const k = Object.entries(PRESETS).find(([, p]) => p.baseUrl === m?.baseUrl)?.[0] ?? "openrouter";
    setKind(k); setBaseUrl(m?.baseUrl ?? PRESETS[k].baseUrl); setModel(m?.model ?? PRESETS[k].model); setKey(""); setCheck({}); setOpen(true);
  };
  const sameEndpoint = baseUrl === m?.baseUrl;
  async function save() {
    setCheck({ busy: true });
    const r = await api.verifyBrain({ provider: "scut", api: PRESETS[kind].api, baseUrl, apiKey: key || undefined, model });
    if (r.models?.length) setModels(r.models);
    // A saved key for this endpoint lives in the agent, not here: only insist on a check when a new key or endpoint is given.
    if (!r.ok && (key || !sameEndpoint)) return setCheck({ error: r.error });
    if (r.ok && r.modelFound === false) return setCheck({ error: `"${model}" isn't offered there.` });
    a.send({ t: "settings", model: { api: PRESETS[kind].api as any, baseUrl, model, apiKey: key || undefined } });
    fetch(`/api/agents/${id}/model`, { method: "POST", body: JSON.stringify({ baseUrl, model }) }).catch(() => {});
    setOpen(false);
  }
  const input = "w-full rounded-lg border border-white/10 bg-panel2 px-2 py-1";
  return (
    <div className="space-y-2">
      <div className="font-mono text-[11px] uppercase tracking-widest text-slate-400">Brain</div>
      {!open ? (
        <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate">{label}{m && <span className="font-mono text-[12px] text-slate-400"> · {m.model}</span>}</span><button onClick={start} className="shrink-0 rounded-full bg-panel2 px-3 py-1 hover:bg-white/10">Change</button></div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {Object.entries(PRESETS).map(([k, p]) => (
              <button key={k} onClick={() => { setKind(k); setBaseUrl(p.baseUrl); setModel(p.model); setCheck({}); }} className={`rounded-full px-2.5 py-0.5 ${kind === k ? "bg-white text-black" : "bg-panel2 hover:bg-white/10"}`}>{p.label}</button>
            ))}
          </div>
          <input className={input} aria-label={`${name}'s model`} list="brain-models" value={model} onChange={(e) => { setModel(e.target.value); setCheck({}); }} />
          <datalist id="brain-models">{models.map((x) => <option key={x} value={x} />)}</datalist>
          <input className={input} aria-label={`${name}'s API key`} type="password" value={key} onChange={(e) => { setKey(e.target.value); setCheck({}); }} placeholder={sameEndpoint && m?.hasKey ? "Keep the current key, or paste a new one" : `API key (${PRESETS[kind].keyHint})`} />
          <details className="text-slate-400"><summary className="cursor-pointer">Endpoint</summary><input className={`${input} mt-1`} aria-label="Endpoint" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setCheck({}); }} /></details>
          {check.error && <div role="alert" className="text-amber-200">{check.error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="rounded-full px-3 py-1 text-slate-400 hover:text-white">Cancel</button>
            <button disabled={check.busy || !model || !baseUrl} onClick={save} className="rounded-full bg-beam px-3 py-1 font-semibold text-black disabled:opacity-50">{check.busy ? "Checking…" : "Save"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PersonaSettings({ a, name }: { a: ReturnType<typeof useAgent>; name: string }) {
  const saved = a.settings?.persona ?? "";
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  return (
    <div className="space-y-2">
      <div className="font-mono text-[11px] uppercase tracking-widest text-slate-400">What {name} does</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} aria-label={`What ${name} does`} placeholder="e.g. Keep an eye on my inbox and draft replies for me to approve" className="h-20 w-full rounded-lg border border-white/10 bg-panel2 px-2 py-1" />
      {text !== saved && <button onClick={() => a.send({ t: "settings", persona: text })} className="rounded-full bg-panel2 px-3 py-1 hover:bg-white/10">Save</button>}
    </div>
  );
}

/** Deleting is final, so it takes two clicks and offers the file as the gentler alternative. */
export function RemoveAgent({ agent }: { agent: Agent }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking) return <button onClick={() => setAsking(true)} className="pt-2 text-sm text-red-300/80 hover:text-red-300">Remove {agent.name}…</button>;
  return (
    <div role="alertdialog" aria-label={`Remove ${agent.name}`} className="space-y-2 rounded-xl border border-red-400/30 bg-red-500/10 p-3">
      <div className="font-medium">Remove {agent.name} for good?</div>
      <div className="text-slate-300">This deletes {agent.name}'s computer, files, browser logins, memory and chats, everywhere it has lived. It can't be undone.</div>
      <div className="text-slate-400">Just moving computers? <button onClick={() => dispatchEvent(new CustomEvent("beamhop:export", { detail: agent.id }))} className="text-beam hover:underline">Move it to a file</button> instead.</div>
      <div className="flex justify-end gap-2">
        <button onClick={() => setAsking(false)} className="rounded-full bg-panel2 px-3 py-1 hover:bg-white/10">Keep {agent.name}</button>
        <button disabled={busy} onClick={async () => { setBusy(true); await api.remove(agent.id); location.hash = ""; }} className="rounded-full bg-red-500 px-3 py-1 font-semibold text-white disabled:opacity-50">{busy ? "Removing…" : "Remove for good"}</button>
      </div>
    </div>
  );
}

/** Plain-language safety posture for one agent: what protects you, and what to look at. */
export function safetyItems(a: ReturnType<typeof useAgent>, agent: Agent) {
  const s = a.settings!;
  const items: { ok: boolean; text: string }[] = [];
  items.push({ ok: true, text: "Works on its own sandboxed computer, separate from your files and accounts" });
  items.push(s.autonomy === "auto"
    ? { ok: false, text: "Never asks before acting. \"Risky only\" still lets it work alone but checks payments, messages and logins with you" }
    : { ok: true, text: s.autonomy === "ask" ? "Asks you before every action" : "Asks you before payments, messages, deletes and logins" });
  if (!s.dailyTokenBudget) items.push({ ok: false, text: "No daily spending cap" });
  else {
    const usd = agent.price ? ` (about $${((s.dailyTokenBudget * (agent.price.in * 0.8 + agent.price.out * 0.2)) / 1e6).toFixed(2)})` : "";
    const pct = Math.round((100 * s.dayTokens) / s.dailyTokenBudget);
    items.push({ ok: pct < 90, text: `Stops at ${(s.dailyTokenBudget / 1e6).toFixed(1)}M tokens a day${usd}; ${pct}% used today` });
  }
  const names: Record<string, string> = { telegram: "Telegram", slack: "Slack", discord: "Discord", nostr: "Nostr" };
  for (const k of Object.keys(names)) {
    if (!(s.channels as any)[k] || k === "nostr") continue;
    const owner = a.pairing?.channels?.[k]?.owner;
    items.push(owner
      ? { ok: true, text: `${names[k]}: anyone in the chat can ask, only you (${owner}) can approve risky things` }
      : { ok: false, text: `${names[k]}: you haven't paired yet, so risky actions there can only be approved here` });
  }
  items.push({ ok: true, text: "Beams are end-to-end encrypted; only one copy can run at a time" });
  return items;
}

export function SafetyCheck({ a, agent }: { a: ReturnType<typeof useAgent>; agent: Agent }) {
  const items = safetyItems(a, agent);
  const todo = items.filter((i) => !i.ok).length;
  const [open, setOpen] = useState(todo > 0);
  return (
    <div className={`rounded-xl p-3 ${todo ? "bg-amber-400/10" : "bg-beam/10"}`}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
        <span aria-hidden className={todo ? "text-amber-300" : "text-beam"}>{todo ? "!" : "✓"}</span>
        <span className="font-medium">{todo ? `Safety: ${todo} thing${todo > 1 ? "s" : ""} to look at` : "Safety: all good"}</span>
        <span className="ml-auto text-slate-400">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {items.map((i) => (
            <li key={i.text} className="flex gap-2"><span aria-hidden className={i.ok ? "text-beam" : "text-amber-300"}>{i.ok ? "✓" : "!"}</span><span className={i.ok ? "text-slate-300" : "text-slate-100"}>{i.text}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SkillSettings({ a }: { a: ReturnType<typeof useAgent> }) {
  const [src, setSrc] = useState("");
  return (
    <div className="space-y-2">
      <div className="font-mono text-[11px] uppercase tracking-widest text-slate-400">Skills · {a.skills.items.length}</div>
      {a.skills.items.map((s) => (
        <div key={s.name} className="flex items-start gap-2 rounded-lg bg-panel2 px-2 py-1.5">
          <div className="min-w-0 flex-1"><div className="font-medium">{s.name}</div><div className="line-clamp-2 text-slate-400">{s.description}</div></div>
          <button aria-label={`Remove ${s.name}`} onClick={() => a.send({ t: "skills", op: "delete", name: s.name })} className="text-slate-400 hover:text-red-300">✕</button>
        </div>
      ))}
      <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); const v = src.trim(); if (!v) return; a.send(v.startsWith("http") ? { t: "skills", op: "add", url: v } : { t: "skills", op: "add", content: v }); setSrc(""); }}>
        <input value={src} onChange={(e) => setSrc(e.target.value)} placeholder="Link to a SKILL.md (GitHub ok) or paste one" aria-label="Add a skill" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-panel2 px-2 py-1" />
        <button className="rounded-full bg-panel2 px-3 py-1 hover:bg-white/10">Add</button>
      </form>
      {a.skills.error && <div className="text-red-300">{a.skills.error}</div>}
    </div>
  );
}

/** A memory you can correct in place: click it, edit, Enter to save, Escape to cancel. */
export function MemoryText({ a, item }: { a: ReturnType<typeof useAgent>; item: MemoryItem }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  if (!editing) return <button onClick={() => { setText(item.text); setEditing(true); }} title="Click to edit" className="min-w-0 flex-1 text-left hover:text-white">{item.text}</button>;
  const save = () => { const t = text.trim(); if (t && t !== item.text) a.send({ t: "memory", op: "edit", id: item.id, text: t }); setEditing(false); };
  return (
    <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={save} aria-label="Edit memory"
      onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
      className="min-w-0 flex-1 rounded border border-white/10 bg-panel px-1" />
  );
}

export function MemorySettings({ a }: { a: ReturnType<typeof useAgent> }) {
  const [text, setText] = useState("");
  return (
    <div className="space-y-2">
      <div className="font-mono text-[11px] uppercase tracking-widest text-slate-400">Memory · {a.memory.length}</div>
      {a.memory.length === 0 && <div className="text-slate-400">Nothing yet. Your agent saves things it learns about you here, and you can add your own.</div>}
      <div className="max-h-48 space-y-1 overflow-y-auto">
        {a.memory.map((m) => (
          <div key={m.id} className="group flex items-start gap-2 rounded-lg bg-panel2 px-2 py-1.5">
            <MemoryText a={a} item={m} />
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

/** What a connected chat app is doing right now: signed in as @bot, still connecting, or token rejected. */
export function ChannelStatus({ a, name }: { a: ReturnType<typeof useAgent>; name: string }) {
  const c = a.pairing?.channels?.[name];
  if (c?.error) return <span role="alert" className="min-w-0 flex-1 text-red-300">{c.error}</span>;
  if (c?.bot) return <span className="min-w-0 flex-1 truncate text-emerald-300">connected as @{c.bot}</span>;
  return <span className="min-w-0 flex-1 text-slate-400">connecting…</span>;
}

export function ChannelSettings({ a }: { a: ReturnType<typeof useAgent> }) {
  const [tg, setTg] = useState("");
  const ch = a.settings?.channels;
  return (
    <div className="space-y-2">
      <div className="font-mono text-[11px] uppercase tracking-widest text-slate-400">Chat with {"this agent"} from…</div>
      <div className="flex items-center gap-2">
        <span className="w-20">Telegram</span>
        {ch?.telegram ? (
          <><ChannelStatus a={a} name="telegram" /><button onClick={() => a.send({ t: "settings", channels: { telegram: null } })} className="ml-auto shrink-0 text-slate-400 hover:text-red-300">Disconnect</button></>
        ) : (
          <><button onClick={() => a.send({ t: "chat", text: TELEGRAM_SETUP })} className="rounded-full bg-beam/90 px-3 py-1 text-sm font-semibold text-black hover:bg-beam" title="Your agent opens Telegram on its screen and creates its own bot">Set it up for me</button>
          <input value={tg} onChange={(e) => setTg(e.target.value)} placeholder="or paste a token from @BotFather" aria-label="Telegram bot token" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-panel2 px-2 py-1" />
          <button onClick={() => { if (tg.trim()) a.send({ t: "settings", channels: { telegram: { token: tg.trim() } } }); setTg(""); }} className="rounded-full bg-panel2 px-3 py-1 hover:bg-white/10">Connect</button></>
        )}
      </div>
      <SecretRow a={a} name="slack" label="Slack" connected={!!ch?.slack} fields={["App token (xapp-…)", "Bot token (xoxb-…)"]}
        onConnect={([appToken, botToken]) => a.send({ t: "settings", channels: { slack: { appToken, botToken } } })}
        onDisconnect={() => a.send({ t: "settings", channels: { slack: null } })} />
      <SecretRow a={a} name="discord" label="Discord" connected={!!ch?.discord} fields={["Bot token"]}
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

export function SecretRow({ a, name, label, connected, fields, onConnect, onDisconnect }: { a: ReturnType<typeof useAgent>; name: string; label: string; connected: boolean; fields: string[]; onConnect: (v: string[]) => void; onDisconnect: () => void }) {
  const [vals, setVals] = useState(fields.map(() => ""));
  if (connected) return <div className="flex items-center gap-2"><span className="w-20 shrink-0">{label}</span><ChannelStatus a={a} name={name} /><button onClick={onDisconnect} className="ml-auto shrink-0 text-slate-400 hover:text-red-300">Disconnect</button></div>;
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

/** What scheduled tasks did while you were away: result, how long, cost, and the screen at the end. */
export function RecentRuns({ runs }: { runs: TaskRun[] }) {
  const [open, setOpen] = useState<string>();
  return (
    <div className="space-y-1 pt-1">
      <div className="text-[12px] text-slate-400">Recent runs</div>
      {[...runs].reverse().map((r) => (
        <div key={r.id} className="rounded-lg bg-panel2">
          <button onClick={() => setOpen(open === r.id ? undefined : r.id)} aria-expanded={open === r.id} className="flex w-full items-center gap-2 px-2 py-1.5 text-left">
            <span aria-label={r.ok ? "Done" : "Failed"} className={r.ok ? "text-beam" : "text-red-300"}>{r.ok ? "✓" : "✕"}</span>
            <span className="min-w-0 flex-1 truncate">{r.prompt}</span>
            <span className="shrink-0 font-mono text-[11px] text-slate-400">{ago(r.endedAt)}</span>
          </button>
          {open === r.id && (
            <div className="space-y-2 px-2 pb-2">
              <div className="font-mono text-[11px] text-slate-400">took {Math.max(1, Math.round((r.endedAt - r.startedAt) / 1000))}s · {r.tokens.toLocaleString()} tokens</div>
              <div className="whitespace-pre-wrap text-slate-200">{r.result}</div>
              {r.shot && <img src={r.shot} alt={`Screen when "${r.prompt}" finished`} className="w-full rounded-md ring-1 ring-white/10" />}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function Schedules({ a }: { a: ReturnType<typeof useAgent> }) {
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
    // Local wall-clock time + your time zone, so "daily at 8:00" stays 8:00 across daylight-saving changes and beams.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const minuteOfDay = tz ? h * 60 + m : local.getUTCHours() * 60 + local.getUTCMinutes();
    save([...a.schedules, { id: Math.random().toString(36).slice(2, 8), prompt, kind, minuteOfDay, minutes: Number(minutes) || 60, enabled: true, createdAt: Date.now(), ...(tz ? { tz } : {}) }]);
    setPrompt("");
  };
  const label = (s: Schedule) => {
    if (s.kind === "every") return `every ${s.minutes} min`;
    const d = new Date();
    const hh = Math.floor((s.minuteOfDay ?? 0) / 60), mm = (s.minuteOfDay ?? 0) % 60;
    if (s.tz) d.setHours(hh, mm, 0, 0); else d.setUTCHours(hh, mm, 0, 0);
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return `daily ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${s.tz && s.tz !== here ? ` (${s.tz})` : ""}`;
  };
  return (
    <div className="space-y-2">
      <div className="font-mono text-[11px] uppercase tracking-widest text-slate-400">Scheduled tasks</div>
      {a.schedules.map((s) => (
        <div key={s.id} className="flex items-center gap-2 rounded-lg bg-panel2 px-2 py-1.5">
          <input type="checkbox" checked={s.enabled} aria-label="Enabled" onChange={() => save(a.schedules.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)))} className="accent-cyan-400" />
          <div className="min-w-0 flex-1"><div className="truncate">{s.prompt}</div><div className="font-mono text-[11px] text-slate-400">{label(s)}{s.lastRun ? ` · last ${new Date(s.lastRun).toLocaleString()}` : ""}</div></div>
          <button onClick={() => a.send({ t: "run_schedule", id: s.id })} className="rounded-full bg-white/5 px-2 py-0.5 text-[12px] hover:bg-white/10">Run now</button>
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
      {a.runs.length > 0 && <RecentRuns runs={a.runs} />}
    </div>
  );
}
