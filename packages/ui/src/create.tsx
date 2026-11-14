// New agent, job first (DESIGN-PLAN §4.5): 1 what should it do → 2 give it a brain → 3 create (the first-time download
// runs inside step 3, and the first task can be typed while it downloads). A Dialog by default; `inline` renders the
// same flow as a section, for a bench that shows it in place on first run.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckIcon, CodeIcon, CreditCardIcon, EnvelopeIcon, FileArrowUpIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { api, PRESETS, TEMPLATES, npubToHex, type Destination, type LocalState, type Sandboxes } from "./lib.tsx";
import { Button, Dialog, Field, Input, PlateGlyph, Progress, Segmented, Select, Switch, Textarea, announce, callsign, cx, money, usdToEur } from "./ui/index.ts";
import { ChoiceTile, KEY_URL, modelName, Notice, PROVIDER_NOTE, SUBSCRIPTIONS } from "./settings-parts.tsx";

const NAMES = ["Nova", "Scout", "Atlas", "Orbit", "Pixel", "Comet", "Juno", "Wren"];
const TEMPLATE_ICON = { assistant: EnvelopeIcon, researcher: MagnifyingGlassIcon, developer: CodeIcon } as const;
const STEPS = ["What should your agent do?", "Give it a brain", "Ready to create"] as const;
const STEP_SHORT = ["Job", "Brain", "Create"];
/** Template blurbs in plain words (the shared TEMPLATES name tools in the developer one). */
const BLURB: Record<string, string> = {
  assistant: "Email, calendar and errands, in its own browser",
  researcher: "Web research and short, sourced reports",
  developer: "Builds and fixes software on its own computer",
};
type BrainKind = "subscription" | "openrouter" | "openai" | "anthropic" | "ollama";
type Prefetch = { state: string; done: number; total: number; error?: string };

/** After creating: hand the first task to the new agent over its socket, then open its view so you can watch. */
async function sendFirstTask(id: string, text: string) {
  const t = (await fetch(`/api/agents/${id}/token`).then((r) => r.json()).catch(() => null)) as { endpoint: string; token: string } | null;
  if (!t) return;
  await new Promise<void>((done) => {
    const ws = new WebSocket(`${t.endpoint.replace(/^http/, "ws")}/ws?auth=${t.token}`);
    ws.onopen = () => { ws.send(JSON.stringify({ t: "chat", text })); setTimeout(() => { ws.close(); done(); }, 400); };
    ws.onerror = () => done();
  });
  location.hash = `#/agent/${id}`;
}

