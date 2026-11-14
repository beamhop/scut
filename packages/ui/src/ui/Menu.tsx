import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode, type KeyboardEvent as RKE } from "react";
import { cx } from "./cx.ts";

export type MenuItem = {
  id: string;
  /** Visible label. Keep the text stable: tests and typeahead use it. */
  label: ReactNode;
  /** Plain text for typeahead when `label` isn't a string. */
  textValue?: string;
  /** Right-aligned meta, e.g. "free", "~€21/month". */
  hint?: ReactNode;
  /** Second line, e.g. the beam pre-flight line "Key works · Keeps working while this computer is off". */
  description?: ReactNode;
  disabled?: boolean;
  /** Destructive items are drawn in err. */
  danger?: boolean;
  onSelect: () => void;
};
export type MenuSection = { heading?: string; items: MenuItem[] };

export type MenuProps = {
  /** The trigger. A <Button> (or any element accepting ref/onClick/onKeyDown/aria-*). */
  trigger: ReactElement<any>;
  /** Items, or sections with optional headings. */
  items: MenuItem[] | MenuSection[];
  /** Optional caption at the top of the menu ("Beam Atlas to…"); also labels the menu. */
  heading?: ReactNode;
  align?: "start" | "end";
  side?: "bottom" | "top";
  /** Min width of the popup in px (default 224). */
  width?: number;
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

const isSections = (x: MenuItem[] | MenuSection[]): x is MenuSection[] => !!x.length && "items" in x[0];

/**
 * APG menu button: the trigger gets aria-haspopup/expanded; the popup is role=menu with role=menuitem children.
 * ↑/↓/Home/End move, typeahead jumps, Enter/Space select, Esc or Tab close and focus returns to the trigger.
 */
export function Menu({ trigger, items, heading, align = "end", side = "bottom", width = 224, open: openProp, onOpenChange, className }: MenuProps) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v: boolean) => { if (openProp === undefined) setOpenState(v); onOpenChange?.(v); };
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const focusOnOpen = useRef<"first" | "last">("first");
  const typed = useRef({ s: "", t: 0 });
  const sections: MenuSection[] = isSections(items) ? items : [{ items: items as MenuItem[] }];
  const flat = sections.flatMap((s) => s.items);

  const itemEls = () => [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const focusAt = (i: number) => { const els = itemEls(); if (els.length) els[(i + els.length) % els.length].focus(); };
  const close = (refocus = true) => { setOpen(false); if (refocus) triggerRef.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    const els = itemEls();
    const enabled = els.findIndex((e) => e.getAttribute("aria-disabled") !== "true");
    focusAt(focusOnOpen.current === "last" ? els.length - 1 : Math.max(0, enabled));
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) close(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onMenuKey = (e: RKE) => {
    const els = itemEls();
    const i = els.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); focusAt(i + 1); break;
      case "ArrowUp": e.preventDefault(); focusAt(i - 1); break;
      case "Home": e.preventDefault(); focusAt(0); break;
      case "End": e.preventDefault(); focusAt(els.length - 1); break;
      case "Escape": e.preventDefault(); e.stopPropagation(); close(); break;
      case "Tab": close(false); break;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const now = Date.now();
          typed.current.s = now - typed.current.t > 600 ? e.key.toLowerCase() : typed.current.s + e.key.toLowerCase();
          typed.current.t = now;
          const texts = flat.map((it) => (it.textValue ?? (typeof it.label === "string" ? it.label : "")).toLowerCase());
          const start = typed.current.s.length === 1 ? i + 1 : i;
          for (let k = 0; k < texts.length; k++) {
            const j = (start + k) % texts.length;
            if (texts[j].startsWith(typed.current.s)) { focusAt(j); break; }
          }
        }
    }
  };

  const t = isValidElement(trigger) ? trigger : <button type="button">{trigger as ReactNode}</button>;
  const tp = t.props as any;
  const triggerEl = cloneElement(t as ReactElement<any>, {
    ref: (el: HTMLElement | null) => { triggerRef.current = el; },
    id: tp.id ?? `${id}-b`,
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-controls": open ? `${id}-m` : undefined,
    onClick: (e: any) => { tp.onClick?.(e); if (!e.defaultPrevented) { focusOnOpen.current = "first"; setOpen(!open); } },
    onKeyDown: (e: any) => {
      tp.onKeyDown?.(e);
      if (e.defaultPrevented) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); focusOnOpen.current = e.key === "ArrowUp" ? "last" : "first"; setOpen(true); }
    },
  });

  return (
    <span ref={wrap} className={cx("relative inline-flex", className)}>
      {triggerEl}
      {open && (
        <div
          ref={list}
          id={`${id}-m`}
          role="menu"
          aria-labelledby={heading ? `${id}-h` : tp.id ?? `${id}-b`}
          onKeyDown={onMenuKey}
          style={{ minWidth: width }}
          className={cx(
            "absolute z-40 max-w-[min(360px,calc(100vw-24px))] animate-pop rounded-[10px] border border-line bg-surface p-1 shadow-float",
            side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5",
            align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left",
          )}
        >
          {heading && <div id={`${id}-h`} className="px-2.5 pb-1 pt-1.5 text-small font-medium text-ink-2">{heading}</div>}
          {sections.map((s, si) => (
            <div key={si} role="group" aria-label={s.heading} className={cx(si > 0 && "mt-1 border-t border-line pt-1")}>
              {s.heading && <div aria-hidden className="px-2.5 pb-0.5 pt-1.5 text-micro font-medium text-ink-3">{s.heading}</div>}
              {s.items.map((it) => (
                <div
                  key={it.id}
                  role="menuitem"
                  tabIndex={-1}
                  aria-disabled={it.disabled || undefined}
                  onClick={() => { if (it.disabled) return; close(); it.onSelect(); }}
                  onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !it.disabled) { e.preventDefault(); close(); it.onSelect(); } }}
                  onMouseEnter={(e) => (e.currentTarget as HTMLElement).focus({ preventScroll: true })}
                  className={cx(
                    "flex w-full cursor-default select-none flex-col rounded-control px-2.5 py-1.5 text-left outline-none",
                    "focus:bg-ink/7 focus-visible:[outline-offset:-2px]",
                    it.disabled ? "opacity-45" : "cursor-pointer",
                  )}
                >
                  <span className="flex items-center gap-3">
                    <span className={cx("min-w-0 flex-1 truncate text-body", it.danger ? "text-err" : "text-ink")}>{it.label}</span>
                    {it.hint && <span className="shrink-0 text-small tabular-nums text-ink-2">{it.hint}</span>}
                  </span>
                  {it.description && <span className="mt-0.5 text-small text-ink-2">{it.description}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
