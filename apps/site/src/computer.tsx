import { useRef, useState, type PointerEvent } from "react";
import { HandIcon, LockSimpleIcon, ArrowLeftIcon, ArrowRightIcon, ArrowClockwiseIcon } from "@phosphor-icons/react";
import { Bezel, Button, Lamp, Readout, StatusBadge, cx, money, type Status } from "../../../packages/ui/src/ui/index.ts";
import { reduced, useInterval, useVisible } from "./shared.tsx";

const FLIGHTS = [
  { t: "07:15 → 09:20", a: "Skyline Air", p: 112 },
  { t: "09:40 → 11:45", a: "Atlantic Hop", p: 89 },
  { t: "13:05 → 15:15", a: "Skyline Air", p: 134 },
  { t: "18:30 → 20:35", a: "Coastal", p: 97 },
];

type Step = { head: string; x: number; y: number; status: Status; pick?: number; url: string; click?: boolean; wait?: boolean };
// x/y are % of the screen. One loop of a simple task; the last step waits for the visitor.
const STEPS: Step[] = [
  { head: "Opening a flight search", x: 40, y: 13, status: "working", url: "flights.example", click: true },
  { head: "Searching AMS → LIS, Friday", x: 72, y: 28, status: "working", url: "flights.example/search?from=AMS&to=LIS", click: true },
  { head: "Comparing 4 results", x: 55, y: 58, status: "working", url: "flights.example/search?from=AMS&to=LIS" },
  { head: "Picking the 09:40, cheapest direct", x: 80, y: 51, status: "working", pick: 1, url: "flights.example/search?from=AMS&to=LIS", click: true },
  { head: "Wants to pay €89 on flights.example", x: 80, y: 51, status: "needs", pick: 1, url: "flights.example/checkout", wait: true },
];

