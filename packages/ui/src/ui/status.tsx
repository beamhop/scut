import { ArrowUpRightIcon, CircleIcon, TriangleIcon, XIcon } from "@phosphor-icons/react";
import { cx } from "./cx.ts";

/**
 * The five states. Every status is word + shape (+ colour). Never colour alone.
 *   needs   ▲ signal   a person is needed (approval, stuck, take-over requested)
 *   working ● ok       doing a task (the lamp pulses gently unless reduced motion)
 *   free    ○ ink-3    idle, ready for work (the word is "Ready": "Free" read as "costs nothing")
 *   moving  ↗ ink      beaming between places, booting, packing
 *   problem ✕ err      failed, offline, can't sign in
 */
export type Status = "needs" | "working" | "free" | "moving" | "problem";

export const STATUS: Record<Status, { word: string; tone: string }> = {
  needs: { word: "Needs you", tone: "text-signal-ink" },
  working: { word: "Working", tone: "text-ink" },
  free: { word: "Ready", tone: "text-ink-2" },
  moving: { word: "Moving", tone: "text-ink" },
  problem: { word: "Problem", tone: "text-err" },
};

/** Map an agent's protocol state (+ what the UI knows) to one of the five statuses. */
export function toStatus(state: string | undefined, o: { needs?: boolean; failed?: boolean; beaming?: boolean; problem?: boolean } = {}): Status {
  if (o.needs || state === "stuck") return "needs";
  if (o.failed || o.problem) return "problem";
  if (o.beaming || state === "awaiting" || state === "starting" || state === "quiescing" || state === "retired") return "moving";
  if (state === "busy") return "working";
  return "free";
}

/** The shape alone. Decorative by default (aria-hidden); give `label` when it stands alone. */
export function Lamp({ status, size = 10, label, className, onScreen }: { status: Status; size?: number; label?: string; className?: string; onScreen?: boolean }) {
  const a11y = label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true as const };
  const s = size;
  const common = { size: s };
  let shape;
  switch (status) {
    case "needs": shape = <TriangleIcon {...common} weight="fill" className="block text-signal" />; break;
    case "working": shape = <span className="block animate-lamp rounded-full bg-ok" style={{ width: s * 0.8, height: s * 0.8, margin: s * 0.1 }} />; break;
    case "free": shape = <CircleIcon {...common} weight="bold" className={cx("block", onScreen ? "text-screen-ink-2" : "text-ink-3")} />; break;
    case "moving": shape = <ArrowUpRightIcon {...common} weight="bold" className={cx("block", onScreen ? "text-screen-ink" : "text-ink")} />; break;
    case "problem": shape = <XIcon {...common} weight="bold" className="block text-err" />; break;
  }
  return <span {...a11y} className={cx("inline-grid shrink-0 place-items-center", className)} style={{ width: s, height: s }}>{shape}</span>;
}

/**
 * Lamp + word. `label` replaces the word ("Waiting for you", "Beaming to Fly.io") but keep it short.
 * `emphasis` puts needs-you on a signal wash, for places where it must jump out (unit header, tray).
 */
export function StatusBadge({ status, label, emphasis, size = "md", className, onScreen }: {
  status: Status; label?: string; emphasis?: boolean; size?: "sm" | "md"; className?: string; onScreen?: boolean;
}) {
  const m = STATUS[status];
  const wash = emphasis && status === "needs";
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-medium",
        size === "sm" ? "text-small" : "text-body",
        onScreen ? (status === "needs" ? "text-signal" : status === "problem" ? "text-err" : "text-screen-ink") : m.tone,
        wash && "-mx-1.5 rounded-[4px] bg-signal-wash px-1.5 py-px",
        className,
      )}
    >
      <Lamp status={status} size={size === "sm" ? 9 : 10} onScreen={onScreen} />
      {label ?? m.word}
    </span>
  );
}
