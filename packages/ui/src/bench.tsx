import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as RKE, type ReactNode } from "react";
import { ArrowRightIcon, CalendarBlankIcon, ChatsCircleIcon, CloudArrowUpIcon, FileArrowDownIcon, FolderOpenIcon, KeyboardIcon, MagnifyingGlassIcon, PauseIcon, PlayIcon, PlusIcon } from "@phosphor-icons/react";
import type { StatusMsg } from "@scut/protocol";
import { Agent, Destination, Approval, ResolvedApproval } from "./lib.tsx";
import { useAgent } from "./useAgent.ts";
import { BeamMenu, BeamGhost, BeamCountdown, BeamConfirm, BeamReceipt, BeamFailed, beamInFlight, placeCost, placeIcon, placeLabel } from "./beam.tsx";
import { ApprovalCard, approvalTitle } from "./ui/ApprovalCard.tsx";
import {
  Button, IconButton, Kbd, StatusBadge, Lamp, STATUS, toStatus, Plate, Bezel, ScreenNote, Readout, Tray, Switch, Input, Dialog, ThemeToggle,
  useHotkeys, useCommands, openCommandPalette, announce, money, tokensEur, duration, relativeTime, clock, plural, cx, prefersReducedMotion, setThemePref, getThemePref, formatShortcut,
  type Status, type ReadoutItem,
} from "./ui/index.ts";

// ---------------- what each unit reports up to the bench ----------------

export type UnitReport = {
  status: Status;
  /** Short status word for this unit ("Needs you", "Working", "Starting", "Free since 14:02"). */
  word: string;
  headline: string;
  approvals: Approval[];
  resolved: ResolvedApproval[];
  send: (m: unknown) => void;
  eurToday: number;
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

/** The status sentence: "1 needs you · 2 working · Scout free". */
export function statusSentence(agents: Agent[], reports: Record<string, UnitReport | undefined>) {
  const of = (s: Status) => agents.filter((a) => (reports[a.id]?.status ?? "moving") === s);
  const needs = of("needs").length, working = of("working").length, free = of("free"), moving = of("moving"), problem = of("problem").length;
  const parts: string[] = [];
  if (working) parts.push(`${working} working`);
  if (moving.length) parts.push(moving.length <= 2 ? moving.map((a) => `${a.name} ${beamInFlight(a) ? "moving" : "starting"}`).join(" · ") : `${moving.length} starting`);
  if (problem) parts.push(`${problem} with a problem`);
  if (free.length) parts.push(free.length === 1 ? `${free[0].name} free` : free.length === agents.length ? `All ${free.length} free` : `${free.length} free`);
  return { needs, rest: parts.join(" · ") };
}

// ---------------- the unit ----------------

type UnitProps = {
  agent: Agent; dests: Destination[]; solo: boolean; previews: boolean; tabbable: boolean; index: number;
  onOpen: () => void; onBeam: (to: string) => void; onReport: (id: string, r: UnitReport) => void;
  onKeyNav: (e: RKE<HTMLElement>, id: string) => void; onFocusUnit: (id: string) => void;
  onReview: (approvalId: string) => void; onDragStart: (id: string) => void; onDragEnd: () => void;
  menuOpen: boolean; setMenuOpen: (v: boolean) => void; onRetry: () => void; onBeamBack?: () => void; landed: boolean;
};

function useNow(on: boolean, every = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!on) return; const t = setInterval(() => setNow(Date.now()), every); return () => clearInterval(t); }, [on, every]);
  return on ? now : Date.now();
}

