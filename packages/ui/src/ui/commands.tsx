import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { cx } from "./cx.ts";
import { Kbd } from "./Button.tsx";
import { useModalFocus } from "./overlay.tsx";
import { isTypingTarget, matchHotkey, useHotkeys } from "./hotkeys.ts";

/**
 * Command registry + ⌘K palette.
 *
 *   useCommands([
 *     { id: "agent.open.atlas", title: "Open Atlas", group: "Agents", run: () => go("atlas") },
 *     { id: "agent.beam.atlas.fly", title: "Beam Atlas to Fly.io", synonyms: ["move", "send", "transfer"], group: "Beam", run },
 *     { id: "agent.new", title: "New agent", shortcut: "n", group: "Crew", run: create },
 *   ], [agents]);
 *
 * Commands live while the component that registered them is mounted. A command's `shortcut` is shown in the palette
 * and bound globally (outside text fields and modals) unless `bindShortcut: false` — don't also bind it with
 * useHotkeys. Mount <CommandPalette/> once (main.tsx does).
 */
export type Command = {
  id: string;
  title: string;
  /** Other words people use for it: "move", "send", "transfer" for beam. */
  synonyms?: string[];
  /** Section heading in the palette ("Agents", "Beam", "View"). Groups appear in registration order. */
  group?: string;
  /** Shortcut spec ("n", "mod+shift+p"), shown as keycaps. */
  shortcut?: string;
  bindShortcut?: boolean;
  /** Right-side meta text ("~€21/month", "This computer"). */
  hint?: string;
  disabled?: boolean;
  run: () => void;
};

