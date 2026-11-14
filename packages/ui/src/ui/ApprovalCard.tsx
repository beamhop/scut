import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CheckIcon, HandGrabbingIcon, MagnifyingGlassPlusIcon, TriangleIcon, XIcon } from "@phosphor-icons/react";
import { assessApproval, type ApprovalKind, type Risk } from "@scut/protocol";
import { cx } from "./cx.ts";
import { Button } from "./Button.tsx";
import { HoldButton } from "./HoldButton.tsx";
import { Lamp } from "./status.tsx";
import { Plate } from "./Plate.tsx";
import { Dialog } from "./overlay.tsx";
import { Input } from "./form.tsx";
import { clock, durationWords, relativeTime } from "./format.ts";

/**
 * The approval card (DESIGN-PLAN §4.3, research 03 §1.3). One shape everywhere: the bench tray, the agent view
 * (above the composer) and the phone.
 *
 *   <ApprovalCard approval={req} agentName="Atlas" pubkey={agent.agentPubkey} task={status.task?.prompt} pageUrl={status.url}
 *     onAnswer={(ok, reason) => send({ t: "approval", id: req.id, ok, reason })} />
 *
 * Anatomy: plate + "{Agent} wants to" · verb-first title with the site's domain in bold and the path on its own line ·
 * risk in words plus a one-line reason derived from facts (never colour alone) · the payload, selectable · a screenshot
 * only when it shows what the action is about · "Came from: …" · a visible expiry countdown · Allow / Don't (+ an
 * optional reason). Allow is inert for 600 ms after the card appears and never takes focus; high risk is hold-to-allow,
 * with a click-to-confirm second step for people who can't hold. After answering, focus stays on the card (never body).
 * Pass `resolved` to echo the decision ("Allowed by you on Telegram, 14:02") instead of the buttons.
 */
export type ApprovalCardData = {
  id: string;
  title: string;
  detail?: string;
  ts: number;
  shot?: string;
  kind?: ApprovalKind;
  risk?: Risk;
  expiresAt?: number;
  origin?: string;
};
export type ApprovalCardProps = {
  approval: ApprovalCardData;
  agentName: string;
  pubkey?: string;
  /** `reason` is the owner's optional one-line "why not" (sent to the agent with the denial). */
  onAnswer: (ok: boolean, reason?: string) => void;
  /** Narrower card for trays and the phone: payload clamped to 3 lines, smaller thumbnail. */
  compact?: boolean;
  /** Decision echo; replaces the buttons. `by` as the protocol says it ("you on Telegram", "timeout"). */
  resolved?: { ok: boolean; by: string; at: number };
  /** Shown as a third button when the agent's screen is right there. */
  onTakeOver?: () => void;
  /** The task the agent is working on (status.task.prompt): a site that isn't in it gets flagged. */
  task?: string;
  /** The page the agent is on right now (status.url): the screenshot is shown only when the action is about that page. */
  pageUrl?: string;
  className?: string;
};

