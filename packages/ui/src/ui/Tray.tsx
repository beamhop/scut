import { useId, type ReactNode } from "react";
import { cx } from "./cx.ts";

export type TrayProps = {
  /** Region name and visible heading, e.g. "Waiting for you". Must be unique on the page. */
  title: string;
  /** Count shown after the title (tabular pill: one of the few allowed pills). */
  count?: number;
  /** Visually hide the heading (the region keeps its name). */
  hideTitle?: boolean;
  /** Right side of the heading row. */
  actions?: ReactNode;
  /** Heading level for the title (default 2). */
  level?: 2 | 3;
  className?: string;
  children: ReactNode;
};

/**
 * Horizontal scroll container for a row of cards (approvals, units in a dock). role=region with a label so it is a
 * landmark you can jump to; scrolls with the keyboard via the cards' own focus.
 */
export function Tray({ title, count, hideTitle, actions, level = 2, className, children }: TrayProps) {
  const id = useId();
  const H = level === 2 ? "h2" : "h3";
  return (
    <section role="region" aria-labelledby={`${id}-t`} className={cx("min-w-0", className)}>
      <div className={cx("mb-2 flex items-center gap-2", hideTitle && "sr-only")}>
        <H id={`${id}-t`} className="text-body font-semibold text-ink">{title}</H>
        {count !== undefined && <span className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-ink px-1.5 text-micro font-semibold tabular-nums text-surface">{count}</span>}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 pt-0.5 [&>*]:shrink-0 [&>*]:snap-start">
        {children}
      </div>
    </section>
  );
}
