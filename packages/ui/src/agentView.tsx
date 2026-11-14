import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CaretDownIcon, CaretLeftIcon, CaretUpIcon, ChatsIcon, CheckIcon, CopyIcon, CornersInIcon, CornersOutIcon, DeviceMobileIcon, GearIcon, MagnifyingGlassPlusIcon,
  ChatCircleTextIcon, CloudArrowUpIcon, PauseIcon, PlayIcon, QrCodeIcon, ShieldCheckIcon, ShieldWarningIcon, StopIcon, TelegramLogoIcon,
} from "@phosphor-icons/react";
import qrcode from "qrcode-generator";
import type { Agent, Approval, Destination } from "./lib.tsx";
import { useAgent } from "./useAgent.ts";
import { BeamMenu, placeIcon, placeLabel, placeOf } from "./beam.tsx";
import { SettingsPanel, SETTINGS_SECTIONS, safetySummary, type SettingsSection } from "./settings.tsx";
import { ApprovalCard, approvalTitleShort, resolutionText } from "./ui/ApprovalCard.tsx";
import { Activity, buildActivity, useActivityAnnouncements } from "./agent-activity.tsx";
import { ChatLog, Composer, focusComposer } from "./agent-chat.tsx";
import { AgentScreen, useDrive, type Drive } from "./agent-screen.tsx";
import { FIX_LABEL, FIX_SECTION, useAgentNow, type AgentData } from "./agent-status.ts";
import { Button, Dialog, Drawer, IconButton, Lamp, Plate, Readout, StatusBadge, announce, cx, prefersReducedMotion, useCommands, useHotkeys } from "./ui/index.ts";

/**
 * Agent view (DESIGN-PLAN §4.4) and the stacked layout (§4.6).
 * Desktop (≥ 900 px): conversation on the left (resizable), the agent's screen on the right with the status sentence above
 * it, a control bar + readout under it and the activity timeline below. An approval rises from the bezel's bottom edge,
 * over the screen it is about. Settings open in a drawer over the screen side only.
 * Stacked (< 900 px: phones, small windows, 200 % zoom; also the standalone page from the phone link): what needs you
 * first, then status, the screen, the conversation, and a composer pinned to the bottom.
 */

