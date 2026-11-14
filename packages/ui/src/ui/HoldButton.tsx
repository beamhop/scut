import { useEffect, useRef, useState, type ReactNode } from "react";
import { FingerprintSimpleIcon, type Icon } from "@phosphor-icons/react";
import { cx } from "./cx.ts";
import { announce } from "./announcer.tsx";

export type HoldButtonProps = {
  /** Called once the hold completes (or the second step is confirmed). */
  onConfirm: () => void;
  /** Label at rest, e.g. "Hold to allow". */
  children: ReactNode;
  /** Label while holding (default "Keep holding…"). */
  holdingLabel?: ReactNode;
  /** Hold time in ms (default 700). */
  duration?: number;
  /** Inert for this long after mounting so a stray click or Enter can't confirm (default 600). */
  armDelay?: number;
  /** Announced when confirmed (default: none — the caller's own state change usually announces). */
  confirmedMessage?: string;
  /**
   * The second step for people who can't hold (screen readers, voice control, switch access, a quick tap): a short
   * question, a "Yes" button that is inert for 600 ms and never focused, and Cancel. Default "Are you sure?".
   */
  confirmPrompt?: ReactNode;
  /** Label of the "Yes" button in the second step (default "Yes, I'm sure"). E.g. "Yes, allow". */
  confirmLabel?: string;
  /** Spoken when the second step opens (default: `${confirmPrompt} Press ${confirmLabel} to confirm.`). */
  confirmAnnouncement?: string;
  tone?: "signal" | "primary" | "danger";
  size?: "sm" | "md";
  icon?: Icon;
  disabled?: boolean;
  className?: string;
  /** Extra accessible description, e.g. the risk: "High risk: sends money". */
  "aria-describedby"?: string;
};

const TONE = {
  signal: { base: "bg-surface text-signal-ink border-signal", fill: "bg-signal", done: "text-on-signal", yes: "bg-signal text-on-signal border-signal hover:bg-signal/88" },
  primary: { base: "bg-surface text-ink border-ink", fill: "bg-ink", done: "text-surface", yes: "bg-ink text-surface border-ink hover:bg-ink/88" },
  danger: { base: "bg-surface text-err border-err", fill: "bg-err", done: "text-surface", yes: "bg-err text-surface border-err hover:bg-err/88" },
};
/** A press shorter than this is a tap, not an attempt to hold: it opens the second step instead. */
const TAP_MS = 250;

/**
 * Hold-to-confirm for high-risk approvals. Pointer: press and hold. Keyboard: hold Space or Enter. The fill is a
 * linear 700 ms progress; releasing early rewinds it over 200 ms. Never autofocus this button.
 *
 * Holding is the fast path, never the only one: a plain click (what VoiceOver, NVDA, Dragon/Voice Control and switch
 * access send) or a quick tap morphs the button in place into "Are you sure? [Yes] [Cancel]", where Yes is inert for
 * 600 ms (WCAG 2.1.1, 4.1.2).
 */