export function Unit(p: UnitProps) {
  const { agent, dests, solo } = p;
  const [large, setLarge] = useState(solo);
  // Units stream only while large: small 480 px frames at 2 fps; the lone agent gets full frames.
  const a = useAgent(agent, p.previews && large, solo ? 4 : 2, !solo);
  const st: StatusMsg | undefined = a.status;
  const beaming = beamInFlight(agent);
  const failed = agent.beam?.stage === "failed";
  const brokenChannel = Object.entries(a.pairing?.channels ?? {}).find(([, c]) => c.error)?.[0];
  const needs = a.approvals.length > 0 || a.state === "stuck";
  const status = toStatus(a.state, { needs, beaming, failed: !!brokenChannel && a.state === "running" });
  const since = a.since ?? st?.since;
  const where = placeLabel(dests, agent.current.driver);
  const word = status === "free" ? (since ? `Free since ${clock(since)}` : "Free")
    : status === "moving" ? (beaming ? `Beaming to ${placeLabel(dests, agent.beam!.to)}` : a.state === "quiescing" ? "Packing up" : "Starting")
    : status === "problem" && brokenChannel ? `${brokenChannel[0].toUpperCase()}${brokenChannel.slice(1)} can't sign in`
    : STATUS[status].word;
  const headline = needs && st?.task?.prompt ? st.task.prompt
    : needs && a.approvals[0] ? `Waiting for you: ${approvalTitle(a.approvals[0].title)}`
    : st?.headline && !(status === "free" && st.headline === "Free") ? st.headline
    : status === "working" ? a.narration.at(-1)?.text ?? "Working"
    : status === "free" ? (st?.lastResult ? "Ready for the next task" : "Ready for a task") : word;
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

  useEffect(() => { p.onReport(agent.id, { status, word, headline, approvals: a.approvals, resolved: a.resolved, send: a.send, eurToday: eur }); }, [status, word, headline, a.approvals, a.resolved, eur]);

  const startedAt = st?.task?.startedAt ?? since;
  const now = useNow(large && status === "working" && !!startedAt);
  const readout: ReadoutItem[] = [{ value: status === "moving" && !beaming ? "Starting" : STATUS[status].word, status }];
  if (status === "working" && startedAt) readout.push({ value: duration(now - startedAt), srLabel: "for" });
  readout.push({ value: money(eur), label: "today" });

  const headingId = useId();
  const ref = useRef<HTMLElement>(null);
  const actions = (
    <div className="flex items-center gap-2">
      <Button size="sm" variant={solo ? "primary" : "secondary"} aria-label={`Open ${agent.name}`} onClick={p.onOpen} iconEnd={solo ? ArrowRightIcon : undefined}>Open</Button>
      <BeamMenu agent={agent} dests={dests} onBeam={p.onBeam} open={p.menuOpen} onOpenChange={p.setMenuOpen} align={solo ? "start" : "end"} />
    </div>
  );
  const needsRow = needs && (
    <div className="flex items-center gap-2 rounded-control bg-signal-wash px-2.5 py-1.5 text-small">
      <Lamp status="needs" size={9} />
      <span className="min-w-0 flex-1 truncate font-medium text-signal-ink">
        {a.approvals.length > 1 ? `${a.approvals.length} things are waiting for you` : a.approvals[0] ? `Wants to ${approvalTitle(a.approvals[0].title).replace(/^./, (c) => c.toLowerCase())}` : `${agent.name} is stuck and asked for help`}
      </span>
      {a.approvals[0]
        ? <Button size="sm" variant="signal" onClick={() => p.onReview(a.approvals[0].id)}>Review</Button>
        : <Button size="sm" variant="signal" onClick={p.onOpen}>Take a look</Button>}
    </div>
  );
  const after = (
    <>
      {p.landed && <BeamReceipt agent={agent} where={where} from={placeLabel(dests, agent.beam?.from)} onBeamBack={p.onBeamBack} />}
      <BeamFailed agent={agent} dests={dests} onRetry={p.onRetry} />
    </>
  );
  const screen = (
    <Bezel size={solo ? "md" : "sm"} label={`${agent.name}'s screen`}>
      {a.frame && p.previews ? (
        <img src={a.frame} alt={`${agent.name}'s screen: ${headline}`} draggable={false} className="absolute inset-0 h-full w-full object-cover" />
      ) : a.frame ? (
        <><img src={a.frame} alt={`${agent.name}'s screen (paused): ${headline}`} draggable={false} className="absolute inset-0 h-full w-full object-cover opacity-35" /><ScreenNote>Preview paused</ScreenNote></>
      ) : (
        <ScreenNote>{!p.previews ? "Preview paused" : a.connected ? `Waiting for ${agent.name}'s screen…` : `Starting ${agent.name}'s screen…`}</ScreenNote>
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
      onFocus={(e) => { if (e.target === e.currentTarget) p.onFocusUnit(agent.id); }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter") { e.preventDefault(); p.onOpen(); }
        else if (e.key.toLowerCase() === "b" && !e.metaKey && !e.ctrlKey && !e.altKey && !beaming) { e.preventDefault(); p.setMenuOpen(true); }
        else p.onKeyNav(e, agent.id);
      }}
      className={cx(
        "relative min-w-0 rounded-unit border bg-surface text-left transition-[opacity,border-color] duration-(--dur-tray)",
        needs ? "border-signal" : "border-line",
        p.landed && agent.beam?.doneAt && Date.now() - agent.beam.doneAt < 4000 && "animate-pop",
        cls,
      )}
    >
      <div className={cx(beaming && "pointer-events-none opacity-40 transition-opacity duration-(--dur-tray)")} inert={beaming || undefined}>{children}</div>
      {beaming && (
        <p className="flex items-center gap-1.5 border-t border-line px-3 py-2 text-small text-ink">
          <Lamp status="moving" size={10} />
          <span className="min-w-0"><span className="font-medium">Beaming to {placeLabel(dests, agent.beam!.to)}.</span> <span className="text-ink-2">Stays here until it lands safely.</span></span>
        </p>
      )}
    </article>
  );

  const header = (big: boolean) => (
    <header className="flex min-w-0 items-center gap-2">
      <Plate pubkey={agent.agentPubkey} name={agent.name} size={big ? "md" : "sm"} />
      <h3 id={headingId} className={cx("min-w-0 truncate text-ink", big ? "text-h3" : "text-body font-semibold")}>
        {agent.name}<span className="sr-only">, {word}{p.index < 9 ? `, press ${p.index + 1} to jump here` : ""}</span>
      </h3>
      {!big && !large && <span className="ml-auto pl-1"><StatusBadge status={status} size="sm" emphasis label={beaming ? "Moving" : word} /></span>}
      {!big && large && <span className="ml-auto pl-1 text-small text-ink-3 max-sm:hidden">{p.index < 9 ? <Kbd>{String(p.index + 1)}</Kbd> : null}</span>}
    </header>
  );

  if (solo) {
    return shell(
      <div className="grid gap-5 p-4 md:grid-cols-[minmax(0,1.55fr)_minmax(280px,1fr)] md:p-5">
        {screen}
        <div className="flex min-w-0 flex-col gap-3">
          {header(true)}
          <StatusBadge status={status} emphasis label={word} className="self-start" />
          <p className="text-ui-lg text-ink [overflow-wrap:anywhere]">{headline}</p>
          <Readout label={`${agent.name} right now`} items={readout} className="self-start" />
          {needsRow}
          <Details st={st} name={agent.name} />
          <TaskBox name={agent.name} disabled={beaming} onSend={(text) => { a.send({ t: "chat", text }); announce(`Sent to ${agent.name}`); }} />
          {after}
          <div className="mt-auto pt-1">{actions}</div>
        </div>
      </div>,
      cx("w-full"),
    );
  }

  if (large) {
    return shell(
      <div className="flex flex-col gap-2.5 p-3">
        {header(false)}
        {screen}
        <p className="line-clamp-2 text-body text-ink [overflow-wrap:anywhere]">{headline}</p>
        <Readout label={`${agent.name} right now`} items={readout} className="self-start" />
        {needsRow}
        {after}
        <div className="pt-0.5">{actions}</div>
      </div>,
      cx("w-full sm:w-[400px]"),
    );
  }

  return shell(
    <div className="flex h-full flex-col gap-2 p-3">
      {header(false)}
      {status !== "free" && <p className="text-small text-ink-2">{headline}</p>}
      <Details st={st} compact />
      {needsRow}
      {after}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">{actions}<span className="text-micro text-ink-3 max-sm:hidden">{p.index < 9 ? <Kbd>{String(p.index + 1)}</Kbd> : null}</span></div>
    </div>,
    cx("w-full sm:w-[280px]"),
  );
}

/** Last result + next routine, the two "what's next" facts. */
function Details({ st, compact, name }: { st?: StatusMsg; compact?: boolean; name?: string }) {
  if (!st?.lastResult && !st?.nextRun) return compact ? <p className="text-small text-ink-3">Nothing done yet.</p>
    : name ? <p className="max-w-prose text-body text-ink-2">Nothing done yet. Give {name} a task below, or open it to chat, schedule routines and connect your chat apps.</p> : null;
  return (
    <dl className="space-y-1.5 text-small">
      {st.lastResult && (
        <div className="min-w-0">
          <dt className="text-ink-3">Last result, {relativeTime(st.lastResult.ts)}</dt>
          <dd className={cx("text-ink [overflow-wrap:anywhere]", compact && "line-clamp-2")}>{st.lastResult.text}</dd>
        </div>
      )}
      {st.nextRun && (
        <div className="flex min-w-0 items-center gap-1.5 text-ink-2">
          <CalendarBlankIcon size={13} aria-hidden className="shrink-0" />
          <dt className="sr-only">Next routine</dt>
          <dd className="min-w-0 truncate"><span className="tabular-nums text-ink">{whenNext(st.nextRun.at)}</span> · {st.nextRun.prompt}</dd>
        </div>
      )}
    </dl>
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
  /** First run (no agents yet): shown in place of the docks, e.g. the create flow inline. */
  empty?: ReactNode;
  children?: ReactNode;
};

export function Bench(p: BenchProps) {
  const { agents, dests, reports } = p;
  const [previewPref, setPreviewPref] = useState(() => { try { const v = localStorage.getItem("beamhop-previews"); return v ? v === "on" : !prefersReducedMotion(); } catch { return true; } });
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  useEffect(() => { const h = () => setHidden(document.hidden); document.addEventListener("visibilitychange", h); return () => document.removeEventListener("visibilitychange", h); }, []);
  const previews = previewPref && !hidden;
  const togglePreviews = () => setPreviewPref((v) => { try { localStorage.setItem("beamhop-previews", v ? "off" : "on"); } catch {} announce(v ? "Previews paused" : "Previews on"); return !v; });
  const [menuFor, setMenuFor] = useState<string>();
  const [focusId, setFocusId] = useState<string>();
  const [dragId, setDragId] = useState<string>();
  const [hot, setHot] = useState<string>();
  const [keysOpen, setKeysOpen] = useState(false);
  const trayRef = useRef<HTMLDivElement>(null);

  // Lanes: This computer first, then clouds alphabetically; agents on a place we don't list get a lane of their own.
  const lanes = useMemo(() => {
    const known = [...dests].sort((a, b) => (isLocal(a.id) === isLocal(b.id) ? a.label.localeCompare(b.label) : isLocal(a.id) ? -1 : 1));
    const extra = [...new Set(agents.map((a) => a.current.driver).filter((d) => !dests.some((x) => x.id === d)))]
      .map((id): Destination => ({ id, label: id === "local" ? "This computer" : id, isolation: "container", monthlyUsd: 0 }));
    return [...known, ...extra].map((d) => ({ d, agents: agents.filter((a) => a.current.driver === d.id).sort(byName) }));
  }, [agents, dests]);
  const order = useMemo(() => lanes.flatMap((l) => l.agents), [lanes]);
  const solo = agents.length === 1;
  const tabbableId = order.some((a) => a.id === focusId) ? focusId : order[0]?.id;

  const unitEl = (id: string) => document.querySelector<HTMLElement>(`[data-unit="${CSS.escape(id)}"]`);
  const focusUnit = (id?: string) => { if (!id) return; setFocusId(id); unitEl(id)?.focus(); };
  const open = (id: string) => (location.hash = `#/agent/${id}`);

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
    const el = approvalId ? trayRef.current?.querySelector<HTMLElement>(`[data-approval="${CSS.escape(approvalId)}"]`) : trayRef.current?.querySelector<HTMLElement>("[data-approval]");
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    el?.focus({ preventScroll: true });
  };

  // Top bar facts.
  const s = statusSentence(agents, reports);
  const eurToday = agents.reduce((sum, a) => sum + (reports[a.id]?.eurToday ?? 0), 0);
  useEffect(() => {
    const t = [s.needs ? `${s.needs} need${s.needs === 1 ? "s" : ""} you` : "", s.rest].filter(Boolean).join(" · ");
    document.title = `${s.needs ? `(${s.needs}) ` : ""}${t ? `${t} · ` : ""}Beamhop`;
    setFavicon(s.needs > 0);
    return () => { document.title = "Beamhop"; setFavicon(false); };
  }, [s.needs, s.rest]);

  // Keyboard: 1–9 jump to a unit, Alt+Shift+A to the oldest approval. (N, ?, ⌘K are palette commands.)
  useHotkeys(Object.fromEntries([
    ...order.slice(0, 9).map((a, i) => [String(i + 1), () => focusUnit(a.id)]),
    ["alt+shift+a", () => focusInbox()],
  ]));
  useCommands([
    { id: "bench.new", title: "New agent", group: "Agents", shortcut: "n", synonyms: ["create", "add", "make"], disabled: p.loaded && !agents.length && !!p.empty, run: p.onCreate },
    { id: "bench.crew", title: "Talk to all agents", group: "Agents", synonyms: ["crew room", "chat", "everyone"], run: p.onToggleCrew },
    { id: "bench.cloud", title: "Add a cloud", group: "Places", synonyms: ["connect a cloud", "fly", "render", "railway"], run: p.onAddCloud },
    { id: "bench.import", title: "Open an agent file", group: "Places", synonyms: ["import", "receive", ".beamhop"], run: p.onImport },
    { id: "bench.inbox", title: "Go to what's waiting for you", group: "View", shortcut: "alt+shift+a", bindShortcut: false, disabled: !cards.length, synonyms: ["approvals", "inbox"], run: () => focusInbox() },
    { id: "bench.previews", title: previewPref ? "Pause previews" : "Resume previews", group: "View", synonyms: ["video", "screens", "calm"], run: togglePreviews },
    { id: "bench.theme", title: "Switch theme", group: "View", hint: getThemePref() === "system" ? "follows your computer" : getThemePref(), synonyms: ["dark", "light", "appearance"], run: () => setThemePref(getThemePref() === "system" ? "light" : getThemePref() === "light" ? "dark" : "system") },
    { id: "bench.keys", title: "Keyboard shortcuts", group: "View", shortcut: "?", synonyms: ["help", "keys"], run: () => setKeysOpen(true) },
  ], [previewPref, cards.length, p.onCreate, p.onToggleCrew, agents.length, !!p.empty]);

  const laneDrop = (laneId: string) => ({
    onDragOver: (e: DragEvent) => { if (!dragId) return; const ag = agents.find((x) => x.id === dragId); if (ag?.current.driver === laneId) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; setHot(laneId); },
    onDragLeave: (e: DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setHot((h) => (h === laneId ? undefined : h)); },
    onDrop: (e: DragEvent) => { e.preventDefault(); setHot(undefined); const id = e.dataTransfer.getData("text/agent") || dragId; setDragId(undefined); if (!id) return; laneId === "file" ? p.onExport(id) : p.requestBeam(id, laneId); },
  });

  const pendingAgent = p.pending && agents.find((a) => a.id === p.pending!.agentId);
  const first = p.loaded && !agents.length && !!p.empty;

  return (
    <div className={cx("min-h-dvh pb-10 transition-[padding] duration-(--dur-tray)", p.crewOpen && "xl:pr-[400px]")}>
      {/* ---------- top bar ---------- */}
      <header className="sticky top-0 z-20 border-b border-line bg-bg">
        <div className="mx-auto flex min-h-14 max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
          <h1 className="wordmark text-[17px] text-ink">Beamhop</h1>
          <p className="order-last w-full min-w-0 truncate text-body text-ink-2 sm:order-none sm:w-auto sm:flex-1" aria-live="off">
            {s.needs > 0 && (
              <button type="button" onClick={() => focusInbox()} className="mr-1 inline-flex items-center gap-1.5 rounded-[4px] font-medium text-signal-ink underline decoration-signal/50 underline-offset-[3px] hover:decoration-signal">
                <Lamp status="needs" size={9} />{s.needs} need{s.needs === 1 ? "s" : ""} you
              </button>
            )}
            {s.needs > 0 && s.rest && <span aria-hidden> · </span>}
            {s.rest || (!agents.length && p.loaded ? "No agents yet" : "")}
          </p>
          <div className="ml-auto flex items-center gap-1.5 sm:ml-0">
            {!first && <span className="mr-1.5 hidden whitespace-nowrap text-body tabular-nums text-ink-2 md:inline" title="Model cost today, all agents (estimate)">{money(eurToday, { period: "today" })}</span>}
            <Button variant="secondary" icon={MagnifyingGlassIcon} shortcut="mod+k" onClick={() => openCommandPalette()} className="w-60 justify-start text-ink-2 max-lg:hidden"><span className="flex-1 text-left">Search or do anything</span></Button>
            <IconButton className="lg:hidden" label={`Search or do anything (${formatShortcut("mod+k")})`} icon={MagnifyingGlassIcon} onClick={() => openCommandPalette()} />
            {!first && <Button variant="quiet" icon={ChatsCircleIcon} onClick={p.onToggleCrew} aria-expanded={p.crewOpen} className="max-sm:hidden">Talk to all agents</Button>}
            {!first && <IconButton label={previewPref ? "Pause previews" : "Resume previews"} icon={previewPref ? PauseIcon : PlayIcon} pressed={!previewPref} onClick={togglePreviews} />}
            <ThemeToggle />
            {!first && <Button variant="primary" icon={PlusIcon} onClick={p.onCreate} title="New agent (N)">New agent</Button>}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] space-y-7 px-4 pt-5 sm:px-6">
        {/* ---------- waiting for you ---------- */}
        {cards.length > 0 && (
          <div ref={trayRef}>
            <Tray title="Waiting for you" count={pendingCards.length} actions={<span className="hidden text-small text-ink-3 sm:inline">Oldest first · <Kbd keys="alt+shift+a" /></span>}>
              {cards.map(({ ag, ap, resolved }) => (
                <ApprovalCard key={ap.id} compact approval={ap} agentName={ag.name} pubkey={ag.agentPubkey} resolved={resolved}
                  onAnswer={(ok) => reports[ag.id]?.send({ t: "approval", id: ap.id, ok })} />
              ))}
            </Tray>
          </div>
        )}

        {first && <div className="py-4 sm:py-8">{p.empty}</div>}

        {/* ---------- docks ---------- */}
        {!first && lanes.map(({ d, agents: here }) => {
          const ghosts = agents.filter((a) => beamInFlight(a) && a.beam!.to === d.id);
          const countdown = p.pending?.mode === "undo" && p.pending.to === d.id && pendingAgent;
          const confirm = p.pending?.mode === "confirm" && p.pending.to === d.id && pendingAgent;
          const Icon = placeIcon(d);
          const dragSource = dragId && agents.find((x) => x.id === dragId)?.current.driver === d.id;
          const headId = `lane-${d.id}`;
          return (
            <section key={d.id} aria-labelledby={headId} {...laneDrop(d.id)}
              className={cx("rounded-unit transition-[background-color,outline-color] duration-(--dur-pop)",
                dragId && !dragSource && "outline-2 outline-offset-4 outline-dashed outline-line-strong",
                hot === d.id && "bg-surface-2 outline-ink")}>
              <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <h2 id={headId} className="flex items-center gap-1.5 text-body font-semibold text-ink"><Icon size={16} aria-hidden className="self-center" />{d.label}</h2>
                <span className="text-small text-ink-2">{plural(here.length, "agent")}</span>
                <span className="text-small tabular-nums text-ink-2">{d.monthlyUsd ? `${placeCost(d)} each` : "free"}</span>
                {!!d.monthlyUsd && <span className="text-small text-ink-2">Connected</span>}
                {dragId && <span className="ml-auto text-small font-medium text-ink">{dragSource ? "Already here" : "Drop to beam here"}</span>}
              </div>
              {confirm && <div className="mb-3"><BeamConfirm agent={pendingAgent!} to={d} onConfirm={p.onConfirmBeam} onCancel={p.onCancelBeam} /></div>}
              <div className="flex flex-wrap items-start gap-3">
                {here.map((ag, i) => (
                  <Unit key={ag.id} agent={ag} dests={dests} solo={solo} previews={previews} index={order.indexOf(ag)} tabbable={ag.id === tabbableId}
                    onOpen={() => open(ag.id)} onBeam={(to) => p.requestBeam(ag.id, to)} onReport={p.onReport}
                    onKeyNav={onKeyNav} onFocusUnit={setFocusId} onReview={focusInbox}
                    onDragStart={setDragId} onDragEnd={() => { setDragId(undefined); setHot(undefined); }}
                    menuOpen={menuFor === ag.id} setMenuOpen={(v) => setMenuFor(v ? ag.id : undefined)}
                    onRetry={() => ag.beam && p.requestBeam(ag.id, ag.beam.to)}
                    onBeamBack={ag.beam?.from && ag.beam.from !== ag.current.driver ? () => p.requestBeam(ag.id, ag.beam!.from!) : undefined}
                    landed={!!p.landed[ag.id] || ag.beam?.stage === "online"} />
                ))}
                {ghosts.map((ag) => <BeamGhost key={`g-${ag.id}`} agent={ag} dests={dests} />)}
                {countdown && <BeamCountdown agent={pendingAgent!} to={d} at={p.pending!.at} onUndo={p.onCancelBeam} onNow={p.onConfirmBeam} />}
                {!here.length && !ghosts.length && !countdown && !confirm && (
                  <div className="flex min-h-24 w-full items-center rounded-unit border border-dashed border-line-strong px-4 py-3 text-small text-ink-2 sm:w-auto sm:min-w-[320px]">
                    {!agents.length && isLocal(d.id) ? "Your first agent will live here." : `Nothing here yet. Drag an agent here or use Beam to…`}
                  </div>
                )}
              </div>
            </section>
          );
        })}

        {/* ---------- the other places: a file, a new cloud ---------- */}
        {!first && <section aria-label="More places" className="grid gap-3 sm:grid-cols-2">
          <div {...laneDrop("file")}
            className={cx("flex min-h-20 flex-wrap items-center gap-3 rounded-unit border border-dashed px-4 py-3 transition-colors duration-(--dur-pop)", hot === "file" ? "border-ink bg-surface-2" : "border-line-strong")}>
            <FileArrowDownIcon size={20} aria-hidden className="shrink-0 text-ink-2" />
            <div className="min-w-[200px] flex-1">
              <h2 className="text-body font-semibold text-ink">In a file</h2>
              <p className="text-small text-ink-2">{dragId ? "Drop to move it into a file for another computer." : "Drop an agent here to carry it to another computer. Or bring one in."}</p>
            </div>
            <Button size="sm" icon={FolderOpenIcon} onClick={p.onImport}>Open an agent file</Button>
          </div>
          <div className="flex min-h-20 flex-wrap items-center gap-3 rounded-unit border border-dashed border-line-strong px-4 py-3">
            <CloudArrowUpIcon size={20} aria-hidden className="shrink-0 text-ink-2" />
            <div className="min-w-[200px] flex-1">
              <h2 className="text-body font-semibold text-ink">Your own cloud</h2>
              <p className="text-small text-ink-2">Keep agents working while this computer is off. You pay the provider directly.</p>
            </div>
            <Button size="sm" icon={PlusIcon} onClick={p.onAddCloud}>Add a cloud</Button>
          </div>
        </section>}

        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-small text-ink-2">
          <AutostartToggle />
          {!first && <Button size="sm" variant="quiet" icon={ChatsCircleIcon} onClick={p.onToggleCrew} className="sm:hidden">Talk to all agents</Button>}
          <span className="ml-auto hidden items-center gap-1.5 sm:inline-flex">
            <KeyboardIcon size={14} aria-hidden />
            <button type="button" onClick={() => setKeysOpen(true)} className="rounded-[4px] hover:text-ink">Keyboard shortcuts</button>
            <Kbd>?</Kbd>
          </span>
        </footer>
        {p.children}
      </main>

      <Dialog open={keysOpen} onClose={() => setKeysOpen(false)} title="Keyboard shortcuts" size="sm">
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-body">
          {([
            ["mod+k", "Search or do anything"], ["n", "New agent"], ["1", "Jump to agent 1–9"], ["arrowright", "Move between agents"],
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
