import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import { ArrowCounterClockwiseIcon, ArrowsLeftRightIcon, CaretDownIcon, CheckIcon, CloudIcon, DesktopIcon, FileArrowDownIcon, WarningIcon, XIcon, type Icon } from "@phosphor-icons/react";
import { Agent, Destination, BEAM_STAGES } from "./lib.tsx";
import { Button, IconButton, Menu, Dialog, Field, Input, Select, Progress, Plate, announce, money, usdToEur, duration, durationWords, bytes, plural, list, cx, prefersReducedMotion, type MenuSection } from "./ui/index.ts";

// ---------------- places ----------------

/** Where an agent can live, in plain words. "local" and any other free host on this machine count as This computer. */
export function placeIcon(d?: Pick<Destination, "id" | "monthlyUsd">): Icon {
  if (!d) return DesktopIcon;
  if (d.id === "file") return FileArrowDownIcon;
  return isHere(d) ? DesktopIcon : CloudIcon;
}
const isHere = (d: Pick<Destination, "id" | "monthlyUsd">) => d.id === "local" || d.id === "docker" || d.id === "smolvm";

/** "€0/month" · "~€18/month" (per agent). Never "free": that word reads as a status. */
export function placeCost(d: Pick<Destination, "monthlyUsd">) {
  return d.monthlyUsd ? money(usdToEur(d.monthlyUsd), { approx: true, period: "month" }) : money(0, { whole: true, period: "month" });
}
/** For lane headers: "no running cost" · "~€18/month each". */
export function placeRunningCost(d: Pick<Destination, "monthlyUsd">) {
  return d.monthlyUsd ? `${placeCost(d)} each` : "no running cost";
}

/** The pre-flight line: what changes if the agent moves there. */
export function placeChange(d: Destination, agentName: string) {
  if (isHere(d)) return `Runs on this computer. ${agentName} pauses while it sleeps.`;
  if (d.monthlyUsd) return `Key works. Keeps working while this computer is off. You pay ${d.label} directly.`;
  return `Keeps working while this computer is off.`;
}

export function placeLabel(dests: Destination[], id?: string) {
  return dests.find((d) => d.id === id)?.label ?? (id === "local" ? "This computer" : id ?? "here");
}

// ---------------- beam menu (the non-drag path; keeps the "Beam to…" label and role=menu/menuitem contract) ----------------

export function BeamMenu({ agent, dests, onBeam, onFile, open, onOpenChange, size = "sm", trigger, align = "end", side = "bottom" }: {
  agent: Agent; dests: Destination[];
  /** Called with the destination id. The caller decides about confirm/undo (see the bench). */
  onBeam: (to: string) => void;
  /** "A file, for another computer…". Default: dispatches beamhop:export, which the app shell turns into the export dialog. */
  onFile?: () => void;
  open?: boolean; onOpenChange?: (open: boolean) => void;
  size?: "sm" | "md"; trigger?: ReactElement<any>; align?: "start" | "end"; side?: "top" | "bottom";
  /** Old API (agent view before its rebuild): ignored. */
  onClose?: () => void;
}) {
  const here = agent.current.driver;
  const busy = !!agent.beam && !["online", "failed"].includes(agent.beam.stage);
  const sections: MenuSection[] = [
    {
      items: dests.map((d) => ({
        id: d.id,
        label: d.label,
        disabled: d.id === here || busy,
        hint: d.id === here ? "here now" : placeCost(d),
        description: d.id === here ? `${agent.name} is here now.` : placeChange(d, agent.name),
        onSelect: () => onBeam(d.id),
      })),
    },
    {
      items: [{
        id: "file", label: "A file, for another computer…", textValue: "A file", hint: "offline", disabled: busy,
        description: `This moves ${agent.name}. It does not make a copy.`,
        onSelect: () => (onFile ? onFile() : dispatchEvent(new CustomEvent("beamhop:export", { detail: agent.id }))),
      }],
    },
  ];
  return (
    <Menu
      trigger={trigger ?? <Button size={size} icon={ArrowsLeftRightIcon} iconEnd={CaretDownIcon} disabled={busy}>Beam to…</Button>}
      heading={`Beam ${agent.name} to…`}
      items={sections}
      width={300}
      align={align}
      side={side}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

// ---------------- in flight ----------------

export const STAGE_SENTENCE = (name: string): Record<string, string> => ({
  packing: "Packing", provisioning: "Starting the new computer", transferring: "Sending the encrypted bundle",
  restoring: `Starting ${name}`, online: "Online",
});
const STAGES = BEAM_STAGES as readonly string[];
export const beamInFlight = (a: Agent) => !!a.beam && !["online", "failed"].includes(a.beam.stage);

function useTick(on: boolean, every = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set((x) => x + 1), every);
    return () => clearInterval(t);
  }, [on, every]);
}

