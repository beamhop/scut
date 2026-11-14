import { useEffect, useId, useRef, useState } from "react";
import { CheckCircleIcon, CheckIcon, ClockCountdownIcon, HandIcon, PauseIcon, PlayIcon, ProhibitIcon, StopIcon, UserIcon, WarningIcon, type Icon } from "@phosphor-icons/react";
import { RISK_WORD } from "@scut/protocol";
import type { Approval, ResolvedApproval } from "./lib.tsx";
import { Button, announce, clock, cx } from "./ui/index.ts";

/**
 * Activity: what the agent did, as a timeline (newest first). Built from the agent's narration plus approval decisions,
 * so "Asked you: Pay €24.90" is followed by "Allowed by you on Telegram". Replaces the old mono log.
 */

export type ActivityKind = "step" | "ask" | "allowed" | "denied" | "skipped" | "done" | "problem" | "you" | "note";
export type ActivityItem = { ts: number; kind: ActivityKind; text: string; detail?: string; count: number };

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Narration line → timeline item (plain words; "Now: opening …" becomes "Opening …"). */
export function readNarration(text: string): { kind: ActivityKind; text: string } | null {
  let m: RegExpMatchArray | null;
  if ((m = text.match(/^Now:\s*(.*)$/s))) return { kind: "step", text: cap(m[1]) };
  if ((m = text.match(/^Waiting for approval:\s*(.*)$/s))) return { kind: "ask", text: `Asked you: ${m[1]}` };
  if ((m = text.match(/^No answer about "(.*)" in (\d+) minutes/s))) return { kind: "skipped", text: `Skipped, nobody answered in ${m[2]} min: ${m[1]}` };
  if (text === "Ready") return { kind: "done", text: "Finished" };
  if ((m = text.match(/^Stuck:\s*(.*?)(?: — reply or take over to help)?$/s))) return { kind: "problem", text: `Stuck: ${m[1]}` };
  if ((m = text.match(/^Problem:\s*(.*)$/s))) return { kind: "problem", text: m[1] };
  if (text === "Budget reached") return { kind: "problem", text: "Stopped: daily spending limit reached" };
  if (/^You have control/.test(text)) return { kind: "you", text: "You took over the screen" };
  if (text === "Control handed back") return { kind: "you", text: "You gave control back" };
  if (/^Paused — waiting/.test(text)) return { kind: "you", text: "Paused until you give control back" };
  if (text === "Resumed") return { kind: "you", text: "Picked up where it left off" };
  if (text === "Stopped by you") return { kind: "you", text: "You stopped it" };
  return { kind: "note", text: cap(text) };
}

export function buildActivity(narration: { text: string; ts: number }[], resolved: ResolvedApproval[]): ActivityItem[] {
  const raw: Omit<ActivityItem, "count">[] = [];
  for (const n of narration) {
    const r = readNarration(n.text);
    if (r) raw.push({ ts: n.ts, ...r });
  }
  for (const d of resolved) {
    if (d.by === "timeout") continue; // narration already says "Skipped, nobody answered"
    raw.push({ ts: d.at, kind: d.ok ? "allowed" : "denied", text: `${d.ok ? "Allowed" : "Not allowed"} by ${d.by}: ${d.title}`, detail: d.risk ? RISK_WORD[d.risk] : undefined });
  }
  raw.sort((a, b) => a.ts - b.ts);
  const out: ActivityItem[] = [];
  for (const it of raw) {
    const prev = out.at(-1);
    if (prev && prev.kind === it.kind && prev.text === it.text) { prev.count++; prev.ts = it.ts; continue; }
    if (it.kind === "done" && (!prev || prev.kind === "done")) continue; // "Ready" at boot is not a finished task
    out.push({ ...it, count: 1 });
  }
  return out.reverse();
}

const ICON: Record<ActivityKind, { icon?: Icon; tone: string; label: string }> = {
  step: { tone: "text-ink-3", label: "Step" },
  ask: { icon: HandIcon, tone: "text-signal-ink", label: "Asked you" },
  allowed: { icon: CheckIcon, tone: "text-ink", label: "Allowed" },
  denied: { icon: ProhibitIcon, tone: "text-ink", label: "Not allowed" },
  skipped: { icon: ClockCountdownIcon, tone: "text-ink-2", label: "Skipped" },
  done: { icon: CheckCircleIcon, tone: "text-ink", label: "Finished" },
  problem: { icon: WarningIcon, tone: "text-err", label: "Problem" },
  you: { icon: UserIcon, tone: "text-ink-2", label: "You" },
  note: { tone: "text-ink-3", label: "Note" },
};
const YOU_ICON: Record<string, Icon> = { "You stopped it": StopIcon, "Paused until you give control back": PauseIcon, "Picked up where it left off": PlayIcon };

