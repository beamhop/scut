import { useId, type ReactNode } from "react";
import { cx } from "./cx.ts";

export type ProgressProps = {
  /** Accessible name, e.g. "Beaming Atlas to Fly.io". Shown above the bar unless hideLabel. */
  label: string;
  hideLabel?: boolean;
  /** Determinate: 0–1. */
  value?: number;
  /** Staged: stage names and the index of the current one (stages before it are done). */
  stages?: string[];
  current?: number;
  /** Spoken + shown value text, e.g. "Sending 42 MB". Defaults to the stage name or a percentage. */
  valueText?: string;
  /** Right side of the label row, e.g. elapsed "00:07". */
  aside?: ReactNode;
  tone?: "ink" | "signal";
  className?: string;
};

/**
 * role=progressbar with aria-valuetext. Honest: it only moves when real work moves (no shimmer, no loops).
 * Staged mode draws one segment per stage, for pipelines like beaming.
 */
export function Progress({ label, hideLabel, value, stages, current = 0, valueText, aside, tone = "ink", className }: ProgressProps) {
  const id = useId();
  const staged = !!stages?.length;
  const max = staged ? stages!.length : 100;
  const now = staged ? Math.min(current + 1, stages!.length) : value === undefined ? undefined : Math.round(Math.max(0, Math.min(1, value)) * 100);
  const text = valueText ?? (staged ? `Step ${now} of ${max}: ${stages![Math.min(current, max - 1)]}` : now === undefined ? "Working" : `${now}%`);
  const fill = tone === "signal" ? "bg-signal" : "bg-ink";
  return (
    <div className={cx("min-w-0", className)}>
      {!hideLabel && (
        <div className="mb-1.5 flex items-baseline gap-3 text-small">
          <span id={`${id}-l`} className="min-w-0 flex-1 truncate font-medium text-ink">{label}</span>
          {aside && <span className="shrink-0 tabular-nums text-ink-2">{aside}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-labelledby={hideLabel ? undefined : `${id}-l`}
        aria-label={hideLabel ? label : undefined}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={now}
        aria-valuetext={text}
        className={cx("flex h-1.5 gap-[3px]", !staged && "overflow-hidden rounded-full bg-line")}
      >
        {staged
          ? stages!.map((s, i) => (
              <span key={s} title={s} className={cx("h-full flex-1 rounded-full transition-colors duration-(--dur-tray)", i < current ? fill : i === current ? cx(fill, "opacity-45") : "bg-line")} />
            ))
          : now !== undefined && <span className={cx("h-full rounded-full transition-[width] duration-(--dur-tray) ease-(--ease-out)", fill)} style={{ width: `${now}%` }} />}
      </div>
      {staged && !hideLabel && <div className="mt-1.5 text-small text-ink-2" aria-hidden>{text}</div>}
    </div>
  );
}