/** The thin track between two places. The only gradient in the product (ink → signal). */
export function BeamTrack({ from, to, value }: { from: string; to: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-micro text-ink-2" aria-hidden>
      <span className="max-w-[40%] truncate">{from}</span>
      <span className="relative h-[3px] min-w-8 flex-1 overflow-hidden rounded-full bg-line">
        <span className="absolute inset-y-0 left-0 rounded-full bg-linear-to-r from-ink to-signal transition-[width] duration-(--dur-view) ease-(--ease-out)" style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className="max-w-[40%] truncate text-ink">{to}</span>
    </div>
  );
}

/** Staged progress for a beam, with elapsed time. role=progressbar + aria-valuetext. */
export function BeamProgress({ agent, dests = [], className }: { agent: Agent; dests?: Destination[]; className?: string }) {
  const b = agent.beam;
  useTick(!!b && beamInFlight(agent));
  if (!b) return null;
  const idx = Math.max(0, STAGES.indexOf(b.stage));
  const sentences = STAGE_SENTENCE(agent.name);
  const labels = STAGES.map((s) => sentences[s]);
  return (
    <div className={cx("space-y-2", className)}>
      <BeamTrack from={placeLabel(dests, b.from ?? agent.current.driver)} to={placeLabel(dests, b.to)} value={(idx + 0.5) / STAGES.length} />
      <Progress label={`Beaming ${agent.name} to ${placeLabel(dests, b.to)}`} hideLabel stages={labels} current={idx}
        valueText={`Step ${idx + 1} of ${STAGES.length}: ${labels[idx]}`} />
      <div className="flex items-baseline gap-2 text-small">
        <span className="min-w-0 flex-1 truncate font-medium text-ink">{labels[idx]}…</span>
        <span className="shrink-0 tabular-nums text-ink-2"><span className="sr-only">Elapsed </span>{duration(Date.now() - b.startedAt)}</span>
      </div>
    </div>
  );
}

/** The ghost unit in the target dock while an agent travels there. */
export function BeamGhost({ agent, dests }: { agent: Agent; dests: Destination[] }) {
  const from = placeLabel(dests, agent.beam?.from ?? agent.current.driver);
  return (
    <article data-ghost={agent.id} aria-label={`${agent.name}, arriving from ${from}`} className="w-full animate-pop rounded-unit border border-dashed border-line-strong bg-surface/60 p-3.5">
      <header className="mb-3 flex items-center gap-2">
        <Plate pubkey={agent.agentPubkey} name={agent.name} size="sm" />
        <h3 className="min-w-0 truncate text-body font-semibold text-ink">{agent.name}</h3>
        <span className="ml-auto text-small text-ink-2">Arriving</span>
      </header>
      <BeamProgress agent={agent} dests={dests} />
    </article>
  );
}

/**
 * Free destinations: the beam starts after 5 s unless undone. Shown on the agent's own unit, where you acted
 * ("Beaming to Cloud in 4 s · Undo · Beam now"); the target dock shows a quiet BeamPendingGhost.
 */
export function BeamCountdown({ agent, to, at, onUndo, onNow }: { agent: Agent; to: Destination; at: number; onUndo: () => void; onNow: () => void }) {
  useTick(true, 250);
  const undo = useRef<HTMLButtonElement>(null);
  // Undo takes focus when the beam was asked for from this unit (its menu just closed) or from nowhere (⌘K).
  useEffect(() => {
    const t = setTimeout(() => { const ae = document.activeElement; if (!ae || ae === document.body || undo.current?.closest("[data-unit]")?.contains(ae)) undo.current?.focus({ preventScroll: true }); }, 0);
    return () => clearTimeout(t);
  }, []);
  const left = Math.max(0, Math.ceil((at - Date.now()) / 1000));
  const total = 5;
  return (
    <div role="group" aria-label={`${agent.name} beams to ${to.label} in ${left} seconds`}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onUndo(); } }}
      className="animate-pop space-y-2 rounded-control border border-ink bg-surface px-2.5 py-2">
      <p className="flex items-baseline gap-2 text-small">
        <span className="min-w-0 flex-1 font-medium text-ink">Beaming to {to.label} in <span className="tabular-nums">{left} s</span></span>
      </p>
      <span aria-hidden className="block h-[3px] overflow-hidden rounded-full bg-line">
        <span className="block h-full rounded-full bg-ink transition-[width] duration-(--dur-tray) ease-linear" style={{ width: `${Math.round(((total - left) / total) * 100)}%` }} />
      </span>
      <div className="flex flex-wrap gap-2">
        <Button ref={undo} size="sm" icon={ArrowCounterClockwiseIcon} onClick={onUndo}>Undo</Button>
        <Button size="sm" variant="quiet" onClick={onNow}>Beam now</Button>
      </div>
    </div>
  );
}