export function CreateAgent({ firstRun, onDone, inline = false, onAddCloud }: { firstRun: boolean; onDone: () => void; inline?: boolean; onAddCloud?: () => void }) {
  const [step, setStep] = useState(0);
  // 1 · the job
  const [template, setTemplate] = useState("assistant");
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("");
  const suggested = useMemo(() => NAMES[Math.floor(Math.random() * NAMES.length)], []);
  const agentName = name.trim() || suggested;
  // 2 · the brain
  const [kind, setKind] = useState<BrainKind>();
  const [sub, setSub] = useState<"codex" | "copilot">("codex");
  const [model, setModel] = useState({ baseUrl: PRESETS.openrouter.baseUrl, apiKey: "", model: PRESETS.openrouter.model });
  const [brain, setBrain] = useState<Awaited<ReturnType<typeof api.brain>>>();
  const [check, setCheck] = useState<{ busy?: boolean; error?: string; failed?: boolean; found?: number }>({});
  const [models, setModels] = useState<string[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [skipped, setSkipped] = useState(false);
  // 3 · create
  const [engine, setEngine] = useState<"pi" | "opencode" | "mock">("pi");
  const [firstTask, setFirstTask] = useState("");
  const [telegram, setTelegram] = useState("");
  const [nostr, setNostr] = useState(false);
  const [npub, setNpub] = useState("");
  const [dests, setDests] = useState<Destination[]>([]);
  const [where, setWhere] = useState("local");
  const [pf, setPf] = useState<Prefetch>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ids = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const jobRef = useRef<HTMLTextAreaElement>(null);

  const [local, setLocal] = useState<LocalState>();
  const [boxes, setBoxes] = useState<Sandboxes>();
  const [sandbox, setSandbox] = useState<string>();
  const loadBoxes = (fresh = false) => api.sandboxes(fresh).then((b) => { setBoxes(b); setSandbox((cur) => (cur && b.options.some((o) => o.engine === cur && o.available) ? cur : b.default ?? undefined)); }).catch(() => {});
  useEffect(() => { loadBoxes(); }, []);
  const [pfRun, setPfRun] = useState(0);
  useEffect(() => { api.destinations().then(setDests).catch(() => {}); api.local().then(setLocal).catch(() => {}); }, []);
  // This computer can't run agents (no engine): start the agent on a connected cloud instead.
  useEffect(() => {
    const cloud = dests.find((d) => d.id !== "local");
    if (pf?.state === "error" && where === "local" && cloud) setWhere(cloud.id);
  }, [pf?.state, dests]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    let alive = true;
    const poll = async () => {
      const p = await fetch("/api/prefetch").then((r) => r.json()).catch(() => null);
      if (!alive) return;
      setPf(p);
      if (p?.state === "pulling") t = setTimeout(poll, 2000);
    };
    poll();
    return () => { alive = false; clearTimeout(t); };
  }, [pfRun]);
  // A brain saved on this computer (from the first agent) is the default: later agents don't ask again.
  useEffect(() => {
    api.brain().then((b) => {
      setBrain(b);
      if (!b) return;
      const k = Object.entries(PRESETS).find(([, p]) => p.baseUrl === b.baseUrl)?.[0] as BrainKind | undefined;
      setKind(k ?? "openrouter");
      setModel({ baseUrl: b.baseUrl, model: b.model, apiKey: "" });
    });
  }, []);
  // Each step: move focus to its first control (not on first open: the dialog does that) and say where we are.
  useEffect(() => {
    if (!moved.current) { moved.current = true; return; }
    const el = bodyRef.current?.querySelector<HTMLElement>("input:not([type=hidden]):not(:disabled), textarea, select, button");
    el?.focus({ preventScroll: true });
    announce(`Step ${step + 1} of 3: ${STEPS[step]}`);
  }, [step]);

  const usesSavedKey = !!brain?.hasKey && brain.baseUrl === model.baseUrl && !model.apiKey;
  const api_ = kind && kind !== "subscription" ? PRESETS[kind].api : "openai-completions";

  function pickBrain(k: BrainKind) {
    setKind(k);
    setSkipped(false);
    setCheck({});
    setModels([]);
    if (k === "subscription") return;
    const p = PRESETS[k];
    const keepSaved = brain && brain.baseUrl === p.baseUrl;
    setModel((m) => ({ ...m, baseUrl: p.baseUrl, model: keepSaved ? brain!.model : p.model }));
    if (k === "ollama") findOllama(p.baseUrl);
  }
  /** Local models: look at what's installed as soon as Ollama is picked. */
  async function findOllama(baseUrl: string) {
    setCheck({ busy: true });
    const r = await api.verifyBrain({ provider: "scut", api: "openai-completions", baseUrl, model: "" });
    setModels(r.models ?? []);
    if (!r.ok) return setCheck({ failed: true, error: r.error });
    if (!r.models?.length) return setCheck({ failed: true, error: "Ollama is running but has no models yet. In a terminal, run: ollama pull qwen3.8:8b" });
    setModel((m) => ({ ...m, baseUrl, model: r.models!.includes(m.model) ? m.model : r.models![0] }));
    setCheck({ found: r.models.length });
  }
  /** Brain step "Next": check the key and model before the agent depends on them. "Continue anyway" after a failure. */
  async function checkBrain() {
    if (kind === "subscription") return setStep(2);
    if (check.failed) { setCheck({}); setStep(2); return; }
    if (kind === "ollama" && check.found) return setStep(2);
    setCheck({ busy: true });
    const r = await api.verifyBrain({ provider: "scut", api: api_, baseUrl: model.baseUrl, apiKey: model.apiKey || undefined, model: model.model });
    if (r.models?.length) setModels(r.models);
    if (r.ok && r.modelFound !== false) { setCheck({}); setStep(2); return; }
    if (r.ok) setDetailsOpen(true);
    setCheck({ failed: true, error: r.ok ? `The key works, but "${model.model}" isn't offered there. Pick another model below.` : r.error });
  }

  const harness = kind === "subscription" && !skipped ? sub : engine;
  async function go() {
    setBusy(true);
    setError(undefined);
    const r = await api.create({
      name: agentName,
      harness, template, persona: prompt.trim() || undefined, telegramToken: telegram.trim() || undefined,
      nostr: nostr ? { ownerPubkey: npubToHex(npub) } : undefined,
      model: harness === "mock" || harness === "codex" || harness === "copilot" ? undefined
        : { provider: "scut", api: api_, baseUrl: model.baseUrl, apiKey: model.apiKey || undefined, model: model.model },
      driver: where,
      sandbox: where === "local" && sandbox && sandbox !== local?.engine ? sandbox : undefined,
    }).catch((e) => ({ error: String(e) }));
    if (r.error) { setBusy(false); setError(r.error); return; }
    announce(`${agentName} is ready`);
    const task = noBrain ? "" : firstTask.trim(); // a task for an agent that can't think would only come back empty
    onDone();
    if (task && r.id) sendFirstTask(r.id, task);
  }

  // ---------------- steps ----------------
  const tpl = TEMPLATES.find((t) => t.id === template)!;
  const stepJob = (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-small font-medium text-ink">Start from</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {TEMPLATES.map((t) => (
            <ChoiceTile key={t.id} name={`${ids}-tpl`} value={t.id} checked={template === t.id} onChange={setTemplate} title={t.title} note={BLURB[t.id] ?? t.blurb}
              icon={TEMPLATE_ICON[t.id as keyof typeof TEMPLATE_ICON]} />
          ))}
        </div>
      </fieldset>
      <Field label="Describe the job" aside="In your own words" hint="It reads this before every task. You can change it later in Settings.">
        <Textarea ref={jobRef} rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={`e.g. ${tpl.example}`} aria-label="Describe the job" />
      </Field>
      <Field label="Name" aside="Optional" hint={name.trim() ? undefined : `Leave it empty and it's called ${suggested}.`}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={suggested} aria-label="Name" maxLength={40} />
      </Field>
      <p className="flex items-center gap-1.5 text-small text-ink-2">
        <FileArrowUpIcon size={14} aria-hidden />
        Moving an agent from another computer?
        <button className="font-medium text-ink underline decoration-1 underline-offset-2" onClick={() => dispatchEvent(new Event("beamhop:import"))}>Open an agent file</button>
      </p>
    </div>
  );

  const keyUrl = kind ? KEY_URL[kind] : undefined;
  const stepBrain = (
    <div className="space-y-4">
      <fieldset>
        <legend className="sr-only">Brain</legend>
        <ChoiceTile name={`${ids}-brain`} value="subscription" checked={kind === "subscription"} onChange={(v) => pickBrain(v as BrainKind)} icon={CreditCardIcon}
          title="Use my ChatGPT or Copilot subscription" note={`No key needed. ${agentName} asks you to sign in once, on its own screen.`}
          badge={<span className="whitespace-nowrap rounded-full border border-line-strong px-1.5 text-micro text-ink-2">No extra cost</span>} />
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(["openrouter", "openai", "anthropic", "ollama"] as const).map((k) => (
            <ChoiceTile key={k} size="sm" name={`${ids}-brain`} value={k} checked={kind === k} onChange={(v) => pickBrain(v as BrainKind)} title={PRESETS[k].label} note={PROVIDER_NOTE[k]} />
          ))}
        </div>
      </fieldset>

      {kind === "subscription" && (
        <div className="rounded-unit border border-line bg-surface-2 p-3">
          <Segmented legend="Which subscription" value={sub} onChange={setSub} size="sm"
            options={SUBSCRIPTIONS.map((s) => ({ value: s.harness, label: s.label, description: s.note }))} />
        </div>
      )}

      {kind && kind !== "subscription" && kind !== "ollama" && (
        <Field label="API key" aside="Stays on this computer"
          hint={usesSavedKey ? "Using the key you saved before. Paste a new one to replace it." : keyUrl && <>Get one at <a href={keyUrl} target="_blank" rel="noreferrer" className="text-ink">{keyUrl.replace("https://", "")}</a>. It starts with <span className="font-mono">{PRESETS[kind].keyHint}</span></>}>
          <Input mono type="password" autoComplete="off" spellCheck={false} aria-label="API key" value={model.apiKey} aria-invalid={/key/i.test(check.error ?? "") || undefined}
            placeholder={usesSavedKey ? "Saved key" : PRESETS[kind].keyHint}
            onChange={(e) => { setModel({ ...model, apiKey: e.target.value }); setCheck({}); }} />
        </Field>
      )}

      {kind === "ollama" && check.busy && <p role="status" className="text-small text-ink-2">Looking for Ollama on this computer…</p>}
      {kind === "ollama" && !!check.found && (
        <Field label="Model" hint={`Found ${check.found} on this computer.`}>
          <Select value={model.model} onChange={(e) => setModel({ ...model, model: e.target.value })}>
            {models.map((m) => <option key={m} value={m}>{modelName(m)} ({m})</option>)}
          </Select>
        </Field>
      )}

      {check.error && <Notice alert>{check.error}</Notice>}

      {kind && kind !== "subscription" && (
        <details className="text-small text-ink-2" open={detailsOpen} onToggle={(e) => setDetailsOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="w-fit rounded-control">Endpoint and model{model.model && kind !== "ollama" ? <span className="text-ink-3">: {modelName(model.model)}</span> : null}</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Endpoint">
              <Input mono aria-label="Base URL" value={model.baseUrl} onChange={(e) => { setModel({ ...model, baseUrl: e.target.value }); setCheck({}); }} />
            </Field>
            <Field label="Model" hint={kind !== "ollama" ? modelName(model.model) : undefined}>
              <Input mono aria-label="Model" list="model-options" value={model.model} onChange={(e) => { setModel({ ...model, model: e.target.value }); setCheck({}); }} />
            </Field>
            <datalist id="model-options">{models.map((m) => <option key={m} value={m} />)}</datalist>
          </div>
        </details>
      )}
      {!kind && <p className="text-small text-ink-2">Pick one to continue. Not sure? Skip this and choose later in Settings.</p>}
    </div>
  );

  const dest = dests.find((d) => d.id === where);
  const brainWords = skipped
    ? (usesSavedKey ? `${modelName(model.model)} (${PRESETS[kind ?? "openrouter"]?.label ?? "saved"})` : "None yet")
    : kind === "subscription" ? `${SUBSCRIPTIONS.find((s) => s.harness === sub)!.label} subscription, sign in on its screen`
    : kind ? `${modelName(model.model)} (${PRESETS[kind].label})` : "None yet";
  // The first-time download is for the default sandbox; another one picked here gets ready while the agent starts.
  const otherBox = where === "local" && !!sandbox && sandbox !== local?.engine;
  const pulling = pf?.state === "pulling" && !otherBox;
  // Skipped the brain and there's no saved one: say plainly what that means before creating (not after a silent no-op).
  const noBrain = skipped && !usesSavedKey && harness !== "mock" && harness !== "codex" && harness !== "copilot";
  // This computer has no engine for agents (and no cloud is picked): the choice, instead of a create that would fail.
  const noHere = !!local && !local.engine && where === "local";
  async function runHere() {
    setLocal(await api.allowHost(true));
    loadBoxes(true);
    setDests(await api.destinations());
    setWhere("local");
    setPfRun((n) => n + 1);
    announce("Agents can run on this computer without a sandbox");
  }
  const stepCreate = (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-unit border border-line bg-surface-2 p-3">
        <PlateGlyph name={agentName} size="lg" />
        <dl className="grid min-w-0 flex-1 grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body">
          <dt className="sr-only">Name</dt>
          <dd className="col-span-2 flex items-baseline gap-2">
            <span className="text-ui-lg">{agentName}</span>
            <span className="text-small font-semibold tracking-[0.05em] text-ink-3 [font-stretch:110%]" aria-hidden>{callsign(agentName)}</span>
          </dd>
          <dt className="text-ink-2">Job</dt>
          <dd className="min-w-0 truncate">{prompt.trim() || tpl.title}</dd>
          <dt className="text-ink-2">Brain</dt>
          <dd className="min-w-0">{harness === "mock" ? "Demo (no brain, practice replies)" : brainWords}</dd>
        </dl>
      </div>
      {noBrain && (
        <Notice tone="needs" action={<Button size="sm" onClick={() => { setSkipped(false); setStep(1); }} className="-my-0.5 shrink-0">Choose a brain</Button>}>
          Without a brain, {agentName} can't think or do tasks yet. You can add one later in its Settings.
        </Notice>
      )}

      {dests.length > 1 && (
        <Field label="Runs on" hint={dest && (dest.monthlyUsd
          ? `${money(usdToEur(dest.monthlyUsd), { approx: true, period: "month" })}, billed by ${dest.label}. Keeps working when this computer is off.`
          : dest.id === "local" ? "No running cost. Works while this computer is on." : "No running cost.")}>
          <Select value={where} onChange={(e) => setWhere(e.target.value)} aria-label="Runs on">
            {dests.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </Select>
        </Field>
      )}

      {noHere && <HereChoice local={local!} agentName={agentName} onAddCloud={onAddCloud} onRunHere={runHere} />}
      {where === "local" && !!local?.engine && boxes && boxes.options.length > 1 && (
        <SandboxPicker boxes={boxes} value={sandbox ?? local.engine} onChange={setSandbox} name={`${ids}-box`} onRecheck={() => loadBoxes(true)} />
      )}
      {(sandbox ?? local?.engine) === "host" && where === "local" && (
        <Notice tone="info">
          <span className="font-medium">No sandbox.</span> {agentName} runs as a normal program on this computer, with a browser of its own (it never uses your screen or mouse). It asks before touching anything outside its own folder.
        </Notice>
      )}

      {!noBrain && <Field label="First task" aside="Optional" hint={pulling ? `Type it now. ${agentName} starts on it as soon as it's ready.` : `${agentName} starts on it right away, and you can watch.`}>
        <Textarea rows={2} value={firstTask} onChange={(e) => setFirstTask(e.target.value)} placeholder={tpl.example} aria-label="First task" />
      </Field>}

      {pulling && (
        <Progress label="Getting the agent computer ready (first time only)" value={pf!.total ? pf!.done / pf!.total : undefined}
          aside={pf!.total ? `${pf!.done} of ${pf!.total} parts` : "Downloading"} valueText={pf!.total ? `${pf!.done} of ${pf!.total} parts downloaded` : "Downloading the agent computer"} />
      )}
      {pf?.state === "error" && !noHere && <Notice tone="info">{pf.error}</Notice>}

      <details className="text-small text-ink-2" open={template === "developer" || undefined}>
        <summary className="w-fit rounded-control">More options</summary>
        <div className="mt-3 space-y-4 text-body text-ink">
          {(kind !== "subscription" || skipped) && (
            <Segmented legend="Agent software" size="sm" value={engine} onChange={setEngine}
              options={[
                { value: "pi", label: "Pi", description: "The default. Works with any brain above." },
                { value: "opencode", label: "opencode", description: "An open-source coding agent." },
                { value: "mock", label: "Demo", description: "No brain and no cost: practice replies, to try Beamhop." },
              ]} />
          )}
          <Field label="Telegram bot token" aside="Stays on this computer" hint="You can also add this later in Settings, or let the agent set it up.">
            <Input mono type="password" autoComplete="off" spellCheck={false} aria-label="Telegram bot token" value={telegram} onChange={(e) => setTelegram(e.target.value)} />
          </Field>
          <Switch checked={nostr} onChange={setNostr} label="Nostr messages" description="Private, end-to-end encrypted messages over Nostr." />
          {nostr && (
            <Field label="Your npub" aside="Optional" hint="Approval requests go to this address.">
              <Input mono aria-label="Your npub for approvals" value={npub} onChange={(e) => setNpub(e.target.value)} placeholder="npub1…" />
            </Field>
          )}
        </div>
      </details>

      {error && <Notice alert>Couldn't create {agentName}: {error}</Notice>}
    </div>
  );

  // ---------------- frame ----------------
  const stepper = (
    <ol aria-hidden className="mb-5 grid grid-cols-3 gap-1.5">
      {STEP_SHORT.map((s, i) => (
        <li key={s} className="min-w-0">
          <span className={cx("block h-1 rounded-full", i <= step ? "bg-ink" : "bg-line")} />
          <span className={cx("mt-1.5 flex items-center gap-1 text-small", i === step ? "font-medium text-ink" : "text-ink-3")}>
            {i < step ? <CheckIcon size={11} weight="bold" /> : <span className="tabular-nums">{i + 1}</span>}
            {s}
          </span>
        </li>
      ))}
    </ol>
  );
  const body = (
    <div ref={bodyRef}>
      {stepper}
      {step === 0 ? stepJob : step === 1 ? stepBrain : stepCreate}
    </div>
  );
  const cancel = !firstRun && <Button variant="quiet" onClick={onDone} disabled={busy}>Cancel</Button>;
  const back = <Button variant="quiet" onClick={() => { setCheck({}); setStep(step - 1); }} disabled={busy || check.busy}>Back</Button>;
  const footer: ReactNode =
    step === 0 ? <>{cancel}<Button variant="primary" onClick={() => setStep(1)}>Next</Button></>
    : step === 1 ? <>
        <span className="mr-auto">{back}</span>
        <Button variant="quiet" onClick={() => { setSkipped(true); setCheck({}); setStep(2); }} disabled={check.busy}>Skip this</Button>
        <Button variant="primary" loading={check.busy && kind !== "ollama"} onClick={checkBrain}
          disabled={!kind || (check.busy) || (kind !== "subscription" && kind !== "ollama" && !model.apiKey && !usesSavedKey && !check.failed)}>
          {check.busy && kind !== "ollama" ? "Checking…" : check.failed ? "Continue anyway" : "Next"}
        </Button>
      </>
    : <>
        <span className="mr-auto">{back}</span>
        <Button variant="primary" loading={busy} onClick={go} disabled={noHere}>
          {busy ? (pulling ? "Waiting for the download…" : `Starting ${agentName}…`) : "Create agent"}
        </Button>
      </>;
  const title = step === 2 ? `${STEPS[2]}: ${agentName}` : STEPS[step];
  const description = `${firstRun ? "Welcome to Beamhop. " : ""}Step ${step + 1} of 3.`;

  if (inline) {
    return (
      <section aria-labelledby={`${ids}-t`} className="mx-auto w-full max-w-[720px] rounded-unit border border-line bg-surface">
        <header className="px-5 pt-5">
          <p className="text-small text-ink-2">{description}</p>
          <h2 id={`${ids}-t`} className="mt-1 text-h2 text-ink">{title}</h2>
        </header>
        <div className="px-5 pt-5">{body}</div>
        <div className="mt-5 flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>
      </section>
    );
  }
  return (
    <Dialog open onClose={firstRun || busy ? () => {} : onDone} title={title} description={description} size="lg" hideClose={firstRun} footer={footer} initialFocus={jobRef}>
      {body}
    </Dialog>
  );
}

const ISOLATION_WORD: Record<string, string> = { vm: "Virtual machine", sandbox: "Sandbox", container: "Container", none: "No isolation" };

/**
 * How this agent is walled off from this computer: every engine the computer has (microVM, WSL2, gVisor, Docker,
 * Podman, no sandbox), best first. The one Beamhop picked is preselected; ones that aren't here say why.
 */
function SandboxPicker({ boxes, value, onChange, name, onRecheck }: { boxes: Sandboxes; value: string; onChange: (v: string) => void; name: string; onRecheck: () => void }) {
  const [rechecking, setRechecking] = useState(false);
  return (
    <fieldset>
      <legend className="mb-2 flex w-full items-baseline justify-between gap-2 text-small font-medium text-ink">
        <span>Sandbox</span>
        <button type="button" className="rounded-control text-small font-normal text-ink-2 underline-offset-2 hover:text-ink hover:underline" disabled={rechecking}
          onClick={async () => { setRechecking(true); await onRecheck(); setRechecking(false); announce("Checked this computer again"); }}>
          {rechecking ? "Checking…" : "Check again"}
        </button>
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {boxes.options.map((o) => (
          <ChoiceTile key={o.engine} size="sm" name={name} value={o.engine} checked={value === o.engine} onChange={onChange} disabled={!o.available}
            title={o.name}
            badge={<span className="text-small text-ink-3">{o.default ? "Recommended" : ISOLATION_WORD[o.isolation]}</span>}
            note={o.available ? o.blurb : (o.reason ?? "Not on this computer")} />
        ))}
      </div>
    </fieldset>
  );
}

/**
 * This computer can't run agents in a sandbox (no microVM, WSL/gVisor, Docker or Podman). Plain words for why, and
 * the ways forward: turn WSL on (Windows), run it in your cloud, or, last, run it here without a sandbox.
 */
function HereChoice({ local, agentName, onAddCloud, onRunHere }: { local: LocalState; agentName: string; onAddCloud?: () => void; onRunHere: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wsl, setWsl] = useState<string>();
  if (local.unsupported) return <Notice tone="needs">{local.unsupported} You can still run agents in your cloud.</Notice>;
  const wslProbe = local.probes.find((p) => p.action === "enable-wsl");
  const why = local.probes.filter((p) => !p.available && p.engine !== "host");
  return (
    <div className="space-y-3 rounded-unit border border-signal/40 bg-signal-wash p-4" role="group" aria-label="Where should it run?">
      <p className="font-medium text-ink">This computer can't run {agentName} in a sandbox.</p>
      {why.length > 0 && (
        <details className="text-small text-ink-2">
          <summary className="w-fit rounded-control">Why</summary>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5">{why.map((p) => <li key={p.engine}>{p.reason ?? `${p.engine} isn't available`}</li>)}</ul>
        </details>
      )}
      {wslProbe && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" onClick={async () => { const r = await api.enableWsl(); setWsl(r.started ? "Windows asks for permission, then to restart. Open Beamhop again after the restart." : r.error); }}>Turn on WSL</Button>
          <span className="text-small text-ink-2">{wsl ?? "Built into Windows: one permission prompt and a restart. The best option here."}</span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {onAddCloud && <Button size="sm" onClick={onAddCloud}>Run it in your cloud</Button>}
        {!confirm && <Button size="sm" variant="quiet" onClick={() => setConfirm(true)}>Run it here without a sandbox…</Button>}
      </div>
      {confirm && (
        <div className="space-y-2 rounded-control border border-line bg-surface p-3 text-small text-ink">
          <p>Without a sandbox, {agentName} runs as a normal program on this computer. It gets a browser of its own and never uses your screen or mouse, and it asks before touching anything outside its own folder. But nothing walls it off: its shell and files are yours.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="danger" loading={busy} onClick={async () => { setBusy(true); await onRunHere().finally(() => setBusy(false)); }}>Run here without a sandbox</Button>
            <Button size="sm" variant="quiet" onClick={() => setConfirm(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
