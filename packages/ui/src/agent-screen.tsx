import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { EyeIcon, GlobeSimpleIcon, HandGrabbingIcon, LockSimpleIcon, PauseIcon, WarningIcon } from "@phosphor-icons/react";
import { KEYMAP, SCREEN, STAGE_LABEL, type Agent } from "./lib.tsx";
import type { AgentData } from "./agent-status.ts";
import { Bezel, Button, Kbd, ScreenNote, announce, callsign, cx } from "./ui/index.ts";

/**
 * The agent's screen. Watch-only by default (WCAG 2.1.2: focusing it never captures keys).
 *   watching  pointer and keys stay in Beamhop; a click shows "Watching — press Take over…"
 *   driving   after Take over (or Enter on the focused screen): the agent pauses, the bar turns signal, mouse and keys
 *             go to the agent's computer. Esc twice stops sending keys (focus goes to Give back); Give back resumes it.
 */

export type Drive = ReturnType<typeof useDrive>;

export function useDrive(a: AgentData, name: string) {
  const [driving, setDriving] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const screenRef = useRef<HTMLDivElement>(null);
  const giveBackRef = useRef<HTMLButtonElement>(null);
  const takeOverRef = useRef<HTMLButtonElement>(null);

  const takeOver = useCallback((o: { capture?: boolean } = {}) => {
    setDriving(true);
    a.send({ t: "pause", paused: true });
    if (o.capture !== false) {
      setCapturing(true);
      screenRef.current?.focus({ preventScroll: true });
      // From the palette: it closes and restores focus first, so take focus again a moment later.
      setTimeout(() => { if (document.activeElement !== screenRef.current) screenRef.current?.focus({ preventScroll: true }); }, 60);
    }
    announce(`You're driving ${name}'s computer. ${o.capture !== false ? "Keys go to it now. Press Escape twice to stop typing there." : "Press Enter on the screen to type there."}`);
  }, [a.send, name]);

  const giveBack = useCallback(() => {
    setDriving(false);
    setCapturing(false);
    a.send({ t: "pause", paused: false });
    announce(`${name} has control again.`);
    requestAnimationFrame(() => takeOverRef.current?.focus({ preventScroll: true }));
  }, [a.send, name]);

  const release = useCallback(() => {
    setCapturing(false);
    announce(`Keys are back in Beamhop. You still have control of ${name}'s computer: press Give back when you're done.`);
    giveBackRef.current?.focus({ preventScroll: true });
  }, [name]);

  const togglePause = useCallback(() => {
    const next = !a.paused;
    a.send({ t: "pause", paused: next });
    announce(next ? `${name} is paused. It waits before its next step.` : `${name} continues.`);
  }, [a.paused, a.send, name]);

  // Someone gave control back elsewhere (phone, another window): leave driving mode here too.
  useEffect(() => { if (!a.paused && driving) { setDriving(false); setCapturing(false); } }, [a.paused]);

  return { driving, capturing, setCapturing, takeOver, giveBack, release, togglePause, screenRef, giveBackRef, takeOverRef };
}

const ESC_WINDOW = 400;
/** Browser button (0 left, 1 middle, 2 right) to X11 numbering (1 left, 2 middle, 3 right). */
const BUTTONS: Record<number, number> = { 0: 1, 1: 2, 2: 3 };

/**
 * Where the agent's browser is, read from its address. The agent's browser runs without its own address bar, so the
 * bezel bar carries this instead: the site in medium weight (the part that matters for trust), then the path.
 */
