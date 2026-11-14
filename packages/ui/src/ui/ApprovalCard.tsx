import { useEffect, useId, useState } from "react";
import { CheckIcon, EyeIcon, HandGrabbingIcon, MagnifyingGlassPlusIcon, XIcon } from "@phosphor-icons/react";
import { RISK_WORD, assessApproval, type ApprovalKind, type Risk } from "@scut/protocol";
import { cx } from "./cx.ts";
import { Button } from "./Button.tsx";
import { HoldButton } from "./HoldButton.tsx";
import { Lamp } from "./status.tsx";
import { Plate } from "./Plate.tsx";
import { Dialog } from "./overlay.tsx";
import { clock, durationWords } from "./format.ts";

/**
 * The approval card (DESIGN-PLAN §4.3, research 03 §1.3). One shape everywhere: the bench tray, the agent view
 * (above the composer) and the phone.
 *
 *   <ApprovalCard approval={req} agentName="Atlas" pubkey={agent.agentPubkey} onAnswer={(ok) => send({ t: "approval", id: req.id, ok })} />
 *
 * Anatomy: plate + "{Agent} wants to" · risk in words (never colour alone) · verb-first title · the payload, selectable ·
 * screenshot at the moment it asked (click to enlarge) · "Came from: …" · a visible expiry countdown · Allow / Don't.
 * Allow is inert for 600 ms after the card appears and never takes focus; high risk is hold-to-allow.
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
  onAnswer: (ok: boolean) => void;
  /** Narrower card for trays and the phone: payload clamped to 3 lines, smaller thumbnail. */
  compact?: boolean;
  /** Decision echo; replaces the buttons. `by` as the protocol says it ("you on Telegram", "timeout"). */
  resolved?: { ok: boolean; by: string; at: number };
  /** Shown as a third button when the agent's screen is right there. */
  onTakeOver?: () => void;
  className?: string;
};