/** In the target dock while a beam waits for its countdown or for your OK. Information only: the controls are on the unit. */
export function BeamPendingGhost({ agent, at, confirm }: { agent: Agent; at?: number; confirm?: boolean }) {
  useTick(!confirm, 250);
  const left = at ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : 0;
  return (
    <div data-ghost={agent.id} aria-hidden className="flex min-h-[112px] w-full animate-pop items-center gap-3 rounded-unit border border-dashed border-line-strong px-3.5 py-3 text-small text-ink-2">
      <Plate pubkey={agent.agentPubkey} name={agent.name} size="sm" />
      <span className="min-w-0"><span className="font-medium text-ink">{agent.name}</span> {confirm ? "comes here once you confirm" : <>arrives here, starting in <span className="tabular-nums">{left} s</span></>}</span>
    </div>
  );
}

/**
 * Paid destinations: one confirm line on the agent's unit. Focus starts on Cancel (the Enter that picked the menu item
 * must not spend money); Beam is inert for 600 ms. Esc cancels.
 */
export function BeamConfirm({ agent, to, onConfirm, onCancel }: { agent: Agent; to: Destination; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [armed, setArmed] = useState(false);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); const t = setTimeout(() => setArmed(true), 600); return () => clearTimeout(t); }, []);
  return (
    <div role="group" aria-label={`Beam ${agent.name} to ${to.label}?`} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); } }}
      className="animate-pop space-y-2 rounded-control border border-ink bg-surface px-2.5 py-2">
      <p className="text-small text-ink">
        <span className="font-medium">Beam {agent.name} to {to.label}?</span>
        <span className="text-ink-2"> <span className="tabular-nums">{placeCost(to)}</span>. {placeChange(to, agent.name)}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button ref={ref} size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" aria-disabled={!armed || undefined} className={cx(!armed && "cursor-not-allowed opacity-50")} onClick={() => armed && onConfirm()}>Beam</Button>
      </div>
    </div>
  );
}

// ---------------- the crafted moment: a cartridge travels the track between docks ----------------

type Pt = { x: number; y: number };
/** The point at fraction t along a polyline (by length). */
function along(pts: Pt[], t: number): Pt {
  const seg = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  let d = seg.reduce((a, b) => a + b, 0) * t;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) { const k = seg[i] ? Math.min(1, d / seg[i]) : 0; return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k }; }
    d -= seg[i];
  }
  return pts.at(-1)!;
}
/** An orthogonal path through the points with rounded corners (r px). */
function rounded(pts: Pt[], r = 10) {
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const r1 = Math.min(r, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    const u = (p: Pt, q: Pt) => { const l = Math.hypot(q.x - p.x, q.y - p.y) || 1; return { x: (q.x - p.x) / l, y: (q.y - p.y) / l }; };
    const i1 = u(b, a), o1 = u(b, c);
    d += ` L ${b.x + i1.x * r1} ${b.y + i1.y * r1} Q ${b.x} ${b.y} ${b.x + o1.x * r1} ${b.y + o1.y * r1}`;
  }
  const z = pts.at(-1)!;
  return `${d} L ${z.x} ${z.y}`;
}

/**
 * While an agent travels, a track runs from its unit (which stays in the old dock, its screen collapsed to a line) down
 * the gap between the docks to its ghost in the new dock, and a labelled cartridge moves along it by real stage. The
 * track sits behind the units (it shows in the gaps); the cartridge rides on top. The fill is the one gradient in the
 * product (ink → signal). Reduced motion: no cartridge travel; the track fills in place and the ghost's log tells it.
 * Decorative (aria-hidden): the ghost carries the progressbar, and the live region the announcements.
 */
