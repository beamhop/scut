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
  const needs = a.approvals.length > 0 || state === "stuck";
  const working = state === "busy";
  const status: Status = driving || (paused && working) ? "needs" : toStatus(state, { needs, beaming, failed: agent.beam?.stage === "failed" });
  const task = a.status?.task;
  const now = useNow(1000, working || beaming);
  const since = a.status?.since ?? a.since;

  let word = STATUS[status].word;
  if (driving) word = "You're driving";
  else if (paused) word = "Paused";
  else if (a.approvals.length) word = "Needs you";
  else if (!a.connected && a.state === "starting") word = "Connecting";

  const lastStep = [...a.narration].reverse().find((n) => /^Now:/.test(n.text));
  let headline = a.status?.headline ?? (working ? lastStep?.text.replace(/^Now:\s*/, "") ?? "Working" : state === "running" ? "Free" : STATUS[status].word);
  headline = headline.charAt(0).toUpperCase() + headline.slice(1);
  if (beaming) headline = `Moving to ${agent.beam!.to}`;
  if (paused && !driving && !a.approvals.length) headline = working || task ? `Paused. ${agent.name} waits until you resume.` : "Paused";
  else if (driving && /^Paused while you have control/.test(headline)) headline = lastStep ? `Paused at: ${lastStep.text.replace(/^Now:\s*/, "")}` : `${agent.name} is waiting for you`;

  const steps = task ? a.narration.filter((n) => n.ts >= task.startedAt && /^Now:/.test(n.text)).length : 0;
  const dayTokens = a.status?.dayTokens ?? a.stats?.dayTokens ?? a.settings?.dayTokens ?? 0;
  // The demo brain costs nothing; an unknown model's price is unknown, so the readout counts tokens instead (as Settings does).
  const eur = agent.harness === "mock" ? 0 : dayEur(dayTokens, agent.price);

  /** Second line under the headline: where the task came from, or the last reply / next routine. */
  const meta: string[] = [];
  const free = state === "running" && !beaming && !a.approvals.length && (!paused || driving);
  if (free && since) headline = `Free since ${clock(since)}`;
  if (task && working) {
    meta.push(`Started ${clock(task.startedAt)}${task.origin ? ` from ${task.origin}` : ""}`);
  } else if (free) {
    if (a.status?.lastResult) meta.push(`Last reply ${relativeTime(a.status.lastResult.ts, now)}: ${a.status.lastResult.text}`);
    if (a.status?.nextRun) meta.push(`Next: ${nextWhen(a.status.nextRun.at, now)}, ${a.status.nextRun.prompt.slice(0, 60)}`);
    if (!meta.length) meta.push(`Ready for a task. Message ${agent.name} to start one.`);
  }

  const readout: ReadoutItem[] = [{ value: driving ? "Paused" : word, status }];
  if (task && working) readout.push({ value: duration(now - task.startedAt), srLabel: "elapsed" });
  readout.push(eur === undefined && dayTokens ? { value: compact(dayTokens), label: "tokens today" } : { value: money(eur ?? 0), label: "today" });
  if (task && working) readout.push({ value: steps, label: steps === 1 ? "step" : "steps" });

  return { state, status, word, headline, meta, task, working, paused, beaming, needs, steps, eur, dayTokens, readout, since, now };
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
