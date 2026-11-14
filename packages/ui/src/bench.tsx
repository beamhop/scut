import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as RKE, type ReactNode } from "react";
import { ArrowRightIcon, CalendarBlankIcon, ChatsCircleIcon, CloudArrowUpIcon, FileArrowDownIcon, FolderOpenIcon, KeyboardIcon, MagnifyingGlassIcon, PauseIcon, PlayIcon, PlusIcon, WrenchIcon, XIcon } from "@phosphor-icons/react";
import type { StatusMsg, TaskRun } from "@scut/protocol";
import { Agent, Destination, Approval, ResolvedApproval, unsandboxed } from "./lib.tsx";
import { useAgent } from "./useAgent.ts";
import { BeamMenu, BeamGhost, BeamPendingGhost, BeamCountdown, BeamConfirm, BeamReceipt, BeamFailed, BeamFlights, beamInFlight, placeIcon, placeLabel, placeOf, placeRunningCost } from "./beam.tsx";
import { ApprovalCard, approvalTitleShort } from "./ui/ApprovalCard.tsx";
import {
  Button, IconButton, Kbd, StatusBadge, Lamp, STATUS, toStatus, Plate, Bezel, ScreenNote, Readout, Tray, Switch, Input, Select, Dialog, ThemeToggle,
  useHotkeys, useCommands, openCommandPalette, announce, money, tokensEur, duration, relativeTime, clock, plural, cx, prefersReducedMotion, setThemePref, getThemePref, formatShortcut,
  type Status, type ReadoutItem,
} from "./ui/index.ts";

// ---------------- what each unit reports up to the bench ----------------

/** The status message (headline, task, last result, problem, current page, paused/control…). */
export type BenchStatus = StatusMsg;

export type UnitReport = {
  status: Status;
  /** Short status word for this unit ("Needs you", "Working", "Starting", "Ready since 14:02"). */
  word: string;
  headline: string;
  approvals: Approval[];
  resolved: ResolvedApproval[];
  send: (m: unknown) => void;
  eurToday: number;
  /** The owner has control (pause). */
  paused?: boolean;
  /** Shown large (live screen) right now. */
  large?: boolean;
  st?: BenchStatus;
  runs?: TaskRun[];
};

/** Tokens used today → euros. dayTokens has no input/output split; agents read far more than they write, so 85/15. */
export function eurForTokens(dayTokens: number | undefined, price?: { in: number; out: number }) {
  if (!dayTokens || !price) return 0;
  return tokensEur({ input: dayTokens * 0.85, output: dayTokens * 0.15 }, price);
}

/** "Today 08:00" · "Tomorrow 08:00" · "Fri 08:00" */
export function whenNext(at: number, now = Date.now()) {
  const d = new Date(at), n = new Date(now);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(n)) / 86_400_000);
  const prefix = diff <= 0 ? "Today" : diff === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "short" });
  return `${prefix} ${clock(at)}`;
}

const byName = (a: Agent, b: Agent) => a.name.localeCompare(b.name);
const isLocal = (id: string) => id === "local" || id === "docker" || id === "smolvm";
const FREE_AFTER = 30_000;
/** Where a problem's fix lives in the agent's Settings (agent view route: #/agent/<id>?settings=<section>). */
const FIX: Record<string, { label: string; section: string }> = {
  brain: { label: "Add a brain", section: "brain" },
  key: { label: "Check the key", section: "brain" },
  channel: { label: "Reconnect", section: "apps" },
};
export const settingsRoute = (id: string, section?: string) => `#/agent/${id}?settings${section ? `=${section}` : ""}`;
/** Raw errors never become a headline (copy rule 1). */
const RAW_ERROR = /error|exception|parse|ECONN|undefined|stack|TypeError/i;

/** The status sentence: "1 needs you · 2 working · Scout ready". */
export function statusSentence(agents: Agent[], reports: Record<string, UnitReport | undefined>) {
  const of = (s: Status) => agents.filter((a) => (reports[a.id]?.status ?? "moving") === s);
  const paused = agents.filter((a) => reports[a.id]?.paused && reports[a.id]?.status !== "needs");
  const needs = of("needs").length, working = of("working").length, moving = of("moving"), problem = of("problem").length;
  const ready = of("free").filter((a) => !reports[a.id]?.paused);
  const parts: string[] = [];
  if (working) parts.push(`${working} working`);
  if (moving.length) parts.push(moving.length <= 2 ? moving.map((a) => `${a.name} ${beamInFlight(a) ? "moving" : "starting"}`).join(" · ") : `${moving.length} starting`);
  if (paused.length) parts.push(`${paused.length} paused`);
  if (problem) parts.push(`${problem} with a problem`);
  if (ready.length) parts.push(ready.length === 1 ? `${ready[0].name} ready` : ready.length === agents.length ? `All ${ready.length} ready` : `${ready.length} ready`);
  return { needs, rest: parts.join(" · ") };
}

/** Pause or resume every agent. Uses the app's pause-all endpoint; falls back to telling each agent over its socket. */
export async function pauseAgents(agents: Agent[], paused: boolean, reports?: Record<string, UnitReport | undefined>) {
  const live = agents.filter((a) => !beamInFlight(a));
  const r = await fetch(`/api/agents/${paused ? "pause-all" : "resume-all"}`, { method: "POST" }).catch(() => null);
  const body = r?.ok && r.headers.get("content-type")?.includes("json") ? await r.json().catch(() => null) : null;
  if (!body || body.error) {
    for (const ag of live) {
      const send = reports?.[ag.id]?.send;
      if (send) { send({ t: "pause", paused, control: false }); continue; }
      const ws = new WebSocket(`${ag.current.endpoint.replace(/^http/, "ws")}/ws?auth=${ag.token}`);
      ws.onopen = () => { ws.send(JSON.stringify({ t: "pause", paused, control: false })); setTimeout(() => ws.close(), 400); };
    }
  }
  announce(paused ? `Paused ${plural(live.length, "agent")}. They wait before their next step.` : `Resumed ${plural(live.length, "agent")}.`);
}

// ---------------- stills: one frame, not a stream ----------------

/**
 * The agent's last frame as a still image, fetched now and every `every` ms (and on demand). Never streams: a short-lived
 * socket subscribes, takes the first frame the agent sends, and closes (no CORS, no 404 noise while it boots).
 */