/** Older agents send tool-style titles ("open_url https://…"); make them read as a sentence. URLs are kept whole. */
export function approvalTitle(title: string) {
  const m = title.match(/^(open_url|click|dblclick|type|key|scroll)\b\s*(.*)$/);
  let t = title;
  if (m) {
    const [, k, rest] = m;
    const url = rest.match(/https?:\/\/\S+/)?.[0];
    t = k === "open_url" ? `Open ${url ?? rest}` : k === "click" ? "Click on the screen" : k === "dblclick" ? "Double-click on the screen"
      : k === "type" ? `Type ${rest.match(/"(.*)"/)?.[0] ?? "text"}` : k === "key" ? `Press ${rest}` : "Scroll";
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The same title for one-line places (headlines, screen-reader text): URLs shortened to their host. */
export function approvalTitleShort(title: string) {
  return approvalTitle(title).replace(/https?:\/\/([^/\s]+)\S*/g, (_, h: string) => h.replace(/^www\./, ""));
}

/** Risk for a card: the backend's when given, otherwise the same classifier it uses. */
export function approvalRisk(a: Pick<ApprovalCardData, "title" | "detail" | "kind" | "risk">): Risk {
  return a.risk ?? assessApproval(a.title, a.detail, a.kind).risk;
}

/** Risk words for the card. "Medium risk", not "Check this": an imperative verb reads as a button. */
export const RISK_LABEL: Record<Risk, string> = { low: "Low risk", medium: "Medium risk", high: "High risk" };

const URL_RE = /https?:\/\/[^\s"'<>]+/;
/** "https://www.shop.example.com/a?b" → { host: "www.shop.example.com", reg: "example.com", rest: "/a?b" } */
export function splitUrl(url: string) {
  try {
    const u = new URL(url.replace(/[.,;:!?)]+$/, ""));
    const host = u.hostname;
    return { host, reg: registrable(host), rest: `${u.pathname === "/" ? "" : u.pathname}${u.search}` };
  } catch {
    return undefined;
  }
}
/** The registrable part of a host (naive public-suffix rule): bol.com, example.co.uk. */
export function registrable(host: string) {
  const p = host.replace(/^www\./, "").split(".");
  if (p.length <= 2) return p.join(".");
  const two = p.slice(-2);
  const sld = /^(co|com|org|net|ac|gov|edu|ne|or)$/.test(two[0]) && two[1].length === 2;
  return p.slice(sld ? -3 : -2).join(".");
}
function hostIn(a: Pick<ApprovalCardData, "title" | "detail">) {
  const url = a.title.match(URL_RE)?.[0] ?? a.detail?.match(URL_RE)?.[0];
  return url ? splitUrl(url) : undefined;
}

/** One line of "why" behind the risk word, from facts the UI knows: the kind of action and the task it came from. */
export function riskReasons(a: Pick<ApprovalCardData, "title" | "detail" | "kind">, task?: string): string[] {
  const kind = a.kind && a.kind !== "other" ? a.kind : assessApproval(a.title, a.detail, a.kind).kind;
  const u = hostIn(a);
  const out: string[] = [];
  if (kind === "payment") out.push(/^open\b/i.test(a.title) ? "Looks like a payment page" : "Spends money");
  else if (kind === "login") out.push("Uses your login");
  else if (kind === "delete") out.push("Deletes something");
  else if (kind === "message") out.push("Sends a message as you");
  if (u && task) {
    const t = task.toLowerCase();
    const name = u.reg.split(".")[0];
    if (!t.includes(u.reg) && !new RegExp(`\\b${name.replace(/[^a-z0-9-]/g, "")}\\b`).test(t)) out.push("Site isn't in your task");
  }
  if (!out.length && kind === "open" && u) out.push("Opens a website");
  return out;
}

/** "Allowed by you on Telegram, 14:02" · "Skipped: nobody answered in time" */
export function resolutionText(r: { ok: boolean; by: string; at: number }, agentName: string) {
  if (r.by === "timeout") return `Skipped at ${clock(r.at)}: nobody answered in time, so ${agentName} didn't do it`;
  return `${r.ok ? "Allowed" : "Not allowed"} by ${r.by}, ${clock(r.at)}`;
}

function useNow(every: number, on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every, on]);
  return now;
}

/** Risk as word + shape, with an optional reason: "▲ High risk · Spends money". */
export function RiskBadge({ risk, id, reasons }: { risk: Risk; id?: string; reasons?: string[] }) {
  return (
    <span id={id} className="inline-flex min-w-0 items-center gap-1 text-small">
      <span className={cx("inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium", risk === "high" ? "text-signal-ink" : risk === "medium" ? "text-ink" : "text-ink-2")}>
        {risk === "high" ? <Lamp status="needs" size={9} /> : risk === "medium" ? <TriangleIcon size={10} weight="bold" aria-hidden /> : <CheckIcon size={11} weight="bold" aria-hidden />}
        {RISK_LABEL[risk]}
      </span>
      {!!reasons?.length && <span className="min-w-0 truncate text-ink-2"><span aria-hidden> · </span><span className="sr-only">: </span>{reasons.join(" · ")}</span>}
    </span>
  );
}

/** The title with the site's domain in bold (look-alike domains stand out) and the path on its own mono line. */
function Title({ title, compact }: { title: string; compact?: boolean }) {
  const m = title.match(URL_RE);
  const u = m ? splitUrl(m[0]) : undefined;
  if (!m || !u) return <>{title}</>;
  const before = title.slice(0, m.index).replace(/\s+$/, " ");
  const after = title.slice(m.index! + m[0].length);
  const sub = u.host.slice(0, u.host.length - u.reg.length);
  return (
    <>
      {before}
      <span className="whitespace-nowrap"><span className="font-normal text-ink-2">{sub}</span><span className="font-bold">{u.reg}</span></span>
      {after}
      {u.rest && <span className={cx("mt-0.5 block truncate font-mono font-normal text-ink-2", compact ? "text-[11.5px]" : "text-small")}>{u.rest}</span>}
    </>
  );
}