export function BeamFlights({ agents, dests, container }: { agents: Agent[]; dests: Destination[]; container: RefObject<HTMLElement | null> }) {
  const flying = agents.filter(beamInFlight);
  useTick(flying.length > 0, 400);
  if (!flying.length) return null;
  return <>{flying.map((ag) => <Flight key={ag.id} agent={ag} dests={dests} container={container} />)}</>;
}

function Flight({ agent, container }: { agent: Agent; dests: Destination[]; container: RefObject<HTMLElement | null> }) {
  const [pts, setPts] = useState<Pt[]>();
  const gid = useId().replace(/:/g, "");
  useLayoutEffect(() => {
    const root = container.current;
    const box = root?.getBoundingClientRect();
    const srcEl = root?.querySelector<HTMLElement>(`[data-unit="${CSS.escape(agent.id)}"]`);
    const dstEl = root?.querySelector<HTMLElement>(`[data-ghost="${CSS.escape(agent.id)}"]`);
    const src = srcEl?.getBoundingClientRect(), dst = dstEl?.getBoundingClientRect();
    const lane = dstEl?.closest("section")?.getBoundingClientRect();
    if (!box || !src || !dst || !lane) { if (pts) setPts(undefined); return; }
    const down = dst.top >= src.bottom - 4;
    const x0 = src.left + src.width / 2 - box.left, x1 = dst.left + dst.width / 2 - box.left;
    const y0 = (down ? src.bottom : src.top) - box.top, y1 = (down ? dst.top : dst.bottom) - box.top;
    const ym = (down ? lane.top - 12 : lane.bottom + 12) - box.top; // the gap between the docks
    const next = Math.abs(x0 - x1) < 2 ? [{ x: x0, y: y0 }, { x: x1, y: y1 }] : [{ x: x0, y: y0 }, { x: x0, y: ym }, { x: x1, y: ym }, { x: x1, y: y1 }];
    if (!pts || pts.length !== next.length || pts.some((p, i) => Math.abs(p.x - next[i].x) + Math.abs(p.y - next[i].y) > 1)) setPts(next);
  });
  if (!pts) return null;
  const idx = Math.max(0, STAGES.indexOf(agent.beam!.stage));
  const p = Math.min(1, (idx + 0.5) / STAGES.length);
  const at = along(pts, p);
  const d = rounded(pts);
  const still = prefersReducedMotion();
  const stage = STAGE_SENTENCE(agent.name)[agent.beam!.stage] ?? "Moving";
  const a = pts[0], b = pts.at(-1)!;
  return (
    <>
      <svg aria-hidden className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible">
        <defs>
          <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={a.x} y1={a.y} x2={b.x} y2={b.y}>
            <stop offset="0" style={{ stopColor: "var(--color-ink)" }} />
            <stop offset="1" style={{ stopColor: "var(--color-signal)" }} />
          </linearGradient>
        </defs>
        <path d={d} fill="none" stroke="var(--color-line-strong)" strokeWidth={1.5} strokeDasharray="2 5" strokeLinecap="round" />
        <path d={d} fill="none" stroke={`url(#${gid})`} strokeWidth={2.5} strokeLinecap="round" pathLength={1} strokeDasharray={`${p} 1`}
          style={{ transition: "stroke-dasharray 600ms var(--ease-out)" }} />
        <circle cx={b.x} cy={b.y} r={3.5} fill="var(--color-bg)" stroke="var(--color-line-strong)" strokeWidth={1.5} />
      </svg>
      {!still && (
        <div aria-hidden className="pointer-events-none absolute left-0 top-0 z-[2] flex items-center gap-1.5 whitespace-nowrap rounded-control border border-line-strong bg-surface py-1 pl-1.5 pr-2.5 text-small shadow-float"
          style={{ transform: `translate(${at.x}px, ${at.y}px) translate(-50%, -50%)`, transition: "transform 600ms var(--ease-out)" }}>
          <Plate pubkey={agent.agentPubkey} name={agent.name} size="sm" />
          <span className="font-medium text-ink">{agent.name}</span>
          <span className="text-ink-2">{stage}…</span>
        </div>
      )}
    </>
  );
}

// ---------------- after ----------------

