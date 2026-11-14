import { useEffect, useState } from "react";
import type { Agent } from "./lib.tsx";
import type { useAgent } from "./useAgent.ts";
import { STATUS, clock, compact, duration, money, relativeTime, toStatus, tokensEur, type ReadoutItem, type Status } from "./ui/index.ts";

/**
 * Everything the agent view says about "what is happening now", derived once from the socket data:
 * status (word + shape), the headline sentence, elapsed time, € today, steps. One source, so the header, the readout
 * and the phone layout never disagree.
 */

export type AgentData = ReturnType<typeof useAgent>;

/**
 * Something that stops the agent from working, with the setting that fixes it. From the agent's status
 * (`status.problem`, newer agents); older agents don't send it, so "no brain" is also worked out here from Settings.
 */
export type AgentProblem = { text: string; fix?: "brain" | "channel" | "key" | "signin" };
/** Which Settings section fixes a problem. */
export const FIX_SECTION = { brain: "brain", key: "brain", signin: "brain", channel: "apps" } as const;
/** A problem in two or three words, for the headline and the readout (the full sentence goes under it). */
export function problemLabel(p: AgentProblem): string {
  return p.fix === "brain" ? "Needs a brain" : p.fix === "key" ? "Needs a new key" : p.fix === "signin" ? "Needs to sign in" : p.fix === "channel" ? "A chat app can't sign in" : p.text;
}
/** The button that fixes a problem, verb first. */
export const FIX_LABEL = { brain: "Add a brain", key: "Fix the key", signin: "Sign in", channel: "Fix the chat app" } as const;

/** Harnesses that think with a model from Settings (demo and subscription agents don't). */
const MODEL_HARNESS = ["pi", "opencode"];
export function agentProblem(a: Pick<AgentData, "status" | "settings">, agent: Pick<Agent, "harness">): AgentProblem | undefined {
  const p = (a.status as { problem?: AgentProblem } | undefined)?.problem ?? (a.settings as { problem?: AgentProblem } | undefined)?.problem;
  if (p?.text) return p;
  // Older agents don't send `problem`: work out "no brain" from Settings, but only when the harness is known to need a
  // model (the phone page may not know the harness; demo and subscription agents never need one).
  if (a.settings && !a.settings.model && MODEL_HARNESS.includes(agent.harness ?? "")) return { text: "No brain yet", fix: "brain" };
  return undefined;
}

/** One line on what a problem means for you, for under the headline and the composer. */
export function problemMeta(p: AgentProblem, name: string): string {
  if (p.fix === "brain") return `${name} can't think yet, so it can't do tasks. Adding a brain takes about 2 minutes.`;
  if (p.fix === "signin") return `${name} can't think until it's signed in to its subscription. Sign in from Settings: a link and a code, no password.`;
  if (p.fix === "key") return `${name} can't think until its brain's key works. Paste a new key in Settings.`;
  if (p.fix === "channel") return `Messages and approvals from that chat app don't reach ${name}.`;
  return `${name} can't continue until this is fixed.`;
}

/** Raw errors ("JSON Parse error", "ECONNREFUSED") never become the headline; they go in a Details disclosure. */
const JARGON = /error|exception|parse|ECONN|undefined|errno|ETIMEDOUT|\bat \w+\.|[{}]/i;
export function plainProblem(text: string, name: string): { text: string; raw?: string } {
  if (!JARGON.test(text)) return { text };
  const stuck = /^stuck\b/i.test(text);
  return { text: stuck ? `${name} hit a problem and stopped` : `${name} hit a problem`, raw: text.replace(/^(stuck|problem):\s*/i, "") };
}

/** Re-render every `ms` while `on` (for ticking elapsed times). */
export function useNow(ms: number, on = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, on]);
  return now;
}

/** € for a day's tokens at the agent's model price (input-heavy blend, like the settings estimate). */
export function dayEur(dayTokens: number, price?: { in: number; out: number }): number | undefined {
  if (!price) return undefined;
  return tokensEur({ input: dayTokens * 0.8, output: dayTokens * 0.2 }, price);
}

