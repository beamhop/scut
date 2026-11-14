import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowSquareOutIcon, PaperPlaneRightIcon, XIcon, CheckIcon, WarningIcon } from "@phosphor-icons/react";
import { Agent, Destination, api, CLOUD_SETUP, helpOn, PROVIDERS, standaloneAgent } from "./lib.tsx";
import { ExportDialog, ImportDialog, placeLabel, beamInFlight } from "./beam.tsx";
import { CreateAgent } from "./create.tsx";
import { DesignPage } from "./design.tsx";
import { AgentView } from "./agentView.tsx";
import { Bench, Unit, AutostartToggle, pauseAgents, type UnitReport, type PendingBeam } from "./bench.tsx";
import { Button, IconButton, Dialog, Field, Input, Plate, announce, clock, durationWords, money, usdToEur, cx, useCommands } from "./ui/index.ts";

// Names other screens still import from here (old barrel style). Kept so their files keep compiling.
export { AutostartToggle };
export const Tile = Unit;
export const Dock = Bench;

// ---------------- notices (information only; anything that needs a decision goes in the tray or on the unit) ----------------
type Notice = { id: number; text: string; tone: "ok" | "err" };
function useNotices() {
  const [items, setItems] = useState<Notice[]>([]);
  const push = useCallback((text: string, tone: Notice["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setItems((t) => [...t.slice(-2), { id, text, tone }]);
    announce(text, { assertive: tone === "err" });
    setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), tone === "err" ? 14_000 : 9000);
  }, []);
  const view = (
    <div className="pointer-events-none fixed bottom-4 left-4 z-40 flex w-[min(400px,calc(100vw-32px))] flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} className="pointer-events-auto flex animate-pop items-start gap-2.5 rounded-unit border border-line bg-surface px-3.5 py-2.5 text-body text-ink shadow-float">
          {t.tone === "err" ? <WarningIcon size={16} weight="bold" aria-hidden className="mt-0.5 shrink-0 text-err" /> : <CheckIcon size={16} weight="bold" aria-hidden className="mt-0.5 shrink-0" />}
          <p className="min-w-0 flex-1">{t.text}</p>
          <IconButton size="sm" label="Dismiss" icon={XIcon} className="-my-1 -mr-1.5" onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))} />
        </div>
      ))}
    </div>
  );
  return { push, view };
}

