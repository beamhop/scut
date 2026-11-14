import type { ReactNode } from "react";
import { cx } from "./cx.ts";
import { Lamp, type Status } from "./status.tsx";

export type BezelProps = {
  /** Content of the thin top bar inside the frame: lamp, what it's doing, Take over. Omit for no bar. */
  bar?: ReactNode;
  /** "driving": the bar turns signal (the person has the keyboard and mouse). */
  state?: "watching" | "driving";
  /** CSS aspect ratio of the screen area. Default 16 / 10. */
  aspect?: string;
  /** Accessible name for the screen region, e.g. "Atlas's screen". */
  label?: string;
  size?: "sm" | "md";
  className?: string;
  /** The screen: an <img>, canvas, or an empty state. Fills the area. */
  children?: ReactNode;
};

/**
 * Near-black screen frame, identical in both themes, so every agent's computer is framed the same way.
 * Focus rings inside flip to light automatically (.on-screen). The outer hairline (ring-line) and the lit top edge keep the
 * frame visible in dark, where the bezel sits close to the card colour.
 */
export function Bezel({ bar, state = "watching", aspect = "16 / 10", label, size = "md", className, children }: BezelProps) {
  const driving = state === "driving";
  return (
    <div
      role={label ? "group" : undefined}
      aria-label={label}
      data-state={state}
      className={cx("on-screen bg-bezel shadow-[inset_0_1px_0_oklch(1_0_0/0.12),inset_0_0_0_1px_oklch(1_0_0/0.06)] ring-1 ring-line", size === "sm" ? "rounded-[10px] p-1" : "rounded-unit p-1.5", className)}
    >
      <div className={cx("overflow-hidden bg-screen", size === "sm" ? "rounded-[7px]" : "rounded-[8px]")}>
        {bar !== undefined && (
          <div className="relative overflow-hidden">
            <div
              key={state}
              className={cx(
                "flex items-center gap-2 border-b text-small",
                size === "sm" ? "h-7 px-2" : "h-9 px-2.5",
                driving ? "animate-bar-down border-signal bg-signal text-on-signal" : "border-screen-line text-screen-ink",
              )}
            >
              {bar}
            </div>
          </div>
        )}
        <div className="relative overflow-hidden text-screen-ink" style={{ aspectRatio: aspect }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Quiet empty-screen content for a bezel: one centred line in screen ink. */
export function ScreenNote({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 grid place-items-center px-6 text-center text-small text-screen-ink-2">{children}</div>;
}

export type ReadoutItem = {
  value: ReactNode;
  /** Shown after the value ("€0.03 today", "12 steps"). */
  label?: string;
  /** Spoken label when there is no visible one ("elapsed"). */
  srLabel?: string;
  /** Prefix the item with a status lamp. */
  status?: Status;
};

/**
 * LCD-style strip in Departure Mono: WORKING · 01:42 · €0.03 TODAY · 12 STEPS.
 * The only place uppercase is allowed. Numbers are tabular so they don't jitter while ticking.
 */
export function Readout({ items, label, on = "surface", className }: { items: ReadoutItem[]; label?: string; on?: "surface" | "screen"; className?: string }) {
  const screen = on === "screen";
  return (
    <dl
      aria-label={label}
      className={cx(
        "readout inline-flex h-7 max-w-full items-center gap-2 overflow-hidden whitespace-nowrap rounded-control px-2.5",
        screen ? "on-screen bg-screen text-screen-ink-2" : "border border-line bg-surface-2 text-ink-2",
        className,
      )}
    >
      {items.map((it, i) => (
        <div key={i} className="readout-item flex items-center gap-[0.6ch]">
          <dt className={cx("order-2", !it.label && "sr-only")}>{it.label ?? it.srLabel ?? ""}</dt>
          <dd className={cx("order-1 flex items-center gap-1.5", screen ? "text-screen-ink" : "text-ink")}>
            {it.status && <Lamp status={it.status} size={9} onScreen={screen} />}
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