// ---------------- store ----------------
const owners = new Map<string, Command[]>();
const subs = new Set<() => void>();
let snapshot: Command[] = [];
let paletteOpen = false;
let paletteQuery = "";
const emit = () => {
  const seen = new Set<string>();
  snapshot = [...owners.values()].flat().filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export function registerCommands(owner: string, cmds: Command[]) {
  owners.set(owner, cmds);
  emit();
  return () => { owners.delete(owner); emit(); };
}

/** Register commands for as long as the calling component is mounted. Pass deps that change the list. */
export function useCommands(cmds: Command[], deps: unknown[] = []) {
  const owner = useId();
  const latest = useRef(cmds);
  latest.current = cmds;
  useEffect(() => () => { owners.delete(owner); emit(); }, []);
  useEffect(() => {
    // Wrap run so callers can pass inline closures without re-registering on every render.
    owners.set(owner, latest.current.map((c) => ({ ...c, run: () => latest.current.find((x) => x.id === c.id)?.run() })));
    emit();
  }, deps);
}

export const allCommands = () => snapshot;
export function useAllCommands() { return useSyncExternalStore(subscribe, () => snapshot, () => snapshot); }
export function openCommandPalette(query = "") { paletteOpen = true; paletteQuery = query; emit(); }
export function closeCommandPalette() { paletteOpen = false; emit(); }
const useOpen = () => useSyncExternalStore(subscribe, () => paletteOpen, () => false);

// ---------------- fuzzy matching ----------------
/** Score `q` against `text`: substring beats word-start beats subsequence. -1 = no match. */
export function fuzzyScore(q: string, text: string): number {
  q = q.toLowerCase(); text = text.toLowerCase();
  if (!q) return 0;
  const i = text.indexOf(q);
  if (i >= 0) return 100 - Math.min(i, 40) + (i === 0 || /\W/.test(text[i - 1]) ? 40 : 0) + (q.length === text.length ? 30 : 0);
  let score = 0, ti = 0, streak = 0;
  for (const ch of q) {
    const j = text.indexOf(ch, ti);
    if (j < 0) return -1;
    streak = j === ti ? streak + 1 : 0;
    score += 1 + streak * 2 + (j === 0 || /\W/.test(text[j - 1]) ? 6 : 0) - Math.min(j - ti, 6) * 0.5;
    ti = j + 1;
  }
  return Math.max(1, score);
}

/** Every query word must match the title, a synonym or the group. Title matches weigh most. */
export function rankCommands(query: string, cmds: Command[]): Command[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return cmds.filter((c) => !c.disabled);
  const scored: [Command, number][] = [];
  for (const c of cmds) {
    if (c.disabled) continue;
    let total = 0;
    let ok = true;
    for (const w of words) {
      const best = Math.max(fuzzyScore(w, c.title), ...(c.synonyms ?? []).map((s) => fuzzyScore(w, s) * 0.85), c.group ? fuzzyScore(w, c.group) * 0.5 : -1);
      if (best < 0) { ok = false; break; }
      total += best;
    }
    if (ok) scored.push([c, total + (fuzzyScore(query.trim(), c.title) > 0 ? 50 : 0)]);
  }
  return scored.sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

// ---------------- palette ----------------
/**
 * ⌘K / Ctrl+K: a modal dialog with an APG combobox + listbox. ↑/↓ move, Enter runs, Esc closes and returns focus.
 */
export function CommandPalette({ placeholder = "Search or do anything…" }: { placeholder?: string }) {
  const open = useOpen();
  const cmds = useAllCommands();
  useHotkeys({ "mod+k": () => (paletteOpen ? closeCommandPalette() : openCommandPalette()) }, { allowInInputs: true, allowInModal: true });
  // Bind command shortcuts globally.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || paletteOpen || isTypingTarget(e.target) || (e.target as HTMLElement)?.closest?.('[aria-modal="true"]')) return;
      const c = snapshot.find((c) => c.shortcut && c.bindShortcut !== false && !c.disabled && matchHotkey(e, c.shortcut));
      if (c) { e.preventDefault(); c.run(); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  if (!open) return null;
  return <PaletteDialog cmds={cmds} placeholder={placeholder} />;
}

function PaletteDialog({ cmds, placeholder }: { cmds: Command[]; placeholder: string }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState(paletteQuery);
  const [active, setActive] = useState(0);
  const [theme] = useState(() => (document.activeElement as HTMLElement | null)?.closest("[data-theme]")?.getAttribute("data-theme") ?? undefined);
  useModalFocus(ref, true, { onClose: closeCommandPalette, initialFocus: input });
  const results = useMemo(() => rankCommands(q, cmds).slice(0, 60), [q, cmds]);
  const grouped = useMemo(() => {
    // With a query: one ranked list with group as hint. Without: grouped sections.
    if (q.trim()) return [{ group: "", items: results }];
    const order: string[] = [];
    const by = new Map<string, Command[]>();
    for (const c of results) { const g = c.group ?? "Commands"; if (!by.has(g)) { by.set(g, []); order.push(g); } by.get(g)!.push(c); }
    return order.map((g) => ({ group: g, items: by.get(g)! }));
  }, [results, q]);
  const flat = grouped.flatMap((g) => g.items);
  useEffect(() => setActive(0), [q]);
  useEffect(() => { listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);
  const run = (c?: Command) => { if (!c) return; closeCommandPalette(); setTimeout(() => c.run(), 0); };
  const optId = (i: number) => `${id}-o${i}`;
  let idx = -1;
  return createPortal(
    <div data-theme={theme} className="fixed inset-0 z-[60] flex justify-center px-4 pt-[14vh]">
      <div aria-hidden className="fixed inset-0 animate-scrim bg-scrim" onMouseDown={closeCommandPalette} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Command palette" className="relative flex max-h-[min(520px,72vh)] w-full max-w-[600px] animate-pop flex-col overflow-hidden rounded-unit border border-line bg-surface shadow-float">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <MagnifyingGlassIcon size={18} aria-hidden className="shrink-0 text-ink-2" />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-l`}
            aria-autocomplete="list"
            aria-activedescendant={flat.length ? optId(active) : undefined}
            aria-label="Search commands"
            value={q}
            placeholder={placeholder}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (flat.length ? (a + 1) % flat.length : 0)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0)); }
              else if (e.key === "Home" && e.ctrlKey) { e.preventDefault(); setActive(0); }
              else if (e.key === "End" && e.ctrlKey) { e.preventDefault(); setActive(flat.length - 1); }
              else if (e.key === "Enter") { e.preventDefault(); run(flat[active]); }
            }}
            className="h-12 min-w-0 flex-1 bg-transparent text-ui-lg font-normal text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} id={`${id}-l`} role="listbox" aria-label="Commands" className="min-h-0 shrink overflow-y-auto p-1.5">
          {!flat.length && <div className="px-3 py-6 text-center text-body text-ink-2">No matches. Try “beam”, “pause” or an agent’s name.</div>}
          {grouped.map((g) => (
            <div key={g.group || "_"} role={g.group ? "group" : undefined} aria-labelledby={g.group ? `${id}-g-${g.group}` : undefined}>
              {g.group && <div id={`${id}-g-${g.group}`} role="presentation" className="px-2.5 pb-1 pt-2.5 text-micro font-medium text-ink-3">{g.group}</div>}
              {g.items.map((c) => {
                idx++;
                const i = idx;
                const on = i === active;
                return (
                  <div
                    key={c.id}
                    id={optId(i)}
                    data-index={i}
                    role="option"
                    aria-selected={on}
                    onMouseMove={() => !on && setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => run(c)}
                    className={cx("flex h-9 cursor-pointer items-center gap-3 rounded-control px-2.5 text-body", on ? "bg-ink text-surface" : "text-ink")}
                  >
                    <span className="min-w-0 flex-1 truncate">{highlight(c.title, q)}</span>
                    {q.trim() && c.group && <span className={cx("shrink-0 text-small", on ? "text-surface/70" : "text-ink-3")}>{c.group}</span>}
                    {c.hint && <span className={cx("shrink-0 text-small tabular-nums", on ? "text-surface/80" : "text-ink-2")}>{c.hint}</span>}
                    {c.shortcut && <Kbd keys={c.shortcut} className={on ? "opacity-90" : undefined} />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-small text-ink-2" aria-hidden>
          <span className="inline-flex items-center gap-1.5"><Kbd keys="arrowup" /><Kbd keys="arrowdown" /> move</span>
          <span className="inline-flex items-center gap-1.5"><Kbd keys="enter" /> run</span>
          <span className="ml-auto inline-flex items-center gap-1.5"><Kbd keys="mod+k" /> open anywhere</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Bold the characters of `title` that match the query words (substring matches only, to stay calm). */
function highlight(title: string, q: string): ReactNode {
  const words = q.trim().toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return title;
  const lower = title.toLowerCase();
  const marks = new Array(title.length).fill(false);
  for (const w of words) { const i = lower.indexOf(w); if (i >= 0) for (let k = i; k < i + w.length; k++) marks[k] = true; }
  const out: ReactNode[] = [];
  let i = 0;
  while (i < title.length) {
    let j = i;
    while (j < title.length && marks[j] === marks[i]) j++;
    out.push(marks[i] ? <b key={i} className="font-semibold">{title.slice(i, j)}</b> : title.slice(i, j));
    i = j;
  }
  return out;
}