// ---------------- add a cloud ----------------
export function AddCloud({ onClose, onAdded, helpers }: { onClose: () => void; onAdded: (label: string) => void; helpers: Agent[] }) {
  const [pick, setPick] = useState("fly");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const name = useId();
  const p = PROVIDERS.find((x) => x.id === pick)!;
  const usd = (x: (typeof PROVIDERS)[number]) => Number(x.price.match(/\d+(\.\d+)?/)?.[0] ?? 0);
  async function connect() {
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    const r = await fetch("/api/providers", { method: "POST", body: JSON.stringify({ id: pick, token }) }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
    setBusy(false);
    if (r.error) setError(r.error);
    else onAdded(p.label);
  }
  return (
    <Dialog open onClose={onClose} title="Add a cloud" size="md"
      description="Run agents on your own cloud account, so they keep working while this computer is off. You pay the provider directly."
      footer={<>
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!token.trim()} loading={busy} onClick={connect}>{busy ? "Checking…" : "Connect"}</Button>
      </>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); connect(); }}>
        <fieldset>
          <legend className="mb-1.5 text-small font-medium text-ink">Provider</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {PROVIDERS.map((x) => (
              <label key={x.id} className={cx("relative flex cursor-pointer flex-col rounded-control border px-3 py-2.5 transition-colors", pick === x.id ? "border-ink bg-surface-2" : "border-line-strong hover:bg-surface-2")}>
                <input type="radio" name={name} value={x.id} checked={pick === x.id} onChange={() => { setPick(x.id); setError(undefined); }} className="absolute inset-0 m-0 cursor-pointer appearance-none rounded-control" />
                <span className="text-body font-medium text-ink">{x.label}</span>
                <span className="text-small tabular-nums text-ink-2">{money(usdToEur(usd(x)), { approx: true, period: "month" })} per agent</span>
              </label>
            ))}
          </div>
        </fieldset>
        <ol className="list-decimal space-y-1 pl-5 text-body text-ink-2 marker:text-ink-3">
          <li><a className="inline-flex items-center gap-1 font-medium text-ink underline underline-offset-2" href={p.tokenUrl} target="_blank" rel="noreferrer">Get your {p.label} key<ArrowSquareOutIcon size={13} aria-hidden /><span className="sr-only"> (opens in a new tab)</span></a>. {p.hint}</li>
          <li>Paste it below. It stays on this computer.</li>
        </ol>
        <Field label={`${p.label} token`} error={error}>
          <Input mono type="password" autoComplete="off" aria-label={`${p.label} token`} placeholder="Paste the token" value={token} onChange={(e) => setToken(e.target.value)} />
        </Field>
        {helpers.length > 0 && (
          <div className="rounded-control bg-surface-2 px-3 py-2.5">
            <p className="text-small text-ink-2">Or let an agent do the signup on its screen while you watch. You enter any payment details yourself.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {helpers.slice(0, 4).map((h) => (
                <Button key={h.id} size="sm" onClick={() => { helpOn(h, CLOUD_SETUP(p.label, p.tokenUrl)); onClose(); }}>
                  <Plate pubkey={h.agentPubkey} name={h.name} size="sm" />Ask {h.name}
                </Button>
              ))}
            </div>
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// ---------------- crew room ----------------
export function CrewRoomPanel({ onClose, agentNames, agents = [] }: { onClose: () => void; agentNames: string[]; agents?: Agent[] }) {
  const [data, setData] = useState<{ enabled: boolean; lines: { name: string; text: string; ts: number }[]; members: { name: string; kind: string }[] }>();
  const [text, setText] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const load = () => fetch("/api/crew").then((r) => r.json()).then(setData).catch(() => {});
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { const box = log.current; if (box) box.scrollTop = box.scrollHeight; }, [data?.lines.length]);
  const isMe = (n: string) => n === "You" || n === "Owner";
  const pub = (n: string) => agents.find((a) => a.name === n)?.agentPubkey;
  return (
    <aside aria-label="Crew room" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
      className="fixed inset-y-0 right-0 z-30 flex w-full animate-drawer flex-col border-l border-line bg-surface shadow-float sm:w-[400px]">
      <header className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-ui-lg text-ink">Crew room</h2>
          <p className="text-small text-ink-2">{agentNames.length === 1 ? "1 agent" : `${agentNames.length} agents`} · end-to-end encrypted</p>
        </div>
        <IconButton label="Close crew room" icon={XIcon} size="sm" onClick={onClose} />
      </header>
      <div ref={log} role="log" aria-label="Crew messages" className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {data && !data.lines.length && (
          <div className="mt-6 space-y-3 text-body text-ink-2">
            <p>Talk to all your agents at once. Mention one to give it a task.</p>
            <div className="flex flex-wrap gap-2">
              {agentNames.map((n) => <Button key={n} size="sm" onClick={() => { setText(`@${n} `); input.current?.focus(); }}>@{n}</Button>)}
            </div>
          </div>
        )}
        {data?.lines.map((l, i) => (
          <div key={i} className={cx("min-w-0", !isMe(l.name) && "border-l-2 border-line pl-3")}>
            <div className="mb-0.5 flex items-center gap-1.5 text-small">
              {!isMe(l.name) && <Plate pubkey={pub(l.name)} name={l.name} size="sm" />}
              <span className="font-medium text-ink">{isMe(l.name) ? "You" : l.name}</span>
              <span className="tabular-nums text-ink-3">{clock(l.ts)}</span>
            </div>
            <p className="whitespace-pre-wrap text-body text-ink [overflow-wrap:anywhere]">{l.text}</p>
          </div>
        ))}
      </div>
      <form className="flex gap-2 border-t border-line p-3" onSubmit={async (e) => { e.preventDefault(); if (!text.trim()) return; const t = text; setText(""); await fetch("/api/crew", { method: "POST", body: JSON.stringify({ text: t }) }); }}>
        <Input ref={input} value={text} onChange={(e) => setText(e.target.value)} aria-label="Message the crew" placeholder="Message everyone…" className="min-w-0 flex-1" />
        <Button type="submit" variant="primary" icon={PaperPlaneRightIcon} disabled={!text.trim()}>Send</Button>
      </form>
    </aside>
  );
}

// ---------------- app shell ----------------
export function App() {
  const solo = useMemo(standaloneAgent, []);
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const h = () => setHash(location.hash); addEventListener("hashchange", h); return () => removeEventListener("hashchange", h); }, []);
  if (hash === "#/design") return <DesignPage />;
  if (solo) return <SoloAgent agent={solo} />;
  return <CrewApp />;
}