/** "What came along": shown on a unit once after a beam lands, with Beam back. */
export function BeamReceipt({ agent, where, from, onBeamBack }: { agent: Agent; where: string; from: string; onBeamBack?: () => void }) {
  const b = agent.beam;
  const key = `receipt:${agent.id}:${b?.doneAt}`;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === "1"; } catch { return false; } });
  if (!b || b.stage !== "online" || !b.doneAt || !b.summary || hidden || Date.now() - b.doneAt > 30 * 60_000) return null;
  const c = b.summary.carried;
  const items = [
    c.chat ? plural(c.chat, "message") : null, c.memory ? plural(c.memory, "memory", "memories") : null,
    c.skills ? plural(c.skills, "skill") : null, c.schedules ? plural(c.schedules, "routine") : null,
    "logins", "files",
  ].filter(Boolean) as string[];
  const secs = Math.max(1000, b.doneAt - b.startedAt);
  return (
    <div className="flex items-start gap-2 rounded-control border border-line bg-surface-2 px-2.5 py-2 text-small">
      <CheckIcon size={14} weight="bold" aria-hidden className="mt-0.5 shrink-0 text-ink" />
      <div className="min-w-0 flex-1">
        <p className="text-ink"><span className="font-medium">Arrived on {where}</span> <span className="whitespace-nowrap tabular-nums text-ink-2">· {durationWords(secs)} · {bytes(b.summary.bytes)}</span></p>
        <p className="text-ink-2">From {from}. Came along: {list(items)}.{c.channels ? ` ${plural(c.channels, "chat app")} reconnected.` : ""}</p>
        {onBeamBack && <Button size="sm" variant="quiet" className="-ml-2 mt-1" icon={ArrowCounterClockwiseIcon} onClick={onBeamBack}>Beam back to {from}</Button>}
      </div>
      <IconButton size="sm" label="Dismiss" icon={XIcon} className="-mr-1 -mt-1" onClick={() => { try { localStorage.setItem(key, "1"); } catch {} setHidden(true); }} />
    </div>
  );
}

/** One human sentence for a failed beam; the raw error lives under Details. */
export function beamErrorSentence(err: string | undefined, to: string) {
  const e = (err ?? "").toLowerCase();
  if (/401|403|unauthori|forbidden|token|credential/.test(e)) return `${to} didn't accept the key. Reconnect ${to} and try again.`;
  if (/quota|limit|capacity|insufficient|billing|payment/.test(e)) return `${to} has no room for another agent on this plan.`;
  if (/timeout|timed out|etimedout/.test(e)) return `${to} took too long to start the new computer.`;
  if (/econnrefused|enotfound|network|fetch failed|socket/.test(e)) return `Couldn't reach ${to}. Check the internet connection.`;
  if (/app closed/.test(e)) return "Beamhop was closed during the move.";
  if (/space|enospc|disk/.test(e)) return "There wasn't enough disk space to pack it.";
  return "Something went wrong on the way. Nothing was lost.";
}

export function BeamFailed({ agent, dests, onRetry, onDismiss }: { agent: Agent; dests: Destination[]; onRetry: () => void; onDismiss?: () => void }) {
  const b = agent.beam;
  if (!b || b.stage !== "failed") return null;
  const to = placeLabel(dests, b.to);
  return (
    <div className="rounded-control border border-err/50 bg-surface px-2.5 py-2 text-small">
      <div className="flex items-start gap-2">
        <WarningIcon size={14} weight="bold" aria-hidden className="mt-0.5 shrink-0 text-err" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">Beam failed: {agent.name} stayed on {placeLabel(dests, agent.current.driver)}</p>
          <p className="text-ink-2">{beamErrorSentence(b.error, to)}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={onRetry}>Try again</Button>
            {b.error && (
              <details className="min-w-0 text-ink-2">
                <summary className="cursor-pointer rounded-[4px] px-1 font-medium hover:text-ink">Details</summary>
                <p className="mt-1 max-h-24 select-text overflow-auto font-mono text-[11.5px] [overflow-wrap:anywhere]">{b.error}</p>
              </details>
            )}
          </div>
        </div>
        {onDismiss && <IconButton size="sm" label="Dismiss" icon={XIcon} className="-mr-1 -mt-1" onClick={onDismiss} />}
      </div>
    </div>
  );
}

// ---------------- by file ----------------