function useStill(agent: Agent, on: boolean, small: boolean, every = 60_000) {
  const [still, setStill] = useState<{ src: string; at: number }>();
  const tok = useRef(agent.token);
  tok.current = agent.token;
  const last = useRef(0);
  const [nudge, setNudge] = useState(0);
  const urlRef = useRef<string | undefined>(undefined);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);
  useEffect(() => {
    if (!on) return;
    let dead = false;
    const socks = new Set<WebSocket>();
    const load = () => {
      last.current = Date.now();
      const ws = new WebSocket(`${agent.current.endpoint.replace(/^http/, "ws")}/ws?auth=${tok.current}`);
      socks.add(ws);
      ws.binaryType = "blob";
      const done = () => { socks.delete(ws); try { ws.close(); } catch {} };
      const t = setTimeout(done, 6000);
      ws.onopen = () => ws.send(JSON.stringify({ t: "subscribe", frames: true, fps: 0.2, small }));
      ws.onmessage = (ev) => {
        if (!(ev.data instanceof Blob)) return;
        clearTimeout(t);
        done();
        if (dead) return;
        const next = URL.createObjectURL(ev.data);
        setStill({ src: next, at: Date.now() });
        if (urlRef.current) setTimeout((u: string) => URL.revokeObjectURL(u), 1000, urlRef.current);
        urlRef.current = next;
      };
      ws.onerror = () => { clearTimeout(t); done(); };
    };
    load();
    const t = setInterval(load, every);
    return () => { dead = true; clearInterval(t); socks.forEach((w) => { try { w.close(); } catch {} }); };
  }, [on, agent.current.endpoint, small, nudge]);
  const refresh = useCallback(() => { if (Date.now() - last.current > 10_000) setNudge((n) => n + 1); }, []);
  return { still, refresh };
}

// ---------------- the unit ----------------

type UnitProps = {
  agent: Agent; dests: Destination[]; solo: boolean; previews: boolean; tabbable: boolean; index: number;
  onOpen: (section?: string) => void; onBeam: (to: string) => void; onReport: (id: string, r: UnitReport) => void;
  onKeyNav: (e: RKE<HTMLElement>, id: string) => void; onFocusUnit: (id: string) => void;
  onReview: (approvalId: string) => void; onDragStart: (id: string) => void; onDragEnd: () => void;
  menuOpen: boolean; setMenuOpen: (v: boolean) => void; onRetry: () => void; onBeamBack?: () => void; landed: boolean;
  /** A beam of this agent waiting for its countdown (free place) or for your OK (paid place). */
  pending?: { mode: "confirm" | "undo"; at: number; to: Destination };
  onConfirmBeam: () => void; onCancelBeam: () => void;
  /** Many agents in one place: idle units become one-line rack rows instead of bays. */
  dense?: boolean;
};

function useNow(on: boolean, every = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!on) return; const t = setInterval(() => setNow(Date.now()), every); return () => clearInterval(t); }, [on, every]);
  return on ? now : Date.now();
}