export function useAgentNow(a: AgentData, agent: Agent, driving: boolean) {
  const beaming = !!agent.beam && !["online", "failed"].includes(agent.beam.stage);
  const state = a.status?.state ?? a.state;
  const paused = a.paused;
  // You have the screen here, or in another window (the agent says so with status.control).
  const control = driving || (paused && !!(a.status as { control?: boolean } | undefined)?.control);
  const needs = a.approvals.length > 0 || state === "stuck";
  const working = state === "busy";
  const problem = agentProblem(a, agent);
  // A brain or key problem stops all work, so it is the status; a broken chat app is shown, but the agent still works.
  const blocking = !!problem && problem.fix !== "channel" && !working && !needs && !driving && !beaming;
  const status: Status = driving || (paused && working) ? "needs" : blocking ? "problem" : toStatus(state, { needs, beaming, failed: agent.beam?.stage === "failed" });
  const task = a.status?.task;
  const now = useNow(1000, working || beaming);
  const since = a.status?.since ?? a.since;

  let word = STATUS[status].word;
  if (driving) word = "You're driving";
  else if (paused) word = "Paused";
  else if (a.approvals.length) word = "Needs you";
  else if (!a.connected && a.state === "starting") word = "Connecting";

  const lastStep = [...a.narration].reverse().find((n) => /^Now:/.test(n.text));
  const step = lastStep?.text.replace(/^Now:\s*/, "");
  let headline = a.status?.headline ?? (working ? step ?? "Working" : state === "running" ? "Ready" : STATUS[status].word);
  // URLs read as their site in one-line places; the full address is in the screen's bar.
  headline = headline.charAt(0).toUpperCase() + headline.slice(1).replace(/https?:\/\/([^/\s]+)\S*/g, (_, h: string) => h.replace(/^www\./, ""));
  /** The raw text behind a "hit a problem" headline, for a Details disclosure. */
  let raw: string | undefined;
  if (state === "stuck" || /^(stuck|problem):/i.test(headline)) ({ text: headline, raw } = plainProblem(headline, agent.name));

  /** Second line under the headline: where the task came from, or the last reply / next routine. */
  const meta: string[] = [];
  const idle = state === "running" && !beaming && !a.approvals.length && !paused && !control;
  if (beaming) headline = `Moving to ${agent.beam!.to}`;
  else if (control) {
    // The person has the agent's computer: say so, never "Ready since…".
    headline = "You have control";
    meta.push(step && (working || task) ? `${agent.name} is paused at: ${step}. It continues when you give it back.` : `${agent.name} is paused until you give it back.`);
  } else if (paused && !a.approvals.length) {
    headline = working || task ? `Paused. ${agent.name} waits until you resume.` : "Paused";
  } else if (blocking) {
    headline = problemLabel(problem!);
    meta.push(problemMeta(problem!, agent.name));
  } else if (idle) {
    // Idle: news first ("Skipped: … (you said no)" from the agent), else what's next; the time goes in the meta line.
    if (!a.status?.headline || /^(ready|free)\b/i.test(a.status.headline)) headline = "Ready for a task";
    if (since) meta.push(`Since ${clock(since)}`);
    if (a.status?.lastResult) meta.push(`Last reply ${relativeTime(a.status.lastResult.ts, now)}: ${a.status.lastResult.text}`);
    if (a.status?.nextRun) meta.push(`Next: ${nextWhen(a.status.nextRun.at, now)}, ${a.status.nextRun.prompt.slice(0, 60)}`);
    if (!a.status?.lastResult && !a.status?.nextRun) meta.push(`Message ${agent.name} to start one.`);
  }
  if (task && working && !control) meta.push(`Started ${clock(task.startedAt)}${task.origin ? ` from ${task.origin}` : ""}`);

  const steps = task ? a.narration.filter((n) => n.ts >= task.startedAt && /^Now:/.test(n.text)).length : 0;
  const dayTokens = a.status?.dayTokens ?? a.stats?.dayTokens ?? a.settings?.dayTokens ?? 0;
  // The demo brain costs nothing; an unknown model's price is unknown, so the readout counts tokens instead (as Settings does).
  const eur = agent.harness === "mock" ? 0 : dayEur(dayTokens, agent.price);

  const readout: ReadoutItem[] = [{ value: control ? "You have control" : blocking ? problemLabel(problem!) : word, status }];
  if (task && working && !driving) readout.push({ value: duration(now - task.startedAt), srLabel: "elapsed" });
  readout.push(eur === undefined && dayTokens ? { value: compact(dayTokens), label: "tokens today" } : { value: money(eur ?? 0), label: "today" });
  if (task && working && !driving) readout.push({ value: steps, label: steps === 1 ? "step" : "steps" });

  return { state, status, word, headline, raw, control, meta, task, working, paused, beaming, needs, steps, eur, dayTokens, readout, since, now, problem, blocking };
}

/** "14:00" today, "Tomorrow 08:00", or a weekday. */
function nextWhen(at: number, now: number) {
  const d = new Date(at), n = new Date(now);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(n)) / 86_400_000);
  const t = clock(at);
  if (diff <= 0) return t;
  if (diff === 1) return `Tomorrow ${t}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${t}`;
}
