import { useRef, useState, type ReactNode } from "react";
import { ArrowsLeftRightIcon, CloudIcon, GearIcon, HandGrabbingIcon, LaptopIcon, PauseIcon, PlusIcon, ShieldCheckIcon, StopIcon, CaretDownIcon, CornersOutIcon, DeviceMobileIcon, MagnifyingGlassIcon, CheckIcon } from "@phosphor-icons/react";
import {
  Bezel, Button, Dialog, Drawer, Field, HoldButton, IconButton, Input, Kbd, Lamp, Menu, Plate, Progress, Readout, ScreenNote, Segmented,
  Select, StatusBadge, Switch, Textarea, Tray, announce, openCommandPalette, useCommands, fmt, type Status,
} from "./ui/index.ts";

/** #/design — every primitive in every variant, light and dark side by side. For review, not for users. */

const AGENTS = [
  { name: "Atlas", pubkey: "7e7e4b1c9a2f08d3b5e61f0c4a9d27e8b3c15f6a0d9e2b74c18a3f5e6d0b92c4" },
  { name: "Nova", pubkey: "c3f19a07d2e4b85c61f0a39e7d24b8c5f1e06a93d7c2b48e5f1a09c3d6e7b2a8" },
  { name: "Scout", pubkey: "2a9d4c7e1b3f5a08c6e2d94b7f1a3c5e8d0b6f2a4c9e7d1b3f5a8c0e2d4b6f9a" },
  { name: "Packy", pubkey: "e81b5d3a9f7c2e40b6d8f1a3c5e7092b4d6f8a1c3e5b7d9f0a2c4e6b8d1f3a5c" },
  { name: "Gridy", pubkey: "54c0e8a2f6d4b1937e5c0a8f2d6b4e1937c5a0f8e2d6b4c1a9375e0c8f2a6d4b" },
];

export function DesignPage() {
  useCommands([
    { id: "d.open", title: "Open Atlas", group: "Agents", run: () => announce("Opening Atlas") },
    { id: "d.beam", title: "Beam Atlas to Fly.io", synonyms: ["move", "send", "transfer"], group: "Beam", hint: "~€18/month", run: () => announce("Beaming Atlas to Fly.io") },
    { id: "d.beam2", title: "Beam Nova to This computer", synonyms: ["move", "send", "transfer"], group: "Beam", hint: "free", run: () => announce("Beaming Nova") },
    { id: "d.pause", title: "Pause Atlas", synonyms: ["hold", "freeze"], group: "Agents", run: () => announce("Atlas paused") },
    { id: "d.new", title: "New agent", shortcut: "mod+shift+n", group: "Crew", run: () => announce("New agent") },
    { id: "d.talk", title: "Talk to all agents", synonyms: ["crew room", "chat"], group: "Crew", run: () => announce("Crew room") },
    { id: "d.theme", title: "Toggle theme", synonyms: ["dark", "light", "appearance"], group: "View", run: () => announce("Theme toggled") },
    { id: "d.previews", title: "Pause previews", synonyms: ["video", "screens"], group: "View", run: () => announce("Previews paused") },
  ]);
  return (
    <main className="min-h-screen bg-bg">
      <header className="flex items-end gap-6 border-b border-line bg-surface px-8 py-6">
        <div>
          <div className="wordmark text-h2 text-ink">Beamhop</div>
          <h1 className="mt-1 text-body text-ink-2">Design system · Instrument · every primitive, both themes</h1>
        </div>
        <div className="ml-auto flex items-center gap-2 text-small text-ink-2">
          <span>Find anything</span><Kbd keys="mod+k" />
        </div>
      </header>
      <div className="grid grid-cols-1 xl:grid-cols-2">
        <ThemeHalf theme="light" />
        <ThemeHalf theme="dark" />
      </div>
    </main>
  );
}