/** Screen-reader narration of new steps, throttled to one every 8 s (newest wins). Approvals are announced at once. */
export function useActivityAnnouncements(name: string, key: string, items: ActivityItem[], approvals: Approval[], where = "It's above the message box.") {
  const seen = useRef<number | undefined>(undefined);
  useEffect(() => {
    const newest = items[0];
    if (seen.current === undefined) { seen.current = newest?.ts ?? 0; return; } // history isn't news
    if (!newest || newest.ts <= seen.current) return;
    seen.current = newest.ts;
    if (newest.kind === "ask") return; // the approval itself is announced below, with its risk
    announce(`${name}: ${newest.text}`, { key: `activity:${key}`, throttleMs: newest.kind === "problem" ? 0 : 8000, assertive: newest.kind === "problem" });
  }, [items[0]?.ts, items[0]?.text]);
  const asked = useRef<Set<string> | undefined>(undefined);
  useEffect(() => {
    if (!asked.current) { asked.current = new Set(approvals.map((a) => a.id)); return; }
    for (const ap of approvals) {
      if (asked.current.has(ap.id)) continue;
      asked.current.add(ap.id);
      announce(`${name} asks to ${ap.title.charAt(0).toLowerCase()}${ap.title.slice(1)}.${ap.risk ? ` ${RISK_WORD[ap.risk]}.` : ""} ${where}`, { assertive: true });
    }
  }, [approvals]);
}

/** The timeline. Newest first, six visible, "Show all" for the rest. */
export function Activity({ items, className, limit = 6 }: { items: ActivityItem[]; className?: string; limit?: number }) {
  const [all, setAll] = useState(false);
  const id = useId();
  const shown = all ? items : items.slice(0, limit);
  return (
    <section aria-labelledby={`${id}-h`} className={className}>
      <div className="mb-1.5 flex items-baseline gap-2">
        <h2 id={`${id}-h`} className="text-body font-semibold text-ink">Activity</h2>
        <span className="text-small text-ink-3">newest first</span>
      </div>
      {items.length === 0 ? (
        <p className="py-2 text-small text-ink-3">Nothing yet. Steps show up here while it works.</p>
      ) : (
        <ol id={`${id}-list`} className="relative">
          {shown.map((it, i) => <Row key={`${it.ts}-${i}`} it={it} last={i === shown.length - 1} />)}
        </ol>
      )}
      {items.length > limit && (
        <Button size="sm" variant="quiet" className="-ml-2.5 mt-1" aria-expanded={all} aria-controls={`${id}-list`} onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${items.length}`}
        </Button>
      )}
    </section>
  );
}

function Row({ it, last }: { it: ActivityItem; last: boolean }) {
  const m = ICON[it.kind];
  const I = it.kind === "you" ? YOU_ICON[it.text] ?? m.icon : m.icon;
  const strong = it.kind !== "step" && it.kind !== "note";
  return (
    <li className="relative grid grid-cols-[3rem_1rem_minmax(0,1fr)] items-start gap-x-2 py-[3px]">
      <time dateTime={new Date(it.ts).toISOString()} className="pt-px text-right text-small tabular-nums text-ink-3">{clock(it.ts)}</time>
      <span aria-hidden className="relative grid h-[18px] place-items-center">
        {/* the rail */}
        {!last && <span className="absolute left-1/2 top-[13px] h-[calc(100%+6px)] w-px -translate-x-1/2 bg-line" />}
        {I ? <I size={14} weight={it.kind === "done" || it.kind === "problem" ? "fill" : "bold"} className={cx("relative", m.tone)} /> : <span className="relative size-[5px] rounded-full bg-line-strong" />}
      </span>
      <span className={cx("min-w-0 break-words text-body", strong ? "text-ink" : "text-ink-2", it.kind === "problem" && "text-err")}>
        {it.text}
        {it.detail && <span className="text-ink-3"> · {it.detail}</span>}
        {it.count > 1 && <span className="ml-1 text-small tabular-nums text-ink-3">×{it.count}</span>}
      </span>
    </li>
  );
}
