import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { CircleNotchIcon, type Icon } from "@phosphor-icons/react";
import { cx, isMac } from "./cx.ts";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "signal" | "danger" | "on-signal";
export type ButtonSize = "sm" | "md";

const VARIANT: Record<ButtonVariant, string> = {
  // Solid ink: the one main action per view (New agent, Open, Create).
  primary: "bg-ink text-surface hover:bg-ink/88 border border-ink",
  // Panel button with a ≥3:1 border.
  secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-2",
  // Text-only, for low-weight actions in bars and rows.
  quiet: "bg-transparent text-ink border border-transparent hover:bg-ink/6",
  // "A person is needed": Allow, Take over, Fix it. Never decorative.
  signal: "bg-signal text-on-signal border border-signal hover:bg-signal/88",
  // Destructive: outlined in err; pair with a confirm dialog.
  danger: "bg-surface text-err border border-err hover:bg-surface-2",
  // A button sitting on a signal bar (the bezel's "You're driving" bar): Give back.
  "on-signal": "bg-on-signal text-signal border border-on-signal hover:bg-on-signal/88",
};
const SIZE: Record<ButtonSize, string> = {
  sm: "h-7 gap-1.5 px-2.5 text-small",
  md: "h-8 gap-2 px-3 text-body",
};
const ICON_PX: Record<ButtonSize, number> = { sm: 14, md: 16 };

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Phosphor icon component, shown before the label. */
  icon?: Icon;
  /** Phosphor icon after the label (e.g. a caret on a menu button). */
  iconEnd?: Icon;
  /** Shows a spinner, sets aria-busy and blocks clicks. Keep the label meaningful ("Checking…"). */
  loading?: boolean;
  /** Shortcut hint shown inside the button, e.g. "mod+k" → ⌘K. Purely visual; bind it with useHotkeys. */
  shortcut?: string;
  children?: ReactNode;
};

/** The button. Solid ink is primary; signal only when a person is needed. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon: I, iconEnd: IE, loading, shortcut, className, children, disabled, type = "button", onClick, ...rest },
  ref,
) {
  const px = ICON_PX[size];
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      className={cx(
        "pressable inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-control font-medium",
        "disabled:cursor-not-allowed disabled:opacity-45",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <CircleNotchIcon size={px} weight="bold" className="animate-spin" aria-hidden /> : I && <I size={px} weight={variant === "primary" || variant === "signal" ? "bold" : "regular"} aria-hidden />}
      {children}
      {IE && <IE size={px - 2} weight="bold" aria-hidden className="-mr-0.5 opacity-70" />}
      {shortcut && <KeyHint keys={shortcut} className={variant === "primary" ? "text-surface/70" : variant === "signal" ? "text-on-signal/70" : "text-ink-3"} />}
    </button>
  );
});

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  /** Required accessible name; also shown as the native tooltip unless tooltip={false}. */
  label: string;
  icon: Icon;
  variant?: Exclude<ButtonVariant, "danger"> | "danger";
  size?: ButtonSize;
  /** Show the label as a native title tooltip (default true). */
  tooltip?: boolean;
  /** Pressed state for toggles (Pause previews, Focus screen). */
  pressed?: boolean;
  /** Use the filled icon weight (active states). */
  active?: boolean;
};

/** Square icon-only button: 28 px (sm) / 32 px (md) targets, always labelled. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon: I, variant = "quiet", size = "md", tooltip = true, pressed, active, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={tooltip ? label : undefined}
      aria-pressed={pressed}
      className={cx(
        "pressable inline-grid shrink-0 place-items-center rounded-control disabled:cursor-not-allowed disabled:opacity-45",
        pressed && variant === "quiet" ? "border border-line-strong bg-surface-2 text-ink" : VARIANT[variant],
        size === "sm" ? "size-7" : "size-8",
        className,
      )}
      {...rest}
    >
      <I size={size === "sm" ? 16 : 18} weight={active || pressed ? "fill" : "regular"} aria-hidden />
    </button>
  );
});

// ---------------- keys ----------------

const KEY_LABEL: Record<string, string> = {
  mod: isMac ? "⌘" : "Ctrl", cmd: "⌘", meta: isMac ? "⌘" : "Win", ctrl: isMac ? "⌃" : "Ctrl", alt: isMac ? "⌥" : "Alt",
  shift: isMac ? "⇧" : "Shift", enter: "↵", return: "↵", escape: "Esc", esc: "Esc", space: "Space", tab: "Tab",
  arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→", backspace: "⌫", delete: "Del",
};
/** "mod+shift+a" → ["⌘","⇧","A"] (mac) / ["Ctrl","Shift","A"]. */
export function shortcutParts(spec: string): string[] {
  return spec.split("+").map((k) => KEY_LABEL[k.toLowerCase()] ?? (k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1)));
}
/** Human text for a shortcut: "⌘K" on macOS, "Ctrl+K" elsewhere. */
export function formatShortcut(spec: string) {
  return shortcutParts(spec).join(isMac ? "" : "+");
}

/** A keycap. Pass text (<Kbd>Esc</Kbd>) or a spec (<Kbd keys="mod+k" />). */
export function Kbd({ keys, children, className }: { keys?: string; children?: ReactNode; className?: string }) {
  const parts = keys ? shortcutParts(keys) : [children];
  return (
    <span className={cx("inline-flex items-center gap-0.5", className)}>
      {parts.map((p, i) => (
        <kbd key={i} className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-[4px] border border-line-strong border-b-2 bg-surface px-1 font-mono text-[10.5px] leading-none text-ink-2">
          {p}
        </kbd>
      ))}
    </span>
  );
}

/** Inline shortcut hint inside a button: plain text, no keycap chrome. */
function KeyHint({ keys, className }: { keys: string; className?: string }) {
  return <span aria-hidden className={cx("ml-1 font-mono text-[11px] tracking-normal", className)}>{formatShortcut(keys)}</span>;
}