function ThemeHalf({ theme }: { theme: "light" | "dark" }) {
  return (
    <section data-theme={theme} aria-label={theme === "light" ? "Light theme" : "Dark theme"} className="min-w-0 space-y-10 bg-bg px-8 pb-16 pt-8 text-ink">
      <div className="flex items-baseline gap-3">
        <h2 className="text-h2">{theme === "light" ? "Light" : "Dark"}</h2>
        <span className="text-small text-ink-2">{theme === "light" ? "Default. Warm chassis, ink controls." : "Follows the OS. Warm charcoal, never navy."}</span>
      </div>
      <Tokens />
      <Type />
      <Buttons />
      <StatusSection />
      <Plates />
      <Screens />
      <Approvals theme={theme} />
      <Forms />
      <Progressions />
      <Overlays />
      <Formats />
    </section>
  );
}

function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-baseline gap-3 border-b border-line pb-2">
        <h3 className="text-body font-semibold">{title}</h3>
        {note && <p className="min-w-0 truncate text-small text-ink-2">{note}</p>}
      </div>
      {children}
    </div>
  );
}

function Row({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-wrap items-center gap-2 ${className}`}>{children}</div>;
}

// ---------------- tokens ----------------
const SWATCHES: [string, string][] = [
  ["bg", "bg-bg"], ["surface", "bg-surface"], ["surface-2", "bg-surface-2"], ["line", "bg-line"], ["line-strong", "bg-line-strong"],
  ["ink-3", "bg-ink-3"], ["ink-2", "bg-ink-2"], ["ink", "bg-ink"], ["screen", "bg-screen"],
  ["signal-wash", "bg-signal-wash"], ["signal", "bg-signal"], ["signal-ink", "bg-signal-ink"], ["ok", "bg-ok"], ["warn", "bg-warn"], ["err", "bg-err"],
];
function Tokens() {
  return (
    <Block title="Colour" note="One accent, one meaning: signal = a person is needed.">
      <div className="grid grid-cols-5 gap-x-2 gap-y-3 sm:grid-cols-8">
        {SWATCHES.map(([name, cls]) => (
          <div key={name} className="min-w-0">
            <div className={`h-9 rounded-control border border-line ${cls}`} />
            <div className="mt-1 truncate font-mono text-[10.5px] text-ink-2">{name}</div>
          </div>
        ))}
      </div>
    </Block>
  );
}

// ---------------- type ----------------
function Type() {
  return (
    <Block title="Type" note="Mona Sans · Commit Mono for machine strings · Departure Mono for readouts only">
      <div className="grid grid-cols-[72px_1fr] items-baseline gap-x-4 gap-y-2.5">
        <Spec n="display 40" /><div className="text-display [font-stretch:115%]">Atlas</div>
        <Spec n="h2 24" /><div className="text-h2">Waiting for you</div>
        <Spec n="h3 18" /><div className="text-h3">How much it may do on its own</div>
        <Spec n="ui-lg 15" /><div className="text-ui-lg">Comparing e-bike prices on bol.com</div>
        <Spec n="body 13" /><div className="text-body">Atlas keeps working while this computer is off. You pay Fly.io directly.</div>
        <Spec n="small 12" /><div className="text-small text-ink-2">Free since 14:02 · Tomorrow 08:00 · HN digest</div>
        <Spec n="micro 11" /><div className="label-micro text-ink-2">€ today · CPU · Memory</div>
        <Spec n="mono" /><div className="font-mono text-[12.5px] text-ink">sk-or-…9f2c · anthropic/claude-haiku-5.5</div>
        <Spec n="readout" /><div className="readout text-ink">Working · 01:42 · €0.03 today</div>
        <Spec n="numbers" /><div className="text-ui-lg tabular-nums">€0.42 · 1,234 · 00:07 · 42 MB</div>
      </div>
    </Block>
  );
}
const Spec = ({ n }: { n: string }) => <div className="font-mono text-[10.5px] text-ink-3">{n}</div>;

// ---------------- buttons ----------------
function Buttons() {
  const [loading, setLoading] = useState(false);
  return (
    <Block title="Buttons" note="Primary = solid ink. Signal only when a person is needed.">
      <div className="space-y-3">
        <Row>
          <Button variant="primary" icon={PlusIcon}>New agent</Button>
          <Button variant="secondary">Open</Button>
          <Button variant="secondary" icon={ArrowsLeftRightIcon} iconEnd={CaretDownIcon}>Beam to…</Button>
          <Button variant="quiet">Cancel</Button>
          <Button variant="signal" icon={HandGrabbingIcon}>Take over</Button>
          <Button variant="danger">Remove Atlas…</Button>
        </Row>
        <Row>
          <Button size="sm" variant="primary">Create</Button>
          <Button size="sm">Show all</Button>
          <Button size="sm" variant="quiet">Details</Button>
          <Button size="sm" variant="signal">Allow</Button>
          <Button size="sm" variant="danger">Stop</Button>
          <Button size="sm" disabled>Disabled</Button>
          <Button size="sm" variant="primary" loading={loading} onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 1800); }}>{loading ? "Checking…" : "Check key"}</Button>
        </Row>
        <Row>
          <Button variant="secondary" icon={MagnifyingGlassIcon} shortcut="mod+k" className="w-64 justify-start text-ink-2"><span className="flex-1 text-left">Search or do anything</span></Button>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <IconButton label="Settings" icon={GearIcon} />
          <IconButton label="Open on your phone" icon={DeviceMobileIcon} />
          <IconButton label="Focus screen" icon={CornersOutIcon} pressed />
          <IconButton label="Pause" icon={PauseIcon} variant="secondary" />
          <IconButton label="Stop" icon={StopIcon} variant="secondary" size="sm" />
          <IconButton label="Safety: all good" icon={ShieldCheckIcon} size="sm" />
        </Row>
      </div>
    </Block>
  );
}

// ---------------- status ----------------
const STATES: Status[] = ["needs", "working", "free", "moving", "problem"];
function StatusSection() {
  return (
    <Block title="Status" note="Word + shape + colour. Five states only.">
      <div className="space-y-3">
        <Row className="gap-x-5">{STATES.map((s) => <StatusBadge key={s} status={s} />)}</Row>
        <Row className="gap-x-5">
          <StatusBadge status="needs" emphasis label="Waiting for you" />
          <StatusBadge status="moving" label="Beaming to Fly.io" size="sm" />
          <StatusBadge status="problem" label="Telegram can't sign in" size="sm" />
          <StatusBadge status="free" label="Free since 14:02" size="sm" />
        </Row>
        <div className="on-screen inline-flex items-center gap-4 rounded-control bg-screen px-3 py-2">
          {STATES.map((s) => <StatusBadge key={s} status={s} onScreen size="sm" />)}
        </div>
      </div>
    </Block>
  );
}

// ---------------- plates ----------------
function Plates() {
  return (
    <Block title="Plates" note="Key-derived dot glyph + callsign. Monochrome. Replaces mascots.">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <Plate {...AGENTS[0]} size="lg" />
        {AGENTS.map((a) => <Plate key={a.name} {...a} size="md" showName />)}
        <div className="flex items-center gap-3">{AGENTS.map((a) => <Plate key={a.name} {...a} size="sm" />)}</div>
      </div>
    </Block>
  );
}

// ---------------- bezel + readout ----------------
function FakePage({ dim }: { dim?: boolean }) {
  // A neutral stand-in for a live frame: a shop page drawn in screen tones.
  return (
    <svg viewBox="0 0 320 200" className={`absolute inset-0 h-full w-full ${dim ? "opacity-35" : ""}`} aria-hidden>
      <rect width="320" height="200" fill="oklch(0.96 0.003 85)" />
      <rect width="320" height="22" fill="oklch(0.9 0.004 85)" />
      <rect x="10" y="8" width="44" height="6" rx="2" fill="oklch(0.55 0.01 85)" />
      <rect x="120" y="7" width="120" height="8" rx="4" fill="oklch(0.99 0 0)" />
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${12 + i * 102} 34)`}>
          <rect width="92" height="64" rx="3" fill="oklch(0.88 0.006 85)" />
          <rect y="72" width="70" height="5" rx="2" fill="oklch(0.35 0.008 85)" />
          <rect y="82" width="48" height="5" rx="2" fill="oklch(0.6 0.006 85)" />
          <rect y="94" width="34" height="7" rx="2" fill="oklch(0.3 0.01 85)" />
        </g>
      ))}
      <rect x="12" y="150" width="296" height="38" rx="3" fill="oklch(0.92 0.004 85)" />
    </svg>
  );
}