export function HoldButton({
  onConfirm, children, holdingLabel = "Keep holding…", duration = 700, armDelay = 600, confirmedMessage,
  confirmPrompt = "Are you sure?", confirmLabel = "Yes, I'm sure", confirmAnnouncement,
  tone = "signal", size = "md", icon: I, disabled, className, ...rest
}: HoldButtonProps) {
  const [armed, setArmed] = useState(armDelay <= 0);
  const [holding, setHolding] = useState(false);
  const [done, setDone] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [yesArmed, setYesArmed] = useState(false);
  const fill = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const group = useRef<HTMLSpanElement>(null);
  const raf = useRef(0);
  const start = useRef(0);
  const pressSeen = useRef(false);
  const backToButton = useRef(false);
  const cb = useRef(onConfirm);
  cb.current = onConfirm;

  useEffect(() => {
    if (armDelay <= 0) return;
    const t = setTimeout(() => setArmed(true), armDelay);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => {
    if (!confirming) { if (backToButton.current) { backToButton.current = false; btn.current?.focus(); } return; }
    setYesArmed(false);
    group.current?.focus();
    announce(confirmAnnouncement ?? `${typeof confirmPrompt === "string" ? confirmPrompt + " " : ""}Press ${confirmLabel} to confirm.`);
    const t = setTimeout(() => setYesArmed(true), 600);
    return () => clearTimeout(t);
  }, [confirming]);

  const inert = disabled || !armed || done;
  const setP = (p: number, animate: boolean) => {
    const el = fill.current;
    if (!el) return;
    el.style.transition = animate ? "clip-path 200ms cubic-bezier(0.23, 1, 0.32, 1)" : "none";
    el.style.clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`;
  };
  const begin = () => {
    pressSeen.current = true;
    if (inert || holding) return;
    setHolding(true);
    announce("Keep holding to confirm");
    start.current = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start.current) / duration);
      setP(p, false);
      if (p >= 1) {
        setHolding(false);
        setDone(true);
        if (confirmedMessage) announce(confirmedMessage);
        cb.current();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  const end = () => {
    if (!holding) return;
    cancelAnimationFrame(raf.current);
    setHolding(false);
    setP(0, true);
    if (performance.now() - start.current < TAP_MS) setConfirming(true);
  };
  const cancel = () => { backToButton.current = true; setConfirming(false); };
  const yes = () => {
    if (!yesArmed || done) return;
    setDone(true);
    setConfirming(false);
    if (confirmedMessage) announce(confirmedMessage);
    cb.current();
  };

  const t = TONE[tone];
  const h = size === "sm" ? "h-7 gap-1.5 px-2.5 text-small" : "h-8 gap-2 px-3 text-body";

  if (confirming) {
    return (
      <span ref={group} role="group" tabIndex={-1} aria-label={typeof confirmPrompt === "string" ? confirmPrompt : "Confirm"} aria-describedby={rest["aria-describedby"]}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); } }}
        className={cx("inline-flex flex-wrap items-center gap-1.5 rounded-control outline-offset-2 animate-pop", className)}>
        <span className={cx("font-medium text-signal-ink", size === "sm" ? "text-small" : "text-body")}>{confirmPrompt}</span>
        <button type="button" aria-disabled={!yesArmed || undefined} onClick={yes}
          className={cx("pressable inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-control border font-medium", h, t.yes, !yesArmed && "cursor-not-allowed opacity-50")}>
          {confirmLabel}
        </button>
        <button type="button" onClick={cancel}
          className={cx("pressable inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-control border border-line-strong bg-surface font-medium text-ink hover:bg-surface-2", h)}>
          Cancel
        </button>
      </span>
    );
  }

  // Default glyph: a fingertip, so the button reads as "press and keep pressing" (not as a disabled outline).
  const G = I ?? FingerprintSimpleIcon;
  const label = (
    <>
      <G size={size === "sm" ? 14 : 16} weight="bold" aria-hidden />
      {holding ? holdingLabel : children}
    </>
  );
  return (
    <button
      ref={btn}
      type="button"
      aria-disabled={inert || undefined}
      aria-describedby={rest["aria-describedby"]}
      onPointerDown={(e) => { if (e.button === 0) { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); begin(); } }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); begin(); } else if (e.key === " " || e.key === "Enter") e.preventDefault(); }}
      onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") end(); }}
      onBlur={end}
      onClick={(e) => {
        e.preventDefault();
        // A press we already handled (hold or tap). A click with no press before it is assistive technology.
        if (pressSeen.current) { pressSeen.current = false; return; }
        if (!inert) setConfirming(true);
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={cx(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden whitespace-nowrap rounded-control border font-medium [touch-action:none]",
        h,
        t.base,
        inert && !done ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className,
      )}
    >
      {/* Two copies of the label: the filled copy is revealed left to right, so text contrast holds at every point. */}
      <span className="inline-flex items-center gap-[inherit]">{label}</span>
      <span ref={fill} aria-hidden className={cx("absolute inset-0 inline-flex items-center justify-center gap-[inherit]", t.fill, t.done)} style={{ clipPath: done ? "inset(0 0 0 0)" : "inset(0 100% 0 0)" }}>
        {label}
      </span>
    </button>
  );
}