/** The agent's own computer: a Bezel around a pretend Chromium, driven by a pretend agent, that you can take over. */
export function Computer() {
  const [i, setI] = useState(0);
  const [driving, setDriving] = useState(false);
  const [secs, setSecs] = useState(102);
  const [steps, setSteps] = useState(12);
  const [clicks, setClicks] = useState<{ id: number; x: number; y: number }[]>([]);
  const [me, setMe] = useState<{ x: number; y: number } | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const screen = useRef<HTMLDivElement>(null);
  const s = STEPS[i];
  const waiting = !!s.wait && !driving;

  const ring = (x: number, y: number) => {
    const id = Math.random();
    setClicks((c) => [...c, { id, x, y }]);
    setTimeout(() => setClicks((c) => c.filter((k) => k.id !== id)), 500);
  };

  const { ref, visible } = useVisible();
  useInterval(1000, () => { if (!driving) setSecs((t) => t + 1); }, visible);
  useInterval(1900, () => {
    if (driving || s.wait) return;
    const next = (i + 1) % STEPS.length;
    setI(next);
    setSteps((n) => n + 1);
    setOutcome(null);
    if (STEPS[next].click && !reduced()) setTimeout(() => ring(STEPS[next].x, STEPS[next].y), 650);
  }, visible);

  const decide = (ok: boolean) => {
    setOutcome(ok ? "Booked. Confirmation sent to your Telegram." : "Skipped (you said no). Atlas will ask before trying again.");
    setTimeout(() => { setI(0); setOutcome(null); }, 2600);
  };

  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!driving || !screen.current) return;
    const r = screen.current.getBoundingClientRect();
    setMe({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
  };

  const cursor = driving ? me : { x: s.x, y: s.y };
  const status: Status = driving ? "working" : outcome ? "free" : s.status;

  return (
    <div ref={ref} className="min-w-0">
      <Bezel
        label="Atlas's screen (demo)"
        state={driving ? "driving" : "watching"}
        bar={driving ? <>
          <HandIcon size={16} weight="bold" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium">You're driving · Atlas is paused</span>
          <Button size="sm" variant="on-signal" onClick={() => { setDriving(false); setMe(null); }}>Give back</Button>
        </> : <>
          <StatusBadge status={status} label={outcome ?? s.head} size="sm" onScreen className="min-w-0 flex-1 [&>span:last-child]:truncate" />
          {waiting && !outcome ? <>
            <Button size="sm" variant="quiet" className="text-screen-ink hover:bg-screen-line" onClick={() => decide(false)}>Don't</Button>
            <Button size="sm" variant="signal" onClick={() => decide(true)}>Allow</Button>
          </> : <Button size="sm" variant="signal" icon={HandIcon} onClick={() => setDriving(true)}>Take over</Button>}
        </>}
      >
        <div ref={screen} onPointerMove={move} onPointerDown={(e) => { if (driving && me) ring(me.x, me.y); e.preventDefault(); }}
          className={cx("absolute inset-0 select-none", driving && "cursor-none")}>
          {/* Chromium, full screen, light page inside the dark frame */}
          <div data-theme="light" className="absolute inset-0 flex flex-col bg-surface text-ink">
            <div className="flex h-[9%] min-h-6 items-center gap-2 border-b border-line bg-surface-2 px-2 text-[11px] text-ink-2">
              <ArrowLeftIcon size={12} aria-hidden /><ArrowRightIcon size={12} aria-hidden className="opacity-50" /><ArrowClockwiseIcon size={12} aria-hidden />
              <div className="flex h-[70%] min-w-0 flex-1 items-center gap-1.5 rounded-full border border-line bg-surface px-2">
                <LockSimpleIcon size={10} aria-hidden /><span className="truncate font-mono">{s.url}</span>
              </div>
            </div>
            <div className="flex-1 overflow-hidden p-[4%]">
              <div className="mb-[3%] flex items-baseline justify-between gap-2">
                <div className="text-[clamp(11px,2vw,18px)] font-semibold">Amsterdam → Lisbon</div>
                <div className="text-[clamp(9px,1.3vw,12px)] text-ink-2">Fri · 1 adult</div>
              </div>
              <ul className="space-y-[2%]">
                {FLIGHTS.map((f, k) => (
                  <li key={k} className={cx("flex items-center justify-between rounded-control border px-[3%] py-[1.6%] text-[clamp(9px,1.4vw,13px)] transition-colors duration-(--dur-tray)",
                    s.pick === k ? "border-ink bg-surface-2" : "border-line")}>
                    <span className="tabular-nums">{f.t}</span>
                    <span className="hidden text-ink-2 sm:inline">{f.a}</span>
                    <span className="font-semibold tabular-nums">€{f.p}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {cursor && (
            <svg aria-hidden viewBox="0 0 16 16" width="18" height="18"
              className={cx("absolute z-10 drop-shadow-[0_1px_1px_rgb(0_0_0/0.4)]", !driving && "transition-[left,top] duration-[900ms] ease-(--ease-inout)")}
              style={{ left: `${cursor.x}%`, top: `${cursor.y}%` }}>
              <path d="M1 1 L1 13 L4.5 9.8 L7 15 L9 14 L6.6 9 L11.5 9 Z" fill="black" stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
          )}
          {clicks.map((c) => <span key={c.id} className="click-ring" style={{ left: `${c.x}%`, top: `${c.y}%`, borderColor: "currentColor" }} />)}
          {waiting && !outcome && (
            <div className="absolute inset-x-[6%] bottom-[6%] animate-pop rounded-unit border border-line bg-surface p-3 text-small text-ink shadow-float" data-theme="light">
              <div className="flex items-center gap-2 font-semibold"><Lamp status="needs" /> Atlas is asking before it pays</div>
              <p className="mt-1 text-ink-2">€89.00 on flights.example · High risk: payment page · from your Telegram chat</p>
            </div>
          )}
        </div>
      </Bezel>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Readout label="Atlas right now" items={[
          { value: driving ? "Paused" : waiting ? "Needs you" : "Working", status: driving ? "free" : waiting ? "needs" : "working" },
          { value: `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`, srLabel: "elapsed" },
          { value: money(0.03 + steps * 0.002), label: "today" },
          { value: steps, label: "steps" },
        ]} />
        <span className="text-small text-ink-3">Demo. Try Take over, or wait for the payment.</span>
      </div>
    </div>
  );
}
