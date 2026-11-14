// Settings for one agent. Rendered as the body of the agent view's Settings drawer (~440 px): no chrome of its own,
// sections stacked in the order of DESIGN-PLAN §4.4, each with a real heading (h3; the drawer title is the h2).
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { Schedule, MemoryItem, TaskRun } from "@scut/protocol";
import { nextRunAt } from "@scut/protocol";
import { nip19 } from "nostr-tools";
import qrcode from "qrcode-generator";
import {
  ArrowSquareOutIcon, CaretDownIcon, CheckCircleIcon, CheckIcon, CircleIcon, CopyIcon, PlayIcon, ShieldCheckIcon, ShieldWarningIcon,
  TrashIcon, TriangleIcon, XIcon,
} from "@phosphor-icons/react";
import { api, PRESETS, TELEGRAM_SETUP, type Agent } from "./lib.tsx";
import type { useAgent } from "./useAgent.ts";
import {
  Button, Dialog, Field, IconButton, Input, Lamp, Progress, Segmented, Select, Switch, Textarea, announce, clock, compact, cx,
  durationWords, money, num, percent, plural, relativeTime,
} from "./ui/index.ts";
import { ChoiceTile, eurToTokens, KEY_URL, modelName, Notice, parseEuro, PROVIDER_NOTE, providerOf, SUBSCRIPTIONS, tokensToEur } from "./settings-parts.tsx";
import { agentProblem, FIX_LABEL, FIX_SECTION, problemLabel, problemMeta, type AgentProblem } from "./agent-status.ts";

type A = ReturnType<typeof useAgent>;

/** Section ids, so the safety check (and the header's safety shield) can jump to the setting that fixes a thing. */
export const SETTINGS_SECTIONS = {
  safety: "set-safety", job: "set-job", brain: "set-brain", autonomy: "set-autonomy", spending: "set-spending", apps: "set-apps",
  tasks: "set-tasks", memory: "set-memory", skills: "set-skills", health: "set-health", remove: "set-remove",
} as const;
export type SettingsSection = keyof typeof SETTINGS_SECTIONS;

function jumpTo(section: SettingsSection, open = false) {
  const el = document.getElementById(SETTINGS_SECTIONS[section]);
  if (!el) return;
  // "Add a brain" from the problem callout or the safety list opens the brain form, not just the section.
  if (open && section === "brain") el.dispatchEvent(new CustomEvent("beamhop:open-brain"));
  // Scroll only the drawer's own scroller: scrollIntoView would also shift overflow-hidden ancestors (the drawer frame).
  const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  let sc = el.parentElement;
  while (sc && !(/(auto|scroll)/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight)) sc = sc.parentElement;
  if (sc) sc.scrollTo({ top: sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 16, behavior });
  else el.scrollIntoView({ block: "start", behavior });
  el.querySelector<HTMLElement>("h3")?.focus({ preventScroll: true });
}

/** A settings section: hairline on top, an h3 (focusable by script, for jumps), optional note, then the controls. */
function Section({ id, title, note, aside, children, className }: { id: SettingsSection; title: ReactNode; note?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={SETTINGS_SECTIONS[id]} aria-labelledby={`${SETTINGS_SECTIONS[id]}-h`} className={cx("scroll-mt-4 border-t border-line pt-5 pb-6 first:border-t-0 first:pt-0", className)}>
      <div className="mb-3 flex items-baseline gap-3">
        <h3 id={`${SETTINGS_SECTIONS[id]}-h`} tabIndex={-1} className="min-w-0 flex-1 text-ui-lg text-ink outline-none focus-visible:outline-2">{title}</h3>
        {aside && <span className="shrink-0 text-small tabular-nums text-ink-2">{aside}</span>}
      </div>
      {note && <p className="-mt-2 mb-3 text-small text-ink-2">{note}</p>}
      {children}
    </section>
  );
}

/**
 * Everything about one agent, safest-first: is it safe → what it does and thinks with → how free it is → what it may
 * spend → where to reach it → routines → what it knows → skills → its computer → the end.
 * `section` scrolls to one section when the drawer opens (e.g. "safety" from the header shield).
 */
export function SettingsPanel({ a, agent, onClose, section }: { a: A; agent: Agent; onClose?: () => void; section?: SettingsSection }) {
  void onClose; // the hosting drawer has the close button; kept for compatibility
  useEffect(() => {
    if (section && a.settings) requestAnimationFrame(() => jumpTo(section));
  }, [section, !!a.settings]);
  if (!a.settings) return <p className="text-body text-ink-2" role="status">Loading {agent.name}'s settings…</p>;
  const problem = agentProblem(a, agent);
  return (
    <div className="text-body text-ink">
      {problem && <ProblemCallout problem={problem} name={agent.name} />}
      <SafetyCheck a={a} agent={agent} />
      <PersonaSettings a={a} name={agent.name} />
      <BrainSettings a={a} name={agent.name} id={agent.id} harness={agent.harness} problem={problem?.fix === "brain" || problem?.fix === "key" || problem?.fix === "signin" ? problem : undefined} autoOpen={section === "brain" && (problem?.fix === "brain" || problem?.fix === "key")} />
      <AutonomySettings a={a} name={agent.name} />
      <SpendingSettings a={a} agent={agent} />
      <ChannelSettings a={a} agent={agent} />
      <Schedules a={a} agent={agent} />
      <MemorySettings a={a} name={agent.name} />
      <SkillSettings a={a} name={agent.name} />
      <ComputerHealth a={a} name={agent.name} />
      <RemoveAgent agent={agent} />
    </div>
  );
}

/** What stops the agent from working, first thing in the drawer, with the button that goes to the fix. */
function ProblemCallout({ problem, name }: { problem: AgentProblem; name: string }) {
  const to = problem.fix ? FIX_SECTION[problem.fix] : undefined;
  return (
    <div className="mb-5 flex items-start gap-2.5 rounded-unit border border-err/45 bg-surface px-3 py-2.5">
      <Lamp status="problem" size={14} className="mt-[3px]" />
      <div className="min-w-0 flex-1">
        <p className="text-ui-lg text-ink">{problemLabel(problem)}</p>
        <p className="mt-0.5 text-small text-ink-2">{problem.fix === "channel" ? problem.text : problemMeta(problem, name)}</p>
      </div>
      {to && <Button size="sm" variant="signal" onClick={() => jumpTo(to, true)} className="shrink-0">{FIX_LABEL[problem.fix!]}</Button>}
    </div>
  );
}

// ---------------- safety ----------------