function Screens() {
  const [driving, setDriving] = useState(false);
  return (
    <Block title="Bezel + readout" note="Watch-only by default. Driving turns the bar signal.">
      <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0 space-y-2">
          <Bezel
            label="Atlas's screen"
            state={driving ? "driving" : "watching"}
            bar={driving ? (
              <>
                <HandGrabbingIcon size={14} weight="bold" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium">You're driving · Atlas is waiting</span>
                <Button size="sm" variant="on-signal" className="h-6" onClick={() => setDriving(false)}>Give back to Atlas</Button>
              </>
            ) : (
              <>
                <Lamp status="working" />
                <span className="min-w-0 flex-1 truncate">Comparing e-bike prices · bol.com</span>
                <Button size="sm" variant="signal" className="h-6" onClick={() => setDriving(true)}>Take over</Button>
              </>
            )}
          >
            <FakePage />
          </Bezel>
          <Readout label="Atlas" items={[{ value: "Working", status: "working" }, { value: fmt.duration(102_000), srLabel: "elapsed" }, { value: fmt.money(0.03), label: "today" }, { value: 12, label: "steps" }]} />
        </div>
        <div className="min-w-0 space-y-2">
          <Bezel size="sm" label="Nova's screen" bar={<><Lamp status="free" onScreen /><span className="truncate text-screen-ink-2">Free since 14:02</span></>}>
            <FakePage dim />
          </Bezel>
          <Bezel size="sm" label="Scout's screen">
            <ScreenNote>Starting Scout's screen…</ScreenNote>
          </Bezel>
          <Readout on="screen" label="Scout" items={[{ value: "Moving", status: "moving" }, { value: "00:07", srLabel: "elapsed" }]} />
        </div>
      </div>
    </Block>
  );
}

