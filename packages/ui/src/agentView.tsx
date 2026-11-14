import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ServerMsg, AgentState, Schedule, MemoryItem, TaskRun } from "@scut/protocol";
import { nip19 } from "nostr-tools";
import qrcode from "qrcode-generator";
import { Instance, Agent, Destination, api, SCREEN, MASCOT_COLORS, BEAM_STAGES, STAGE_LABEL, ChatLine, Approval, Settings, Pairing, Mascot, humanize, needsText, cost, STATE_META, StateChip, plural, bytesLabel, TEMPLATES, HARNESSES, PRESETS, npubToHex, KEYMAP, TELEGRAM_SETUP, CLOUD_SETUP, ago, Cursor, Toast, useToasts, helpOn, PROVIDERS, standaloneAgent } from "./lib.tsx";
import { useAgent } from "./useAgent.ts";
import { BeamMenu, ExportDialog, ImportDialog, BeamReceipt, BeamProgress } from "./beam.tsx";
import { Tile, AutostartToggle, Dock, AddCloud, CrewRoomPanel, App, SoloAgent, CrewApp } from "./crew.tsx";
import { CreateAgent } from "./create.tsx";
import { SettingsPanel, BrainSettings, PersonaSettings, RemoveAgent, safetyItems, SafetyCheck, SkillSettings, MemoryText, MemorySettings, ChannelStatus, ChannelSettings, SecretRow, RecentRuns, Schedules } from "./settings.tsx";

export function AgentView({ agent, dests, onBack, onBeam, standalone = false }: { agent: Agent; dests: Destination[]; onBack: () => void; onBeam: (to: string) => void; standalone?: boolean }) {
  const [phone, setPhone] = useState<{ url: string; local: boolean } | null>(null);
  // On a phone-sized screen the full 1280 px stream is wasted bandwidth; the small one is plenty.
  const [narrow] = useState(() => typeof matchMedia === "function" && matchMedia("(max-width: 700px)").matches);
  const a = useAgent(agent, true, narrow ? 4 : 8, narrow);
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
  // Scroll only the chat list: scrollIntoView would also scroll the page, hiding the header on phones.
  useEffect(() => { const box = chatEnd.current?.parentElement; if (box) box.scrollTop = box.scrollHeight; }, [a.chat.length]);
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
        <h1 className="text-base font-semibold">{agent.name}</h1>
        {!standalone && <span className="shrink-0 whitespace-nowrap rounded-full bg-white/5 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-slate-300">{where}</span>}
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
        <main className="flex min-w-0 flex-1 flex-col p-4">
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
        </main>
        <aside aria-label={showSettings ? "Settings" : `Chat with ${agent.name}`} className="flex min-h-[60vh] w-full flex-col border-t border-white/5 bg-panel lg:min-h-0 lg:w-96 lg:border-l lg:border-t-0">
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
              {a.pairing.channels?.telegram?.bot && !a.pairing.channels.telegram.owner && <TelegramPairQr bot={a.pairing.channels.telegram.bot} code={a.pairing.code} />}
            </div>
          )}
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {a.chat.length === 0 && (
              <div className="mt-8 space-y-3 text-center text-sm text-slate-400">
                <div>Say hi to {agent.name}, or try one of these:</div>
                <div className="flex flex-col items-center gap-2">
                  {["Open Wikipedia and tell me today's featured article", "Find three well-reviewed e-bikes under €2,000, with links", "Every morning at 8, send me the top 3 Hacker News stories"].map((s) => (
                    <button key={s} onClick={() => a.send({ t: "chat", text: s })} className="rounded-full border border-white/10 px-3 py-1.5 text-slate-200 hover:border-beam/60 hover:bg-white/5">{s}</button>
                  ))}
                </div>
              </div>
            )}
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

/** One tap (or one scan) pairs Telegram: t.me deep links deliver "/start <code>" to the bot. */
export function TelegramPairQr({ bot, code }: { bot: string; code: string }) {
  const [show, setShow] = useState(false);
  const link = `https://t.me/${bot}?start=${code}`;
  const svg = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(link);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [link]);
  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-2">
        <a href={link} target="_blank" rel="noreferrer" className="rounded-full bg-beam px-3 py-1 text-sm font-semibold text-black">Pair in Telegram</a>
        <button onClick={() => setShow(!show)} aria-expanded={show} className="rounded-full bg-panel2 px-3 py-1 text-sm hover:bg-white/10">{show ? "Hide QR" : "Scan with phone"}</button>
      </div>
      {show && <div className="w-40 rounded-lg bg-white p-1.5" role="img" aria-label={`QR code to pair with @${bot} in Telegram`} dangerouslySetInnerHTML={{ __html: svg }} />}
    </div>
  );
}

export function PhoneLink({ phone, name, onClose }: { phone: { url: string; local: boolean }; name: string; onClose: () => void }) {
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