/** Plain-language safety posture for one agent: what protects you, and what to look at (`to` = the section that fixes it). */
export function safetyItems(a: A, agent: Agent) {
  const s = a.settings!;
  const items: { ok: boolean; text: string; to?: SettingsSection; fix?: string }[] = [];
  // A brain that's missing or rejected is not "all good": the agent can't do what you ask, and the shield must say so.
  const problem = agentProblem(a, agent);
  if (problem?.fix === "brain") items.push({ ok: false, text: "No brain yet, so it can't think or do tasks", to: "brain", fix: FIX_LABEL.brain });
  else if (problem?.fix === "signin") items.push({ ok: false, text: `${problem.text.replace(/ Sign in in Settings → Brain\.$/, "")} It can't think until it is`, to: "brain", fix: FIX_LABEL.signin });
  else if (problem?.fix === "key") items.push({ ok: false, text: `${problem.text}. It can't think until the key works`, to: "brain", fix: FIX_LABEL.key });
  items.push(s.unsandboxed
    ? { ok: false, text: "No sandbox: it runs as a normal program on this computer. It has its own browser and asks before touching anything outside its folder, but nothing walls it off. Beam it to a cloud to wall it off" }
    : { ok: true, text: "Works on its own separate computer, away from your files and accounts" });
  items.push(s.autonomy === "auto"
    ? { ok: false, text: "Never asks before acting. \"Risky only\" still lets it work alone but checks payments, messages and logins with you", to: "autonomy" }
    : { ok: true, text: s.autonomy === "ask" ? "Asks you before every action" : "Asks you before payments, messages, deletes and logins", to: "autonomy" });
  if (!s.dailyTokenBudget) items.push({ ok: false, text: "No daily spending limit", to: "spending" });
  else {
    const pct = s.dayTokens / s.dailyTokenBudget;
    const cap = agent.price ? `${money(tokensToEur(s.dailyTokenBudget, agent.price), { approx: true })} a day` : `${compact(s.dailyTokenBudget)} tokens a day`;
    items.push({ ok: pct < 0.9, text: `Stops at ${cap}; ${percent(Math.min(1, pct))} used today`, to: "spending" });
  }
  const names: Record<string, string> = { telegram: "Telegram", slack: "Slack", discord: "Discord" };
  for (const k of Object.keys(names)) {
    if (!(s.channels as Record<string, boolean>)[k]) continue;
    const c = a.pairing?.channels?.[k];
    const owner = c?.owner;
    if (c?.error) { items.push({ ok: false, text: `${names[k]} can't sign in, so messages and approvals there don't arrive`, to: "apps" }); continue; }
    items.push(owner
      ? { ok: true, text: `${names[k]}: anyone in the chat can ask, only you (${owner}) can approve risky things`, to: "apps" }
      : { ok: false, text: `${names[k]}: not paired yet, so risky actions can only be approved here`, to: "apps" });
  }
  items.push({ ok: true, text: "Beams are end-to-end encrypted; only one copy can run at a time" });
  return items;
}

/** "Safety: all good" / "Safety: 2 things to look at", for the header shield. */
export function safetySummary(a: A, agent: Agent) {
  if (!a.settings) return undefined;
  const todo = safetyItems(a, agent).filter((i) => !i.ok).length;
  return { todo, text: todo ? `Safety: ${plural(todo, "thing")} to look at` : "Safety: all good" };
}

