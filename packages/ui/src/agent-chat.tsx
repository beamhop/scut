import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRightIcon, ArrowUpIcon } from "@phosphor-icons/react";
import type { Agent, ChatLine } from "./lib.tsx";
import type { AgentData } from "./agent-status.ts";
import { IconButton, announce, clock, cx } from "./ui/index.ts";

/**
 * The conversation: a log of plain messages (sender + time, then text; agent replies get a left rule), starters when
 * empty, and a composer that keeps taking messages while the agent works. This agent's approvals sit right above the
 * composer, where your eyes already are.
 */

export const STARTERS = [
  "Open Wikipedia and tell me today's featured article",
  "Find three well-reviewed e-bikes under €2,000, with links",
  "Every morning at 8, send me the top 3 Hacker News stories",
];

const CHANNEL: Record<string, string> = { telegram: "Telegram", slack: "Slack", discord: "Discord", nostr: "Nostr", crew: "the crew room", app: "Beamhop" };

function sender(m: ChatLine, name: string) {
  const ch = m.channel && m.channel !== "app" ? CHANNEL[m.channel] ?? m.channel : "";
  if (m.from === "agent") return { who: name, where: ch ? `to ${ch}` : "" };
  if (m.from === "owner") return { who: "You", where: ch ? `on ${ch}` : "" };
  return { who: m.from, where: ch ? `on ${ch}` : "" };
}

/** Announce the agent's replies (not your own echoes) — the log itself is aria-live="off" so it doesn't double up. */
function useReplyAnnouncements(chat: ChatLine[], name: string) {
  const seen = useRef<number | undefined>(undefined);
  useEffect(() => {
    const last = chat.at(-1);
    if (seen.current === undefined) { seen.current = last?.ts ?? 0; return; }
    if (!last || last.ts <= seen.current) return;
    seen.current = last.ts;
    if (last.from === "agent") announce(`${name} says: ${last.text.slice(0, 280)}`);
  }, [chat.length]);
}

export function ChatLog({ agent, a, inline = false, className }: { agent: Agent; a: AgentData; inline?: boolean; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useReplyAnnouncements(a.chat, agent.name);
  const task = a.status?.task;
  const working = (a.status?.state ?? a.state) === "busy";
  // Messages you sent after the current task began wait for the next step: say so instead of looking ignored.
  const queuedFrom = useMemo(() => {
    if (!working || !task) return Infinity;
    const lastAgentTs = [...a.chat].reverse().find((m) => m.from === "agent")?.ts ?? 0;
    return Math.max(task.startedAt + 250, lastAgentTs + 1);
  }, [working, task?.startedAt, a.chat]);

  // Scroll only this list (never the page: on phones that would hide the header), and only if you were at the bottom.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || inline) return;
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [a.chat.length, inline]);
  // An approval card or the pairing card appearing shrinks the list: stay pinned to the newest message.
  useEffect(() => {
    const el = box.current;
    if (!el || inline || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el);
    return () => ro.disconnect();
  }, [inline]);

  return (
    <div
      ref={box}
      role="log"
      aria-live="off"
      aria-label={`Conversation with ${agent.name}`}
      // Keyboard users can scroll the history (it's a scroll container with no controls inside most of the time).
      tabIndex={inline ? undefined : 0}
      onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}
      className={cx(!inline && "min-h-0 flex-1 overflow-y-auto focus-visible:outline-offset-[-2px]", className)}
    >
      <div className="space-y-4 px-4 py-4">
        {a.chat.length === 0 && <Starters name={agent.name} onPick={(text) => a.send({ t: "chat", text })} />}
        {a.chat.map((m, i) => {
          const s = sender(m, agent.name);
          const own = m.from === "owner";
          const queued = own && m.ts >= queuedFrom;
          const prev = a.chat[i - 1];
          const grouped = prev && prev.from === m.from && prev.channel === m.channel && m.ts - prev.ts < 120_000;
          return (
            <div key={`${m.ts}-${i}`} className={cx(grouped && "-mt-2.5")}>
              {!grouped && (
                <div className="mb-0.5 flex items-baseline gap-1.5 text-small">
                  <span className="font-semibold text-ink">{s.who}</span>
                  {s.where && <span className="text-ink-2">{s.where}</span>}
                  <time dateTime={new Date(m.ts).toISOString()} className="tabular-nums text-ink-3">{clock(m.ts)}</time>
                </div>
              )}
              <div className={cx("whitespace-pre-wrap break-words text-body", m.from === "agent" ? "border-l-2 border-line-strong pl-3 text-ink" : "text-ink")}>
                {grouped && <span className="sr-only">{s.who}, {clock(m.ts)}: </span>}
                {m.text}
              </div>
              {queued && <div className="mt-1 text-small text-ink-3">Queued. {agent.name} reads it after this step.</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Starters({ name, onPick }: { name: string; onPick: (s: string) => void }) {
  const id = useId();
  return (
    <div className="pt-6">
      <h3 id={id} className="text-ui-lg text-ink">Say hi to {name}, or try one of these:</h3>
      <ul aria-labelledby={id} className="mt-3 divide-y divide-line overflow-hidden rounded-unit border border-line bg-surface">
        {STARTERS.map((s) => (
          <li key={s}>
            <button type="button" onClick={() => onPick(s)} className="pressable group flex min-h-11 w-full items-center gap-3 px-3.5 py-2.5 text-left text-body text-ink hover:bg-surface-2">
              <span className="flex-1">{s}</span>
              <ArrowRightIcon size={14} aria-hidden className="shrink-0 text-ink-3 group-hover:text-ink" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Textarea composer: Enter sends, Shift+Enter is a new line. Keeps working while the agent works (messages queue). */
export function Composer({ agent, a, size = "md", above, className }: { agent: Agent; a: AgentData; size?: "md" | "lg"; above?: ReactNode; className?: string }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const working = (a.status?.state ?? a.state) === "busy";
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };
  useLayoutEffect(fit, [text]);
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    a.send({ t: "chat", text: t });
    setText("");
  };
  const big = size === "lg";
  return (
    <div className={className}>
      {above}
      <form
        className={cx("flex items-end gap-2 rounded-unit border border-line-strong bg-surface p-1.5 pl-3 focus-within:border-ink focus-within:shadow-[0_0_0_1px_var(--color-ink)]", big && "p-1 pl-3")}
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <textarea
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
          aria-label={`Message ${agent.name}`}
          aria-describedby={hintId}
          enterKeyHint="send"
          placeholder={working ? `Add to what ${agent.name} is doing…` : `Message ${agent.name}…`}
          className={cx("max-h-40 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-body text-ink outline-none", big && "py-2.5 text-[16px] leading-[22px]")}
        />
        <IconButton type="submit" label="Send" icon={ArrowUpIcon} variant="primary" size={big ? "md" : "sm"} disabled={!text.trim()} className={cx(big && "size-11")} />
      </form>
      <p id={hintId} className={cx("mt-1.5 px-1 text-micro text-ink-3", big && "sr-only")}>
        {working ? `${agent.name} is working. New messages are read after the current step.` : "Enter to send · Shift+Enter for a new line"}
      </p>
    </div>
  );
}