// ---------------- approvals (composition) ----------------
function Approvals({ theme }: { theme: string }) {
  const [log, setLog] = useState<string[]>([]);
  const say = (s: string) => { setLog((l) => [s, ...l].slice(0, 3)); announce(s); };
  return (
    <Block title="Tray + hold to confirm" note="Allow is inert 600 ms and never focused. High risk = hold 700 ms.">
      <Tray level={3} title={theme === "light" ? "Waiting for you" : "Waiting for you (dark)"} count={2}>
        <ApprovalDemo agent={AGENTS[0]} title="Pay €24.90 to bol.com" risk="High" detail="Card ending 4421 · order #NL-88231" onDone={say} hold />
        <ApprovalDemo agent={AGENTS[2]} title="Open news.ycombinator.com" risk="Low" detail="routine: HN digest" onDone={say} />
      </Tray>
      <div className="mt-1 min-h-5 text-small text-ink-2" aria-hidden>{log[0] ?? " "}</div>
    </Block>
  );
}

function ApprovalDemo({ agent, title, risk, detail, hold, onDone }: { agent: { name: string; pubkey: string }; title: string; risk: string; detail: string; hold?: boolean; onDone: (s: string) => void }) {
  const [armed] = useState(() => Date.now());
  return (
    <article aria-label={`${agent.name} wants to ${title}`} className="w-[300px] rounded-unit border border-line bg-surface p-3.5">
      <div className="flex items-center gap-2">
        <Plate {...agent} size="sm" />
        <span className="text-small text-ink-2">{agent.name} wants to</span>
        <span className={`ml-auto inline-flex items-center gap-1 text-small font-medium ${risk === "High" ? "text-signal-ink" : "text-ink-2"}`}>
          {risk === "High" ? <Lamp status="needs" size={9} /> : <CheckIcon size={12} weight="bold" aria-hidden />}{risk === "High" ? "High risk" : "Low risk"}
        </span>
      </div>
      <h4 className="mt-1.5 text-ui-lg text-ink">{title}</h4>
      <p className="mt-0.5 font-mono text-[12px] text-ink-2">{detail}</p>
      <p className="mt-2 text-small text-ink-3">Decide within 23 min — then {agent.name} skips it</p>
      <div className="mt-3 flex items-center gap-2">
        {hold ? <HoldButton onConfirm={() => onDone(`Allowed: ${title}`)} size="sm">Hold to allow</HoldButton> : <Button size="sm" variant="signal" onClick={() => Date.now() - armed > 600 && onDone(`Allowed: ${title}`)}>Allow</Button>}
        <Button size="sm" onClick={() => onDone(`Declined: ${title}`)}>Don't</Button>
      </div>
    </article>
  );
}

