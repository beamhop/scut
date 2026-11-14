import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CaretDownIcon, CaretLeftIcon, ChatsIcon, CheckIcon, CopyIcon, CornersInIcon, CornersOutIcon, DeviceMobileIcon, GearIcon, MagnifyingGlassPlusIcon,
  PauseIcon, PlayIcon, QrCodeIcon, ShieldCheckIcon, ShieldWarningIcon, StopIcon, TelegramLogoIcon, WarningIcon,
} from "@phosphor-icons/react";
import qrcode from "qrcode-generator";
import type { Agent, Destination } from "./lib.tsx";
import { useAgent } from "./useAgent.ts";
import { BeamMenu, placeIcon, placeLabel } from "./beam.tsx";
import { SettingsPanel, safetySummary, type SettingsSection } from "./settings.tsx";
import { ApprovalCard } from "./ui/ApprovalCard.tsx";
import { Activity, buildActivity, useActivityAnnouncements } from "./agent-activity.tsx";
import { ChatLog, Composer } from "./agent-chat.tsx";
import { AgentScreen, useDrive, type Drive } from "./agent-screen.tsx";
import { useAgentNow, type AgentData } from "./agent-status.ts";
import { Button, Dialog, Drawer, IconButton, Lamp, Plate, Readout, StatusBadge, announce, cx, useCommands, useHotkeys } from "./ui/index.ts";

/**
 * Agent view (DESIGN-PLAN §4.4) and the phone layout (§4.6).
 * Desktop: conversation on the left (resizable), the agent's screen on the right with the status sentence above it, a
 * control bar + readout under it and the activity timeline below. Settings open in a drawer over the screen side only.
 * Phone (≤ 700 px, also the standalone page from the phone link): what needs you first, then status, a collapsible
 * screen, the conversation, and a floating composer at the bottom.
 */

const PHONE = "(max-width: 700px)";
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

export function AgentView({ agent, dests, onBack, onBeam, standalone = false }: { agent: Agent; dests: Destination[]; onBack: () => void; onBeam: (to: string) => void; standalone?: boolean }) {
  const phone = useMedia(PHONE);
  // On a phone-sized screen the full 1280 px stream is wasted bandwidth; the small one is plenty.
  const [small] = useState(() => typeof matchMedia === "function" && matchMedia(PHONE).matches);
  const a = useAgent(agent, true, small ? 4 : 8, small);
  const drive = useDrive(a, agent.name);
  const now = useAgentNow(a, agent, drive.driving);
  const [settings, setSettings] = useState<{ section?: SettingsSection } | null>(null);
  const [phoneLink, setPhoneLink] = useState<{ url: string; local: boolean } | null>(null);
  const activity = useMemo(() => buildActivity(a.narration, a.resolved), [a.narration, a.resolved]);
  useActivityAnnouncements(agent.name, agent.id, activity, a.approvals, phone ? "It's at the top of the page." : "It's above the message box.");

  useEffect(() => {
    const prev = document.title;
    document.title = `${a.approvals.length ? `(${a.approvals.length}) ` : ""}${agent.name} · Beamhop`;
    return () => { document.title = prev; };
  }, [agent.name, a.approvals.length]);

  const openPhone = useCallback(async () => {
    const r = await fetch(`/api/agents/${agent.id}/phone`).then((r) => r.json()).catch(() => null);
    if (r?.url) setPhoneLink(r);
  }, [agent.id]);
  const stop = useCallback(() => { a.send({ t: "stop" }); announce(`Stopping ${agent.name}.`); }, [a.send, agent.name]);

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

  const shared = { agent, a, drive, now, stop, onSettings: (section?: SettingsSection) => setSettings({ section }) };
  return (
    <>
      {phone
        ? <PhoneLayout {...shared} settings={settingsDrawer("fixed")} />
        : <DesktopLayout {...shared} dests={dests} onBack={onBack} onBeam={onBeam} standalone={standalone} onPhone={openPhone} activity={activity} settings={settingsDrawer("contained")} />}
      {phoneLink && <PhoneLink phone={phoneLink} name={agent.name} onClose={() => setPhoneLink(null)} />}
    </>
  );
}