export function Unit(p: UnitProps) {
  const { agent, dests, solo } = p;
  const [large, setLarge] = useState(solo);
  const live = p.previews && large;
  // Large units stream small 480 px frames at 2 fps (the lone agent full frames); everything else shows stills.
  const a = useAgent(agent, live, solo ? 4 : 2, !solo);
  const st = a.status as BenchStatus | undefined;
  const beaming = beamInFlight(agent);
  const brokenChannel = Object.entries(a.pairing?.channels ?? {}).find(([, c]) => c.error)?.[0];
  const problem = st?.problem ?? (brokenChannel && a.state === "running" ? { text: `${brokenChannel[0].toUpperCase()}${brokenChannel.slice(1)} can't sign in`, fix: "channel" as const } : undefined);
  const needs = a.approvals.length > 0 || a.state === "stuck";
  const working = a.state === "busy";
  const paused = !!(a.paused || st?.paused);
  const control = paused && !!st?.control; // you have its screen (Take over); otherwise a plain pause
  let status = toStatus(a.state, { needs, beaming, problem: !!problem && !needs });
  if (control && working && !needs) status = "needs"; // it waits for you to give it back (same as the agent view)
  const since = a.since ?? st?.since;
  const where = placeOf(dests, agent.current);
  const word = beaming ? `Beaming to ${placeLabel(dests, agent.beam!.to)}`
    : status === "moving" ? (a.state === "quiescing" ? "Packing up" : "Starting")
    : control ? "You have control" : paused ? "Paused"
    : status === "problem" && problem ? problem.text
    : status === "free" ? (since ? `Ready since ${clock(since)}` : "Ready")
    : a.state === "stuck" && !a.approvals.length ? "Stuck" : STATUS[status].word;
  const backendLine = st?.headline && !/^(free|ready)$/i.test(st.headline) ? (RAW_ERROR.test(st.headline) ? `${agent.name} hit a problem and stopped` : st.headline) : undefined;
  const headline = control ? `${agent.name} waits until you give it back.` : paused ? `${agent.name} waits before its next step until you resume it.`
    : status === "problem" && problem ? (problem.fix === "brain" ? `${agent.name} can't think yet. Add a brain in Settings: it takes about 2 minutes.` : problem.fix === "channel" ? "Reconnect it in Settings, under Chat apps." : backendLine ?? problem.text)
    : needs && st?.task?.prompt ? st.task.prompt
    : needs && a.approvals[0] ? `Wants to ${approvalTitleShort(a.approvals[0].title).replace(/^./, (c) => c.toLowerCase())}`
    : status === "working" ? (backendLine ?? a.narration.at(-1)?.text ?? "Working")
    : status === "free" ? (st?.lastResult?.text ?? backendLine ?? "Ready for a task")
    : backendLine ?? word;
  const eur = eurForTokens(st?.dayTokens ?? a.stats?.dayTokens ?? a.settings?.dayTokens, agent.price);

  // Adaptive size: large while working or waiting on you (and for 30 s after), or when it's the only agent.
  const lastActive = useRef(0);
  const [, bump] = useState(0);
  if (status === "working" || status === "needs") lastActive.current = Date.now();
  const wantLarge = solo || status === "working" || status === "needs" || Date.now() - lastActive.current < FREE_AFTER;
  useEffect(() => { if (wantLarge !== large) setLarge(wantLarge); }, [wantLarge]);
  useEffect(() => {
    if (!large || solo || status === "working" || status === "needs") return;
    const t = setTimeout(() => bump((x) => x + 1), Math.max(500, lastActive.current + FREE_AFTER - Date.now()));
    return () => clearTimeout(t);
  }, [large, solo, status]);

  useEffect(() => { p.onReport(agent.id, { status, word, headline, approvals: a.approvals, resolved: a.resolved, send: a.send, eurToday: eur, paused, st, runs: a.runs, large }); },
    [status, word, headline, a.approvals, a.resolved, eur, paused, st, a.runs, large]);

  // Stills whenever we're not streaming: idle units, paused previews, reduced motion.
  const { still, refresh } = useStill(agent, !live && !beaming && a.connected && a.state !== "starting" && a.state !== "awaiting", !large);

  const startedAt = st?.task?.startedAt ?? since;
  const now = useNow(large && status === "working" && !!startedAt);
  const readout: ReadoutItem[] = [{ value: STATUS.working.word, status: "working" }];
  if (startedAt) readout.push({ value: duration(now - startedAt), srLabel: "for" });
  readout.push({ value: money(eur), label: "today" });

  const headingId = useId();
  const ref = useRef<HTMLElement>(null);
  // Keep keyboard focus on this unit when its insides change under it (beam starts, countdown ends, unit resizes).
  const focusIn = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !focusIn.current) return;
    const t = setTimeout(() => {
      const ae = document.activeElement;
      if (!ae || ae === document.body || !el.contains(ae) || (ae as HTMLElement).closest("[inert]")) el.focus({ preventScroll: true });
    }, 0);
    return () => clearTimeout(t);
  }, [beaming, p.pending?.mode, large]);

  const actions = p.pending ? (
    p.pending.mode === "undo"
      ? <BeamCountdown agent={agent} to={p.pending.to} at={p.pending.at} onUndo={p.onCancelBeam} onNow={p.onConfirmBeam} />
      : <BeamConfirm agent={agent} to={p.pending.to} onConfirm={p.onConfirmBeam} onCancel={p.onCancelBeam} />
  ) : (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant={solo ? "primary" : "secondary"} aria-label={`Open ${agent.name}`} onClick={() => p.onOpen()} iconEnd={solo ? ArrowRightIcon : undefined}>Open</Button>
      <BeamMenu agent={agent} dests={dests} onBeam={p.onBeam} open={p.menuOpen} onOpenChange={p.setMenuOpen} align={solo ? "start" : "end"} />
      {paused && !beaming && <Button size="sm" variant="quiet" icon={PlayIcon} onClick={() => { a.send({ t: "pause", paused: false, control }); announce(`${agent.name} continues.`); }}>{control ? "Give back" : "Resume"}</Button>}
    </div>
  );
  // One quiet marker on the unit; the decision itself lives in the tray (P1-3). Stuck has no card, so it gets a button.
  const marker = needs && !beaming && (
    <p className="flex min-w-0 items-center gap-2 text-small">
      <Lamp status="needs" size={9} />
      <span className="min-w-0 truncate font-medium text-signal-ink">
        {a.approvals.length > 1 ? `${a.approvals.length} things wait for your OK` : a.approvals.length ? "Waiting for your OK" : `${agent.name} is stuck and asked for help`}
      </span>
      {a.approvals[0]
        ? <Button size="sm" variant="quiet" className="-my-1 underline decoration-line-strong underline-offset-2" onClick={() => p.onReview(a.approvals[0].id)}>Review</Button>
        : <Button size="sm" onClick={() => p.onOpen()}>Take a look</Button>}
    </p>
  );
  const fix = status === "problem" && problem?.fix && FIX[problem.fix];
  const fixButton = fix && !beaming && (
    <Button size="sm" variant={solo ? "primary" : "secondary"} icon={WrenchIcon} onClick={() => p.onOpen(fix.section)} className="self-start">{fix.label}</Button>
  );
  const after = (
    <>
      {p.landed && <BeamReceipt agent={agent} where={where} from={placeLabel(dests, agent.beam?.from)} onBeamBack={p.onBeamBack} />}
      <BeamFailed agent={agent} dests={dests} onRetry={p.onRetry} />
    </>
  );

  const stillTag = still && <span className="absolute bottom-1.5 left-1.5 rounded-[4px] bg-screen/85 px-1.5 py-px text-micro tabular-nums text-screen-ink-2">Still · {clock(still.at)}</span>;
  const bigScreen = (
    <Bezel size={solo ? "md" : "sm"} label={`${agent.name}'s screen`}>
      {live && a.frame ? (
        <img src={a.frame} alt={`${agent.name}'s screen: ${headline}`} draggable={false} className="absolute inset-0 h-full w-full object-cover" />
      ) : still ? (
        <><img src={still.src} alt={`${agent.name}'s screen at ${clock(still.at)}: ${headline}`} draggable={false} className="absolute inset-0 h-full w-full object-cover" />{stillTag}</>
      ) : (
        <ScreenNote>{a.connected ? `Waiting for ${agent.name}'s screen…` : `Starting ${agent.name}'s screen…`}</ScreenNote>
      )}
    </Bezel>
  );

  const shell = (children: ReactNode, cls: string) => (
    <article
      ref={ref}
      aria-labelledby={headingId}
      data-unit={agent.id}
      tabIndex={p.tabbable ? 0 : -1}
      draggable={!beaming}
      onDragStart={(e: DragEvent) => { e.dataTransfer.setData("text/agent", agent.id); e.dataTransfer.effectAllowed = "move"; p.onDragStart(agent.id); }}
      onDragEnd={p.onDragEnd}
      onFocus={(e) => { focusIn.current = true; refresh(); if (e.target === e.currentTarget) p.onFocusUnit(agent.id); }}
      onBlur={(e) => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) focusIn.current = false; }}
      onPointerEnter={refresh}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter") { e.preventDefault(); p.onOpen(); }
        else if (e.key.toLowerCase() === "b" && !e.metaKey && !e.ctrlKey && !e.altKey && !beaming && !p.pending) { e.preventDefault(); p.setMenuOpen(true); }
        else p.onKeyNav(e, agent.id);
      }}
      className={cx(
        "group relative min-w-0 rounded-unit border bg-surface text-left transition-[opacity,border-color] duration-(--dur-tray)",
        needs && !beaming ? "border-signal" : p.pending ? "border-ink" : "border-line",
        p.landed && agent.beam?.doneAt && Date.now() - agent.beam.doneAt < 4000 && "animate-pop",
        cls,
      )}
    >
      <div className={cx(beaming && "pointer-events-none opacity-45 transition-opacity duration-(--dur-tray)")} inert={beaming || undefined}>{children}</div>
      {beaming && (
        <p className="flex items-center gap-1.5 border-t border-line px-3 py-2 text-small text-ink">
          <Lamp status="moving" size={10} />
          <span className="min-w-0"><span className="font-medium">Beaming to {placeLabel(dests, agent.beam!.to)}.</span> <span className="text-ink-2">Stays here until it lands safely.</span></span>
        </p>
      )}
    </article>
  );

  const keycap = p.index < 9 && (
    <span aria-hidden className="text-micro text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100 group-focus-within:opacity-100 max-sm:hidden"><Kbd>{String(p.index + 1)}</Kbd></span>
  );
  const name = (big: boolean) => (
    <h3 id={headingId} className={cx("min-w-0 truncate text-ink", big ? "text-h3" : "text-body font-semibold")}>
      {agent.name}<span className="sr-only">, {word}{p.index < 9 ? `, press ${p.index + 1} to jump here` : ""}</span>
    </h3>
  );
  const badge = (size: "sm" | "md" = "sm") => !beaming && <StatusBadge status={status} size={size} emphasis label={word} className="min-w-0 max-w-full [&>*:last-child]:truncate" />;

  if (solo) {
    return shell(
      <div className="grid gap-5 p-4 md:grid-cols-[minmax(0,1.55fr)_minmax(280px,1fr)] md:p-5">
        {bigScreen}
        <div className="flex min-w-0 flex-col gap-3">
          <header className="flex min-w-0 items-center gap-2"><Plate pubkey={agent.agentPubkey} name={agent.name} size="md" />{name(true)}</header>
          <span className="self-start">{badge("md")}</span>
          {st?.lastResult && status === "free" && <p className="-mb-2 text-small text-ink-3">Last result, {relativeTime(st.lastResult.ts)}</p>}
          <p className="text-ui-lg text-ink [overflow-wrap:anywhere]">{headline}</p>
          {status === "working" && <Readout label={`${agent.name} right now`} items={readout} className="self-start" />}
          {marker}
          {fixButton}
          <NextRun st={st} />
          {!st?.lastResult && status === "free" && <p className="max-w-prose text-body text-ink-2">Give {agent.name} a task below, or open it to chat, schedule routines and connect your chat apps.</p>}
          <TaskBox name={agent.name} disabled={beaming || paused || problem?.fix === "brain"} onSend={(text) => { a.send({ t: "chat", text }); announce(`Sent to ${agent.name}`); }} />
          {after}
          <div className="mt-auto pt-1">{actions}</div>
        </div>
      </div>,
      "w-full",
    );
  }

  if (large) {
    return shell(
      <div className="flex flex-col gap-2.5 p-3">
        <header className="flex min-w-0 items-center gap-2">
          <Plate pubkey={agent.agentPubkey} name={agent.name} size="sm" />{name(false)}
          <span className="ml-auto flex min-w-0 items-center gap-2 pl-1">{status !== "needs" && badge()}{keycap}</span>
        </header>
        {bigScreen}
        <p className="line-clamp-2 text-body text-ink [overflow-wrap:anywhere]">{headline}</p>
        {status === "working" && <Readout label={`${agent.name} right now`} items={readout} className="self-start" />}
        {marker}
        {fixButton}
        {after}
        <div className="pt-0.5">{actions}</div>
      </div>,
      "sm:col-span-2 lg:row-span-3 self-start",
    );
  }

  const stillImg = still ? (
    <img src={still.src} alt={`${agent.name}'s screen at ${clock(still.at)}`} draggable={false}
      className={cx("absolute inset-0 h-full w-full object-cover transition-[opacity,clip-path] duration-(--dur-pop)",
        beaming ? "[clip-path:inset(49%_0_49%_0)]" : "[clip-path:inset(0_0_0_0)] opacity-60 group-hover:opacity-100 group-focus-within:opacity-100")} />
  ) : <ScreenNote>{a.connected ? "" : "Starting…"}</ScreenNote>;
  const lastLine = (
    <p className={cx("line-clamp-2 text-small [overflow-wrap:anywhere]", st?.lastResult && status === "free" && !paused ? "text-ink" : "text-ink-2")}>
      {st?.lastResult && status === "free" && !paused && <span className="text-ink-3">{relativeTime(st.lastResult.ts)}: </span>}
      {status === "free" && !paused && !st?.lastResult && !backendLine ? "Nothing done yet" : headline}
    </p>
  );

  // The rack unit: its display dimmed to a still (brightens on hover or focus) beside plate, status, last result and next routine.
  return shell(
    <div className={cx("grid gap-3 p-2.5", p.dense ? "grid-cols-[104px_minmax(0,1fr)]" : "grid-cols-[112px_minmax(0,1fr)] sm:grid-cols-[152px_minmax(0,1fr)]")}>
      <div className="pt-0.5">
        <Bezel size="sm" label={`${agent.name}'s screen`}>{stillImg}</Bezel>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <header className="flex min-w-0 items-center gap-2">
          <Plate pubkey={agent.agentPubkey} name={agent.name} size="sm" />{name(false)}
          <span className="ml-auto">{keycap}</span>
        </header>
        {badge()}
        {lastLine}
        <NextRun st={st} />
        {marker}
        {fixButton}
        <div className="mt-auto pt-1.5">{actions}</div>
      </div>
      <div className="col-span-2 empty:hidden">{after}</div>
    </div>,
    "self-start",
  );
}

