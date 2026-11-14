import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "@phosphor-icons/react";
import { cx, focusables } from "./cx.ts";
import { IconButton } from "./Button.tsx";

export type InitialFocus = RefObject<HTMLElement | null> | "first" | "container";

/**
 * Modal focus management (APG): moves focus in on open, traps Tab/Shift+Tab, closes on Esc, and puts focus back on
 * the element that opened it when it closes. Use for anything with aria-modal="true".
 */
export function useModalFocus(ref: RefObject<HTMLElement | null>, open: boolean, o: { onClose?: () => void; initialFocus?: InitialFocus; restoreFocus?: boolean; closeOnEsc?: boolean } = {}) {
  const opts = useRef(o);
  opts.current = o;
  useLayoutEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;
    const opener = document.activeElement as HTMLElement | null;
    const init = opts.current.initialFocus ?? "first";
    const target = init === "container" ? el : init === "first" ? focusables(el).find((x) => !x.hasAttribute("data-skip-initial-focus")) ?? el : init.current ?? el;
    target.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && opts.current.closeOnEsc !== false) {
        // Only the top-most modal handles Esc.
        const modals = document.querySelectorAll('[aria-modal="true"]');
        if (modals[modals.length - 1] !== el) return;
        e.preventDefault();
        e.stopPropagation();
        opts.current.onClose?.();
        return;
      }
      if (e.key !== "Tab") return;
      const f = focusables(el);
      if (!f.length) { e.preventDefault(); el.focus(); return; }
      const first = f[0], last = f[f.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    // Focus that escapes (e.g. a click on the page behind) is pulled back in.
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as Node;
      if (el.contains(t)) return;
      const modals = document.querySelectorAll('[aria-modal="true"]');
      if (modals[modals.length - 1] !== el) return;
      (focusables(el)[0] ?? el).focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocusIn);
      if (opts.current.restoreFocus !== false && opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [open]);
}

/** The theme of whatever opened an overlay, so a portal inside a [data-theme] subtree keeps that theme. */
function useOpenerTheme(open: boolean) {
  const [theme, setTheme] = useState<string | undefined>();
  useLayoutEffect(() => {
    if (open) setTheme((document.activeElement as HTMLElement | null)?.closest("[data-theme]")?.getAttribute("data-theme") ?? undefined);
  }, [open]);
  return theme;
}

/** Lock page scroll while a modal is open. */
function useScrollLock(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = prev; };
  }, [open]);
}

// ---------------- Dialog ----------------

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  /** Visible title; becomes aria-labelledby. */
  title: ReactNode;
  /** One or two sentences under the title; becomes aria-describedby. */
  description?: ReactNode;
  /** "alert": role=alertdialog for confirmations of destructive or irreversible actions. No outside-click close. */
  variant?: "dialog" | "alert";
  /** Where focus goes on open. Default: first focusable. For alerts, pass the Cancel button's ref. */
  initialFocus?: InitialFocus;
  size?: "sm" | "md" | "lg";
  /** Buttons row, right-aligned. Put the primary action last. */
  footer?: ReactNode;
  /** Hide the × close button (alerts never show it). */
  hideClose?: boolean;
  className?: string;
  children?: ReactNode;
};

const DIALOG_W = { sm: "max-w-[400px]", md: "max-w-[520px]", lg: "max-w-[720px]" };

/** APG modal dialog: role=dialog|alertdialog, aria-modal, labelled + described, focus trap, Esc, focus restore. */
export function Dialog({ open, onClose, title, description, variant = "dialog", initialFocus, size = "md", footer, hideClose, className, children }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const theme = useOpenerTheme(open);
  useModalFocus(ref, open, { onClose, initialFocus });
  useScrollLock(open);
  if (!open) return null;
  const alert = variant === "alert";
  return createPortal(
    <div data-theme={theme} className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-6">
      <div aria-hidden className="fixed inset-0 animate-scrim bg-scrim" onMouseDown={alert ? undefined : onClose} />
      <div
        ref={ref}
        role={alert ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={description ? `${id}-d` : undefined}
        tabIndex={-1}
        className={cx("relative w-full animate-pop rounded-unit border border-line bg-surface shadow-float outline-none", DIALOG_W[size], className)}
      >
        <div className="flex items-start gap-3 px-5 pt-5">
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-t`} className="text-h3 text-ink">{title}</h2>
            {description && <p id={`${id}-d`} className="mt-1 text-body text-ink-2">{description}</p>}
          </div>
          {!alert && !hideClose && <IconButton label="Close" icon={XIcon} size="sm" onClick={onClose} className="-mr-1.5 -mt-1" data-skip-initial-focus />}
        </div>
        {children && <div className="px-5 pt-4">{children}</div>}
        {footer ? <div className="mt-5 flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : <div className="h-5" />}
      </div>
    </div>,
    document.body,
  );
}

// ---------------- Drawer ----------------

export type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Width in px (default 440). */
  width?: number;
  /** "fixed" (default) covers the viewport's right edge with a scrim; "contained" fills the nearest positioned
   *  ancestor (e.g. only the bezel side of the agent view) and renders in place, without a portal. */
  placement?: "fixed" | "contained";
  initialFocus?: InitialFocus;
  /** Extra controls in the header, before the close button. */
  actions?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
};

/** Right side panel. Modal: focus-trapped, Esc closes, focus returns to the opener. Slides in over 240 ms. */
export function Drawer({ open, onClose, title, description, width = 440, placement = "fixed", initialFocus, actions, footer, className, children }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const theme = useOpenerTheme(open && placement === "fixed");
  useModalFocus(ref, open, { onClose, initialFocus });
  useScrollLock(open && placement === "fixed");
  if (!open) return null;
  const fixed = placement === "fixed";
  const panel = (
    <div data-theme={fixed ? theme : undefined} className={cx(fixed ? "fixed inset-0 z-40" : "absolute inset-0 z-30", "flex justify-end overflow-hidden")}>
      <div aria-hidden className={cx("absolute inset-0 animate-scrim", fixed ? "bg-scrim" : "bg-scrim/60")} onMouseDown={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={description ? `${id}-d` : undefined}
        tabIndex={-1}
        style={{ width: `min(${width}px, 100%)` }}
        className={cx("relative flex h-full animate-drawer flex-col border-l border-line bg-surface shadow-float outline-none", className)}
      >
        <header className="flex items-start gap-2 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-t`} className="text-h3 text-ink">{title}</h2>
            {description && <p id={`${id}-d`} className="mt-0.5 text-small text-ink-2">{description}</p>}
          </div>
          {actions}
          <IconButton label="Close" icon={XIcon} size="sm" onClick={onClose} className="-mr-1.5" data-skip-initial-focus />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
  return fixed ? createPortal(panel, document.body) : panel;
}