/** Move an agent into a passphrase-locked file. It stops here; the file is the agent until it's opened elsewhere. */
export function ExportDialog({ agent, onClose, onDone }: { agent: Agent; onClose: () => void; onDone: (filename: string) => void }) {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const short = p1.length > 0 && p1.length < 8;
  const mismatch = p2.length > 0 && p1 !== p2;
  const ok = p1.length >= 8 && p1 === p2;
  async function go() {
    if (!ok || busy) return;
    setBusy(true); setError(undefined);
    const r = await fetch(`/api/agents/${agent.id}/export`, { method: "POST", body: JSON.stringify({ passphrase: p1 }) }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: String(e) }) }) as any);
    if (!r.ok) { setBusy(false); setError((await r.json().catch(() => ({}))).error ?? `Packing failed (${r.status})`); return; }
    const name = r.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `${agent.name}.beamhop`;
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    onDone(name);
  }
  return (
    <Dialog open onClose={busy ? () => {} : onClose} title={`Move ${agent.name} to a file`}
      description={<><span className="font-medium text-ink">This moves {agent.name}. It does not make a copy.</span> {agent.name} stops here and goes into one encrypted file with its files, logins, memory and chats. Open the file in Beamhop on another computer to bring it back there.</>}
      footer={<>
        <Button variant="quiet" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" disabled={!ok} loading={busy} onClick={go}>{busy ? "Packing…" : "Move to file"}</Button>
      </>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <Field label="Passphrase" hint="At least 8 characters." error={short ? "Use at least 8 characters." : undefined}>
          <Input type="password" aria-label="Passphrase" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} />
        </Field>
        <Field label="Repeat passphrase" error={mismatch ? "The two don't match yet." : undefined}>
          <Input type="password" aria-label="Repeat passphrase" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} />
        </Field>
        <p className="flex items-start gap-2 rounded-control bg-surface-2 px-3 py-2 text-small text-ink-2">
          <WarningIcon size={14} weight="bold" aria-hidden className="mt-0.5 shrink-0 text-ink" />
          Keep the file and the passphrase safe. Until it's opened again, the file is {agent.name}. A lost passphrase can't be recovered.
        </p>
        {error && <p role="alert" className="text-small text-err">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** Bring an agent in from a .beamhop file. */
export function ImportDialog({ dests, onClose, onDone }: { dests: Destination[]; onClose: () => void; onDone: (name: string) => void }) {
  const [file, setFile] = useState<File>();
  const [pass, setPass] = useState("");
  const [to, setTo] = useState(dests[0]?.id ?? "local");
  const fileId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function go() {
    if (!file || !pass || busy) return;
    setBusy(true); setError(undefined);
    const r = await fetch(`/api/import?to=${encodeURIComponent(to)}`, { method: "POST", headers: { "x-passphrase": encodeURIComponent(pass) }, body: file }).catch(() => null);
    const j = r ? await r.json().catch(() => ({ error: `Opening failed (${r.status})` })) : { error: "Couldn't reach Beamhop." };
    setBusy(false);
    if (j.error) setError(/wrong passphrase/i.test(j.error) ? "Wrong passphrase. Check it and try again." : j.error);
    else onDone(j.name);
  }
  return (
    <Dialog open onClose={busy ? () => {} : onClose} title="Open an agent file"
      description="Bring an agent here from a .beamhop file made on another computer. You become its owner."
      footer={<>
        <Button variant="quiet" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" disabled={!file || !pass} loading={busy} onClick={go}>{busy ? "Bringing it in…" : "Open"}</Button>
      </>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <Field label="Agent file" id={fileId}>
          <input id={fileId} type="file" accept=".beamhop" aria-label="Agent file" onChange={(e) => setFile(e.target.files?.[0])}
            className="block w-full rounded-control border border-line-strong bg-surface text-body text-ink-2 file:mr-3 file:h-8 file:cursor-pointer file:border-0 file:border-r file:border-line-strong file:bg-surface-2 file:px-3 file:text-body file:font-medium file:text-ink" />
        </Field>
        <Field label="Passphrase">
          <Input type="password" aria-label="Passphrase" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
        </Field>
        <Field label="Run it on" hint={busy ? "This takes about 15 s." : undefined}>
          <Select aria-label="Run it on" value={to} onChange={(e) => setTo(e.target.value)}>
            {dests.map((d) => <option key={d.id} value={d.id}>{d.label} ({placeCost(d)})</option>)}
          </Select>
        </Field>
        {error && <p role="alert" className="text-small text-err">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