const PHONE = "(max-width: 700px)";
const STACKED = "(max-width: 899px)";
function useMedia(q: string) {
  const [m, setM] = useState(() => typeof matchMedia === "function" && matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

/** Phone link answer: `reachable` says whether a phone can open `url` at all (127.0.0.1 can't). Older apps send `local`. */
type PhoneLinkInfo = { url: string; reachable: boolean; why?: string; local?: boolean };

const SECTION_ALIAS: Record<string, SettingsSection> = { key: "brain", channel: "apps", chat: "apps" };
/**
 * `#/agent/<id>?settings` opens Settings; `?settings=brain` (the bench's "Add a brain") or `?section=brain` opens it at
 * that section. Returns undefined when the address doesn't ask for Settings.
 */
function settingsFromHash(id: string): { section?: SettingsSection } | undefined {
  const m = location.hash.match(/^#\/agent\/([^?]+)\?(.*)$/);
  if (!m || decodeURIComponent(m[1]) !== id) return undefined;
  const q = new URLSearchParams(m[2]);
  if (!q.has("settings") && !q.has("section")) return undefined;
  const s = q.get("section") || q.get("settings") || "";
  const section = SECTION_ALIAS[s] ?? s;
  return { section: section in SETTINGS_SECTIONS ? (section as SettingsSection) : undefined };
}

export function AgentView({ agent, dests, onBack, onBeam, standalone = false }: { agent: Agent; dests: Destination[]; onBack: () => void; onBeam: (to: string) => void; standalone?: boolean }) {
  const phone = useMedia(PHONE);
  const stacked = useMedia(STACKED);
  // On a phone-sized screen the full 1280 px stream is wasted bandwidth; the small one is plenty.
  const [small] = useState(() => typeof matchMedia === "function" && matchMedia(PHONE).matches);
  const a = useAgent(agent, true, small ? 4 : 8, small);
  const drive = useDrive(a, agent.name);
  const now = useAgentNow(a, agent, drive.driving);
  const [settings, setSettings] = useState<{ section?: SettingsSection } | null>(() => settingsFromHash(agent.id) ?? null);
  const [phoneLink, setPhoneLink] = useState<PhoneLinkInfo | null>(null);
  const activity = useMemo(() => buildActivity(a.narration, a.resolved, { chat: a.chat, problem: now.problem }), [a.narration, a.resolved, a.chat, now.problem?.text]);
  useActivityAnnouncements(agent.name, agent.id, activity, a.approvals, stacked ? "It's at the top of the page." : "It's on the screen.");

  // Settings (at a section) from the address, now or later; then tidy the address so a reload doesn't reopen it.
  useEffect(() => {
    const read = () => {
      const asked = settingsFromHash(agent.id);
      if (!asked) return;
      setSettings(asked);
      history.replaceState(history.state, "", `#/agent/${agent.id}`);
    };
    read();
    const onOpen = (e: Event) => { const d = (e as CustomEvent).detail as { id?: string; section?: SettingsSection } | undefined; if (!d?.id || d.id === agent.id) setSettings({ section: d?.section }); };
    addEventListener("hashchange", read);
    addEventListener("beamhop:agent-settings", onOpen);
    return () => { removeEventListener("hashchange", read); removeEventListener("beamhop:agent-settings", onOpen); };
  }, [agent.id]);

  useEffect(() => {
    const prev = document.title;
    document.title = `${a.approvals.length ? `(${a.approvals.length}) ` : ""}${agent.name} · Beamhop`;
    return () => { document.title = prev; };
  }, [agent.name, a.approvals.length]);

  const openPhone = useCallback(async () => {
    const r = await fetch(`/api/agents/${agent.id}/phone`).then((r) => r.json()).catch(() => null);
    if (r?.url) setPhoneLink({ url: r.url, reachable: r.reachable ?? !r.local, why: r.why, local: r.local });
  }, [agent.id]);
  const stop = useCallback(() => { a.send({ t: "stop" }); announce(`Stopping ${agent.name}.`); }, [a.send, agent.name]);

  /**
   * Answer an approval, then put focus somewhere useful (never on the page body): the next card waiting, or the message
   * box. `reason` comes from "Don't" when the person gave one; the agent reads it to choose a safer path.
   */
  const [answered, setAnswered] = useState<Set<string>>(() => new Set());
  const focusAfter = useRef(false);
  const answer = useCallback((ap: Approval, ok: boolean, reason?: string) => {
    a.send({ t: "approval", id: ap.id, ok, ...(reason ? { reason } : {}) });
    setAnswered((s) => new Set(s).add(ap.id));
    const left = a.approvals.filter((x) => x.id !== ap.id && !answered.has(x.id)).length;
    announce(`${ok ? "Allowed" : `Told ${agent.name} no`}.${left ? ` ${left} more waiting.` : ""}`);
    focusAfter.current = true;
  }, [a.send, a.approvals, answered, agent.name]);
  const queue = a.approvals.filter((x) => !answered.has(x.id));
  useLayoutEffect(() => {
    if (!focusAfter.current) return;
    focusAfter.current = false;
    const next = queue[0] && document.querySelector<HTMLElement>(`[data-approval="${CSS.escape(queue[0].id)}"]`);
    if (next) next.focus({ preventScroll: false });
    else focusComposer();
  }, [answered]);

  useCommands([
    drive.driving
      ? { id: "agent.giveback", title: `Give back to ${agent.name}`, group: agent.name, run: drive.giveBack }
      : { id: "agent.takeover", title: `Take over ${agent.name}'s screen`, synonyms: ["control", "drive", "use"], group: agent.name, run: () => drive.takeOver() },
    { id: "agent.pause", title: a.paused ? `Resume ${agent.name}` : `Pause ${agent.name}`, synonyms: ["hold", "wait", "continue"], group: agent.name, disabled: drive.driving, run: drive.togglePause },
    { id: "agent.stop", title: `Stop ${agent.name}`, synonyms: ["cancel", "abort"], group: agent.name, disabled: !now.working, run: stop },
    { id: "agent.settings", title: `Settings of ${agent.name}`, synonyms: ["preferences", "autonomy", "brain", "memory"], group: agent.name, run: () => setSettings({}) },
    { id: "agent.safety", title: `Safety of ${agent.name}`, synonyms: ["security", "permissions"], group: agent.name, run: () => setSettings({ section: "safety" }) },
    ...(standalone ? [] : [
      { id: "agent.phone", title: `Open ${agent.name} on your phone`, synonyms: ["mobile", "qr"], group: agent.name, run: openPhone },
      { id: "agent.back", title: "Back to the bench", synonyms: ["home", "crew", "all agents"], group: agent.name, run: onBack },
    ]),
  ], [agent.name, drive.driving, a.paused, now.working, standalone]);

  const settingsDrawer = (placement: "fixed" | "contained") => (
    <Drawer open={!!settings} onClose={() => setSettings(null)} title="Settings" description={`What ${agent.name} does, how far it may go, and what it knows.`} placement={placement} width={placement === "contained" ? 460 : 440}>
      <SettingsPanel a={a} agent={agent} section={settings?.section} onClose={() => setSettings(null)} />
    </Drawer>
  );

  const onSettings = (section?: SettingsSection) => setSettings({ section });
  const fix = now.problem?.fix;
  const blocked = (fix === "brain" || fix === "key") ? {
    text: fix === "brain" ? `${agent.name} can't think yet. Add a brain first (2 min).` : `${agent.name}'s brain key doesn't work. Fix it first.`,
    action: <Button size="sm" variant="quiet" className="-my-1 shrink-0 underline decoration-1 underline-offset-2" onClick={() => onSettings("brain")}>{FIX_LABEL[fix]}</Button>,
  } : undefined;
  const shared = { agent, a, drive, now, stop, onSettings, queue, answer, blocked };
  return (
    <>
      {stacked
        ? <StackedLayout {...shared} wide={!phone} dests={dests} onBack={onBack} onBeam={onBeam} standalone={standalone} onPhone={openPhone} activity={activity} settings={settingsDrawer("fixed")} />
        : <DesktopLayout {...shared} dests={dests} onBack={onBack} onBeam={onBeam} standalone={standalone} onPhone={openPhone} activity={activity} settings={settingsDrawer("contained")} />}
      {phoneLink && <PhoneLink phone={phoneLink} agent={agent} dests={dests} name={agent.name} onClose={() => setPhoneLink(null)}
        onBeam={(to) => { setPhoneLink(null); onBeam(to); }} onPair={() => { setPhoneLink(null); onSettings("apps"); }} />}
    </>
  );
}

type Shared = {
  agent: Agent; a: AgentData; drive: Drive; now: ReturnType<typeof useAgentNow>; stop: () => void; onSettings: (section?: SettingsSection) => void; settings: ReactNode;
  /** Approvals still waiting for an answer from this window, oldest first. */
  queue: Approval[];
  answer: (ap: Approval, ok: boolean, reason?: string) => void;
  blocked?: { text: string; action?: ReactNode };
};
type Chrome = { dests: Destination[]; onBack: () => void; onBeam: (to: string) => void; standalone: boolean; onPhone: () => void; activity: ReturnType<typeof buildActivity> };

// ---------------------------------------------------------------- desktop

const WIDTH_KEY = "beamhop.chatWidth";
const MIN_CHAT = 360;
const MIN_SCREEN = 480;

function DesktopLayout({ agent, a, drive, now, stop, onSettings, settings, dests, onBack, onBeam, standalone, onPhone, activity, queue, answer, blocked }: Shared & Chrome) {
  const main = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(() => Number(localStorage.getItem(WIDTH_KEY)) || 420);
  const [focus, setFocus] = useState(false);
  const [actual, setActual] = useState(false);
  const [unread, setUnread] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(true);
  const chatLen = useRef(a.chat.length);
  useEffect(() => {
    const added = a.chat.slice(chatLen.current).filter((m) => m.from === "agent").length;
    chatLen.current = a.chat.length;
    if (focus && added) setUnread((n) => n + added);
  }, [a.chat.length]);
  useEffect(() => { if (!focus) setUnread(0); }, [focus]);
  useEffect(() => { localStorage.setItem(WIDTH_KEY, String(width)); }, [width]);
  // A new approval always shows itself, even if you hid the previous one.
  useEffect(() => { setSheetOpen(true); }, [queue[0]?.id]);

  const maxWidth = () => Math.max(MIN_CHAT, (main.current?.clientWidth ?? 1200) - MIN_SCREEN);
  const clamp = (w: number) => Math.round(Math.min(maxWidth(), Math.max(MIN_CHAT, w)));
  const toggleFocus = () => { setFocus((f) => !f); announce(focus ? "Conversation shown" : "Focus screen: the conversation is folded away. Press Escape to bring it back."); };

  useCommands([
    { id: "agent.focus", title: focus ? "Show the conversation" : "Focus screen", synonyms: ["zoom", "fullscreen", "big screen"], shortcut: "f", group: agent.name, run: toggleFocus },
    { id: "agent.actual", title: actual ? "Fit the screen to the window" : "Show the screen at actual size", synonyms: ["1:1", "zoom", "fit"], group: agent.name, run: () => setActual((x) => !x) },
  ], [focus, actual, agent.name]);
  useHotkeys({ escape: () => { if (!focus) return false; toggleFocus(); } }, { enabled: focus });

  const where = placeOf(dests, agent.current);
  const Place = placeIcon(dests.find((d) => d.id === agent.current.driver) ?? { id: agent.current.driver, monthlyUsd: 0 });
  const safety = safetySummary(a, agent);

  /** Go to the approval on the screen (open it if hidden), from the message box or the headline. */
  const showApproval = () => {
    setSheetOpen(true);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-approval="${CSS.escape(queue[0]?.id ?? "")}"]`)?.focus());
  };
  const sheet = <ApprovalSheet agent={agent} a={a} drive={drive} queue={queue} answer={answer} open={sheetOpen && !drive.driving} onOpenChange={setSheetOpen} />;

  return (
    <div className="flex h-dvh min-h-[560px] flex-col bg-bg">
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-surface pl-2 pr-3">
        {!standalone && (
          <nav aria-label="Breadcrumb" className="flex min-w-0 shrink-[3] items-center gap-1 text-small text-ink-2">
            <Button variant="quiet" size="sm" icon={CaretLeftIcon} onClick={onBack} className="-mr-0.5 shrink-0 text-ink-2 hover:text-ink">Bench</Button>
            <span aria-hidden className="text-ink-3 max-lg:hidden">/</span>
            <span className="flex min-w-0 items-center gap-1.5 px-1.5 max-lg:hidden"><Place size={14} aria-hidden className="shrink-0" /><span className="truncate">{where}</span></span>
            <span aria-hidden className="text-ink-3">/</span>
          </nav>
        )}
        <div className="flex min-w-0 shrink items-center gap-2 pl-1.5">
          <Plate pubkey={agent.agentPubkey} name={agent.name} size="sm" />
          <h1 className="min-w-[6ch] truncate text-ui-lg text-ink">{agent.name}</h1>
        </div>
        <StatusBadge status={now.status} label={now.word} emphasis size="sm" className="ml-1.5" />
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {safety && (
            <Button variant="quiet" size="sm" icon={safety.todo ? ShieldWarningIcon : ShieldCheckIcon} onClick={() => onSettings("safety")}
              className={cx(safety.todo ? "text-signal-ink" : "text-ink-2 hover:text-ink")} title="Open safety settings">
              <span className="max-lg:sr-only">{safety.text}</span>
            </Button>
          )}
          {!standalone && <BeamMenu agent={agent} dests={dests} onBeam={onBeam} onFile={() => onBeam("file")} />}
          {!standalone && <IconButton label={`Open ${agent.name} on your phone`} icon={DeviceMobileIcon} size="sm" onClick={onPhone} />}
          <Button size="sm" icon={GearIcon} onClick={() => onSettings()}>Settings</Button>
        </div>
      </header>

      <main ref={main} className="flex min-h-0 flex-1">
        {focus ? (
          <div className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-line bg-surface py-3">
            <span className="relative">
              <IconButton label={unread ? `Show the conversation, ${unread} new` : "Show the conversation"} icon={ChatsIcon} onClick={toggleFocus} />
              {unread > 0 && <span aria-hidden className="pointer-events-none absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-ink px-1 text-[10px] font-semibold tabular-nums text-surface">{unread}</span>}
            </span>
          </div>
        ) : (
          <>
            <section aria-labelledby="conv-h" style={{ width }} className="flex shrink-0 flex-col bg-surface">
              <h2 id="conv-h" className="sr-only">Conversation with {agent.name}</h2>
              <PairingCard agent={agent} a={a} />
              <ChatLog agent={agent} a={a} blocked={!!blocked} />
              <Composer agent={agent} a={a} className="border-t border-line px-3 pb-2 pt-3" blocked={blocked}
                above={queue.length > 0 && <WaitingLink agent={agent} queue={queue} onShow={showApproval} />} />
            </section>
            <Splitter width={width} min={MIN_CHAT} max={maxWidth} onChange={(w) => setWidth(clamp(w))} />
          </>
        )}

        <div className="relative min-w-0 flex-1">
          <div className="h-full overflow-y-auto">
            <div className="mx-auto flex w-full flex-col gap-3 px-6 pb-10 pt-5" style={{ maxWidth: `max(${MIN_SCREEN + 48}px, min(100%, calc((100dvh - 320px) * 1.6 + 60px)))` }}>
              <Headline now={now} a={a} agent={agent} onFix={onSettings} onShowApproval={queue.length ? showApproval : undefined} />
              <AgentScreen agent={agent} a={a} drive={drive} headline={now.headline} actual={actual} overlay={sheet} />
              <div className="flex flex-wrap items-center gap-2">
                {!drive.driving && (
                  <Button icon={a.paused ? PlayIcon : PauseIcon} onClick={drive.togglePause} disabled={!a.connected}>{a.paused ? "Resume" : "Pause"}</Button>
                )}
                {now.working && <Button variant="danger" icon={StopIcon} onClick={stop}>Stop</Button>}
                <Readout label={`${agent.name} now`} items={now.readout} className="min-w-0" />
                <span className="ml-auto flex items-center gap-1">
                  <IconButton label="Actual size" icon={MagnifyingGlassPlusIcon} pressed={actual} onClick={() => setActual(!actual)} />
                  <IconButton label="Focus screen" icon={focus ? CornersInIcon : CornersOutIcon} pressed={focus} onClick={toggleFocus} />
                </span>
              </div>
              <Activity items={activity} className="mt-5 border-t border-line pt-4" />
            </div>
          </div>
          {settings}
        </div>
      </main>
    </div>
  );
}

/**
 * The status sentence above the screen. With a problem, it says what's wrong and holds the button that fixes it; raw
 * error text stays in a Details disclosure.
 */
function Headline({ now, a, agent, phone, onFix, onShowApproval }: {
  now: ReturnType<typeof useAgentNow>; a: AgentData; agent: Agent; phone?: boolean; onFix: (section: SettingsSection) => void; onShowApproval?: () => void;
}) {
  const needs = now.needs;
  const problem = now.blocking && now.problem;
  const text = <span className="line-clamp-2">{now.headline}</span>;
  return (
    <div className={cx(!phone && "min-h-[48px]")}>
      <div className="flex items-start gap-3">
        <p className={cx("flex min-w-0 flex-1 items-start gap-2 [overflow-wrap:anywhere]", phone ? "text-ui-lg" : "text-h3", needs ? "text-signal-ink" : "text-ink")}>
          {needs && <Lamp status="needs" size={phone ? 10 : 12} className={phone ? "mt-[5px]" : "mt-1.5"} />}
          {problem && <Lamp status="problem" size={phone ? 11 : 13} className={phone ? "mt-[5px]" : "mt-1.5"} />}
          {onShowApproval && !phone && a.approvals.length > 0
            ? <button type="button" onClick={onShowApproval} className="rounded-[4px] text-left hover:underline hover:decoration-1 hover:underline-offset-4">{text}</button>
            : text}
        </p>
        {problem && problem.fix && (
          <Button variant="signal" className={cx("shrink-0", phone && "h-11 px-4 text-body")} onClick={() => onFix(FIX_SECTION[problem.fix!])}>{FIX_LABEL[problem.fix]}</Button>
        )}
      </div>
      {now.meta.length > 0 && <p className={cx("mt-0.5 text-small text-ink-2", phone ? "line-clamp-3" : "truncate")} title={now.meta.join(" · ")}>{now.meta.join(" · ")}</p>}
      {now.raw && (
        <details className="mt-1 text-small text-ink-2">
          <summary className="w-fit rounded-[4px]">Details</summary>
          <code className="mt-1 block whitespace-pre-wrap break-words rounded-control bg-surface-2 px-2 py-1 font-mono text-[11.5px] text-ink">{now.raw}</code>
        </details>
      )}
      {!a.connected && a.state !== "starting" && <p className="mt-0.5 text-small text-ink-2">Reconnecting to {agent.name}…</p>}
    </div>
  );
}

/** Keyboard- and pointer-resizable divider (APG window splitter). */
function Splitter({ width, min, max, onChange }: { width: number; min: number; max: () => number; onChange: (w: number) => void }) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the conversation"
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max()}
      aria-valuetext={`Conversation ${width} pixels wide`}
      tabIndex={0}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key === "ArrowLeft") onChange(width - step);
        else if (e.key === "ArrowRight") onChange(width + step);
        else if (e.key === "Home") onChange(min);
        else if (e.key === "End") onChange(max());
        else if (e.key === "Enter") onChange(420);
        else return;
        e.preventDefault();
      }}
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, w: width }; }}
      onPointerMove={(e) => { if (drag.current) onChange(drag.current.w + e.clientX - drag.current.x); }}
      onPointerUp={() => { drag.current = null; }}
      onDoubleClick={() => onChange(420)}
      className="group relative z-10 w-px shrink-0 cursor-col-resize bg-line outline-none"
    >
      <span aria-hidden className="absolute inset-y-0 -left-[3px] -right-[3px]" />
      <span aria-hidden className="absolute inset-y-0 -left-px -right-px bg-transparent transition-colors duration-(--dur-press) group-hover:bg-line-strong group-focus-visible:bg-focus group-active:bg-ink" />
    </div>
  );
}

/** Echoes of decisions from the last few seconds ("Allowed by you in Beamhop, 14:02"), newest last. */
function useRecentDecisions(a: AgentData, ms: number) {
  const [, tick] = useState(0);
  const recent = a.resolved.filter((r) => Date.now() - r.at < ms);
  useEffect(() => {
    if (!recent.length) return;
    const t = setTimeout(() => tick((x) => x + 1), ms);
    return () => clearTimeout(t);
  }, [a.resolved.length]);
  return recent;
}

/**
 * The approval sheet: rises from the bezel's bottom edge over the screen the agent is about to act on, so you decide
 * while looking at it. One card at a time (oldest first), with "N more waiting". It lowers to a one-line tab while you
 * drive or when you hide it. After an answer it shows the decision for a moment, then gives the screen back.
 */
function ApprovalSheet({ agent, a, drive, queue, answer, open, onOpenChange }: {
  agent: Agent; a: AgentData; drive: Drive; queue: Approval[]; answer: Shared["answer"]; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const recent = useRecentDecisions(a, 4000);
  const current = queue[0];
  const card = useRef<HTMLDivElement>(null);
  // Rise in from the bezel's edge (a small move; a cross-fade under reduced motion).
  useLayoutEffect(() => {
    if (!open || !current || !card.current?.animate) return;
    const reduce = prefersReducedMotion();
    card.current.animate(reduce ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: "translateY(24px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: reduce ? 120 : 220, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
  }, [open, current?.id]);
  const last = recent.at(-1);
  if (!current && !last) return null;
  const chip = "pressable on-screen inline-flex h-7 items-center gap-1.5 rounded-control border border-screen-line bg-bezel px-2.5 text-small text-screen-ink shadow-float";
  return (
    <div className="pointer-events-none absolute inset-x-1.5 bottom-1.5 top-11 flex flex-col items-center justify-end p-3">
      {!current ? (
        <p role="status" className={cx(chip, "pointer-events-auto animate-pop")}>
          {last!.ok ? <CheckIcon size={13} weight="bold" aria-hidden /> : null}
          {resolutionText({ ok: last!.ok, by: last!.by, at: last!.at }, agent.name)}
        </p>
      ) : !open ? (
        <button type="button" onClick={() => onOpenChange(true)} disabled={drive.driving} className={cx(chip, "pointer-events-auto max-w-full")}
          title={drive.driving ? `Give back to ${agent.name} to answer` : undefined}>
          <Lamp status="needs" size={9} />
          <span className="min-w-0 truncate">Waiting for you: {approvalTitleShort(current.title)}</span>
          {!drive.driving && <><span aria-hidden className="text-screen-ink-2">·</span><span className="font-medium">Show</span><CaretUpIcon size={12} weight="bold" aria-hidden /></>}
        </button>
      ) : (
        <div ref={card} className="pointer-events-auto flex max-h-full w-full max-w-[600px] flex-col">
          <div className="mb-1.5 flex shrink-0 justify-end gap-1.5">
            {queue.length > 1 && <span className={cx(chip, "cursor-default")}>{queue.length - 1} more waiting</span>}
            <button type="button" className={chip} onClick={() => onOpenChange(false)} aria-label="Hide the approval to see the whole screen">
              Hide<CaretDownIcon size={12} weight="bold" aria-hidden />
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto rounded-unit shadow-float">
            <ApprovalCard key={current.id} approval={{ ...current, shot: undefined }} agentName={agent.name} pubkey={agent.agentPubkey}
              onAnswer={(ok: boolean, reason?: string) => answer(current, ok, reason)}
              onTakeOver={() => drive.takeOver()} task={a.status?.task?.prompt} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Above the message box while an approval waits: one line that takes you to it (the card itself is on the screen). */
function WaitingLink({ agent, queue, onShow }: { agent: Agent; queue: Approval[]; onShow: () => void }) {
  return (
    <button type="button" onClick={onShow} className="pressable mb-2 flex w-full items-center gap-2 rounded-control border border-signal/45 bg-signal-wash px-2.5 py-1.5 text-left text-small text-ink">
      <Lamp status="needs" size={9} />
      <span className="min-w-0 flex-1 truncate">
        {agent.name} is waiting for you: {approvalTitleShort(queue[0].title)}{queue.length > 1 ? ` (+${queue.length - 1})` : ""}
      </span>
      <span className="shrink-0 font-medium text-signal-ink">Answer on the screen</span>
    </button>
  );
}

/** Stacked layouts: every pending approval as a card at the top, plus the echo of ones decided in the last few seconds. */
function ApprovalStack({ agent, a, queue, recent, answer, phone }: { agent: Agent; a: AgentData; queue: Approval[]; recent: AgentData["resolved"]; answer: Shared["answer"]; phone?: boolean }) {
  if (!queue.length && !recent.length) return null;
  return (
    <div className={cx("space-y-2", phone && BIG_TARGETS)}>
      {queue.map((ap) => (
        <ApprovalCard key={ap.id} approval={ap} agentName={agent.name} pubkey={agent.agentPubkey} compact={phone} className="w-full"
          task={a.status?.task?.prompt} pageUrl={a.status?.url}
          onAnswer={(ok: boolean, reason?: string) => answer(ap, ok, reason)} />
      ))}
      {recent.map((r) => (
        <ApprovalCard key={`r-${r.id}`} approval={r} agentName={agent.name} pubkey={agent.agentPubkey} compact className="w-full" resolved={{ ok: r.ok, by: r.by, at: r.at }} onAnswer={() => {}} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- stacked (phone, small windows, 200 % zoom)

/** 44 px touch targets for the small buttons inside shared cards (approvals, pairing) on the phone. */
const BIG_TARGETS = "[&_.rounded-control.h-7:not([aria-label])]:h-11 [&_.rounded-control.h-7:not([aria-label])]:px-4 [&_.rounded-control.h-7:not([aria-label])]:text-body";

function StackedLayout({ agent, a, drive, now, stop, onSettings, settings, wide, dests, onBack, onBeam, standalone, onPhone, activity, queue, answer, blocked }: Shared & Chrome & {
  /** A small window (or 200 % zoom), not a phone: the screen starts open, the header keeps Bench / Beam / phone. */
  wide: boolean;
}) {
  const [screen, setScreen] = useState(wide);
  const screenId = useId();
  const recent = useRecentDecisions(a, 8000);
  const pending = queue.length > 0 || recent.length > 0;
  // Taking over opens the screen.
  useEffect(() => { if (drive.driving) setScreen(true); }, [drive.driving]);
  const big = "h-11 px-4 text-body";
  const safety = safetySummary(a, agent);
  const chrome = wide && !standalone;
  return (
    <div className="min-h-dvh bg-bg pb-[calc(env(safe-area-inset-bottom)+84px)] [scroll-padding-bottom:96px]">
      <header className={cx("flex min-h-14 items-center gap-2.5 border-b border-line bg-surface py-1.5 pr-1.5", chrome ? "pl-2" : "pl-4")}>
        {chrome && <IconButton label="Back to the bench" icon={CaretLeftIcon} onClick={onBack} className="size-11" />}
        <Plate pubkey={agent.agentPubkey} name={agent.name} size="sm" />
        <h1 className="min-w-[6ch] truncate text-ui-lg text-ink">{agent.name}</h1>
        <StatusBadge status={now.status} label={now.word} emphasis size="sm" />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {wide && safety && (
            <IconButton label={safety.text} icon={safety.todo ? ShieldWarningIcon : ShieldCheckIcon} onClick={() => onSettings("safety")}
              className={cx("size-11", safety.todo && "text-signal-ink")} />
          )}
          {chrome && <BeamMenu agent={agent} dests={dests} onBeam={onBeam} onFile={() => onBeam("file")} />}
          {chrome && <IconButton label={`Open ${agent.name} on your phone`} icon={DeviceMobileIcon} onClick={onPhone} className="size-11" />}
          <IconButton label="Settings" icon={GearIcon} onClick={() => onSettings()} className="size-11" />
        </div>
      </header>

      <main className={cx(wide && "mx-auto max-w-[760px]")}>
        {pending && (
          <section aria-labelledby="phone-wait" className="border-b border-line bg-signal-wash/60 px-4 py-3">
            <h2 id="phone-wait" className="mb-2 flex items-center gap-1.5 text-body font-semibold text-signal-ink"><Lamp status="needs" size={10} />Waiting for you</h2>
            <ApprovalStack agent={agent} a={a} queue={queue} recent={recent} answer={answer} phone={!wide} />
          </section>
        )}

        <section aria-label="Now" className="px-4 pt-4">
          {queue.length > 0 ? <p className="text-body text-ink-2">{agent.name} is waiting for your answer above.</p> : <Headline now={now} a={a} agent={agent} phone onFix={onSettings} />}
          <Readout label={`${agent.name} now`} items={now.readout} className="mt-2" />
        </section>

        <section aria-label={`${agent.name}'s screen`} className="px-4 pt-3">
          <button type="button" aria-expanded={screen} aria-controls={screenId} onClick={() => setScreen(!screen)}
            className={cx("pressable flex min-h-11 w-full items-center gap-3 rounded-unit border border-line bg-surface p-1.5 pr-3 text-left", screen && "pl-3.5")}>
            {!screen && (
              <span className="relative block aspect-[16/10] w-[72px] shrink-0 overflow-hidden rounded-[6px] bg-screen">
                {a.frame && <img src={a.frame} alt="" className="h-full w-full object-cover" />}
              </span>
            )}
            <span className="min-w-0 flex-1 text-body font-medium text-ink">{screen ? "Hide the screen" : "Show the screen"}</span>
            <CaretDownIcon size={16} weight="bold" aria-hidden className={cx("text-ink-2 transition-transform duration-(--dur-pop)", screen && "rotate-180")} />
          </button>
          <div id={screenId} hidden={!screen} className="pt-2">
            {screen && <>
              <AgentScreen agent={agent} a={a} drive={drive} headline={now.headline} compact={!wide} barActions={false} />
              <div className="mt-2 flex flex-wrap gap-2">
                {drive.driving
                  ? <Button ref={drive.giveBackRef} variant="signal" className={big} onClick={drive.giveBack}>Give back to {agent.name}</Button>
                  : <Button ref={drive.takeOverRef} variant="signal" className={big} onClick={() => drive.takeOver({ capture: wide })} disabled={!a.connected}>Take over</Button>}
                {!drive.driving && <Button icon={a.paused ? PlayIcon : PauseIcon} className={big} onClick={drive.togglePause}>{a.paused ? "Resume" : "Pause"}</Button>}
                {now.working && <Button variant="danger" icon={StopIcon} className={big} onClick={stop}>Stop</Button>}
              </div>
            </>}
          </div>
        </section>

        <section aria-labelledby="phone-conv" className="mt-4 border-t border-line bg-surface">
          <h2 id="phone-conv" className="sr-only">Conversation with {agent.name}</h2>
          <div className={BIG_TARGETS}><PairingCard agent={agent} a={a} /></div>
          <ChatLog agent={agent} a={a} inline blocked={!!blocked} />
        </section>

        {wide && <Activity items={activity} limit={4} className="border-t border-line px-4 pb-4 pt-4" />}
      </main>

      <section aria-label={`Write to ${agent.name}`} className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2.5 shadow-float">
        <Composer agent={agent} a={a} size="lg" blocked={blocked} className={cx(wide && "mx-auto max-w-[760px]")} />
      </section>
      {settings}
    </div>
  );
}

// ---------------------------------------------------------------- pairing

function PairingCard({ agent, a }: { agent: Agent; a: AgentData }) {
  const code = a.pairing?.code;
  if (!code) return null;
  const open = Object.entries(a.pairing?.channels ?? {}).filter(([, v]) => !v.owner);
  if (!open.length) return null;
  const tg = a.pairing?.channels?.telegram;
  const names: Record<string, string> = { telegram: "Telegram", slack: "Slack", discord: "Discord" };
  return (
    <div className="m-3 mb-0 rounded-unit border border-line bg-surface-2 p-3">
      <h3 className="text-body font-semibold text-ink">Get {agent.name}'s questions on your phone</h3>
      <p className="mt-1 text-small text-ink-2">
        Send <code className="rounded-[4px] border border-line bg-surface px-1 py-px font-mono text-[11.5px] text-ink">/pair {code}</code> to {agent.name} on{" "}
        {open.map(([k, v], i) => (
          <span key={k}>{i ? (i === open.length - 1 ? " or " : ", ") : ""}{names[k] ?? k}{v.bot ? ` (@${v.bot})` : ""}</span>
        ))}. Then only you can approve things there; anyone in the chat can still talk to it.
      </p>
      {tg?.bot && !tg.owner && <TelegramPairQr bot={tg.bot} code={code} />}
    </div>
  );
}

function qrSvg(text: string) {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

/** One tap (or one scan) pairs Telegram: t.me deep links deliver "/start <code>" to the bot. */
export function TelegramPairQr({ bot, code }: { bot: string; code: string }) {
  const [show, setShow] = useState(false);
  const id = useId();
  const link = `https://t.me/${bot}?start=${code}`;
  const svg = useMemo(() => qrSvg(link), [link]);
  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap gap-2">
        <a href={link} target="_blank" rel="noreferrer"
          className="pressable inline-flex h-7 items-center gap-1.5 rounded-control border border-ink bg-ink px-2.5 text-small font-medium text-surface no-underline hover:bg-ink/88">
          <TelegramLogoIcon size={14} weight="bold" aria-hidden />Pair in Telegram
        </a>
        <Button size="sm" icon={QrCodeIcon} aria-expanded={show} aria-controls={id} onClick={() => setShow(!show)}>{show ? "Hide QR code" : "Scan with your phone"}</Button>
      </div>
      <div id={id} hidden={!show}>
        {show && (
          <div className="mt-2.5 flex items-center gap-3">
            <div className="w-32 shrink-0 overflow-hidden rounded-control border border-line" role="img" aria-label={`QR code that opens @${bot} in Telegram and pairs it`} dangerouslySetInnerHTML={{ __html: svg }} />
            <p className="text-small text-ink-2">Point your phone's camera at it. Telegram opens @{bot}; tap Start.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- phone link

/**
 * "Open on your phone". A QR code only when a phone can actually open the link. When it can't (the agent runs on this
 * computer and the phone can't reach it), say why in one sentence and offer what does work: beam it to a cloud, or
 * answer from a paired chat app.
 */
export function PhoneLink({ phone, agent, dests = [], name, onClose, onBeam, onPair }: {
  phone: { url: string; reachable?: boolean; why?: string; local?: boolean }; agent?: Agent; dests?: Destination[]; name: string; onClose: () => void;
  onBeam?: (to: string) => void; onPair?: () => void;
}) {
  const reachable = phone.reachable ?? !phone.local;
  const svg = useMemo(() => (reachable ? qrSvg(phone.url) : ""), [phone.url, reachable]);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(t); }, [copied]);
  const clouds = dests.filter((d) => d.id !== agent?.current.driver);
  if (!reachable) {
    return (
      <Dialog open onClose={onClose} size="sm" title={`Open ${name} on your phone`}
        description={phone.why ?? `Your phone can't reach this computer directly, so a link or QR code wouldn't open.`}
        footer={<>
          {onPair && <Button onClick={onPair}>Pair a chat app</Button>}
          {agent && onBeam && clouds.length > 0
            ? <BeamMenu agent={agent} dests={dests} onBeam={onBeam} onFile={() => onBeam("file")} size="md" side="top"
                trigger={<Button variant="primary">Beam to a cloud…</Button>} />
            : <Button variant="primary" onClick={onClose}>Done</Button>}
        </>}>
        <ul className="space-y-2.5 text-body text-ink">
          <li className="flex gap-2.5">
            <CloudArrowUpIcon size={18} aria-hidden className="mt-px shrink-0 text-ink-2" />
            <p><span className="font-medium">Beam {name} to a cloud.</span> <span className="text-ink-2">It keeps working when this computer is off, and the phone link works anywhere.</span></p>
          </li>
          <li className="flex gap-2.5">
            <ChatCircleTextIcon size={18} aria-hidden className="mt-px shrink-0 text-ink-2" />
            <p><span className="font-medium">Or pair a chat app.</span> <span className="text-ink-2">Answer {name}'s questions from Telegram, Slack or Discord on your phone.</span></p>
          </li>
        </ul>
      </Dialog>
    );
  }
  return (
    <Dialog open onClose={onClose} size="sm" title={`Open ${name} on your phone`}
      description={`Scan within 15 minutes. The link signs you in to ${name} only.${phone.local ? " Your phone must be on the same Wi-Fi as this computer." : ""}`}
      footer={<>
        <Button icon={copied ? CheckIcon : CopyIcon} onClick={async () => { await navigator.clipboard?.writeText(phone.url).catch(() => {}); setCopied(true); announce("Link copied"); }}>{copied ? "Copied" : "Copy link"}</Button>
        <Button variant="primary" onClick={onClose}>Done</Button>
      </>}>
      <div className="mx-auto w-52 overflow-hidden rounded-unit border border-line bg-[white]" role="img" aria-label={`QR code with a sign-in link for ${name}`} dangerouslySetInnerHTML={{ __html: svg }} />
    </Dialog>
  );
}