type Shared = { agent: Agent; a: AgentData; drive: Drive; now: ReturnType<typeof useAgentNow>; stop: () => void; onSettings: (section?: SettingsSection) => void; settings: ReactNode };

// ---------------------------------------------------------------- desktop

const WIDTH_KEY = "beamhop.chatWidth";
const MIN_CHAT = 360;
const MIN_SCREEN = 480;

function DesktopLayout({ agent, a, drive, now, stop, onSettings, settings, dests, onBack, onBeam, standalone, onPhone, activity }: Shared & {
  dests: Destination[]; onBack: () => void; onBeam: (to: string) => void; standalone: boolean; onPhone: () => void; activity: ReturnType<typeof buildActivity>;
}) {
  const main = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(() => Number(localStorage.getItem(WIDTH_KEY)) || 420);
  const [focus, setFocus] = useState(false);
  const [actual, setActual] = useState(false);
  const [unread, setUnread] = useState(0);
  const chatLen = useRef(a.chat.length);
  useEffect(() => {
    const added = a.chat.slice(chatLen.current).filter((m) => m.from === "agent").length;
    chatLen.current = a.chat.length;
    if (focus && added) setUnread((n) => n + added);
  }, [a.chat.length]);
  useEffect(() => { if (!focus) setUnread(0); }, [focus]);
  useEffect(() => { localStorage.setItem(WIDTH_KEY, String(width)); }, [width]);

  const maxWidth = () => Math.max(MIN_CHAT, (main.current?.clientWidth ?? 1200) - MIN_SCREEN);
  const clamp = (w: number) => Math.round(Math.min(maxWidth(), Math.max(MIN_CHAT, w)));
  const toggleFocus = () => { setFocus((f) => !f); announce(focus ? "Conversation shown" : "Focus screen: the conversation is folded away. Press Escape to bring it back."); };

  useCommands([
    { id: "agent.focus", title: focus ? "Show the conversation" : "Focus screen", synonyms: ["zoom", "fullscreen", "big screen"], shortcut: "f", group: agent.name, run: toggleFocus },
    { id: "agent.actual", title: actual ? "Fit the screen to the window" : "Show the screen at actual size", synonyms: ["1:1", "zoom", "fit"], group: agent.name, run: () => setActual((x) => !x) },
  ], [focus, actual, agent.name]);
  useHotkeys({ escape: () => { if (!focus) return false; toggleFocus(); } }, { enabled: focus });

  const where = placeLabel(dests, agent.current.driver);
  const Place = placeIcon(dests.find((d) => d.id === agent.current.driver) ?? { id: agent.current.driver, monthlyUsd: 0 });
  const safety = safetySummary(a, agent);
  const pending = a.approvals;

  const approvals = (
    <ApprovalStack agent={agent} a={a} drive={drive} />
  );

  return (
    <div className="flex h-dvh min-h-[560px] flex-col bg-bg">
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-surface pl-2 pr-3">
        {!standalone && (
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-small text-ink-2">
            <Button variant="quiet" size="sm" icon={CaretLeftIcon} onClick={onBack} className="-mr-0.5 text-ink-2 hover:text-ink">Bench</Button>
            <span aria-hidden className="text-ink-3">/</span>
            <span className="flex min-w-0 items-center gap-1.5 px-1.5"><Place size={14} aria-hidden className="shrink-0" /><span className="truncate">{where}</span></span>
            <span aria-hidden className="text-ink-3">/</span>
          </nav>
        )}
        <div className="flex min-w-0 items-center gap-2 pl-1.5">
          <Plate pubkey={agent.agentPubkey} name={agent.name} size="sm" />
          <h1 className="truncate text-ui-lg text-ink">{agent.name}</h1>
        </div>
        <StatusBadge status={now.status} label={now.word} emphasis size="sm" className="ml-1.5" />
        <div className="ml-auto flex items-center gap-1.5">
          {safety && (
            <Button variant="quiet" size="sm" icon={safety.todo ? ShieldWarningIcon : ShieldCheckIcon} onClick={() => onSettings("safety")}
              className={cx(safety.todo ? "text-signal-ink" : "text-ink-2 hover:text-ink")} title="Open safety settings">
              <span className="max-xl:sr-only">{safety.text}</span>
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
              <ChatLog agent={agent} a={a} />
              <Composer agent={agent} a={a} className="border-t border-line px-3 pb-2 pt-3" above={approvals} />
            </section>
            <Splitter width={width} min={MIN_CHAT} max={maxWidth} onChange={(w) => setWidth(clamp(w))} />
          </>
        )}

        <div className="relative min-w-0 flex-1">
          <div className="h-full overflow-y-auto">
            <div className="mx-auto flex w-full flex-col gap-3 px-6 pb-10 pt-5" style={{ maxWidth: `max(${MIN_SCREEN + 48}px, min(100%, calc((100dvh - 320px) * 1.6 + 60px)))` }}>
              {focus && pending.length > 0 && <div className="space-y-2">{approvals}</div>}
              <Headline now={now} a={a} />
              <AgentScreen agent={agent} a={a} drive={drive} headline={now.headline} actual={actual} />
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

function Headline({ now, a, phone }: { now: ReturnType<typeof useAgentNow>; a: AgentData; phone?: boolean }) {
  const needs = now.needs;
  return (
    <div className={cx(!phone && "min-h-[48px]")}>
      <p className={cx("flex items-start gap-2 [overflow-wrap:anywhere]", phone ? "text-ui-lg" : "text-h3", needs ? "text-signal-ink" : "text-ink")}>
        {needs && <Lamp status="needs" size={phone ? 10 : 12} className={phone ? "mt-[5px]" : "mt-1.5"} />}
        <span className="line-clamp-2">{now.headline}</span>
      </p>
      {now.meta.length > 0 && <p className="mt-0.5 truncate text-small text-ink-2">{now.meta.join(" · ")}</p>}
      {!a.connected && a.state !== "starting" && <p className="mt-0.5 text-small text-ink-2">Reconnecting…</p>}
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

/** This agent's pending approvals, plus the echo of ones decided in the last few seconds. */
function ApprovalStack({ agent, a, drive, phone }: { agent: Agent; a: AgentData; drive: Drive; phone?: boolean }) {
  const [, tick] = useState(0);
  const recent = a.resolved.filter((r) => Date.now() - r.at < 8000);
  useEffect(() => {
    if (!recent.length) return;
    const t = setTimeout(() => tick((x) => x + 1), 8000);
    return () => clearTimeout(t);
  }, [a.resolved.length]);
  if (!a.approvals.length && !recent.length) return null;
  return (
    <div className={cx("space-y-2", phone ? BIG_TARGETS : "mb-3 max-h-[55vh] overflow-y-auto")}>
      {a.approvals.map((ap) => (
        <ApprovalCard key={ap.id} approval={ap} agentName={agent.name} pubkey={agent.agentPubkey} compact={phone} className={phone ? "w-full" : undefined}
          onAnswer={(ok) => a.send({ t: "approval", id: ap.id, ok })}
          onTakeOver={drive.driving || phone ? undefined : () => drive.takeOver()} />
      ))}
      {recent.map((r) => (
        <ApprovalCard key={`r-${r.id}`} approval={r} agentName={agent.name} pubkey={agent.agentPubkey} compact className="w-full" resolved={{ ok: r.ok, by: r.by, at: r.at }} onAnswer={() => {}} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- phone

/** 44 px touch targets for the small buttons inside shared cards (approvals, pairing) on the phone. */
const BIG_TARGETS = "[&_.rounded-control.h-7:not([aria-label])]:h-11 [&_.rounded-control.h-7:not([aria-label])]:px-4 [&_.rounded-control.h-7:not([aria-label])]:text-body";

function PhoneLayout({ agent, a, drive, now, stop, onSettings, settings }: Shared) {
  const [screen, setScreen] = useState(false);
  const screenId = useId();
  const pending = a.approvals.length > 0;
  // Taking over opens the screen.
  useEffect(() => { if (drive.driving) setScreen(true); }, [drive.driving]);
  const big = "h-11 px-4 text-body";
  return (
    <div className="min-h-dvh bg-bg pb-[calc(env(safe-area-inset-bottom)+84px)] [scroll-padding-bottom:96px]">
      <header className="flex min-h-14 items-center gap-2.5 border-b border-line bg-surface py-1.5 pl-4 pr-1.5">
        <Plate pubkey={agent.agentPubkey} name={agent.name} size="sm" />
        <h1 className="min-w-0 truncate text-ui-lg text-ink">{agent.name}</h1>
        <StatusBadge status={now.status} label={now.word} emphasis size="sm" />
        <IconButton label="Settings" icon={GearIcon} onClick={() => onSettings()} className="ml-auto size-11" />
      </header>

      <main>
        {pending && (
          <section aria-labelledby="phone-wait" className="border-b border-line bg-signal-wash/60 px-4 py-3">
            <h2 id="phone-wait" className="mb-2 flex items-center gap-1.5 text-body font-semibold text-signal-ink"><Lamp status="needs" size={10} />Waiting for you</h2>
            <ApprovalStack agent={agent} a={a} drive={drive} phone />
          </section>
        )}

        <section aria-label="Now" className="px-4 pt-4">
          {pending ? <p className="text-body text-ink-2">{agent.name} is waiting for your answer above.</p> : <Headline now={now} a={a} phone />}
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
              <AgentScreen agent={agent} a={a} drive={drive} headline={now.headline} compact barActions={false} />
              <div className="mt-2 flex flex-wrap gap-2">
                {drive.driving
                  ? <Button variant="signal" className={big} onClick={drive.giveBack}>Give back to {agent.name}</Button>
                  : <Button variant="signal" className={big} onClick={() => drive.takeOver({ capture: false })} disabled={!a.connected}>Take over</Button>}
                {!drive.driving && <Button icon={a.paused ? PlayIcon : PauseIcon} className={big} onClick={drive.togglePause}>{a.paused ? "Resume" : "Pause"}</Button>}
                {now.working && <Button variant="danger" icon={StopIcon} className={big} onClick={stop}>Stop</Button>}
              </div>
            </>}
          </div>
        </section>

        <section aria-labelledby="phone-conv" className="mt-4 border-t border-line bg-surface">
          <h2 id="phone-conv" className="sr-only">Conversation with {agent.name}</h2>
          <div className={BIG_TARGETS}><PairingCard agent={agent} a={a} /></div>
          <ChatLog agent={agent} a={a} inline />
        </section>
      </main>

      <section aria-label={`Write to ${agent.name}`} className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2.5 shadow-float">
        <Composer agent={agent} a={a} size="lg" />
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

export function PhoneLink({ phone, name, onClose }: { phone: { url: string; local: boolean }; name: string; onClose: () => void }) {
  const svg = useMemo(() => qrSvg(phone.url), [phone.url]);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(t); }, [copied]);
  return (
    <Dialog open onClose={onClose} size="sm" title={`Open ${name} on your phone`}
      description={phone.local ? undefined : "Scan within 15 minutes. The link signs you in to this one agent only."}
      footer={<>
        <Button icon={copied ? CheckIcon : CopyIcon} onClick={async () => { await navigator.clipboard?.writeText(phone.url).catch(() => {}); setCopied(true); announce("Link copied"); }}>{copied ? "Copied" : "Copy link"}</Button>
        <Button variant="primary" onClick={onClose}>Done</Button>
      </>}>
      {phone.local && (
        <p className="mb-3 flex gap-2 rounded-control border border-line bg-surface-2 px-3 py-2 text-small text-ink">
          <WarningIcon size={16} weight="fill" aria-hidden className="mt-px shrink-0 text-warn" />
          <span>{name} runs on this computer, so the link only works on this computer's network. Beam {name} to a cloud to reach it from anywhere.</span>
        </p>
      )}
      <div className="mx-auto w-52 overflow-hidden rounded-unit border border-line" role="img" aria-label={`QR code with a sign-in link for ${name}`} dangerouslySetInnerHTML={{ __html: svg }} />
    </Dialog>
  );
}
