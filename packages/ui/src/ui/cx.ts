/** Join class names, skipping falsy values. */
export function cx(...parts: (string | false | null | undefined | 0)[]): string {
  return parts.filter(Boolean).join(" ");
}

let n = 0;
/** Stable-enough id for non-React callers (React code should use useId). */
export const uid = (prefix = "bh") => `${prefix}-${(++n).toString(36)}`;

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** True when the user asked the OS for less motion. */
export function prefersReducedMotion() {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Elements that can take keyboard focus, in DOM order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  const sel = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
  return [...root.querySelectorAll<HTMLElement>(sel)].filter((el) => !el.closest("[inert]") && el.getClientRects().length > 0);
}
