import { useEffect, useState } from "react";
import { DesktopIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import { IconButton } from "./Button.tsx";

/** "system" follows the OS; "light"/"dark" set <html data-theme>. Stored in localStorage. */
export type ThemePref = "system" | "light" | "dark";
const KEY = "beamhop-theme";
const listeners = new Set<(t: ThemePref) => void>();

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch { return "system"; }
}

/** Apply the stored preference to <html>. Call once before the first render (main.tsx does). */
export function applyTheme(t: ThemePref = getThemePref()) {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
}

export function setThemePref(t: ThemePref) {
  try { t === "system" ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, t); } catch {}
  applyTheme(t);
  listeners.forEach((f) => f(t));
}

/** The resolved theme right now ("light" | "dark"), taking the OS setting into account. */
export function resolvedTheme(t: ThemePref = getThemePref()): "light" | "dark" {
  if (t !== "system") return t;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(getThemePref);
  useEffect(() => { listeners.add(setPref); return () => { listeners.delete(setPref); }; }, []);
  /** Cycle system → light → dark → system. */
  const cycle = () => setThemePref(pref === "system" ? "light" : pref === "light" ? "dark" : "system");
  return { pref, set: setThemePref, cycle, resolved: resolvedTheme(pref) };
}

const NEXT_LABEL: Record<ThemePref, string> = { system: "Theme: follows your computer", light: "Theme: light", dark: "Theme: dark" };

/** Top-bar theme button: cycles system → light → dark. */
export function ThemeToggle({ size = "md" }: { size?: "sm" | "md" }) {
  const { pref, cycle } = useTheme();
  const icon = pref === "system" ? DesktopIcon : pref === "light" ? SunIcon : MoonIcon;
  return <IconButton label={NEXT_LABEL[pref]} icon={icon} size={size} onClick={cycle} />;
}