// ---------------- forms ----------------
function Forms() {
  const [on, setOn] = useState(true);
  const [auto, setAuto] = useState<"ask" | "risky" | "never">("risky");
  const [name, setName] = useState("Atlas");
  return (
    <Block title="Fields" note="Visible labels. Borders are line-strong (≥3:1).">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint="You can change it later.">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="OpenRouter key" error="That key was rejected. Check it on openrouter.ai/keys." aside="Stays on this computer">
          <Input mono defaultValue="sk-or-v1-9f2c" />
        </Field>
        <Field label="Brain">
          <Select defaultValue="haiku">
            <option value="haiku">Claude Haiku (OpenRouter)</option>
            <option value="gpt">GPT-5.6 Luna (OpenAI)</option>
            <option value="local">Qwen 3.8 (this computer)</option>
          </Select>
        </Field>
        <Field label="Daily spending limit" hint="0 = no limit · about 1 M tokens a day">
          <Input inputMode="decimal" defaultValue="€1.00" className="tabular-nums" />
        </Field>
        <Field label="What Atlas does" className="sm:col-span-2">
          <Textarea rows={2} defaultValue="Keep an eye on my inbox and draft replies for me to approve." />
        </Field>
        <Segmented
          className="sm:col-span-2"
          legend="How much it may do on its own"
          value={auto}
          onChange={setAuto}
          options={[
            { value: "ask", label: "Ask first", description: "Every action needs your approval." },
            { value: "risky", label: "Risky only", description: "Asks before payments, messages, deletes and logins." },
            { value: "never", label: "Never ask", description: "Acts on its own. You can still watch and take over." },
          ]}
        />
        <Switch className="sm:col-span-2" checked={on} onChange={setOn} label="Open Beamhop when I log in" description="Agents on this computer come back after a restart." />
      </div>
    </Block>
  );
}

// ---------------- progress ----------------
function Progressions() {
  const stages = ["Packing", "Starting the new computer", "Sending 42 MB", "Starting Atlas", "Online"];
  const [stage, setStage] = useState(2);
  return (
    <Block title="Progress" note="Honest: moves only with real work. Staged for pipelines.">
      <div className="grid gap-5 sm:grid-cols-2">
        <Progress label="Downloading the agent computer" value={0.62} aside="1.3 of 2.1 GB" />
        <div>
          <Progress label="Beaming Atlas to Fly.io" stages={stages} current={stage} aside={fmt.duration(7_000)} tone="signal" />
          <Row className="mt-2">
            <Button size="sm" variant="quiet" onClick={() => setStage((s) => Math.max(0, s - 1))}>Back</Button>
            <Button size="sm" variant="quiet" onClick={() => setStage((s) => Math.min(stages.length - 1, s + 1))}>Next stage</Button>
          </Row>
        </div>
      </div>
    </Block>
  );
}