export function SafetyCheck({ a, agent }: { a: A; agent: Agent }) {
  const items = safetyItems(a, agent);
  const todo = items.filter((i) => !i.ok).length;
  const [open, setOpen] = useState(todo > 0);
  const listId = useId();
  const Shield = todo ? ShieldWarningIcon : ShieldCheckIcon;
  return (
    <section id={SETTINGS_SECTIONS.safety} aria-labelledby={`${SETTINGS_SECTIONS.safety}-h`} className="scroll-mt-4 pb-6">
      <div className={cx("rounded-unit border", todo ? "border-signal/45 bg-signal-wash" : "border-line bg-surface-2")}>
        <h3 id={`${SETTINGS_SECTIONS.safety}-h`} tabIndex={-1} className="outline-none">
          <button onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={listId} className="flex w-full items-center gap-2.5 rounded-unit px-3 py-2.5 text-left">
            <Shield size={20} weight={todo ? "fill" : "regular"} aria-hidden className={todo ? "text-signal-ink" : "text-ink"} />
            <span className="min-w-0 flex-1 text-ui-lg">{todo ? `Safety: ${plural(todo, "thing")} to look at` : "Safety: all good"}</span>
            <CaretDownIcon size={14} weight="bold" aria-hidden className={cx("shrink-0 text-ink-2 transition-transform duration-(--dur-pop)", open && "rotate-180")} />
          </button>
        </h3>
        <ul id={listId} hidden={!open} className={cx("space-y-2 rounded-b-unit border-t px-3 pb-3 pt-2.5", todo ? "border-signal/30 bg-surface" : "border-line")}>
          {items.map((i) => (
            <li key={i.text} className="flex items-start gap-2.5">
              {i.ok
                ? <CheckIcon size={14} weight="bold" aria-label="OK" role="img" className="mt-[3px] shrink-0 text-ink-2" />
                : <TriangleIcon size={13} weight="fill" aria-label="Look at this" role="img" className="mt-[3px] shrink-0 text-signal" />}
              <span className={cx("min-w-0 flex-1", i.ok ? "text-ink-2" : "text-ink")}>{i.text}</span>
              {!i.ok && i.to && <Button size="sm" variant="secondary" onClick={() => jumpTo(i.to!, true)} className="-my-0.5">{i.fix ?? (i.to === "apps" ? "Show" : "Change")}</Button>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ---------------- what it does ----------------

export function PersonaSettings({ a, name }: { a: A; name: string }) {
  const saved = a.settings?.persona ?? "";
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  const dirty = text !== saved;
  return (
    <Section id="job" title={`What ${name} does`}>
      <Field label="Job description" hint={`${name} reads this before every task. Plain words work best.`}>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3} aria-label={`What ${name} does`}
          placeholder="e.g. Keep an eye on my inbox and draft replies for me to approve" />
      </Field>
      {dirty && (
        <div className="mt-2 flex justify-end gap-2">
          <Button size="sm" variant="quiet" onClick={() => setText(saved)}>Undo</Button>
          <Button size="sm" variant="primary" onClick={() => { a.send({ t: "settings", persona: text }); announce(`Saved what ${name} does`); }}>Save</Button>
        </div>
      )}
    </Section>
  );
}

// ---------------- brain ----------------

/** Brains offered in Settings: a provider's API (with Pi or opencode), a subscription (Codex, Copilot CLI), or the demo. */
type BrainChoice = "openrouter" | "openai" | "anthropic" | "ollama" | "codex" | "copilot" | "mock";
const API_KINDS = ["openrouter", "openai", "anthropic", "ollama"] as const;
const SOFTWARE_NAME: Record<string, string> = { pi: "Pi", opencode: "opencode", codex: "Codex", copilot: "Copilot CLI", mock: "Demo" };

/**
 * Change what an agent thinks with, any time after it's made: the provider and model, the key, the agent software
 * (Pi, opencode) or a subscription (ChatGPT through Codex, GitHub Copilot). An agent busy with a task finishes it
 * first, then switches. An expired key shouldn't strand an agent, and neither should a brain you're unhappy with.
 */
export function BrainSettings({ a, name, id, harness: recHarness, problem, autoOpen }: { a: A; name: string; id: string; harness?: string; problem?: AgentProblem; autoOpen?: boolean }) {
  const m = a.settings?.model;
  const harness = a.settings?.harness ?? recHarness;
  const [open, setOpen] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<BrainChoice>("openrouter");
  const [software, setSoftware] = useState<"pi" | "opencode">("pi");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [check, setCheck] = useState<{ busy?: boolean; error?: string }>({});
  const [models, setModels] = useState<string[]>([]);
  const group = useId();
  const sub = SUBSCRIPTIONS.find((s) => s.harness === harness);
  const prov = providerOf(m?.baseUrl);
  const isApi = (k: BrainChoice): k is (typeof API_KINDS)[number] => (API_KINDS as readonly string[]).includes(k);
  const current: BrainChoice = harness === "mock" ? "mock" : sub && !m?.baseUrl ? sub.harness : ((prov ?? "openrouter") as BrainChoice);
  const start = () => {
    const k = current;
    const p = isApi(k) ? k : "openrouter";
    setKind(k); setSoftware(harness === "opencode" ? "opencode" : "pi");
    setBaseUrl(m?.baseUrl && isApi(k) ? m.baseUrl : PRESETS[p].baseUrl); setModel(m?.model && isApi(k) ? m.model : PRESETS[p].model);
    setKey(""); setCheck({}); setOpen(true);
  };
  const pick = (v: string) => {
    const k = v as BrainChoice;
    setKind(k); setCheck({}); setModels([]);
    if (isApi(k)) { setBaseUrl(PRESETS[k].baseUrl); setModel(k === prov && m ? m.model : PRESETS[k].model); }
  };
  const sameEndpoint = baseUrl === m?.baseUrl;
  /** Tell the app first (it installs the agent software when there's no sandbox), then the agent. */
  async function apply(msg: { harness: string; model: { api: string; baseUrl: string; model: string; apiKey?: string } | null | undefined }, words: string) {
    const r = await fetch(`/api/agents/${id}/model`, {
      method: "POST",
      body: JSON.stringify({ harness: msg.harness, baseUrl: msg.model?.baseUrl, model: msg.model === null ? null : msg.model?.model }),
    }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    if (r?.error) return setCheck({ error: r.error });
    a.send({ t: "settings", harness: msg.harness as "pi", ...(msg.model !== undefined ? { model: msg.model as { api: "openai-completions"; baseUrl: string; model: string } | null } : {}) });
    announce(`${name} now thinks with ${words}`);
    setOpen(false);
    setCheck({});
  }
  async function save() {
    setCheck({ busy: true });
    if (kind === "mock") return apply({ harness: "mock", model: undefined }, "the demo brain");
    if (kind === "codex" || kind === "copilot") return apply({ harness: kind, model: null }, `your ${SUBSCRIPTIONS.find((s) => s.harness === kind)!.label} subscription`);
    const r = await api.verifyBrain({ provider: "scut", api: PRESETS[kind].api, baseUrl, apiKey: key || undefined, model });
    if (r.models?.length) setModels(r.models);
    // A saved key for this endpoint lives in the agent, not here: only insist on a check when a new key or endpoint is given.
    if (!r.ok && (key || !sameEndpoint)) return setCheck({ error: r.error });
    if (r.ok && r.modelFound === false) return setCheck({ error: `The key works, but "${model}" isn't offered there. Pick another model.` });
    await apply({ harness: software, model: { api: PRESETS[kind].api, baseUrl, model, apiKey: key || undefined } }, `${modelName(model)} through ${SOFTWARE_NAME[software]}`);
  }
  // Opened from "Add a brain" / "Fix the key": go straight to the form.
  useEffect(() => { if (autoOpen) start(); }, [autoOpen]);
  useEffect(() => {
    const el = sectionRef.current?.closest("section");
    if (!el) return;
    const on = () => { if (!open) start(); };
    el.addEventListener("beamhop:open-brain", on);
    return () => el.removeEventListener("beamhop:open-brain", on);
  });
  const busyNow = a.status?.state === "busy";
  return (
    <Section id="brain" title="Brain">
      <div ref={sectionRef} hidden />
      {problem && problem.fix !== "signin" && (
        <Notice className="mb-3">
          <span className="font-medium">{problemLabel(problem)}.</span> {problemMeta(problem, name)}
        </Notice>
      )}
      {!open ? (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-medium">{harness === "mock" ? "Demo" : sub && !m?.baseUrl ? `${sub.label} subscription` : m ? modelName(m.model) : "None yet"}</div>
            <div className="mt-0.5 text-small text-ink-2">
              {harness === "mock" ? "No brain: it answers with practice replies."
                : sub && !m?.baseUrl ? `Through ${SOFTWARE_NAME[harness!]}${a.settings?.subModel ? ` · ${a.settings.subModel}` : ""}`
                : m ? <>{SOFTWARE_NAME[harness ?? "pi"] ?? harness} · {prov ? PRESETS[prov].label : m.baseUrl} · {m.hasKey || prov === "ollama" ? "key saved" : "no key"} · <span className="font-mono text-[11.5px]">{m.model}</span></>
                : `${name} can't think until it has one.`}
            </div>
          </div>
          <Button size="sm" variant={problem && !(sub && !m?.baseUrl) ? "signal" : "secondary"} onClick={start}>{problem && !(sub && !m?.baseUrl) ? FIX_LABEL[problem.fix === "key" ? "key" : "brain"] : "Change"}</Button>
        </div>
      ) : null}
      {!open && sub && !m?.baseUrl && <div className="mt-3"><SubscriptionPanel a={a} name={name} kind={sub.harness} label={sub.label} /></div>}
      {!open ? null : (
        <div className="space-y-3">
          <fieldset>
            <legend className="mb-1.5 text-small font-medium">Thinks with</legend>
            <div className="grid grid-cols-2 gap-1.5">
              {API_KINDS.map((k) => (
                <ChoiceTile key={k} size="sm" name={group} value={k} checked={kind === k} onChange={pick} title={PRESETS[k].label} />
              ))}
              {SUBSCRIPTIONS.map((s) => (
                <ChoiceTile key={s.harness} size="sm" name={group} value={s.harness} checked={kind === s.harness} onChange={pick} title={`${s.label} subscription`} />
              ))}
              <ChoiceTile size="sm" name={group} value="mock" checked={kind === "mock"} onChange={pick} title="Demo" className="col-span-2" />
            </div>
            <p className="mt-1.5 text-small text-ink-2">
              {isApi(kind) ? PROVIDER_NOTE[kind]
                : kind === "mock" ? "No brain and no cost: practice replies, to try things out."
                : `${SUBSCRIPTIONS.find((s) => s.harness === kind)!.note}. No key: ${name} asks you to sign in once, on its own screen.`}
            </p>
          </fieldset>
          {isApi(kind) && (<>
            <Field label="Model" hint="As the provider names it.">
              <Input mono aria-label={`${name}'s model`} list="brain-models" value={model} onChange={(e) => { setModel(e.target.value); setCheck({}); }} />
            </Field>
            <datalist id="brain-models">{models.map((x) => <option key={x} value={x} />)}</datalist>
            {kind !== "ollama" && (
              <Field label="API key" aside="Stays on this computer"
                hint={KEY_URL[kind] && <>Get one at <a href={KEY_URL[kind]} target="_blank" rel="noreferrer" className="text-ink">{KEY_URL[kind].replace("https://", "")}</a></>}>
                <Input mono type="password" autoComplete="off" spellCheck={false} aria-label={`${name}'s API key`} value={key}
                  onChange={(e) => { setKey(e.target.value); setCheck({}); }}
                  placeholder={sameEndpoint && m?.hasKey ? "Keep the current key, or paste a new one" : PRESETS[kind].keyHint} />
              </Field>
            )}
            <Segmented legend="Agent software" size="sm" value={software} onChange={setSoftware}
              options={[
                { value: "pi", label: "Pi", description: "The default. Works with any brain above." },
                { value: "opencode", label: "opencode", description: "An open-source coding agent." },
              ]} />
            <details className="text-small text-ink-2">
              <summary className="w-fit rounded-control">Endpoint</summary>
              <div className="mt-2"><Input mono aria-label="Endpoint" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setCheck({}); }} /></div>
            </details>
          </>)}
          {busyNow && <p className="text-small text-ink-2">{name} is working on something: it finishes that first, then switches.</p>}
          {check.error && <Notice alert>{check.error}</Notice>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="quiet" onClick={() => { setOpen(false); setCheck({}); }}>Cancel</Button>
            <Button size="sm" variant="primary" loading={check.busy} disabled={isApi(kind) && (!model || !baseUrl)} onClick={save}>{check.busy ? "Checking…" : "Save"}</Button>
          </div>
        </div>
      )}
    </Section>
  );
}

/**
 * A subscription brain: is the agent signed in, and a way to sign in right here (a link and a one-time code from the
 * CLI's device login, opened on any device where you're signed in), try again, or sign out. Plus the model to use.
 */
function SubscriptionPanel({ a, name, kind, label }: { a: A; name: string; kind: "codex" | "copilot"; label: string }) {
  const s = a.signin?.harness === kind ? a.signin : undefined;
  const [copied, setCopied] = useState(false);
  const [custom, setCustom] = useState(a.settings?.subModel ?? "");
  useEffect(() => setCustom(a.settings?.subModel ?? ""), [a.settings?.subModel]);
  const send = (op: "start" | "cancel" | "check" | "signout") => a.send({ t: "signin", op });
  const setModel = (v: string) => { a.send({ t: "settings", subModel: v || null }); announce(v ? `${name} now uses ${v}` : `${name} uses ${label}'s default model`); };
  const models = a.settings?.subModels ?? [];
  const state = s?.state ?? "checking";
  return (
    <div className="space-y-3 rounded-unit border border-line bg-surface-2 p-3">
      <div className="flex items-start gap-2.5">
        {state === "signed-in" ? <CheckCircleIcon size={18} weight="fill" className="mt-px shrink-0 text-ok" aria-hidden />
          : <CircleIcon size={18} className="mt-px shrink-0 text-ink-3" aria-hidden />}
        <div className="min-w-0 flex-1" role="status">
          <div className="font-medium text-ink">
            {state === "signed-in" ? `Signed in to ${label}` : state === "waiting" ? `Waiting for you to sign in to ${label}` : state === "checking" ? "Checking the sign-in…" : `Not signed in to ${label}`}
          </div>
          <div className="mt-0.5 text-small text-ink-2">
            {state === "signed-in" ? (s?.account ?? `${name} uses your ${label} subscription.`)
              : state === "waiting" ? "Open the link on any device where you're signed in, and enter the code."
              : state === "error" ? s?.error
              : state === "checking" ? null
              : `${name} can't think until it's signed in. No password goes through Beamhop.`}
          </div>
        </div>
        {state === "signed-in" && <Button size="sm" variant="quiet" onClick={() => send("signout")}>Sign out</Button>}
        {(state === "signed-out" || state === "error") && <Button size="sm" variant="primary" onClick={() => send("start")}>{state === "error" ? "Try again" : "Sign in"}</Button>}
      </div>
      {state === "waiting" && s?.url && s.code && (
        <div className="space-y-2 rounded-control border border-line bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-ui-lg tracking-[0.12em] text-ink" aria-label={`Code ${s.code.split("").join(" ")}`}>{s.code}</span>
            <IconButton size="sm" label={copied ? "Copied" : "Copy the code"} icon={copied ? CheckIcon : CopyIcon}
              onClick={() => { navigator.clipboard?.writeText(s.code!); setCopied(true); announce("Code copied"); setTimeout(() => setCopied(false), 1500); }} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-body font-medium text-ink underline underline-offset-2">
              {s.url.replace("https://", "")} <ArrowSquareOutIcon size={13} aria-hidden />
            </a>
            <span className="ml-auto flex gap-1">
              <Button size="sm" variant="quiet" onClick={() => send("cancel")}>Cancel</Button>
              <Button size="sm" variant="quiet" onClick={() => send("start")}>New code</Button>
            </span>
          </div>
          {s.expiresAt && <p className="text-small text-ink-3">The code works until {clock(s.expiresAt)}.</p>}
        </div>
      )}
      {models.length > 0 ? (
        <Field label="Model">
          <Select value={a.settings?.subModel ?? ""} onChange={(e) => setModel(e.target.value)} aria-label={`${name}'s model`}>
            <option value="">{label}'s default</option>
            {models.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            {a.settings?.subModel && !models.some((x) => x.id === a.settings!.subModel) && <option value={a.settings.subModel}>{a.settings.subModel}</option>}
          </Select>
        </Field>
      ) : (
        <Field label="Model" aside="Optional" hint={kind === "copilot" ? "Empty lets Copilot pick (auto). Or a model your plan offers, e.g. gpt-5.6-sol." : `Empty uses ${label}'s default.`}>
          <div className="flex gap-2">
            <Input mono aria-label={`${name}'s model`} value={custom} placeholder="auto" onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") setModel(custom.trim()); }} />
            <Button size="sm" variant="secondary" disabled={custom.trim() === (a.settings?.subModel ?? "")} onClick={() => setModel(custom.trim())}>Save</Button>
          </div>
        </Field>
      )}
    </div>
  );
}

// ---------------- autonomy ----------------

function AutonomySettings({ a, name }: { a: A; name: string }) {
  const s = a.settings!;
  return (
    <Section id="autonomy" title="How much it may do on its own">
      <Segmented
        legend="Autonomy"
        hideLegend
        value={s.autonomy}
        onChange={(v) => { a.send({ t: "settings", autonomy: v }); announce(`${name}: ${v === "ask" ? "asks first" : v === "risky" ? "asks for risky things only" : "never asks"}`); }}
        options={[
          { value: "ask", label: "Ask first", description: "Every action waits for your OK." },
          { value: "risky", label: "Risky only", description: "Works alone, but asks before payments, messages, deletes and logins." },
          { value: "auto", label: "Never ask", description: "Acts on its own. Not for email or payments. You can still watch and take over." },
        ]}
      />
    </Section>
  );
}

// ---------------- spending ----------------

function SpendingSettings({ a, agent }: { a: A; agent: Agent }) {
  const s = a.settings!;
  const price = agent.price && (agent.price.in || agent.price.out) ? agent.price : undefined;
  const shown = (tokens: number) => (price ? (tokens ? tokensToEur(tokens, price).toFixed(2) : "0") : tokens ? String(Math.round(tokens / 1e5) / 10) : "0");
  const [val, setVal] = useState(shown(s.dailyTokenBudget));
  useEffect(() => setVal(shown(s.dailyTokenBudget)), [s.dailyTokenBudget, !!price]);
  const parsed = parseEuro(val);
  const invalid = !Number.isFinite(parsed) || parsed < 0;
  const tokens = invalid ? 0 : price ? eurToTokens(parsed, price) : Math.round(parsed * 1e6);
  const dirty = !invalid && val !== shown(s.dailyTokenBudget) && tokens !== s.dailyTokenBudget;
  const capEur = price && s.dailyTokenBudget ? tokensToEur(s.dailyTokenBudget, price) : 0;
  const spentEur = price ? tokensToEur(s.dayTokens, price) : 0;
  const save = () => { a.send({ t: "settings", dailyTokenBudget: tokens }); announce(tokens ? `Daily limit saved` : "Daily limit removed"); };
  return (
    <Section id="spending" title="Daily spending limit">
      {s.dailyTokenBudget > 0 ? (
        <Progress className="mb-4" label="Used today" value={s.dayTokens / s.dailyTokenBudget}
          aside={price ? `${money(spentEur, { approx: spentEur > 0 })} of ${money(capEur, { approx: true })}` : `${compact(s.dayTokens)} of ${compact(s.dailyTokenBudget)} tokens`}
          valueText={price ? `${money(spentEur)} of ${money(capEur)} used today` : `${percent(Math.min(1, s.dayTokens / s.dailyTokenBudget))} used today`} />
      ) : (
        <p className="mb-3 text-small text-ink-2">{price ? `${money(spentEur, { approx: spentEur > 0, period: "today" })}, no limit set.` : "No limit set."}</p>
      )}
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (dirty) save(); }}>
        <Field className="min-w-0 flex-1" label={price ? "Limit per day, in euros" : "Limit per day, in millions of tokens"} error={invalid ? "Type a number, like 1.50" : undefined}
          hint={price
            ? `0 = no limit. ${agent.name} stops for the day when it reaches this.`
            : `0 = no limit. Beamhop doesn't know what ${modelName(agent.model?.model) === "No model" ? "this brain" : modelName(agent.model?.model)} costs, so this counts tokens instead (a token is about ¾ of a word).`}>
          <div className="relative">
            {price && <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-2">€</span>}
            <Input inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} className={cx("tabular-nums", price && "pl-6")}
              aria-label={price ? "Daily spending limit in euros, 0 for none" : "Daily limit in million tokens, 0 for none"} />
          </div>
        </Field>
        {dirty && <Button type="submit" variant="primary" className="mb-[calc(16px+6px)]">Save</Button>}
      </form>
    </Section>
  );
}

// ---------------- chat apps ----------------

type Health = { shape: "ok" | "moving" | "problem" | "off" | "needs"; text: string };
function HealthLine({ h, className }: { h: Health; className?: string }) {
  return (
    <span className={cx("flex min-w-0 items-start gap-1.5 text-small", h.shape === "problem" ? "text-err" : h.shape === "needs" ? "text-signal-ink" : "text-ink-2", className)}>
      <span className="mt-[3px] shrink-0">
        {h.shape === "ok" ? <CheckCircleIcon size={12} weight="fill" aria-hidden className="text-ink" />
          : h.shape === "off" ? <CircleIcon size={12} weight="bold" aria-hidden className="text-ink-3" />
          : <Lamp status={h.shape === "moving" ? "moving" : h.shape === "needs" ? "needs" : "problem"} size={11} />}
      </span>
      <span className="min-w-0">{h.text}</span>
    </span>
  );
}

function channelHealth(a: A, name: string): Health {
  const c = a.pairing?.channels?.[name];
  if (c?.error) return { shape: "problem", text: c.error };
  if (c?.bot) return { shape: "ok", text: `Connected as @${c.bot}` };
  return { shape: "moving", text: "Connecting…" };
}

/** What a connected chat app is doing right now: connected as @bot, still connecting, or token rejected (word + shape). */
export function ChannelStatus({ a, name }: { a: A; name: string }) {
  return <HealthLine h={channelHealth(a, name)} />;
}

/** One chat app: name and health on the left, the action on the right, setup fields underneath when open. */
function AppRow({ label, health, action, children, pair }: { label: string; health: Health; action: ReactNode; children?: ReactNode; pair?: ReactNode }) {
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{label}</div>
          <HealthLine h={health} className="mt-0.5" />
        </div>
        <div className="flex shrink-0 gap-1.5">{action}</div>
      </div>
      {pair}
      {children}
    </li>
  );
}

/** Not paired yet: one tap (or one scan) pairs Telegram; other apps get the /pair code. */
function PairHint({ a, name, app }: { a: A; name: string; app: string }) {
  const c = a.pairing?.channels?.[app];
  const code = a.pairing?.code;
  const [qr, setQr] = useState(false);
  const link = app === "telegram" && c?.bot && code ? `https://t.me/${c.bot}?start=${code}` : undefined;
  const svg = useMemo(() => {
    if (!link) return "";
    const q = qrcode(0, "M");
    q.addData(link);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [link]);
  if (!c?.bot || c.owner) return c?.owner ? <p className="mt-1 text-small text-ink-2">Only you ({c.owner}) can approve things from here.</p> : null;
  if (!code) return null;
  return (
    <div className="mt-2 rounded-control border border-signal/40 bg-signal-wash px-3 py-2">
      <p className="text-small text-ink">
        Pair it so approvals reach you there: send <span className="font-mono text-[11.5px]">/pair {code}</span> to @{c.bot}. Only you can approve; anyone in the chat can talk to {name}.
      </p>
      {link && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <a href={link} target="_blank" rel="noreferrer" className="pressable inline-flex h-7 items-center gap-1.5 rounded-control border border-signal bg-signal px-2.5 text-small font-medium text-on-signal no-underline">
            Pair in Telegram <ArrowSquareOutIcon size={12} weight="bold" aria-hidden />
          </a>
          <Button size="sm" onClick={() => setQr(!qr)} aria-expanded={qr}>{qr ? "Hide QR code" : "Scan with phone"}</Button>
        </div>
      )}
      {qr && <div className="mt-2 w-36 rounded-control bg-[white] p-1.5" role="img" aria-label={`QR code to pair with @${c.bot} in Telegram`} dangerouslySetInnerHTML={{ __html: svg }} />}
    </div>
  );
}

/** Secret fields: masked, Commit Mono, never shown back. */
function SecretFields({ label, fields, vals, setVals, onSubmit, onCancel }: { label: string; fields: string[]; vals: string[]; setVals: (v: string[]) => void; onSubmit: () => void; onCancel: () => void }) {
  return (
    <form className="mt-3 space-y-2.5 rounded-control border border-line bg-surface-2 p-3" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      {fields.map((f, i) => (
        <Field key={f} label={f} aside={i === 0 ? "Stays on this computer" : undefined}>
          <Input mono type="password" autoComplete="off" spellCheck={false} autoFocus={i === 0} aria-label={`${label} ${f}`} value={vals[i]}
            onChange={(e) => setVals(vals.map((v, j) => (j === i ? e.target.value : v)))} />
        </Field>
      ))}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="quiet" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" type="submit" disabled={!vals.every((v) => v.trim())}>Connect</Button>
      </div>
    </form>
  );
}

export function SecretRow({ a, name, label, connected, fields, onConnect, onDisconnect, agentName = "your agent", extra }: {
  a: A; name: string; label: string; connected: boolean; fields: string[]; onConnect: (v: string[]) => void; onDisconnect: () => void; agentName?: string; extra?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState(fields.map(() => ""));
  if (connected) {
    return <AppRow label={label} health={channelHealth(a, name)} action={<Button size="sm" variant="quiet" onClick={onDisconnect}>Disconnect</Button>} pair={<PairHint a={a} name={agentName} app={name} />} />;
  }
  return (
    <AppRow label={label} health={{ shape: "off", text: "Not connected" }}
      action={<>{extra}{!open && <Button size="sm" onClick={() => setOpen(true)}>{extra ? "Paste a token" : "Connect…"}</Button>}</>}>
      {open && <SecretFields label={label} fields={fields} vals={vals} setVals={setVals}
        onCancel={() => { setOpen(false); setVals(fields.map(() => "")); }}
        onSubmit={() => { onConnect(vals.map((v) => v.trim())); setVals(fields.map(() => "")); setOpen(false); announce(`Connecting ${label}`); }} />}
    </AppRow>
  );
}

export function ChannelSettings({ a, agent }: { a: A; agent?: Agent }) {
  const ch = a.settings?.channels;
  const name = agent?.name ?? "your agent";
  const npub = agent?.agentPubkey ? nip19.npubEncode(agent.agentPubkey) : undefined;
  const [copied, setCopied] = useState(false);
  return (
    <Section id="apps" title="Chat apps" note={`Talk to ${name} and approve things from apps you already use.`}>
      <ul className="divide-y divide-line">
        <SecretRow a={a} name="telegram" label="Telegram" agentName={name} connected={!!ch?.telegram} fields={["Bot token from @BotFather"]}
          extra={!ch?.telegram && <Button size="sm" onClick={() => { a.send({ t: "chat", text: TELEGRAM_SETUP }); announce(`${name} is setting up Telegram on its screen`); }} title={`${name} opens Telegram on its screen and creates its own bot`}>Set it up for me</Button>}
          onConnect={([token]) => a.send({ t: "settings", channels: { telegram: { token } } })}
          onDisconnect={() => a.send({ t: "settings", channels: { telegram: null } })} />
        <SecretRow a={a} name="slack" label="Slack" agentName={name} connected={!!ch?.slack} fields={["App token (xapp-…)", "Bot token (xoxb-…)"]}
          onConnect={([appToken, botToken]) => a.send({ t: "settings", channels: { slack: { appToken, botToken } } })}
          onDisconnect={() => a.send({ t: "settings", channels: { slack: null } })} />
        <SecretRow a={a} name="discord" label="Discord" agentName={name} connected={!!ch?.discord} fields={["Bot token"]}
          onConnect={([token]) => a.send({ t: "settings", channels: { discord: { token } } })}
          onDisconnect={() => a.send({ t: "settings", channels: { discord: null } })} />
        <li className="py-3 last:pb-0">
          <Switch checked={!!ch?.nostr} onChange={(on) => a.send({ t: "settings", channels: { nostr: on ? {} : null } })} label="Nostr messages"
            description={ch?.nostr ? "On: private messages to its address reach it." : "Off. Private, end-to-end encrypted messages over Nostr."} />
          {ch?.nostr && npub && (
            <div className="mt-2 flex items-center gap-1.5 pl-[42px]">
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2" title={npub}>{npub}</span>
              <IconButton size="sm" label={copied ? "Copied" : `Copy ${name}'s Nostr address`} icon={copied ? CheckIcon : CopyIcon}
                onClick={() => { navigator.clipboard?.writeText(npub); setCopied(true); announce("Address copied"); setTimeout(() => setCopied(false), 1500); }} />
            </div>
          )}
        </li>
      </ul>
    </Section>
  );
}

// ---------------- scheduled tasks ----------------

const DAY = 86_400_000;
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** "in 23 min" · "today 14:00" · "tomorrow 08:00" · "Monday 08:00" */
export function whenText(ts: number, now = Date.now()) {
  if (ts - now < 60_000) return "now";
  if (ts - now < 3_600_000) return `in ${durationWords(ts - now)}`;
  const days = Math.round((startOfDay(ts) - startOfDay(now)) / DAY);
  if (days === 0) return `today ${clock(ts)}`;
  if (days === 1) return `tomorrow ${clock(ts)}`;
  return `${new Date(ts).toLocaleDateString(undefined, { weekday: "long" })} ${clock(ts)}`;
}

function scheduleText(s: Schedule) {
  if (s.kind === "every") return `Every ${durationWords((s.minutes ?? 60) * 60_000)}`;
  const mod = s.minuteOfDay ?? 0;
  const d = new Date();
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (s.tz) d.setHours(Math.floor(mod / 60), mod % 60, 0, 0);
  else d.setUTCHours(Math.floor(mod / 60), mod % 60, 0, 0);
  return `Every day at ${clock(d.getTime())}${s.tz && s.tz !== here ? ` (${s.tz.split("/").pop()!.replace(/_/g, " ")} time)` : ""}`;
}

/** What scheduled tasks did while you were away: result, how long, cost, and the screen at the end. */
export function RecentRuns({ runs, price }: { runs: TaskRun[]; price?: { in: number; out: number } }) {
  const [open, setOpen] = useState<string>();
  return (
    <div className="mt-5">
      <h4 className="mb-1.5 text-small font-medium text-ink-2">Recent runs</h4>
      <ul className="divide-y divide-line rounded-control border border-line">
        {[...runs].reverse().slice(0, 8).map((r) => (
          <li key={r.id}>
            <button onClick={() => setOpen(open === r.id ? undefined : r.id)} aria-expanded={open === r.id} className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-surface-2">
              {r.ok ? <CheckIcon size={13} weight="bold" className="shrink-0 text-ink" aria-hidden /> : <XIcon size={13} weight="bold" className="shrink-0 text-err" aria-hidden />}
              <span className={cx("w-11 shrink-0 text-small", r.ok ? "text-ink-2" : "text-err")}>{r.ok ? "Done" : "Failed"}</span>
              <span className="min-w-0 flex-1 truncate">{r.prompt}</span>
              <span className="shrink-0 text-small tabular-nums text-ink-3">{relativeTime(r.endedAt)}</span>
            </button>
            {open === r.id && (
              <div className="space-y-2 px-2.5 pb-3">
                <div className="text-small tabular-nums text-ink-2">
                  {clock(r.startedAt)} · took {durationWords(Math.max(1000, r.endedAt - r.startedAt))}
                  {price ? ` · ${money(tokensToEur(r.tokens, price), { approx: true })}` : r.tokens ? ` · ${compact(r.tokens)} tokens` : ""}
                </div>
                <div className="whitespace-pre-wrap text-body">{r.result}</div>
                {r.shot && <img src={r.shot} alt={`Screen when "${r.prompt}" finished`} className="w-full rounded-control border border-line" />}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Schedules({ a, agent }: { a: A; agent?: Agent }) {
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<"daily" | "every">("daily");
  const [time, setTime] = useState("08:00");
  const [minutes, setMinutes] = useState("60");
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);
  const save = (list: Schedule[]) => a.send({ t: "schedules", schedules: list });
  const add = () => {
    if (!prompt.trim()) return;
    const [h, m] = time.split(":").map(Number);
    const local = new Date();
    local.setHours(h, m, 0, 0);
    // Local wall-clock time + your time zone, so "daily at 8:00" stays 8:00 across daylight-saving changes and beams.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const minuteOfDay = tz ? h * 60 + m : local.getUTCHours() * 60 + local.getUTCMinutes();
    save([...a.schedules, { id: Math.random().toString(36).slice(2, 8), prompt: prompt.trim(), kind, minuteOfDay, minutes: Number(minutes) || 60, enabled: true, createdAt: Date.now(), ...(tz ? { tz } : {}) }]);
    announce(`Added: ${prompt.trim()}`);
    setPrompt("");
  };
  const name = agent?.name ?? "it";
  return (
    <Section id="tasks" title="Scheduled tasks" aside={a.schedules.length ? plural(a.schedules.filter((s) => s.enabled).length, "active task") : undefined}>
      {a.schedules.length === 0 && <p className="mb-3 text-small text-ink-2">Nothing scheduled. Add a task {name} should repeat, or just ask in chat: "every morning at 8, send me the top 3 Hacker News stories".</p>}
      {a.schedules.length > 0 && (
        <ul className="mb-4 divide-y divide-line">
          {a.schedules.map((s) => {
            const next = nextRunAt(s);
            return (
              <li key={s.id} className="flex items-start gap-2 py-2.5 first:pt-0">
                <Switch className="min-w-0 flex-1" checked={s.enabled} onChange={() => save(a.schedules.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)))}
                  label={s.prompt}
                  description={<span className="tabular-nums">{scheduleText(s)} · {s.enabled ? (next !== undefined ? `next ${whenText(next)}` : "next run unknown") : "paused"}{s.lastRun ? ` · last ${relativeTime(s.lastRun)}` : ""}</span>} />
                <IconButton size="sm" label={`Run now: ${s.prompt}`} icon={PlayIcon} onClick={() => { a.send({ t: "run_schedule", id: s.id }); announce("Running it now"); }} />
                <IconButton size="sm" label={`Delete task: ${s.prompt}`} icon={TrashIcon} onClick={() => save(a.schedules.filter((x) => x.id !== s.id))} />
              </li>
            );
          })}
        </ul>
      )}
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <Field label="New task">
          <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. Check Hacker News and send me the top 3" aria-label="Task" />
        </Field>
        <div className="flex items-end gap-2">
          <div className="w-32 shrink-0">
            <Select value={kind} onChange={(e) => setKind(e.target.value as "daily" | "every")} aria-label="Repeat">
              <option value="daily">Every day at</option>
              <option value="every">Every … min</option>
            </Select>
          </div>
          {kind === "daily"
            ? <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" className="w-28 tabular-nums" />
            : <Input value={minutes} onChange={(e) => setMinutes(e.target.value)} inputMode="numeric" aria-label="Minutes" className="w-20 tabular-nums" />}
          <Button type="submit" className="ml-auto" disabled={!prompt.trim()}>Add task</Button>
        </div>
      </form>
      {a.runs.length > 0 && <RecentRuns runs={a.runs} price={agent?.price} />}
    </Section>
  );
}

// ---------------- memory ----------------

/** A memory you can correct in place: click it, edit, Enter to save, Escape to cancel. */
export function MemoryText({ a, item }: { a: A; item: MemoryItem }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const btn = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => { if (wasEditing.current && !editing) btn.current?.focus(); wasEditing.current = editing; }, [editing]);
  if (!editing) {
    return <button ref={btn} onClick={() => { setText(item.text); setEditing(true); }} title="Edit" className="min-w-0 flex-1 rounded-[4px] py-0.5 text-left text-body text-ink hover:bg-surface-2">{item.text}</button>;
  }
  const save = () => { const t = text.trim(); if (t && t !== item.text) { a.send({ t: "memory", op: "edit", id: item.id, text: t }); announce("Memory saved"); } setEditing(false); };
  return (
    <Input size="sm" autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={save} aria-label="Edit memory"
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditing(false); } }}
      className="min-w-0 flex-1" />
  );
}

export function MemorySettings({ a, name = "it" }: { a: A; name?: string }) {
  const [text, setText] = useState("");
  return (
    <Section id="memory" title={`What ${name} knows`} aside={a.memory.length ? plural(a.memory.length, "memory", "memories") : undefined}
      note={a.memory.length ? "Click a memory to correct it." : undefined}>
      {a.memory.length === 0 && <p className="mb-3 text-small text-ink-2">Nothing yet. {name} saves what it learns about you here, and you can add your own.</p>}
      {a.memory.length > 0 && (
        <ul className="mb-3 max-h-72 divide-y divide-line overflow-y-auto">
          {a.memory.map((m) => (
            <li key={m.id} className="group flex items-start gap-2 py-1.5">
              <MemoryText a={a} item={m} />
              <span className="mt-1 shrink-0 text-micro text-ink-3">{m.source === "owner" ? "you" : "learned"}</span>
              <IconButton size="sm" label={`Forget: ${m.text}`} icon={TrashIcon} onClick={() => { a.send({ t: "memory", op: "delete", id: m.id }); announce("Forgotten"); }} className="-my-0.5" />
            </li>
          ))}
        </ul>
      )}
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { a.send({ t: "memory", op: "add", text: text.trim() }); setText(""); announce("Memory added"); } }}>
        <Field className="min-w-0 flex-1" label="Add a memory">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. I prefer replies in Dutch" aria-label="Add a memory" />
        </Field>
        <Button type="submit" disabled={!text.trim()}>Add</Button>
      </form>
    </Section>
  );
}

// ---------------- skills ----------------

export function SkillSettings({ a, name = "it" }: { a: A; name?: string }) {
  const [src, setSrc] = useState("");
  return (
    <Section id="skills" title="Skills" aside={a.skills.items.length ? plural(a.skills.items.length, "skill") : undefined}
      note={`Instructions ${name} can follow for a kind of job, from a SKILL.md file.`}>
      {a.skills.items.length > 0 && (
        <ul className="mb-3 divide-y divide-line">
          {a.skills.items.map((s) => (
            <li key={s.name} className="flex items-start gap-2 py-2 first:pt-0">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{s.name}</div>
                <div className="line-clamp-2 text-small text-ink-2">{s.description}</div>
              </div>
              <IconButton size="sm" label={`Remove ${s.name}`} icon={TrashIcon} onClick={() => a.send({ t: "skills", op: "delete", name: s.name })} />
            </li>
          ))}
        </ul>
      )}
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); const v = src.trim(); if (!v) return; a.send(v.startsWith("http") ? { t: "skills", op: "add", url: v } : { t: "skills", op: "add", content: v }); setSrc(""); }}>
        <Field className="min-w-0 flex-1" label="Add a skill" error={a.skills.error}>
          <Input value={src} onChange={(e) => setSrc(e.target.value)} placeholder="Link to a SKILL.md (GitHub is fine), or paste one" aria-label="Add a skill" />
        </Field>
        <Button type="submit" disabled={!src.trim()} className={a.skills.error ? "mb-[calc(16px+6px)]" : undefined}>Add</Button>
      </form>
    </Section>
  );
}