export function readLocation(url?: string): { site: string; path: string; secure: boolean | "local"; full: string } | undefined {
  if (!url) return undefined;
  let u: URL;
  try { u = new URL(url); } catch { return undefined; }
  if (u.protocol === "about:") return { site: "Blank page", path: "", secure: "local", full: url };
  if (u.protocol === "chrome:" || u.protocol === "chrome-search:") return { site: "New tab", path: "", secure: "local", full: url };
  if (u.protocol === "file:") return { site: "A file", path: decodeURIComponent(u.pathname), secure: "local", full: url };
  const local = /^(127\.|localhost$|\[::1\]$|0\.0\.0\.0$)/.test(u.hostname);
  // agentd's own start page (127.0.0.1:8080/start?name=…) is not a website: never show its internal address.
  if (local && /^\/start\b/.test(u.pathname)) return { site: "Start page", path: "", secure: "local", full: "Start page" };
  const path = u.pathname === "/" ? "" : decodeURIComponent(u.pathname);
  return { site: local ? u.host : u.hostname.replace(/^www\./, ""), path, secure: local ? "local" : u.protocol === "https:", full: url };
}

function Location({ url, dim = true, className }: { url?: string; dim?: boolean; className?: string }) {
  const loc = readLocation(url);
  if (!loc) return null;
  const Icon = loc.secure === "local" ? GlobeSimpleIcon : loc.secure ? LockSimpleIcon : WarningIcon;
  return (
    <span className={cx("flex min-w-0 items-center gap-1.5", className)} title={loc.full}>
      <Icon size={14} weight={loc.secure === false ? "fill" : "bold"} aria-hidden className="shrink-0" />
      {loc.secure === false && <span className="shrink-0 font-medium">Not secure ·</span>}
      <span className="sr-only">On </span>
      <span className="shrink-0 font-medium">{loc.site}</span>
      {loc.path && <span aria-hidden className={cx("min-w-0 truncate", dim && "text-screen-ink-2")}>{loc.path}</span>}
    </span>
  );
}