function NextRun({ st }: { st?: StatusMsg }) {
  if (!st?.nextRun) return null;
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-small text-ink-2">
      <CalendarBlankIcon size={13} aria-hidden className="shrink-0" />
      <span className="sr-only">Next routine: </span>
      <span className="min-w-0 truncate"><span className="tabular-nums text-ink">{whenNext(st.nextRun.at)}</span> · {st.nextRun.prompt}</span>
    </p>
  );
}

function TaskBox({ name, onSend, disabled }: { name: string; onSend: (t: string) => void; disabled?: boolean }) {
  const [text, setText] = useState("");
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (!t) return; onSend(t); setText(""); }}>
      <Input aria-label={`Give ${name} a task`} placeholder={`Ask ${name} to…`} value={text} onChange={(e) => setText(e.target.value)} disabled={disabled} className="min-w-0 flex-1" />
      <Button type="submit" disabled={disabled || !text.trim()}>Send</Button>
    </form>
  );
}

/** "Ask [Atlas] to… [Send]": the main thing to do on an idle bench is to give one of them work. */
function TaskBar({ agents, reports }: { agents: Agent[]; reports: Record<string, UnitReport | undefined> }) {
  const ready = agents.filter((a) => { const r = reports[a.id]; return r && (r.status === "free" || r.status === "working") && !r.paused && !r.st?.problem; });
  const [who, setWho] = useState<string>();
  const [text, setText] = useState("");
  const pick = ready.find((a) => a.id === who) ?? ready[0];
  if (!pick) return null;
  const send = () => {
    const t = text.trim();
    if (!t) return;
    reports[pick.id]?.send({ t: "chat", text: t });
    setText("");
    announce(`Sent to ${pick.name}. Its screen comes up live here while it works.`);
  };
  return (
    <form aria-label="Give an agent a task" onSubmit={(e) => { e.preventDefault(); send(); }} className="flex w-full max-w-[720px] items-center gap-2">
      {ready.length > 1 ? (
        <Select aria-label="Which agent" value={pick.id} onChange={(e) => setWho(e.target.value)} className="w-auto shrink-0">
          {ready.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      ) : <span className="shrink-0 text-body font-medium text-ink">{pick.name}</span>}
      <Input aria-label={`Give ${pick.name} a task`} placeholder={`Ask ${pick.name} to…`} value={text} onChange={(e) => setText(e.target.value)} className="min-w-0 flex-1" />
      <Button type="submit" disabled={!text.trim()}>Send</Button>
    </form>
  );
}

// ---------------- while you were away ----------------

type RecapItem = { agent: Agent; text: string; at: number; flag?: boolean };

/** What happened since `since`: skipped approvals first (they need a look), then finished routines and replies. */
function recap(agents: Agent[], reports: Record<string, UnitReport | undefined>, since: number): RecapItem[] {
  const items: RecapItem[] = [];
  for (const ag of agents) {
    const r = reports[ag.id];
    if (!r) continue;
    for (const x of r.resolved) if (x.by === "timeout" && x.at > since) items.push({ agent: ag, flag: true, at: x.at, text: `skipped "${approvalTitleShort(x.title)}" because nobody answered` });
    const runs = (r.runs ?? []).filter((x) => x.endedAt > since);
    for (const x of runs.slice(-2)) items.push({ agent: ag, flag: !x.ok, at: x.endedAt, text: x.ok ? `ran "${x.prompt.slice(0, 40)}"${x.result ? `: ${x.result.split("\n")[0].slice(0, 80)}` : ""}` : `couldn't finish "${x.prompt.slice(0, 40)}"` });
    const last = r.st?.lastResult;
    if (last && last.ts > since && !runs.some((x) => x.result.startsWith(last.text.slice(0, 30)))) items.push({ agent: ag, at: last.ts, text: last.text, flag: last.ok === false });
  }
  return items.sort((a, b) => Number(!!b.flag) - Number(!!a.flag) || b.at - a.at);
}

function Recap({ items, since, away, onOpen, onDismiss, children }: { items: RecapItem[]; since?: number; away: boolean; onOpen: (id: string) => void; onDismiss?: () => void; children?: ReactNode }) {
  const shown = items.slice(0, 4);
  return (
    <section aria-labelledby="recap-h" className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-1 basis-[min(100%,520px)] items-baseline gap-x-3 gap-y-1 max-sm:flex-col max-sm:items-stretch">
        <h2 id="recap-h" className="shrink-0 text-small font-semibold text-ink">{away && since ? `While you were away, since ${clock(since)}` : "Today"}</h2>
        {shown.length ? (
          <ul className="flex min-w-0 max-w-full flex-col gap-y-0.5 text-small">
            {shown.map((it, i) => (
              <li key={i} className="flex min-w-0 max-w-full items-baseline gap-1.5">
                {it.flag && <Lamp status="needs" size={8} label="Look at this" className="self-center" />}
                <button type="button" onClick={() => onOpen(it.agent.id)} className="block min-w-0 max-w-full truncate rounded-[4px] text-left text-ink-2 hover:text-ink">
                  <span className="font-medium text-ink">{it.agent.name}</span> {it.text}
                </button>
              </li>
            ))}
            {items.length > shown.length && <li className="text-ink-3">and {items.length - shown.length} more</li>}
          </ul>
        ) : (
          <p className="text-small text-ink-2">{away ? "Nothing happened while you were away." : "Nothing finished yet."}</p>
        )}
        {away && onDismiss && <IconButton size="sm" label="Dismiss the summary" icon={XIcon} onClick={onDismiss} className="self-center" />}
      </div>
      {children}
    </section>
  );
}

// ---------------- the bench ----------------

export type PendingBeam = { agentId: string; to: string; mode: "confirm" | "undo"; at: number };

export type BenchProps = {
  agents: Agent[]; dests: Destination[]; loaded: boolean;
  reports: Record<string, UnitReport | undefined>; onReport: (id: string, r: UnitReport) => void;
  pending?: PendingBeam; onConfirmBeam: () => void; onCancelBeam: () => void;
  requestBeam: (id: string, to: string) => void;
  landed: Record<string, boolean>;
  onCreate: () => void; onAddCloud: () => void; onImport: () => void; onExport: (id: string) => void;
  crewOpen: boolean; onToggleCrew: () => void;
  /** When the owner was last here (≥10 min ago), for "While you were away". */
  awaySince?: number; onDismissAway?: () => void;
  /** First run (no agents yet): shown in place of the docks, e.g. the create flow inline. */
  empty?: ReactNode;
  children?: ReactNode;
};

export function Bench(p: BenchProps) {
  const { agents, dests, reports } = p;
  // Previews: live video for working units. Off under reduced motion (stills instead, never black boxes).
  const [previewPref, setPreviewPref] = useState(() => { try { const v = localStorage.getItem("beamhop-previews"); return v ? v === "on" : !prefersReducedMotion(); } catch { return true; } });
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  useEffect(() => { const h = () => setHidden(document.hidden); document.addEventListener("visibilitychange", h); return () => document.removeEventListener("visibilitychange", h); }, []);
  const previews = previewPref && !hidden;
  const setPreviews = (v: boolean) => { try { localStorage.setItem("beamhop-previews", v ? "on" : "off"); } catch {} setPreviewPref(v); announce(v ? "Live previews on" : "Live previews off. Screens show stills."); };
  const [menuFor, setMenuFor] = useState<string>();
  const [focusId, setFocusId] = useState<string>();
  const [dragId, setDragId] = useState<string>();
  const [hot, setHot] = useState<string>();
  const [keysOpen, setKeysOpen] = useState(false);
  const trayRef = useRef<HTMLDivElement>(null);
  const docksRef = useRef<HTMLDivElement>(null);

  // Lanes: This computer first, then clouds alphabetically; agents on a place we don't list get a lane of their own.
  const lanes = useMemo(() => {
    const known = [...dests].sort((a, b) => (isLocal(a.id) === isLocal(b.id) ? a.label.localeCompare(b.label) : isLocal(a.id) ? -1 : 1));
    const extra = [...new Set(agents.map((a) => a.current.driver).filter((d) => !dests.some((x) => x.id === d)))]
      .map((id): Destination => ({ id, label: id === "local" ? "This computer" : id, isolation: "container", monthlyUsd: 0 }));
    return [...known, ...extra].map((d) => ({ d, agents: agents.filter((a) => a.current.driver === d.id).sort(byName) }));
  }, [agents, dests]);
  // Stable order: by name, the same across lanes, so 1–9 don't renumber after a beam.
  const order = useMemo(() => [...agents].sort(byName), [agents]);
  const solo = agents.length === 1;
  const tabbableId = order.some((a) => a.id === focusId) ? focusId : order[0]?.id;

  const unitEl = (id: string) => document.querySelector<HTMLElement>(`[data-unit="${CSS.escape(id)}"]`);
  const focusUnit = (id?: string) => { if (!id) return; setFocusId(id); unitEl(id)?.focus(); };
  const open = (id: string, section?: string) => (location.hash = section !== undefined ? settingsRoute(id, section) : `#/agent/${id}`);

  // Arrow keys move to the nearest unit in that direction (units wrap, lanes stack).
  const onKeyNav = useCallback((e: RKE<HTMLElement>, id: string) => {
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (e.key === "Home" || e.key === "End") { e.preventDefault(); focusUnit((e.key === "Home" ? order[0] : order.at(-1))?.id); return; }
    if (!dir) return;
    e.preventDefault();
    const from = unitEl(id)?.getBoundingClientRect();
    if (!from) return;
    const cx0 = from.left + from.width / 2, cy0 = from.top + from.height / 2;
    let best: [number, string] | undefined;
    for (const a of order) {
      if (a.id === id) continue;
      const r = unitEl(a.id)?.getBoundingClientRect();
      if (!r) continue;
      const dx = r.left + r.width / 2 - cx0, dy = r.top + r.height / 2 - cy0;
      const along = dir[0] ? dx * dir[0] : dy * dir[1];
      if (along <= 4) continue;
      const across = dir[0] ? Math.abs(dy) : Math.abs(dx);
      const score = along + across * 2.5;
      if (!best || score < best[0]) best = [score, a.id];
    }
    if (!best && dir[0]) { // wrap left/right through the reading order
      const i = order.findIndex((a) => a.id === id);
      best = [0, order[(i + dir[0] + order.length) % order.length]?.id];
    }
    if (best) focusUnit(best[1]);
  }, [order]);

  // The inbox: every pending approval across agents, oldest first; decided ones echo for a few seconds.
  const [now, setNow] = useState(Date.now());
  const mountedAt = useRef(Date.now());
  const pendingCards = order.flatMap((ag) => (reports[ag.id]?.approvals ?? []).map((ap) => ({ ag, ap, resolved: undefined as ResolvedApproval | undefined })));
  const echoes = order.flatMap((ag) => (reports[ag.id]?.resolved ?? []).filter((r) => r.at > mountedAt.current - 2000 && now - r.at < 8000).map((r) => ({ ag, ap: r as Approval, resolved: r })));
  const cards = [...pendingCards, ...echoes].sort((x, y) => x.ap.ts - y.ap.ts);
  useEffect(() => { if (!echoes.length) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [echoes.length]);
  const focusInbox = (approvalId?: string) => {
    const el = approvalId ? trayRef.current?.querySelector<HTMLElement>(`[data-approval="${CSS.escape(approvalId)}"]`) : trayRef.current?.querySelector<HTMLElement>("[data-approval][data-pending]") ?? trayRef.current?.querySelector<HTMLElement>("[data-approval]");
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    el?.focus({ preventScroll: true });
  };
  // After a decision: focus the next card that waits; with none left the card keeps focus, then its agent's unit.
  const lastAnswered = useRef<string | undefined>(undefined);
  const answer = (ag: Agent, ap: Approval, ok: boolean, reason?: string) => {
    reports[ag.id]?.send({ t: "approval", id: ap.id, ok, ...(reason ? { reason } : {}) });
    lastAnswered.current = ag.id;
    const next = [...(trayRef.current?.querySelectorAll<HTMLElement>("[data-approval][data-pending]") ?? [])].filter((el) => el.dataset.approval !== ap.id);
    announce(`${ok ? "Allowed" : `Told ${ag.name} no`}. ${next.length ? `${next.length} more waiting.` : "Nothing else is waiting."}`);
    if (next[0]) requestAnimationFrame(() => { next[0].scrollIntoView({ block: "nearest", inline: "nearest" }); next[0].focus({ preventScroll: true }); });
  };
  useEffect(() => {
    if (cards.length || !lastAnswered.current) return;
    const id = lastAnswered.current;
    lastAnswered.current = undefined;
    if (document.activeElement === document.body) focusUnit(id);
  }, [cards.length]);

  // Top bar facts.
  const s = statusSentence(agents, reports);
  const eurToday = agents.reduce((sum, a) => sum + (reports[a.id]?.eurToday ?? 0), 0);
  const settled = agents.filter((a) => reports[a.id] && reports[a.id]!.status !== "moving");
  const allPaused = settled.length > 0 && settled.every((a) => reports[a.id]?.paused);
  const pausedCount = settled.filter((a) => reports[a.id]?.paused).length;
  useEffect(() => {
    const t = [s.needs ? `${s.needs} need${s.needs === 1 ? "s" : ""} you` : "", s.rest].filter(Boolean).join(" · ");
    document.title = `${s.needs ? `(${s.needs}) ` : ""}${t ? `${t} · ` : ""}Beamhop`;
    setFavicon(s.needs > 0);
    return () => { document.title = "Beamhop"; setFavicon(false); };
  }, [s.needs, s.rest]);
  const goToNeeds = () => {
    if (pendingCards.length) return focusInbox();
    const ag = order.find((a) => reports[a.id]?.status === "needs");
    if (ag) { unitEl(ag.id)?.scrollIntoView({ block: "nearest" }); focusUnit(ag.id); }
  };

  // Keyboard: 1–9 jump to a unit, Alt+Shift+A to the oldest approval. (N, ?, ⌘K are palette commands.)
  useHotkeys(Object.fromEntries([
    ...order.slice(0, 9).map((a, i) => [String(i + 1), () => focusUnit(a.id)]),
    ["alt+shift+a", () => focusInbox()],
  ]));
  useCommands([
    { id: "bench.new", title: "New agent", group: "Agents", shortcut: "n", synonyms: ["create", "add", "make"], disabled: p.loaded && !agents.length && !!p.empty, run: p.onCreate },
    { id: "bench.crew", title: "Talk to all agents", group: "Agents", synonyms: ["crew room", "chat", "everyone"], run: p.onToggleCrew },
    // Per-agent controls work from the bench too (the agent view registers its own for the open agent).
    ...order.flatMap((ag) => {
      const r = reports[ag.id];
      return [
        { id: `bench.pause.${ag.id}`, title: r?.paused ? `Resume ${ag.name}` : `Pause ${ag.name}`, group: "Agents", synonyms: ["hold", "wait", "continue", "give back"], disabled: !r || r.status === "moving",
          run: () => { r?.send({ t: "pause", paused: !r.paused, control: false }); announce(r?.paused ? `${ag.name} continues.` : `${ag.name} is paused. It waits before its next step.`); } },
        { id: `bench.stop.${ag.id}`, title: `Stop ${ag.name}`, hint: "ends the current task", group: "Agents", synonyms: ["cancel", "halt", "abort", "kill"], disabled: r?.status !== "working",
          run: () => { r?.send({ t: "stop" }); announce(`Stopped ${ag.name}'s task.`); } },
        { id: `bench.settings.${ag.id}`, title: `Settings of ${ag.name}`, group: "Agents", synonyms: ["preferences", "brain", "autonomy", "memory"], run: () => open(ag.id, "") },
      ];
    }),
    { id: "bench.cloud", title: "Add a cloud", group: "Places", synonyms: ["connect a cloud", "fly", "render", "railway"], run: p.onAddCloud },
    { id: "bench.import", title: "Open an agent file", group: "Places", synonyms: ["import", "receive", ".beamhop"], run: p.onImport },
    { id: "bench.inbox", title: "Go to what's waiting for you", group: "View", shortcut: "alt+shift+a", bindShortcut: false, disabled: !cards.length, synonyms: ["approvals", "inbox"], run: () => focusInbox() },
    { id: "bench.previews", title: previewPref ? "Previews: turn live video off" : "Previews: turn live video on", group: "View", synonyms: ["video", "screens", "calm", "stills"], run: () => setPreviews(!previewPref) },
    { id: "bench.theme", title: "Switch theme", group: "View", hint: getThemePref() === "system" ? "follows your computer" : getThemePref(), synonyms: ["dark", "light", "appearance"], run: () => setThemePref(getThemePref() === "system" ? "light" : getThemePref() === "light" ? "dark" : "system") },
    { id: "bench.keys", title: "Keyboard shortcuts", group: "View", shortcut: "?", synonyms: ["help", "keys"], run: () => setKeysOpen(true) },
  ], [previewPref, cards.length, p.onCreate, p.onToggleCrew, agents.length, !!p.empty, order, ...order.map((a) => `${reports[a.id]?.paused}${reports[a.id]?.status}`)]);

  const laneDrop = (laneId: string) => ({
    onDragOver: (e: DragEvent) => { if (!dragId) return; const ag = agents.find((x) => x.id === dragId); if (ag?.current.driver === laneId) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; setHot(laneId); },
    onDragLeave: (e: DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setHot((h) => (h === laneId ? undefined : h)); },
    onDrop: (e: DragEvent) => { e.preventDefault(); setHot(undefined); const id = e.dataTransfer.getData("text/agent") || dragId; setDragId(undefined); if (!id) return; laneId === "file" ? p.onExport(id) : p.requestBeam(id, laneId); },
  });

  const pendingAgent = p.pending && agents.find((a) => a.id === p.pending!.agentId);
  const dense = (here: Agent[]) => here.filter((a) => !reports[a.id]?.large).length > 6;
  const first = p.loaded && !agents.length && !!p.empty;
  const awayItems = p.awaySince ? recap(agents, reports, p.awaySince) : [];
  const startOfDay = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const todayItems = recap(agents, reports, startOfDay).filter((x) => !x.flag || x.at > startOfDay);
  const away = !!p.awaySince;

  return (
    <div className={cx("min-h-dvh pb-10 transition-[padding] duration-(--dur-tray)", p.crewOpen && "xl:pr-[400px]",
      // Phone: 44 px targets on everything you can press (DESIGN-PLAN §5).
      "max-sm:[&_button]:min-h-11 max-sm:[&_button]:min-w-11 max-sm:[&_input:not([type=checkbox])]:min-h-11")}>
      {/* ---------- top bar ---------- */}
      <header className="sticky top-0 z-20 border-b border-line bg-bg">
        <div className="mx-auto flex min-h-14 max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
          <h1 className="wordmark text-[17px] text-ink">Beamhop</h1>
          <p className="order-last w-full min-w-0 truncate text-body text-ink-2 sm:order-none sm:w-auto sm:flex-1" aria-live="off">
            {s.needs > 0 && (
              <button type="button" onClick={goToNeeds} className="mr-1 inline-flex items-center gap-1.5 rounded-[4px] font-medium text-signal-ink underline decoration-signal/50 underline-offset-[3px] hover:decoration-signal">
                <Lamp status="needs" size={9} />{s.needs} need{s.needs === 1 ? "s" : ""} you
              </button>
            )}
            {s.needs > 0 && s.rest && <span aria-hidden> · </span>}
            {s.rest || (!agents.length && p.loaded ? "No agents yet" : "")}
          </p>
          <div className="ml-auto flex items-center gap-1.5 sm:ml-0">
            {!first && <span className="mr-1.5 hidden whitespace-nowrap text-body tabular-nums text-ink-2 md:inline" title="Estimated from the tokens each agent used today and its brain's price. Your provider's bill is the truth.">≈ {money(eurToday, { period: "today" })}</span>}
            <Button variant="secondary" icon={MagnifyingGlassIcon} shortcut="mod+k" onClick={() => openCommandPalette()} className="w-60 justify-start text-ink-2 max-lg:hidden"><span className="flex-1 text-left">Search or do anything</span></Button>
            <IconButton className="lg:hidden" label={`Search or do anything (${formatShortcut("mod+k")})`} icon={MagnifyingGlassIcon} onClick={() => openCommandPalette()} />
            {!first && <Button variant="quiet" icon={ChatsCircleIcon} onClick={p.onToggleCrew} aria-expanded={p.crewOpen} className="max-md:hidden">Talk to all agents</Button>}
            {!first && agents.length > 0 && (allPaused
              ? <Button variant="secondary" icon={PlayIcon} onClick={() => pauseAgents(agents, false, reports)} className="max-sm:hidden">Resume all<span className="text-ink-2"> ({pausedCount} paused)</span></Button>
              : <Button variant="secondary" icon={PauseIcon} onClick={() => pauseAgents(agents, true, reports)} className="max-sm:hidden" title="Every agent waits before its next step until you resume">Pause all</Button>)}
            {!first && agents.length > 0 && <IconButton className="sm:hidden" label={allPaused ? "Resume all agents" : "Pause all agents"} icon={allPaused ? PlayIcon : PauseIcon} onClick={() => pauseAgents(agents, !allPaused, reports)} />}
            {!first && <Button variant="primary" icon={PlusIcon} onClick={p.onCreate} title="New agent (N)">New agent</Button>}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] space-y-6 px-4 pt-5 sm:px-6">
        {/* ---------- waiting for you ---------- */}
        {cards.length > 0 && (
          <div ref={trayRef}>
            <Tray title={pendingCards.length ? "Waiting for you" : "Just decided"} count={pendingCards.length || undefined}
              actions={<span className="hidden text-small text-ink-3 sm:inline">Oldest first · <Kbd keys="alt+shift+a" /></span>}>
              {cards.map(({ ag, ap, resolved }) => (
                <ApprovalCard key={ap.id} compact approval={ap} agentName={ag.name} pubkey={ag.agentPubkey} resolved={resolved}
                  task={reports[ag.id]?.st?.task?.prompt} pageUrl={reports[ag.id]?.st?.url}
                  onAnswer={(ok, reason) => answer(ag, ap, ok, reason)} />
              ))}
            </Tray>
          </div>
        )}

        {first && <div className="py-4 sm:py-8">{p.empty}</div>}

        {/* ---------- today / while you were away, and the view switch ---------- */}
        {!first && agents.length > 0 && (
          <div className="space-y-3">
            <Recap items={away ? awayItems : todayItems} since={p.awaySince} away={away} onOpen={(id) => open(id)} onDismiss={p.onDismissAway}>
              {!solo && <Switch checked={previewPref} onChange={setPreviews} label="Live previews" className="ml-auto shrink-0 text-small" />}
            </Recap>
            {!solo && <TaskBar agents={order} reports={reports} />}
          </div>
        )}

        {/* ---------- docks ---------- */}
        {!first && (
          <div ref={docksRef} className="relative space-y-6">
            {lanes.map(({ d, agents: here }) => {
              const ghosts = agents.filter((a) => beamInFlight(a) && a.beam!.to === d.id);
              const pendingHere = p.pending?.to === d.id && pendingAgent;
              const Icon = placeIcon(d);
              const dragSource = dragId && agents.find((x) => x.id === dragId)?.current.driver === d.id;
              const headId = `lane-${d.id}`;
              const empty = !here.length && !ghosts.length && !pendingHere;
              const head = (
                <>
                  <h2 id={headId} className="flex items-center gap-1.5 text-body font-semibold text-ink"><Icon size={16} aria-hidden className="self-center" />{d.label}</h2>
                  <span className="text-small text-ink-2">{empty ? "nothing here" : plural(here.length, "agent")}</span>
                  <span className="text-small tabular-nums text-ink-2">{placeRunningCost(d)}</span>
                  {!!d.monthlyUsd && <span className="text-small text-ink-2">Connected</span>}
                  {here.some((a) => unsandboxed(a.current)) && !/no sandbox/i.test(d.label) && (
                    <span className="text-small text-ink-2" title="These agents run as normal programs on this computer, each with its own browser, and ask before touching anything outside their folder.">No sandbox</span>
                  )}
                </>
              );
              return (
                <section key={d.id} aria-labelledby={headId} {...laneDrop(d.id)}
                  className={cx("relative z-[1] rounded-unit transition-[background-color,outline-color] duration-(--dur-pop)",
                    dragId && !dragSource && "outline-2 outline-offset-4 outline-dashed outline-line-strong",
                    hot === d.id && "bg-surface-2 outline-ink")}>
                  {empty ? (
                    // An empty place is one quiet row, not a dashed box that outweighs the agents.
                    <div className="flex min-h-10 flex-wrap items-baseline gap-x-3 gap-y-0.5 border-y border-dashed border-line-strong px-1 py-2.5">
                      {head}
                      <span className="text-small text-ink-3 sm:ml-auto">
                        {dragId ? (dragSource ? "Already here" : "Drop to beam here") : !agents.length && isLocal(d.id) ? "Your first agent will live here." : <><span className="pointer-coarse:hidden">Drag an agent here, or use Beam to… on it</span><span className="hidden pointer-coarse:inline">Use Beam to… on an agent to move it here</span></>}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        {head}
                        {dragId && <span className="ml-auto text-small font-medium text-ink">{dragSource ? "Already here" : "Drop to beam here"}</span>}
                      </div>
                      {/* Rack grid: idle units are short rows two tracks wide; a working unit is a big screen two tracks wide and three
                          rows tall, with the idle ones stacking beside it (dense flow keeps name order otherwise). */}
                      <div className={cx("grid items-start gap-3 [grid-auto-flow:dense]", solo ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 [&>*]:lg:col-span-2")}>
                        {here.map((ag) => (
                          <Unit key={ag.id} agent={ag} dests={dests} solo={solo} previews={previews} index={order.indexOf(ag)} tabbable={ag.id === tabbableId}
                            onOpen={(section) => open(ag.id, section)} onBeam={(to) => p.requestBeam(ag.id, to)} onReport={p.onReport}
                            onKeyNav={onKeyNav} onFocusUnit={setFocusId} onReview={focusInbox}
                            onDragStart={setDragId} onDragEnd={() => { setDragId(undefined); setHot(undefined); }}
                            menuOpen={menuFor === ag.id} setMenuOpen={(v) => setMenuFor(v ? ag.id : undefined)}
                            onRetry={() => ag.beam && p.requestBeam(ag.id, ag.beam.to)}
                            onBeamBack={ag.beam?.from && ag.beam.from !== ag.current.driver ? () => p.requestBeam(ag.id, ag.beam!.from!) : undefined}
                            landed={!!p.landed[ag.id] || ag.beam?.stage === "online"}
                            pending={p.pending?.agentId === ag.id ? { mode: p.pending.mode, at: p.pending.at, to: dests.find((x) => x.id === p.pending!.to) ?? { id: p.pending.to, label: placeLabel(dests, p.pending.to), isolation: "container", monthlyUsd: 0 } } : undefined}
                            onConfirmBeam={p.onConfirmBeam} onCancelBeam={p.onCancelBeam} dense={dense(here)} />
                        ))}
                        {ghosts.map((ag) => <BeamGhost key={`g-${ag.id}`} agent={ag} dests={dests} />)}
                        {pendingHere && <BeamPendingGhost agent={pendingAgent!} at={p.pending!.at} confirm={p.pending!.mode === "confirm"} />}
                      </div>
                    </>
                  )}
                </section>
              );
            })}
            {dragId && (
              <div {...laneDrop("file")} className={cx("flex min-h-12 items-center gap-2 rounded-unit border border-dashed px-4 py-2.5 text-small transition-colors duration-(--dur-pop)", hot === "file" ? "border-ink bg-surface-2 text-ink" : "border-line-strong text-ink-2")}>
                <FileArrowDownIcon size={16} aria-hidden className="shrink-0" />
                <span><span className="font-medium text-ink">In a file</span> · Drop here to move it into a file for another computer.</span>
              </div>
            )}
            <BeamFlights agents={agents} dests={dests} container={docksRef} />
          </div>
        )}

        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-small text-ink-2">
          {!first && <AutostartToggle />}
          {!first && (
            <span className="flex flex-wrap items-center gap-x-1 gap-y-1">
              <span className="mr-1">More places:</span>
              <Button size="sm" variant="quiet" icon={FolderOpenIcon} onClick={p.onImport}>Open an agent file</Button>
              <Button size="sm" variant="quiet" icon={CloudArrowUpIcon} onClick={p.onAddCloud}>Add a cloud</Button>
            </span>
          )}
          {!first && <Button size="sm" variant="quiet" icon={ChatsCircleIcon} onClick={p.onToggleCrew} className="md:hidden">Talk to all agents</Button>}
          <span className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <span className="hidden items-center gap-1.5 sm:inline-flex">
              <KeyboardIcon size={14} aria-hidden />
              <button type="button" onClick={() => setKeysOpen(true)} className="rounded-[4px] hover:text-ink">Keyboard shortcuts</button>
              <Kbd>?</Kbd>
            </span>
          </span>
        </footer>
        {p.children}
      </main>

      <Dialog open={keysOpen} onClose={() => setKeysOpen(false)} title="Keyboard shortcuts" size="sm">
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-body">
          {([
            ["mod+k", "Search or do anything"], ["n", "New agent"], ["1", "Jump to agent 1–9 (in name order)"], ["arrowright", "Move between agents"],
            ["enter", "Open the agent"], ["b", "Beam the agent to…"], ["alt+shift+a", "What's waiting for you"], ["?", "This list"],
          ] as const).map(([k, t]) => <div key={k} className="contents"><dt><Kbd keys={k} /></dt><dd className="text-ink-2">{t}</dd></div>)}
        </dl>
      </Dialog>
    </div>
  );
}

// ---------------- footer: autostart ----------------
/** Agents on this computer come back when Beamhop starts; starting it at login keeps them going after a reboot. */
export function AutostartToggle() {
  const [on, setOn] = useState<boolean>();
  useEffect(() => { fetch("/api/autostart").then((r) => r.json()).then((j) => setOn(j.on)).catch(() => {}); }, []);
  if (on === undefined) return null;
  return (
    <Switch checked={on} label="Open Beamhop when I log in" description="Agents on this computer come back after a restart."
      onChange={async (v) => { setOn(v); const j = await (await fetch("/api/autostart", { method: "POST", body: JSON.stringify({ on: v }) })).json().catch(() => ({ on: !v })); setOn(j.on); }} />
  );
}

// ---------------- favicon badge ----------------
let baseIcon: string | undefined;
function setFavicon(needs: boolean) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  baseIcon ??= link.href;
  link.href = needs && baseIcon.startsWith("data:image/svg+xml,") ? baseIcon.replace(/%3C\/svg%3E$/, "%3Ccircle cx='52' cy='12' r='12' fill='%23F15B00' stroke='%231f1d19' stroke-width='3'/%3E%3C/svg%3E") : baseIcon;
}