// ---------------- computer health ----------------

function ComputerHealth({ a, name }: { a: A; name: string }) {
  const [open, setOpen] = useState(false);
  const st = a.stats;
  const id = useId();
  return (
    <section id={SETTINGS_SECTIONS.health} aria-labelledby={`${SETTINGS_SECTIONS.health}-h`} className="scroll-mt-4 border-t border-line py-4">
      <h3 id={`${SETTINGS_SECTIONS.health}-h`} tabIndex={-1} className="outline-none">
        <button onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={id} className="flex w-full items-center gap-2 rounded-control text-left">
          <span className="min-w-0 flex-1 text-ui-lg">Computer health</span>
          {st && !open && <span className="text-small tabular-nums text-ink-2">{percent(st.cpu / 100)} processor · {percent(st.memMb / Math.max(1, st.memTotalMb))} memory</span>}
          <CaretDownIcon size={14} weight="bold" aria-hidden className={cx("shrink-0 text-ink-2 transition-transform duration-(--dur-pop)", open && "rotate-180")} />
        </button>
      </h3>
      <div id={id} hidden={!open} className="mt-3 space-y-3">
        {!st ? <p className="text-small text-ink-2">Waiting for {name}'s computer to report.</p> : <>
          <Progress label="Processor" value={st.cpu / 100} aside={percent(st.cpu / 100)} />
          <Progress label="Memory" value={st.memMb / Math.max(1, st.memTotalMb)} aside={`${num(st.memMb / 1024, 1)} of ${num(st.memTotalMb / 1024, 1)} GB`} />
          <p className="text-small tabular-nums text-ink-2">Model usage today: {compact(st.dayTokens ?? a.settings?.dayTokens ?? 0)} tokens · since it started: {compact(st.tokens.input + st.tokens.output)}</p>
        </>}
      </div>
    </section>
  );
}