export function AgentScreen({ agent, a, drive, headline, actual = false, compact = false, barActions = true, overlay, className }: {
  agent: Agent; a: AgentData; drive: Drive; headline: string; actual?: boolean; compact?: boolean;
  /** Put Take over / Give back in the screen's own bar (desktop). The phone shows 44 px buttons under the screen instead. */
  barActions?: boolean;
  /** Rises from the bezel's bottom edge over the screen (the approval sheet). Rendered outside the dark bezel scope. */
  overlay?: ReactNode;
  className?: string;
}) {
  const id = useId();
  const { driving, capturing } = drive;
  const img = useRef<HTMLImageElement>(null);
  const lastMove = useRef(0);
  const held = useRef(new Set<number>());
  const escAt = useRef(0);
  const escTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [nudge, setNudge] = useState(0);
  const beaming = !!agent.beam && !["online", "failed"].includes(agent.beam.stage);

  useEffect(() => {
    if (!nudge) return;
    const t = setTimeout(() => setNudge(0), 2600);
    return () => clearTimeout(t);
  }, [nudge]);
  useEffect(() => () => clearTimeout(escTimer.current), []);

  const pos = (e: { clientX: number; clientY: number }) => {
    const r = (img.current ?? drive.screenRef.current)!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(SCREEN.w, Math.round(((e.clientX - r.left) / r.width) * SCREEN.w))),
      y: Math.max(0, Math.min(SCREEN.h, Math.round(((e.clientY - r.top) / r.height) * SCREEN.h))),
    };
  };
  const send = a.send;
  const key = (keys: string) => send({ t: "input", kind: "key", keys });

  function onKeyDown(e: React.KeyboardEvent) {
    if (!driving) {
      // Watching: Enter or Space on the focused screen takes over. Everything else (Tab, arrows) behaves normally.
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); drive.takeOver(); }
      return;
    }
    if (!capturing) {
      if (e.key === "Enter") { e.preventDefault(); drive.setCapturing(true); announce("Keys go to the screen again. Escape twice to stop."); }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      // Esc twice (within 400 ms) leaves; a single Esc is sent to the agent's computer after the window.
      const now = Date.now();
      if (now - escAt.current < ESC_WINDOW) {
        clearTimeout(escTimer.current);
        escAt.current = 0;
        drive.release();
        return;
      }
      escAt.current = now;
      escTimer.current = setTimeout(() => key("Escape"), ESC_WINDOW);
      return;
    }
    const mods = [e.ctrlKey && "ctrl", e.altKey && "alt", e.metaKey && "super"].filter(Boolean) as string[];
    if (e.key.length === 1 && mods.length === 0) return send({ t: "input", kind: "type", text: e.key });
    const k = KEYMAP[e.key] ?? (e.key.length === 1 ? e.key.toLowerCase() : undefined);
    if (!k || ["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
    key([...mods, e.shiftKey && e.key.length > 1 ? "shift" : "", k].filter(Boolean).join("+"));
  }

  const screenName = `${agent.name}'s screen`;
  const hintId = `${id}-hint`;
  const hint = driving
    ? capturing ? "Keys and mouse go to the agent's computer. Press Esc twice to stop typing there." : "You have control. Press Enter on the screen to type there, or Give back when you're done."
    : "Watch only. Take over, or press Enter on the screen, to use it yourself.";

  const url = (a.status as { url?: string } | undefined)?.url;
  const where = readLocation(url) && !beaming;
  const bar = driving ? (
    <>
      <HandGrabbingIcon size={16} weight="bold" aria-hidden className="shrink-0" />
      <span className="shrink-0 font-medium">You're driving</span>
      {where ? <Location url={url} dim={false} className="flex-1 border-l border-on-signal/35 pl-2" /> : <span className="flex-1" />}
      {!compact && <span className="hidden shrink-0 items-center gap-1 text-micro xl:inline-flex" aria-hidden>{capturing ? <><Kbd>Esc</Kbd><Kbd>Esc</Kbd> stop typing</> : <><Kbd>Enter</Kbd> type here</>}</span>}
      {barActions && <Button ref={drive.giveBackRef} size="sm" variant="on-signal" onClick={drive.giveBack} className="shrink-0">Give back to {agent.name}</Button>}
    </>
  ) : (
    <>
      {where ? <>
        <Location url={url} className="flex-1 text-screen-ink" />
        <span className="flex shrink-0 items-center gap-1.5 text-micro text-screen-ink-2">
          {a.paused ? <PauseIcon size={13} weight="bold" aria-hidden /> : <EyeIcon size={13} aria-hidden />}
          <span className={cx(compact && "sr-only")}>{a.paused ? "Paused" : "Watch only"}</span>
        </span>
      </> : <>
        {a.paused ? <PauseIcon size={16} weight="bold" aria-hidden className="shrink-0 text-screen-ink-2" /> : <EyeIcon size={16} aria-hidden className="shrink-0 text-screen-ink-2" />}
        <span className="min-w-0 flex-1 truncate text-screen-ink-2">{a.paused ? `Paused · ${agent.name} is waiting` : "Watch only"}</span>
      </>}
      {barActions && <Button ref={drive.takeOverRef} size="sm" variant="signal" onClick={() => drive.takeOver()} disabled={beaming || !a.connected} aria-describedby={hintId} className="shrink-0">Take over</Button>}
    </>
  );

  const alt = `${screenName}: ${headline}`;
  return (
    <div className={cx("relative", className)}>
      <Bezel state={driving ? "driving" : "watching"} bar={bar} size={compact ? "sm" : "md"}>
        <div
          ref={drive.screenRef}
          tabIndex={0}
          role={driving && capturing ? "application" : "group"}
          aria-roledescription="remote screen"
          aria-label={driving ? `${screenName}, you're driving` : `${screenName}, watch only`}
          aria-describedby={hintId}
          onKeyDown={onKeyDown}
          onBlur={() => { if (capturing) drive.setCapturing(false); }}
          onMouseDown={(e) => {
            if (!driving) return;
            if (!capturing) drive.setCapturing(true);
            if (document.activeElement !== drive.screenRef.current) { drive.screenRef.current?.focus({ preventScroll: true }); }
            e.preventDefault();
          }}
          // The real press, moves and release of every button, so drags select text and move windows, double and
          // triple clicks count as such, and the middle button pastes. The pointer is captured while a button is down:
          // a release outside the screen still arrives.
          onPointerDown={(e) => {
            if (!driving || !e.isPrimary) return;
            const button = BUTTONS[e.button];
            if (!button) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            held.current.add(button);
            send({ t: "input", kind: "down", ...pos(e), button, count: e.detail || 1 });
          }}
          onPointerUp={(e) => {
            const button = BUTTONS[e.button];
            if (!button || !held.current.delete(button)) return;
            send({ t: "input", kind: "up", ...pos(e), button });
          }}
          onPointerCancel={() => {
            for (const button of held.current) send({ t: "input", kind: "up", button });
            held.current.clear();
          }}
          onClick={() => { if (!driving) setNudge(Date.now()); }}
          onAuxClick={(e) => driving && e.preventDefault()}
          onContextMenu={(e) => driving && e.preventDefault()}
          onWheel={(e) => driving && send({ t: "input", kind: "scroll", ...pos(e), dy: e.deltaY })}
          onPointerMove={(e) => {
            if (!driving) return;
            const dragging = held.current.size > 0;
            if (Date.now() - lastMove.current < (dragging ? 30 : 60)) return;
            lastMove.current = Date.now();
            if (dragging) send({ t: "input", kind: "move", ...pos(e) });
            send({ t: "cursor", ...pos(e) });
          }}
          className={cx(
            "peer absolute inset-0 cursor-default outline-none",
            actual ? "overflow-auto" : "overflow-hidden",
          )}
        >
          {a.frame ? (
            <img
              ref={img}
              src={a.frame}
              alt={alt}
              draggable={false}
              className={cx("block select-none", actual ? "max-w-none" : "h-full w-full object-contain")}
              style={actual ? { width: SCREEN.w, height: SCREEN.h } : undefined}
            />
          ) : (
            <ScreenNote>{beaming ? `${STAGE_LABEL[agent.beam!.stage] ?? "Moving"}…` : a.connected ? `Starting ${agent.name}'s screen…` : `Connecting to ${agent.name}…`}</ScreenNote>
          )}
          {a.frame && beaming && <div className="absolute inset-0 grid place-items-center bg-screen/80 text-small text-screen-ink">{STAGE_LABEL[agent.beam!.stage] ?? "Moving"}…</div>}
          {a.agentCursor && a.state === "busy" && !driving && !actual && <AgentCursor p={a.agentCursor} sign={callsign(agent.name, agent.agentPubkey)} />}
        </div>
        {/* Focus ring and "keys go here" ring, drawn inside on top of the image so the bezel never clips them. */}
        <span aria-hidden className={cx(
          "pointer-events-none absolute inset-0 rounded-[2px]",
          driving && capturing ? "shadow-[inset_0_0_0_3px_var(--color-signal)]" : "peer-focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)]",
        )} />
        {nudge > 0 && !driving && (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3">
            <span className="animate-pop rounded-control border border-screen-line bg-bezel px-3 py-1.5 text-small text-screen-ink shadow-float">
              Watching. Press <b className="font-semibold">Take over</b> to use {agent.name}'s computer.
            </span>
          </div>
        )}
      </Bezel>
      {overlay}
      <p id={hintId} className="sr-only">{hint}</p>
    </div>
  );
}

/** The agent's pointer, decorative. Screen ink with its callsign, never a brand colour. */
function AgentCursor({ p, sign }: { p: { x: number; y: number }; sign: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute transition-[left,top] duration-150 ease-(--ease-out)" style={{ left: `${(p.x / SCREEN.w) * 100}%`, top: `${(p.y / SCREEN.h) * 100}%` }}>
      <svg width="16" height="16" viewBox="0 0 16 16">
        <path d="M1 1 L1 13 L4.5 9.8 L7 15 L9 14 L6.6 9 L11.5 9 Z" className="fill-screen-ink stroke-screen" strokeWidth="1" />
      </svg>
      <span className="readout absolute left-3.5 top-3.5 rounded-[3px] bg-screen-ink px-1 text-[10px] leading-[14px] text-screen">{sign}</span>
    </div>
  );
}
