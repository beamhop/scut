import { useRef, useState, type DragEvent } from "react";
import { LaptopIcon, CloudIcon, FileLockIcon, CheckIcon, ArrowUUpLeftIcon, type Icon } from "@phosphor-icons/react";
import { Button, Plate, Progress, StatusBadge, cx, announce } from "../../../packages/ui/src/ui/index.ts";
import { ATLAS_KEY, reduced, sleep } from "./shared.tsx";

type Place = { id: string; name: string; where: string; icon: Icon; note: string };
const PLACES: Place[] = [
  { id: "laptop", name: "This laptop", where: "smolvm microVM", icon: LaptopIcon, note: "Free · runs while the lid is open" },
  { id: "fly", name: "Fly.io", where: "your account · ams", icon: CloudIcon, note: "≈ €4/month · always on" },
  { id: "render", name: "Render", where: "your account · frankfurt", icon: CloudIcon, note: "≈ €7/month · always on" },
  { id: "railway", name: "Railway", where: "your account · us-west", icon: CloudIcon, note: "≈ €5/month · always on" },
  { id: "file", name: "A file", where: "atlas.beamhop", icon: FileLockIcon, note: "Passphrase-locked · no network needed" },
];
const STAGES = ["Pause & pack", "Encrypt (AES-256-GCM)", "Send", "Seal keys to new host", "Sign lease", "Boot"];
const CAME = ["Workspace · 412 MB", "Browser profile & logins", "1,284 chat messages", "Memory", "6 skills", "3 routines"];

/** Drag (or press) the agent onto a place. Staged progress, then a receipt. All pretend; the stages are the real ones. */
export function Beam() {
  const [at, setAt] = useState("laptop");
  const [to, setTo] = useState<string | null>(null);
  const [stage, setStage] = useState(0);
  const [receipt, setReceipt] = useState<{ from: string; to: string; secs: number } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const busy = to !== null;
  const run = useRef(0);

  const beam = async (dest: string) => {
    if (busy || dest === at) return;
    const id = ++run.current;
    const from = at;
    setReceipt(null); setTo(dest); setStage(0);
    const name = PLACES.find((p) => p.id === dest)!.name;
    announce(`Beaming Atlas to ${name}`);
    const t0 = performance.now();
    for (let k = 0; k < STAGES.length; k++) {
      setStage(k);
      await sleep(reduced() ? 250 : 450 + Math.random() * 500);
      if (run.current !== id) return;
    }
    setAt(dest); setTo(null); setStage(STAGES.length);
    setReceipt({ from, to: dest, secs: Math.max(3, Math.round((performance.now() - t0) / 1000 * 2.2)) });
    announce(dest === "file" ? "Atlas is in atlas.beamhop" : `Atlas is on ${name}`);
  };

  const drop = (e: DragEvent, id: string) => { e.preventDefault(); setOver(null); void beam(id); };
  const place = (id: string) => PLACES.find((p) => p.id === id)!;

  return (
    <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_380px]">
      <ul className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Places Atlas can live">
        {PLACES.map((p) => {
          const here = at === p.id, going = to === p.id, leaving = busy && here;
          const I = p.icon;
          return (
            <li key={p.id}
              onDragOver={(e) => { if (!busy && !here) { e.preventDefault(); setOver(p.id); } }}
              onDragLeave={() => setOver((o) => (o === p.id ? null : o))}
              onDrop={(e) => drop(e, p.id)}
              className={cx("flex min-h-[168px] flex-col rounded-unit border bg-surface p-4 transition-colors duration-(--dur-pop)",
                over === p.id ? "border-ink border-dashed bg-surface-2" : here || going ? "border-line-strong" : "border-line")}>
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-control border border-line bg-surface-2"><I size={18} aria-hidden /></span>
                <div className="min-w-0">
                  <div className="font-semibold leading-5">{p.name}</div>
                  <div className="truncate font-mono text-small text-ink-3">{p.where}</div>
                </div>
              </div>
              <div className="mt-auto pt-4">
                {here || going ? (
                  <div draggable={here && !busy}
                    onDragStart={(e) => { e.dataTransfer.setData("text/plain", "atlas"); e.dataTransfer.effectAllowed = "move"; }}
                    className={cx("flex items-center justify-between gap-2 rounded-control border border-line bg-surface-2 px-2.5 py-2", here && !busy && "cursor-grab active:cursor-grabbing", (leaving || going) && "opacity-70")}>
                    <Plate pubkey={ATLAS_KEY} name="Atlas" size="sm" showName />
                    <StatusBadge size="sm" status={leaving || going ? "moving" : "working"} label={leaving ? "Leaving" : going ? "Arriving" : p.id === "file" ? "Sealed" : "Working"} />
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-small text-ink-3">{p.note}</span>
                    <Button size="sm" disabled={busy} onClick={() => beam(p.id)} aria-label={`Beam Atlas to ${p.name}`}>Beam here</Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="min-w-0 rounded-unit border border-line bg-surface p-5" aria-live="polite">
        {busy ? (
          <>
            <p className="kicker mb-3">beam in progress</p>
            <Progress label={`Beaming Atlas to ${place(to!).name}`} stages={STAGES} current={stage} />
            <p className="mt-4 text-small text-ink-2">Atlas shows in both places while it travels. If anything fails, it rolls back and keeps running where it was.</p>
          </>
        ) : receipt ? (
          <>
            <p className="kicker mb-3">receipt</p>
            <div className="flex items-center gap-2 text-ui-lg font-semibold"><CheckIcon size={18} weight="bold" aria-hidden />
              {receipt.to === "file" ? "Atlas is in atlas.beamhop" : `Atlas is on ${place(receipt.to).name}`}</div>
            <p className="mt-1 text-small text-ink-2 tabular-nums">{receipt.secs}s · from {place(receipt.from).name} · one active copy, lease signed</p>
            <ul className="mt-4 space-y-1.5 text-body">
              {CAME.map((c) => <li key={c} className="flex items-center gap-2"><CheckIcon size={14} weight="bold" className="text-ink-2" aria-hidden />{c}</li>)}
            </ul>
            {receipt.to === "file" && <p className="mt-3 text-small text-ink-2">Open it in Beamhop on any computer. Whoever opens it becomes its owner.</p>}
            <Button className="mt-5" icon={ArrowUUpLeftIcon} onClick={() => beam(receipt.from)}>Beam back</Button>
          </>
        ) : (
          <>
            <p className="kicker mb-3">try it</p>
            <p className="text-ui-lg font-semibold">Drag Atlas onto a place.</p>
            <p className="mt-2 text-body text-ink-2">Or press Beam here. Its workspace, browser profile, chats, memory, skills and schedules travel encrypted. The new host gets the keys sealed to it. A signed lease means there is only ever one Atlas.</p>
          </>
        )}
      </div>
    </div>
  );
}
