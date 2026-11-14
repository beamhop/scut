import { useEffect, useState } from "react";

/**
 * Screen-reader announcements. Mount <Announcer/> once (main.tsx does); both live regions exist from page load, which
 * is what makes them reliable. Call announce() from anywhere:
 *   announce("Atlas arrived on Fly.io")
 *   announce("Beam failed: Atlas stayed on This computer", { assertive: true })
 *   announce(step, { key: "activity:atlas", throttleMs: 8000 })   // at most one per 8 s, newest wins
 */

type Opts = { assertive?: boolean; key?: string; throttleMs?: number };
type Region = "polite" | "assertive";

const GAP_MS = 500; // min time between two messages in the same region; text is cleared after this too
let setters: Partial<Record<Region, (s: string) => void>> = {};
const queue: Record<Region, string[]> = { polite: [], assertive: [] };
const busy: Record<Region, boolean> = { polite: false, assertive: false };
const lastByKey = new Map<string, number>();
const pendingByKey = new Map<string, { msg: string; o: Opts; timer: ReturnType<typeof setTimeout> }>();

function pump(r: Region) {
  if (busy[r] || !setters[r]) return;
  const msg = queue[r].shift();
  if (msg === undefined) return;
  busy[r] = true;
  setters[r]!(msg);
  setTimeout(() => {
    setters[r]?.("");
    busy[r] = false;
    // A tick between clear and the next message so identical text is announced again.
    setTimeout(() => pump(r), 50);
  }, GAP_MS);
}

function enqueue(msg: string, assertive?: boolean) {
  const r: Region = assertive ? "assertive" : "polite";
  if (queue[r].at(-1) === msg) return; // drop exact duplicates in a burst
  queue[r].push(msg);
  if (queue[r].length > 5) queue[r].splice(0, queue[r].length - 5);
  pump(r);
}

export function announce(msg: string, o: Opts = {}) {
  if (!msg) return;
  if (!o.key || !o.throttleMs) return enqueue(msg, o.assertive);
  const now = Date.now();
  const last = lastByKey.get(o.key) ?? 0;
  const wait = last + o.throttleMs - now;
  if (wait <= 0) {
    lastByKey.set(o.key, now);
    return enqueue(msg, o.assertive);
  }
  // Inside the window: keep only the newest message and say it when the window ends.
  const p = pendingByKey.get(o.key);
  if (p) clearTimeout(p.timer);
  pendingByKey.set(o.key, {
    msg, o,
    timer: setTimeout(() => {
      pendingByKey.delete(o.key!);
      lastByKey.set(o.key!, Date.now());
      enqueue(msg, o.assertive);
    }, wait),
  });
}

const SR_ONLY = "absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0 [clip:rect(0,0,0,0)]";

/** The two live regions. Mount exactly once, at the app root. */
export function Announcer() {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  useEffect(() => {
    setters = { polite: setPolite, assertive: setAssertive };
    pump("polite");
    pump("assertive");
    return () => { setters = {}; };
  }, []);
  return (
    <>
      <div className={SR_ONLY} aria-live="polite" aria-atomic="true" data-announcer="polite">{polite}</div>
      <div className={SR_ONLY} aria-live="assertive" aria-atomic="true" data-announcer="assertive">{assertive}</div>
    </>
  );
}