// ---------------- remove ----------------

/** Deleting is final, so it takes two steps and offers the file as the gentler alternative. */
export function RemoveAgent({ agent }: { agent: Agent }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const keep = useRef<HTMLButtonElement>(null);
  return (
    <Section id="remove" title="Remove" className="pb-2">
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 text-small text-ink-2">Deletes {agent.name}'s computer, files, logins, memory and chats. Moving computers? Use a file instead.</p>
        <Button size="sm" variant="danger" onClick={() => setAsking(true)}>Remove {agent.name}…</Button>
      </div>
      <Dialog open={asking} onClose={() => !busy && setAsking(false)} variant="alert" size="sm" initialFocus={keep}
        title={`Remove ${agent.name} for good?`}
        description={`This deletes ${agent.name}'s computer, files, browser logins, memory and chats, everywhere it has lived. It can't be undone.`}
        footer={<>
          <Button ref={keep} onClick={() => setAsking(false)} disabled={busy}>Keep {agent.name}</Button>
          <Button variant="danger" loading={busy} onClick={async () => {
            setBusy(true);
            const r = await api.remove(agent.id).catch((e) => ({ error: String(e) }));
            if ((r as { error?: string }).error) { setBusy(false); setError((r as { error: string }).error); return; }
            announce(`${agent.name} removed`);
            location.hash = "";
          }}>{busy ? "Removing…" : "Remove for good"}</Button>
        </>}>
        <p className="text-body text-ink-2">
          Just moving computers?{" "}
          <button className="text-ink underline decoration-1 underline-offset-2" onClick={() => { setAsking(false); dispatchEvent(new CustomEvent("beamhop:export", { detail: agent.id })); }}>Move it to a file</button>{" "}
          instead.
        </p>
        {error && <Notice alert className="mt-3">Couldn't remove {agent.name}: {error}</Notice>}
      </Dialog>
    </Section>
  );
}
