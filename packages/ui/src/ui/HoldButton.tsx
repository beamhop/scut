import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Icon } from "@phosphor-icons/react";
import { cx } from "./cx.ts";
import { announce } from "./announcer.tsx";

export type HoldButtonProps = {
  /** Called once the hold completes. */
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
  tone?: "signal" | "primary" | "danger";
  size?: "sm" | "md";
  icon?: Icon;
  disabled?: boolean;
  className?: string;
  /** Extra accessible description, e.g. the risk: "High risk: sends money". */
  "aria-describedby"?: string;
};

const TONE = {
  signal: { base: "bg-signal-wash text-signal-ink border-signal", fill: "bg-signal", done: "text-on-signal" },
  primary: { base: "bg-surface text-ink border-ink", fill: "bg-ink", done: "text-surface" },
  danger: { base: "bg-surface text-err border-err", fill: "bg-err", done: "text-surface" },
};

/**
 * Hold-to-confirm for high-risk approvals. Pointer: press and hold. Keyboard: hold Space or Enter. The fill is a
 * linear 700 ms progress; releasing early rewinds it over 200 ms. Never autofocus this button.
 */
export function HoldButton({ onConfirm, children, holdingLabel = "Keep holding…", duration = 700, armDelay = 600, confirmedMessage, tone = "signal", size = "md", icon: I, disabled, className, ...rest }: HoldButtonProps) {
  const [armed, setArmed] = useState(armDelay <= 0);
  const [holding, setHolding] = useState(false);
  const [done, setDone] = useState(false);
  const fill = useRef<HTMLSpanElement>(null);
  const raf = useRef(0);
  const start = useRef(0);
  const cb = useRef(onConfirm);
  cb.current = onConfirm;

  useEffect(() => {
    if (armDelay <= 0) return;
    const t = setTimeout(() => setArmed(true), armDelay);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const inert = disabled || !armed || done;
  const setP = (p: number, animate: boolean) => {
    const el = fill.current;
    if (!el) return;
    el.style.transition = animate ? "clip-path 200ms cubic-bezier(0.23, 1, 0.32, 1)" : "none";
    el.style.clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`;
  };
  const begin = () => {
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
  };

  const t = TONE[tone];
  return (
    <button
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
      onClick={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      className={cx(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden whitespace-nowrap rounded-control border font-medium [touch-action:none]",
        size === "sm" ? "h-7 gap-1.5 px-2.5 text-small" : "h-8 gap-2 px-3 text-body",
        t.base,
        inert && !done ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className,
      )}
    >
      {/* Two copies of the label: the filled copy is revealed left to right, so text contrast holds at every point. */}
      <span className="inline-flex items-center gap-[inherit]">
        {I && <I size={size === "sm" ? 14 : 16} weight="bold" aria-hidden />}
        {holding ? holdingLabel : children}
      </span>
      <span ref={fill} aria-hidden className={cx("absolute inset-0 inline-flex items-center justify-center gap-[inherit]", t.fill, t.done)} style={{ clipPath: done ? "inset(0 0 0 0)" : "inset(0 100% 0 0)" }}>
        {I && <I size={size === "sm" ? 14 : 16} weight="bold" aria-hidden />}
        {holding ? holdingLabel : children}
      </span>
    </button>
  );
}
