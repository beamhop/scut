import { useEffect, useRef, type RefObject } from "react";
import { isMac } from "./cx.ts";

/**
 * Key bindings. Specs are "+"-joined, case-insensitive: "n", "?", "f", "1", "escape", "mod+k" (⌘ on macOS, Ctrl
 * elsewhere), "alt+shift+a", "shift+enter", "arrowdown".
 *
 *   useHotkeys({ n: () => setCreating(true), "mod+k": openPalette, "alt+shift+a": focusInbox });
 *   useHotkeys({ b: openBeamMenu }, { scope: unitRef });   // only while focus is inside unitRef
 *
 * By default bindings are ignored while typing (input, textarea, select, contenteditable) unless they use a modifier
 * (mod/ctrl/alt), and unscoped bindings are ignored while a modal dialog is open.
 */
export type HotkeyHandler = (e: KeyboardEvent) => void | boolean;
export type HotkeyOptions = {
  /** Listen on this element (focus must be inside it) instead of the whole window. */
  scope?: RefObject<HTMLElement | null>;
  enabled?: boolean;
  /** Fire even while typing in a field. */
  allowInInputs?: boolean;
  /** Fire even while a modal (aria-modal) is open. */
  allowInModal?: boolean;
};

type Parsed = { key: string; mod: boolean; ctrl: boolean; meta: boolean; alt: boolean; shift: boolean };

export function parseHotkey(spec: string): Parsed {
  const parts = spec.toLowerCase().split("+").map((s) => s.trim());
  const key = parts.pop() || "+";
  const has = (m: string) => parts.includes(m);
  return { key: key === "esc" ? "escape" : key === "space" ? " " : key === "return" ? "enter" : key, mod: has("mod"), ctrl: has("ctrl"), meta: has("meta") || has("cmd"), alt: has("alt") || has("option"), shift: has("shift") };
}

export function matchHotkey(e: KeyboardEvent, spec: string | Parsed): boolean {
  const p = typeof spec === "string" ? parseHotkey(spec) : spec;
  const wantMeta = p.meta || (p.mod && isMac);
  const wantCtrl = p.ctrl || (p.mod && !isMac);
  if (e.metaKey !== wantMeta || e.ctrlKey !== wantCtrl || e.altKey !== p.alt) return false;
  const k = e.key.toLowerCase();
  const letterOrDigit = /^[a-z0-9]$/.test(p.key);
  // Symbols like "?" are typed with shift; only enforce shift for letters, digits and named keys.
  if ((letterOrDigit || p.key.length > 1) && e.shiftKey !== p.shift) return false;
  if (k === p.key) return true;
  // With Alt (macOS) or Shift the produced character changes; fall back to the physical key.
  if (letterOrDigit) return e.code === (/[0-9]/.test(p.key) ? `Digit${p.key}` : `Key${p.key.toUpperCase()}`);
  return false;
}

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(type);
  }
  return false;
}

export function useHotkeys(bindings: Record<string, HotkeyHandler>, o: HotkeyOptions = {}) {
  const ref = useRef({ bindings, o });
  ref.current = { bindings, o };
  const enabled = o.enabled !== false;
  useEffect(() => {
    if (!enabled) return;
    const target: HTMLElement | Window | null = o.scope ? o.scope.current : window;
    if (!target) return;
    const parsed = Object.keys(ref.current.bindings).map((spec) => [spec, parseHotkey(spec)] as const);
    const onKey = (ev: Event) => {
      const e = ev as KeyboardEvent;
      if (e.defaultPrevented || e.isComposing) return;
      const { bindings, o } = ref.current;
      for (const [spec, p] of parsed) {
        if (!matchHotkey(e, p)) continue;
        const modified = p.mod || p.ctrl || p.meta || p.alt;
        if (!o.allowInInputs && !modified && isTypingTarget(e.target)) continue;
        if (!o.scope && !o.allowInModal && !modified && (e.target as HTMLElement | null)?.closest?.('[aria-modal="true"]')) continue;
        const h = bindings[spec];
        if (!h) continue;
        if (h(e) !== false) e.preventDefault();
        return;
      }
    };
    target.addEventListener("keydown", onKey);
    return () => target.removeEventListener("keydown", onKey);
  }, [enabled, o.scope, Object.keys(bindings).join("|")]);
}