const REASONS = ["Wrong site", "Not now", "Ask me first next time"];

export function ApprovalCard({ approval: a, agentName, pubkey, onAnswer, compact, resolved, onTakeOver, task, pageUrl, className }: ApprovalCardProps) {
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  const risk = approvalRisk(a);
  const reasons = riskReasons(a, task);
  const [armed, setArmed] = useState(false);
  const [answered, setAnswered] = useState<boolean>();
  const [zoom, setZoom] = useState(false);
  const [more, setMore] = useState(false);
  const [why, setWhy] = useState<string>();
  useEffect(() => { const t = setTimeout(() => setArmed(true), 600); return () => clearTimeout(t); }, []);
  useEffect(() => { if (why === "") reasonRef.current?.focus(); }, [why === ""]);
  const left = a.expiresAt ? a.expiresAt - Date.now() : undefined;
  // Tick every second in the last two minutes, otherwise every 15 s.
  const now = useNow(left !== undefined && left < 120_000 ? 1000 : 15_000, !!a.expiresAt && !resolved);
  const remaining = a.expiresAt ? a.expiresAt - now : undefined;
  const urgent = remaining !== undefined && remaining < 120_000;
  const title = approvalTitle(a.title);
  const answer = (ok: boolean, reason?: string) => {
    if (answered !== undefined || resolved) return;
    // The buttons are about to go: keep focus on the card (the bench then moves it to the next one), never on <body>.
    if (root.current?.contains(document.activeElement)) root.current.focus({ preventScroll: true });
    setAnswered(ok);
    onAnswer(ok, reason?.trim() || undefined);
  };
  const longDetail = !!a.detail && (a.detail.length > (compact ? 140 : 280) || a.detail.split("\n").length > (compact ? 3 : 6));
  // The screenshot is taken when it asks, before the action. Show it only when it is about the page on screen.
  const u = hostIn(a);
  const showShot = !!a.shot && (u ? !!pageUrl && splitUrl(pageUrl)?.reg === u.reg : !(a.kind === "open"));

  let buttons: ReactNode;
  if (resolved) {
    buttons = (
      <p role="status" className="flex items-center gap-1.5 text-small text-ink-2">
        {resolved.ok ? <CheckIcon size={13} weight="bold" aria-hidden className="text-ink" /> : <XIcon size={13} weight="bold" aria-hidden />}
        {resolutionText(resolved, agentName)}
      </p>
    );
  } else if (answered !== undefined) {
    buttons = <p className="text-small text-ink-2">{answered ? "Allowing…" : `Telling ${agentName} no…`}</p>;
  } else {
    buttons = (
      <>
        {risk === "high"
          ? <HoldButton size="sm" onConfirm={() => answer(true)} aria-describedby={`${id}-r`} confirmPrompt="Allow this? High risk." confirmLabel="Yes, allow"
              confirmAnnouncement={`High risk. Press Yes, allow to confirm, or Cancel.`}>Hold to allow</HoldButton>
          : <Button size="sm" variant="signal" aria-disabled={!armed || undefined} className={cx(!armed && "cursor-not-allowed opacity-50")} onClick={() => armed && answer(true)}>Allow</Button>}
        <Button size="sm" onClick={() => answer(false, why)}>Don't</Button>
        {onTakeOver && <Button size="sm" variant="quiet" icon={HandGrabbingIcon} onClick={onTakeOver}>Take over</Button>}
        {why === undefined && (
          <button type="button" onClick={() => setWhy("")} className="ml-auto rounded-[4px] px-1 text-small text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink">Say why</button>
        )}
      </>
    );
  }

  return (
    <article
      ref={root}
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-r`}
      tabIndex={-1}
      data-approval={a.id}
      data-pending={!resolved && answered === undefined ? "" : undefined}
      className={cx(
        "flex min-w-0 flex-col rounded-unit border bg-surface text-left outline-offset-2",
        resolved ? "border-line" : "border-line-strong",
        compact ? "w-[min(360px,calc(100vw-40px))] p-3.5" : "w-full p-4",
        className,
      )}
    >
      <header className="flex items-center gap-2">
        <Plate pubkey={pubkey} name={agentName} size="sm" />
        <span className="min-w-0 truncate text-small text-ink-2">{agentName} wants to</span>
        <span className="ml-auto shrink-0 text-small tabular-nums text-ink-3">{relativeTime(a.ts)}</span>
      </header>
      <h3 id={`${id}-t`} className={cx("mt-1.5 min-w-0 text-ink [overflow-wrap:anywhere]", compact ? "text-ui-lg" : "text-h3")}>
        <span className="sr-only">{agentName} wants to: </span><Title title={title} compact={compact} />
      </h3>
      <p className="mt-1 flex min-w-0"><RiskBadge risk={risk} id={`${id}-r`} reasons={reasons} /></p>

      <div className="mt-2 flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          {a.detail && a.detail.trim() !== a.title.match(URL_RE)?.[0] && (
            <div>
              <p className={cx("select-text whitespace-pre-wrap rounded-control bg-surface-2 px-2.5 py-1.5 text-small text-ink [overflow-wrap:anywhere]", longDetail && !more && (compact ? "line-clamp-3" : "line-clamp-6"))}>
                {a.detail}
              </p>
              {longDetail && <button type="button" onClick={() => setMore(!more)} className="mt-1 rounded-[4px] text-small font-medium text-ink-2 underline underline-offset-2 hover:text-ink">{more ? "Show less" : "Show all"}</button>}
            </div>
          )}
          {(a.origin || a.expiresAt) && (
            <dl className="space-y-0.5 text-small">
              {a.origin && <div className="flex gap-1 text-ink-2"><dt className="shrink-0">Came from:</dt><dd className="min-w-0 truncate text-ink">{a.origin}</dd></div>}
              {a.expiresAt && !resolved && (
                <div className={cx("tabular-nums", urgent ? "font-medium text-signal-ink" : "text-ink-2")}>
                  <dt className="sr-only">Time left</dt>
                  <dd>{remaining! > 0 ? `Decide within ${durationWords(remaining!)}, then ${agentName} skips it` : `Time is up: ${agentName} skips it`}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
        {showShot && (
          <button type="button" onClick={() => setZoom(true)} aria-label="Enlarge the screenshot from when it asked"
            className={cx("group relative shrink-0 overflow-hidden rounded-control border border-line bg-screen", compact ? "w-24" : "w-44")}>
            <img src={a.shot} alt="" className="aspect-[16/10] w-full object-cover" />
            <span aria-hidden className="absolute bottom-1 right-1 grid size-5 place-items-center rounded-[4px] bg-surface/90 text-ink opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <MagnifyingGlassPlusIcon size={12} weight="bold" />
            </span>
          </button>
        )}
      </div>

      <div className="mt-3 flex min-h-7 flex-wrap items-center gap-2">{buttons}</div>

      {why !== undefined && !resolved && answered === undefined && (
        <form className="mt-2.5 space-y-2 border-t border-line pt-2.5" onSubmit={(e) => { e.preventDefault(); answer(false, why); }}>
          <Input ref={reasonRef} size="sm" aria-label={`Why not? ${agentName} reads this (optional)`} placeholder={`Why not? ${agentName} reads this`} maxLength={200}
            value={why} onChange={(e) => setWhy(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setWhy(undefined); } }} />
          <div className="flex flex-wrap items-center gap-1.5">
            {REASONS.map((r) => (
              <button key={r} type="button" aria-label={`Don't: ${r}`} onClick={() => answer(false, r)}
                className="pressable h-7 rounded-control border border-line-strong bg-surface px-2 text-small text-ink hover:bg-surface-2">
                {r}
              </button>
            ))}
          </div>
        </form>
      )}

      {showShot && (
        <Dialog open={zoom} onClose={() => setZoom(false)} size="lg" title={`${agentName}'s screen when it asked`} description={approvalTitleShort(a.title)}>
          <img src={a.shot} alt={`${agentName}'s screen when it asked to ${title.charAt(0).toLowerCase() + title.slice(1)}`} className="w-full rounded-control border border-line" />
        </Dialog>
      )}
    </article>
  );
}
