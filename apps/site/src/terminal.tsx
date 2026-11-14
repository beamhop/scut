import { useEffect, useState } from "react";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import { Bezel, IconButton, Lamp, type Status } from "../../../packages/ui/src/ui/index.ts";
import { reduced, sleep, useVisible } from "./shared.tsx";

type Line = { cmd?: string; out?: string; status?: Status; dim?: boolean };

const SESSION: Line[] = [
  { cmd: "scut create atlas --harness pi" },
  { out: "pulling ghcr.io/beamhop/scut-agent:latest", status: "moving", dim: true },
  { out: "atlas is up · smolvm · this laptop · desktop + chromium", status: "working" },
  { cmd: "scut beam atlas --to fly" },
  { out: "pack → encrypt → send → seal keys → sign lease → boot", status: "moving", dim: true },
  { out: "atlas is up · fly.io · ams · laptop copy retired", status: "working" },
  { out: "came along: workspace, browser profile, chats, memory, 6 skills, 3 routines", dim: true },
  { cmd: "scut export atlas --out atlas.beamhop" },
  { out: "atlas.beamhop · 418 MB · passphrase-locked · open it anywhere", status: "free" },
];

/** A shell session that types itself once it scrolls into view. Reduced motion: shown complete. */
export function Terminal() {
  const [shown, setShown] = useState<{ n: number; chars: number }>(() => (reduced() ? { n: SESSION.length, chars: 0 } : { n: 0, chars: 0 }));
  const [run, setRun] = useState(0);
  const { ref, visible } = useVisible();
  const done = shown.n >= SESSION.length;

  useEffect(() => {
    if (!visible || reduced()) return;
    let stop = false;
    (async () => {
      setShown({ n: 0, chars: 0 });
      await sleep(400);
      for (let i = 0; i < SESSION.length && !stop; i++) {
        const l = SESSION[i];
        if (l.cmd) {
          for (let c = 1; c <= l.cmd.length && !stop; c++) { setShown({ n: i, chars: c }); await sleep(28 + Math.random() * 40); }
          await sleep(350);
        } else await sleep(l.status === "moving" ? 700 : 260);
        if (!stop) setShown({ n: i + 1, chars: 0 });
      }
    })();
    return () => { stop = true; };
  }, [visible, run]);

  const lines = SESSION.slice(0, shown.n + (done ? 0 : 1));
  return (
    <div ref={ref} className="min-w-0">
      <Bezel
        label="Terminal: a Beamhop session"
        aspect="auto"
        bar={<>
          <span className="font-mono text-small text-screen-ink-2">~/agents — scut</span>
          <span className="flex-1" />
          <IconButton size="sm" label="Replay" icon={ArrowCounterClockwiseIcon} className="text-screen-ink-2 hover:bg-screen-line" onClick={() => setRun((r) => r + 1)} />
        </>}
      >
        <pre className="min-h-[300px] overflow-x-auto p-4 font-mono text-[12.5px] leading-[22px] sm:p-5 sm:text-[13.5px]" aria-label="scut create, beam and export commands with their output">
          {lines.map((l, i) => {
            const typing = i === shown.n && !done;
            if (l.cmd) return (
              <div key={i}><span className="text-screen-ink-2">$ </span><span className="text-screen-ink">{typing ? l.cmd.slice(0, shown.chars) : l.cmd}</span>{typing && <span className="caret ml-px text-screen-ink" />}</div>
            );
            if (typing) return null;
            return (
              <div key={i} className={l.dim ? "text-screen-ink-2" : "text-screen-ink"}>
                <span className="inline-flex w-5 justify-start">{l.status && <Lamp status={l.status} size={10} onScreen />}</span>{l.out}
              </div>
            );
          })}
          {done && <div><span className="text-screen-ink-2">$ </span><span className="caret text-screen-ink" /></div>}
        </pre>
      </Bezel>
    </div>
  );
}