// ---------------- overlays ----------------
function Overlays() {
  const [dialog, setDialog] = useState(false);
  const [alert, setAlert] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const [auto, setAuto] = useState<"ask" | "risky" | "never">("ask");
  return (
    <Block title="Overlays + keys" note="APG dialogs: focus trap, Esc, focus returns. Menus: arrows + typeahead.">
      <Row>
        <Menu
          trigger={<Button iconEnd={CaretDownIcon}>Beam to…</Button>}
          heading="Beam Atlas to…"
          width={300}
          items={[
            { heading: "Places", items: [
              { id: "local", label: "This computer", hint: "here", disabled: true, onSelect: () => {} },
              { id: "fly", label: "Fly.io", hint: "~€18/month", description: "Key works · keeps working while this computer is off", onSelect: () => announce("Beaming Atlas to Fly.io") },
              { id: "render", label: "Render", hint: "~€73/month", description: "Key works", onSelect: () => announce("Beaming Atlas to Render") },
            ] },
            { items: [{ id: "file", label: "A file, for another computer…", hint: "offline", onSelect: () => announce("Move to file") }] },
          ]}
        />
        <Button onClick={() => setDialog(true)}>Dialog</Button>
        <Button variant="danger" onClick={() => setAlert(true)}>Alert dialog</Button>
        <Button onClick={() => setDrawer(true)} icon={GearIcon}>Settings drawer</Button>
        <Button variant="quiet" onClick={() => openCommandPalette()} shortcut="mod+k">Palette</Button>
      </Row>
      <Row className="mt-3 text-small text-ink-2">
        <Kbd keys="mod+k" /> palette <Kbd>N</Kbd> new agent <Kbd>?</Kbd> shortcuts <Kbd keys="alt+shift+a" /> oldest approval <Kbd>Esc</Kbd> close
      </Row>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Add a cloud"
        description="Run agents on your own cloud account, even when this computer is off. You pay the provider directly."
        footer={<><Button variant="quiet" onClick={() => setDialog(false)}>Cancel</Button><Button variant="primary" onClick={() => setDialog(false)}>Connect</Button></>}
      >
        <Field label="Fly.io token" hint="Fly.io → Account → Access tokens → Create.">
          <Input mono placeholder="fo1_…" />
        </Field>
      </Dialog>

      <Dialog
        open={alert}
        variant="alert"
        onClose={() => setAlert(false)}
        initialFocus={cancel}
        size="sm"
        title="Remove Atlas?"
        description="This deletes Atlas's computer, memory and logins on this computer. It can't be undone."
        footer={<><Button ref={cancel} variant="quiet" onClick={() => setAlert(false)}>Keep Atlas</Button><Button variant="danger" onClick={() => setAlert(false)}>Remove Atlas</Button></>}
      />

      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        title="Atlas settings"
        description="Changes apply right away."
        footer={<Button variant="primary" onClick={() => setDrawer(false)}>Done</Button>}
      >
        <div className="space-y-6">
          <div>
            <h3 className="mb-2 text-body font-semibold">Safety</h3>
            <StatusBadge status="free" label="Safety: all good" />
          </div>
          <Segmented legend="How much it may do on its own" value={auto} onChange={setAuto} options={[
            { value: "ask", label: "Ask first", description: "Every action needs your approval." },
            { value: "risky", label: "Risky only" },
            { value: "never", label: "Never ask" },
          ]} />
          <Field label="Daily spending limit" hint="0 = no limit"><Input defaultValue="€1.00" /></Field>
        </div>
      </Drawer>
    </Block>
  );
}

// ---------------- format helpers ----------------
function Formats() {
  const now = Date.now();
  const rows: [string, string][] = [
    ["money(0.42, { period: \"today\" })", fmt.money(0.42, { period: "today" })],
    ["money(18, { approx, period: \"month\" })", fmt.money(18, { approx: true, period: "month" })],
    ["money(0, { zero: \"free\" })", fmt.money(0, { zero: "free" })],
    ["money(0.001)", fmt.money(0.001)],
    ["compact(1_250_000)", fmt.compact(1_250_000)],
    ["duration(102_000)", fmt.duration(102_000)],
    ["durationWords(11_000)", fmt.durationWords(11_000)],
    ["relativeTime(now − 2 min)", fmt.relativeTime(now - 120_000, now)],
    ["plural(1, \"memory\", \"memories\")", fmt.plural(1, "memory", "memories")],
    ["bytes(42e6)", fmt.bytes(42e6)],
  ];
  return (
    <Block title="Format helpers" note="ui/format.ts · locale-aware · render with tabular-nums">
      <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="truncate font-mono text-[11.5px] text-ink-2">{k}</dt>
            <dd className="text-right text-body tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex flex-wrap gap-3 text-small text-ink-2">
        <span className="inline-flex items-center gap-1.5"><LaptopIcon size={16} aria-hidden /> This computer</span>
        <span className="inline-flex items-center gap-1.5"><CloudIcon size={16} aria-hidden /> Fly.io</span>
      </div>
    </Block>
  );
}