/** Older agents send tool-style titles ("open_url https://…"); make them read as a sentence. */
export function approvalTitle(title: string) {
  const m = title.match(/^(open_url|click|dblclick|type|key|scroll)\b\s*(.*)$/);
  let t = title;
  if (m) {
    const [, k, rest] = m;
    const host = rest.match(/https?:\/\/([^/\s]+)/)?.[1];
    t = k === "open_url" ? `Open ${host ?? rest}` : k === "click" ? "Click on the screen" : k === "dblclick" ? "Double-click on the screen"
      : k === "type" ? `Type ${rest.match(/"(.*)"/)?.[0] ?? "text"}` : k === "key" ? `Press ${rest}` : "Scroll";
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Risk for a card: the backend's when given, otherwise the same classifier it uses. */
export function approvalRisk(a: Pick<ApprovalCardData, "title" | "detail" | "kind" | "risk">): Risk {
  return a.risk ?? assessApproval(a.title, a.detail, a.kind).risk;
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

export function RiskBadge({ risk, id }: { risk: Risk; id?: string }) {
  return (
    <span id={id} className={cx("inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-small font-medium", risk === "high" ? "text-signal-ink" : risk === "medium" ? "text-ink" : "text-ink-2")}>
      {risk === "high" ? <Lamp status="needs" size={9} /> : risk === "medium" ? <EyeIcon size={13} weight="bold" aria-hidden /> : <CheckIcon size={12} weight="bold" aria-hidden />}
      {RISK_WORD[risk]}
    </span>
  );
}

export function ApprovalCard({ approval: a, agentName, pubkey, onAnswer, compact, resolved, onTakeOver, className }: ApprovalCardProps) {
  const id = useId();
  const risk = approvalRisk(a);
  const [armed, setArmed] = useState(false);
  const [answered, setAnswered] = useState<boolean>();
  const [zoom, setZoom] = useState(false);
  const [more, setMore] = useState(false);
  useEffect(() => { const t = setTimeout(() => setArmed(true), 600); return () => clearTimeout(t); }, []);
  const left = a.expiresAt ? a.expiresAt - Date.now() : undefined;
  // Tick every second in the last two minutes, otherwise every 15 s.
  const now = useNow(left !== undefined && left < 120_000 ? 1000 : 15_000, !!a.expiresAt && !resolved);
  const remaining = a.expiresAt ? a.expiresAt - now : undefined;
  const urgent = remaining !== undefined && remaining < 120_000;
  const title = approvalTitle(a.title);
  const answer = (ok: boolean) => { if (answered !== undefined || resolved) return; setAnswered(ok); onAnswer(ok); };
  const longDetail = !!a.detail && (a.detail.length > (compact ? 140 : 280) || a.detail.split("\n").length > (compact ? 3 : 6));

  return (
    <article
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-r`}
      tabIndex={-1}
      data-approval={a.id}
      className={cx(
        "flex min-w-0 flex-col rounded-unit border bg-surface text-left outline-offset-2",
        resolved ? "border-line" : "border-line-strong",
        compact ? "w-[min(340px,calc(100vw-40px))] p-3.5" : "w-full p-4",
        className,
      )}
    >
      <header className="flex items-center gap-2">
        <Plate pubkey={pubkey} name={agentName} size="sm" />
        <span className="min-w-0 truncate text-small text-ink-2">{agentName} wants to</span>
        <span className="ml-auto"><RiskBadge risk={risk} id={`${id}-r`} /></span>
      </header>
      <h3 id={`${id}-t`} className={cx("mt-1.5 text-ink [overflow-wrap:anywhere]", compact ? "text-ui-lg" : "text-h3")}>
        <span className="sr-only">{agentName} wants to: </span>{title}
      </h3>

      <div className="mt-2 flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          {a.detail && (
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
        {a.shot && (
          <button type="button" onClick={() => setZoom(true)} aria-label="Enlarge the screenshot from when it asked"
            className={cx("group relative shrink-0 overflow-hidden rounded-control border border-line bg-screen", compact ? "w-24" : "w-44")}>
            <img src={a.shot} alt="" className="aspect-[16/10] w-full object-cover" />
            <span aria-hidden className="absolute bottom-1 right-1 grid size-5 place-items-center rounded-[4px] bg-surface/90 text-ink opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <MagnifyingGlassPlusIcon size={12} weight="bold" />
            </span>
          </button>
        )}
      </div>

      <div className="mt-3 flex min-h-7 flex-wrap items-center gap-2">
        {resolved ? (
          <p role="status" className="flex items-center gap-1.5 text-small text-ink-2">
            {resolved.ok ? <CheckIcon size={13} weight="bold" aria-hidden className="text-ink" /> : <XIcon size={13} weight="bold" aria-hidden />}
            {resolutionText(resolved, agentName)}
          </p>
        ) : answered !== undefined ? (
          <p className="text-small text-ink-2">{answered ? "Allowing…" : "Telling " + agentName + " no…"}</p>
        ) : (
          <>
            {risk === "high"
              ? <HoldButton size="sm" onConfirm={() => answer(true)} aria-describedby={`${id}-r`}>Hold to allow</HoldButton>
              : <Button size="sm" variant="signal" aria-disabled={!armed || undefined} className={cx(!armed && "cursor-not-allowed opacity-50")} onClick={() => armed && answer(true)}>Allow</Button>}
            <Button size="sm" onClick={() => answer(false)}>Don't</Button>
            {onTakeOver && <Button size="sm" variant="quiet" icon={HandGrabbingIcon} onClick={onTakeOver}>Take over</Button>}
          </>
        )}
      </div>

      {a.shot && (
        <Dialog open={zoom} onClose={() => setZoom(false)} size="lg" title={`${agentName}'s screen when it asked`} description={title}>
          <img src={a.shot} alt={`${agentName}'s screen when it asked to ${title.charAt(0).toLowerCase() + title.slice(1)}`} className="w-full rounded-control border border-line" />
        </Dialog>
      )}
    </article>
  );
}