export function SoloAgent({ agent }: { agent: Agent }) {
  const [info, setInfo] = useState({ name: agent.name, mascot: agent.mascot, agentPubkey: "" });
  useEffect(() => {
    fetch(`/status?auth=${agent.token}`).then((r) => r.json()).then((s) => s.spec && setInfo({ name: s.spec.name, mascot: s.spec.mascot ?? "cyan", agentPubkey: s.spec.agentPubkey })).catch(() => {});
  }, []);
  return <AgentView agent={{ ...agent, ...info }} dests={[]} onBack={() => {}} onBeam={() => {}} standalone />;
}

/**
 * When the owner was last here, for the bench's "While you were away" line. Marked every 30 s while the window is
 * visible (in any view); a gap of 10 min or more (closed, hidden, asleep) counts as away.
 */
const AWAY_MS = 10 * 60_000;
function useAway() {
  const [since, setSince] = useState<number | undefined>(() => {
    try { const v = Number(localStorage.getItem("beamhop-seen")); return v && Date.now() - v >= AWAY_MS ? v : undefined; } catch { return undefined; }
  });
  useEffect(() => {
    const mark = () => { try { localStorage.setItem("beamhop-seen", String(Date.now())); } catch {} };
    let hiddenAt: number | undefined;
    const vis = () => {
      if (document.hidden) { hiddenAt = Date.now(); mark(); }
      else if (hiddenAt && Date.now() - hiddenAt >= AWAY_MS) setSince(hiddenAt);
    };
    mark();
    const t = setInterval(() => { if (!document.hidden) mark(); }, 30_000);
    document.addEventListener("visibilitychange", vis);
    addEventListener("pagehide", mark);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); removeEventListener("pagehide", mark); };
  }, []);
  return { since, dismiss: () => setSince(undefined) };
}

export function CrewApp() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [dests, setDests] = useState<Destination[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [route, setRoute] = useState(location.hash);
  const [reports, setReports] = useState<Record<string, UnitReport | undefined>>({});
  const [crewOpen, setCrewOpen] = useState(false);
  const [addCloud, setAddCloud] = useState(false);
  const [exportId, setExportId] = useState<string>();
  const [importing, setImporting] = useState(false);
  const [pending, setPending] = useState<PendingBeam>();
  const notices = useNotices();
  const prevStages = useRef<Record<string, string | undefined>>({});
  const focusOnLand = useRef<string | undefined>(undefined);
  const destsRef = useRef(dests);
  destsRef.current = dests;
  const away = useAway();

  const refresh = useCallback(async () => {
    const list = await api.agents().catch(() => null);
    if (!list) return;
    for (const ag of list) {
      const prev = prevStages.current[ag.id];
      const now = ag.beam?.stage;
      if (prev && prev !== now && now === "online") {
        const to = placeLabel(destsRef.current, ag.current.driver);
        announce(`${ag.name} arrived on ${to}${ag.beam?.doneAt ? ` in ${durationWords(ag.beam.doneAt - ag.beam.startedAt)}` : ""}.`);
        if (focusOnLand.current === ag.id) {
          focusOnLand.current = undefined;
          setTimeout(() => document.querySelector<HTMLElement>(`[data-unit="${CSS.escape(ag.id)}"]`)?.focus(), 50);
        }
      }
      if (prev && prev !== now && now === "failed") announce(`Beam failed. ${ag.name} stayed on ${placeLabel(destsRef.current, ag.current.driver)}.`, { assertive: true });
      prevStages.current[ag.id] = now;
    }
    setAgents(list);
    setLoaded(true);
  }, []);
  useEffect(() => { api.destinations().then(setDests).catch(() => {}); }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1500);
    const h = () => setRoute(location.hash);
    addEventListener("hashchange", h);
    return () => { clearInterval(t); removeEventListener("hashchange", h); };
  }, [refresh]);
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    const onCloud = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.ok) { api.destinations().then(setDests); notices.push(`Your agent connected ${d.provider}. Use Beam to… to move an agent there.`); }
      else notices.push(`The ${d.provider} key from your agent didn't work: ${d.error}`, "err");
    };
    const onExport = (e: Event) => setExportId((e as CustomEvent).detail);
    const onImport = () => setImporting(true);
    addEventListener("scut:cloud", onCloud);
    addEventListener("beamhop:export", onExport);
    addEventListener("beamhop:import", onImport);
    return () => { removeEventListener("scut:cloud", onCloud); removeEventListener("beamhop:export", onExport); removeEventListener("beamhop:import", onImport); };
  }, []);
  // Forget reports of agents that left (moved to a file, removed).
  useEffect(() => { setReports((r) => Object.fromEntries(Object.entries(r).filter(([id]) => agents.some((a) => a.id === id)))); }, [agents.length]);
  const onReport = useCallback((id: string, r: UnitReport) => setReports((x) => ({ ...x, [id]: r })), []);

  // ---- beaming ----
  const doBeam = useCallback(async (id: string, to: string) => {
    setPending(undefined);
    const ag = agents.find((a) => a.id === id);
    if (!ag) return;
    const r = await api.beam(id, to).catch((e) => ({ error: String(e) }));
    if (r.error) notices.push(`Couldn't start the beam: ${r.error}`, "err");
    else {
      const from = placeLabel(dests, ag.current.driver), dest = placeLabel(dests, to);
      announce(`${ag.name} is moving from ${from} to ${dest}. It stays on ${from} until it lands safely.`);
      if (document.activeElement === document.body || document.activeElement?.closest(`[data-unit="${CSS.escape(id)}"]`)) focusOnLand.current = id;
    }
    refresh();
  }, [agents, dests, refresh]);
  const requestBeam = useCallback((id: string, to: string) => {
    if (to === "file") return setExportId(id);
    const ag = agents.find((a) => a.id === id);
    const d = dests.find((x) => x.id === to);
    if (!ag || !d || ag.current.driver === to || beamInFlight(ag)) return;
    if (d.monthlyUsd > 0) { setPending({ agentId: id, to, mode: "confirm", at: Date.now() }); announce(`Beam ${ag.name} to ${d.label}? It costs about ${money(usdToEur(d.monthlyUsd), { period: "month" })}. Press Beam to confirm, or Cancel.`); }
    else { setPending({ agentId: id, to, mode: "undo", at: Date.now() + 5000 }); announce(`${ag.name} beams to ${d.label} in 5 seconds. Press Undo to stay.`); }
  }, [agents, dests]);
  useEffect(() => {
    if (pending?.mode !== "undo") return;
    const t = setTimeout(() => doBeam(pending.agentId, pending.to), Math.max(0, pending.at - Date.now()));
    return () => clearTimeout(t);
  }, [pending, doBeam]);
  const cancelBeam = () => {
    if (pending) {
      const ag = agents.find((a) => a.id === pending.agentId);
      announce(`Cancelled. ${ag?.name ?? "The agent"} stays where it is.`);
      setTimeout(() => document.querySelector<HTMLElement>(`[data-unit="${CSS.escape(pending.agentId)}"]`)?.focus(), 0);
    }
    setPending(undefined);
  };

  // ---- palette: agents and beams (everywhere in the crew app) ----
  const routeId = route.match(/^#\/agent\/([^?]+)/)?.[1];
  useCommands([
    { id: "all.pause", title: "Pause all agents", group: "Agents", synonyms: ["stop everything", "emergency", "hold", "freeze"], disabled: !agents.length, run: () => pauseAgents(agents, true, routeId ? undefined : reports) },
    { id: "all.resume", title: "Resume all agents", group: "Agents", synonyms: ["continue", "unpause", "give back"], disabled: !agents.length, run: () => pauseAgents(agents, false, routeId ? undefined : reports) },
  ], [agents, routeId, reports]);
  useCommands(agents.flatMap((ag) => [
    { id: `open.${ag.id}`, title: `Open ${ag.name}`, group: "Agents", synonyms: ["show", "go to", "watch"], hint: placeLabel(dests, ag.current.driver), disabled: ag.id === routeId, run: () => (location.hash = `#/agent/${ag.id}`) },
    ...dests.filter((d) => d.id !== ag.current.driver).map((d) => ({
      id: `beam.${ag.id}.${d.id}`, title: `Beam ${ag.name} to ${d.label}`, group: "Beam", synonyms: ["move", "send", "transfer", "migrate"],
      hint: d.monthlyUsd ? money(usdToEur(d.monthlyUsd), { approx: true, period: "month" }) : money(0, { whole: true, period: "month" }), disabled: beamInFlight(ag),
      run: () => { location.hash = ""; requestBeam(ag.id, d.id); },
    })),
    { id: `file.${ag.id}`, title: `Move ${ag.name} to a file`, group: "Beam", synonyms: ["export", "send to another computer", "save"], disabled: beamInFlight(ag), run: () => setExportId(ag.id) },
  ]), [agents, dests, requestBeam, routeId]);

  // #/agent/<id>, optionally ?settings or ?settings=<section> (the agent view opens its Settings drawer there).
  const open = useMemo(() => agents.find((x) => x.id === routeId), [agents, routeId]);
  const exportAgent = agents.find((x) => x.id === exportId);
  const dialogs = <>
    {exportAgent && <ExportDialog agent={exportAgent} onClose={() => setExportId(undefined)} onDone={(name) => { setExportId(undefined); location.hash = ""; refresh(); notices.push(`${exportAgent.name} is now in ${name}. Open it in Beamhop on the other computer.`); }} />}
    {importing && <ImportDialog dests={dests} onClose={() => setImporting(false)} onDone={(name) => { setImporting(false); refresh(); notices.push(`${name} is here.`); }} />}
  </>;

  if (open) return <>{dialogs}{notices.view}<AgentView agent={open} dests={dests} onBack={() => (location.hash = "")} onBeam={(to) => (to === "file" ? setExportId(open.id) : doBeam(open.id, to))} /></>;

  return (
    <>
      <Bench agents={agents} dests={dests} loaded={loaded} reports={reports} onReport={onReport}
        pending={pending} onConfirmBeam={() => pending && doBeam(pending.agentId, pending.to)} onCancelBeam={cancelBeam} requestBeam={requestBeam}
        landed={{}} onCreate={() => setCreating(true)} onAddCloud={() => setAddCloud(true)} onImport={() => setImporting(true)} onExport={setExportId}
        crewOpen={crewOpen} onToggleCrew={() => setCrewOpen((v) => !v)} awaySince={away.since} onDismissAway={away.dismiss}
        empty={!creating && <CreateAgent firstRun inline onDone={refresh} />} />
      {creating && <CreateAgent firstRun={false} onDone={() => { setCreating(false); refresh(); }} />}
      {addCloud && <AddCloud helpers={agents} onClose={() => setAddCloud(false)} onAdded={(label) => { setAddCloud(false); api.destinations().then(setDests); notices.push(`${label} added. Use Beam to… on an agent to move it there.`); }} />}
      {crewOpen && <CrewRoomPanel onClose={() => setCrewOpen(false)} agentNames={agents.map((x) => x.name)} agents={agents} />}
      {dialogs}
      {notices.view}
    </>
  );
}
