import { createRoot } from "react-dom/client";
import { useState } from "react";
import { GithubLogoIcon, DownloadSimpleIcon, CopyIcon, CheckIcon, ArrowRightIcon, DesktopIcon, MonitorPlayIcon, KeyboardIcon, CursorClickIcon } from "@phosphor-icons/react";
import { Announcer, Button, Readout, ThemeToggle, applyTheme } from "../../../packages/ui/src/ui/index.ts";
import { Terminal } from "./terminal.tsx";
import { Computer } from "./computer.tsx";
import { Beam } from "./beam.tsx";
import { Features } from "./features.tsx";
import { DOWNLOAD, REPO, Section, VERSION } from "./shared.tsx";

applyTheme();

const go = (href: string) => () => { location.href = href; };

function Logo() {
  return (
    <svg viewBox="0 0 64 64" width="22" height="22" aria-hidden>
      <rect width="64" height="64" rx="14" className="fill-ink" />
      <g className="fill-bg">{[[16, 16], [48, 16], [32, 24], [16, 32], [48, 32], [24, 48], [40, 48]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="5" />)}</g>
    </svg>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
      <nav aria-label="Main" className="mx-auto flex h-14 max-w-[1200px] items-center gap-6 px-4 sm:px-8">
        <a href="#top" className="flex items-center gap-2 no-underline"><Logo /><span className="wordmark text-[17px]">Beamhop</span><span className="font-mono text-small text-ink-3">scut</span></a>
        <div className="hidden items-center gap-5 text-body md:flex">
          {[["#computer", "Computer"], ["#beam", "Beam"], ["#features", "Features"], ["#cli", "CLI"], ["#status", "Status"]].map(([h, l]) => (
            <a key={h} href={h} className="text-ink-2 no-underline hover:text-ink">{l}</a>
          ))}
        </div>
        <span className="flex-1" />
        <ThemeToggle />
        <Button size="sm" icon={GithubLogoIcon} onClick={go(REPO)}>GitHub</Button>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <div id="top" className="chassis border-b border-line">
      <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 pb-20 pt-16 sm:px-8 sm:pt-24 lg:grid-cols-[1.1fr_1fr]">
        <div className="min-w-0">
          <a href="#status" className="no-underline"><Readout label="Release" items={[{ value: `v${VERSION}`, status: "moving" }, { value: "early & in the open" }]} /></a>
          <h1 className="hero mt-6">beam<br />your agent.</h1>
          <p className="mt-6 max-w-[46ch] text-[18px] leading-[28px] text-ink-2 text-pretty">
            AI agents that each get <span className="text-ink">their own Linux computer</span>, live in your chat apps, and hop from your laptop to <span className="text-ink">your own cloud</span> in seconds. Everything comes along.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button variant="primary" icon={DownloadSimpleIcon} className="h-11 px-5 text-ui-lg" onClick={go(DOWNLOAD)}>Download</Button>
            <Button icon={GithubLogoIcon} className="h-11 px-5 text-ui-lg" onClick={go(REPO)}>Star on GitHub</Button>
          </div>
          <p className="mt-4 font-mono text-small text-ink-3">macOS · Linux · Windows · one file, no account</p>
        </div>
        <Terminal />
      </div>
    </div>
  );
}

function Copy({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-control border border-line-strong bg-surface px-3 py-2 font-mono text-body">
      <span className="text-ink-3">$</span><code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">{text}</code>
      <Button size="sm" variant="quiet" icon={ok ? CheckIcon : CopyIcon} aria-label={ok ? "Copied" : `Copy ${text}`}
        onClick={() => { navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }, () => {}); }}>{ok ? "Copied" : "Copy"}</Button>
    </div>
  );
}

const CLI: [string, string][] = [
  ["scut create <name> [--harness pi|codex|copilot|opencode] [--to <dest>]", "new agent, here or straight onto a cloud"],
  ["scut ls", "every agent, where it lives, what it's doing"],
  ["scut beam <agent> --to <dest>", "move it. one active copy, rollback on failure"],
  ["scut export <agent> [--out FILE]", "into a passphrase-locked .beamhop file"],
  ["scut import FILE [--to <dest>]", "open it on any computer"],
  ["scut rm <agent>", "gone"],
];

const PIECES: [string, string][] = [
  ["packages/agentd", "PID 1 in the agent image: desktop, harness, channels, beam protocol, approvals, schedules"],
  ["packages/agent", "harness adapters + the computer-use MCP server they share"],
  ["packages/channels", "Telegram, Slack, Discord, Nostr, all outbound"],
  ["packages/beam", "bundle pack, AES-256-GCM, restore"],
  ["packages/protocol", "beam ticket, signed lease, owner auth, NIP-44 sealing"],
  ["packages/drivers", "smolvm, Docker, Fly.io, Render, Railway"],
  ["packages/ui", "the app you're looking at bits of right now"],
];

const UNTESTED = ["smolvm on a real Mac (CI Macs can't nest VMs)", "Real Fly.io, Render and Railway accounts", "Real Slack and Discord apps", "Codex, Copilot and opencode logins"];
const TESTED = ["Whole agents on smolvm (Linux/KVM), WSL2 (Windows), gVisor and Docker, in CI", "No-sandbox agents under systemd, LaunchAgents and Windows logon tasks", "No sandbox: real Pi, beams to a sandbox and back", "Live Telegram + OpenRouter test", "Zero axe violations on every screen, light, dark and phone", "Typecheck enforced in CI"];

function App() {
  return (
    <>
      <a href="#main" className="sr-only-focusable fixed left-2 top-2 z-30 rounded-control bg-ink px-3 py-2 text-surface">Skip to content</a>
      <Nav />
      <main id="main">
        <Hero />

        <Section id="computer" kicker="// 01 · its own computer" title="A real desktop. Watch it. Grab it."
          lede="Every agent runs in its own sandbox: a Linux desktop, Chromium, and the harness, all inside. Watch it work live, or take the keyboard and mouse for a login or a CAPTCHA, then hand it back.">
          <div className="mt-12 grid items-start gap-10 lg:grid-cols-[1fr_1.5fr]">
            <ul className="order-2 space-y-6 lg:order-1">
              {[
                [MonitorPlayIcon, "Live screen", "Every agent's computer in the same frame. The readout under it ticks: status, time, money, steps."],
                [CursorClickIcon, "Take over", "The bar turns orange while you drive. Press Esc twice and it's the agent's turn again."],
                [KeyboardIcon, "Asks at the screen", "Payments, sending, deleting: the approval rises over the screen and in your chat app."],
                [DesktopIcon, "Nothing to install", "A microVM where the hardware allows, else WSL2 on Windows or gVisor on Linux. Docker only if you already have it. Same image in your cloud."],
              ].map(([I, t, d]) => {
                const Icon = I as typeof DesktopIcon;
                return (
                  <li key={t as string} className="flex gap-4">
                    <Icon size={20} className="mt-0.5 shrink-0" aria-hidden />
                    <div><h3 className="font-semibold">{t as string}</h3><p className="mt-1 text-body text-ink-2">{d as string}</p></div>
                  </li>
                );
              })}
            </ul>
            <div className="order-1 lg:order-2"><Computer /></div>
          </div>
        </Section>

        <div className="border-y border-line bg-surface-2/60">
          <Section id="beam" kicker="// 02 · beam it" title="Drag it onto your cloud. It brings everything."
            lede="Laptop to Fly.io, Render or Railway on your own account, and back. Or into a file you carry to another computer with no network between them. Interrupted beams are rolled back or finished on the next start.">
            <Beam />
          </Section>
        </div>

        <Section id="features" kicker="// 03 · and" title="Everything else an agent needs.">
          <Features />
        </Section>

        <div className="border-y border-line bg-surface-2/60">
          <Section id="cli" kicker="// 04 · for the terminal people" title="Six commands. That's the API.">
            <div className="mt-12 grid gap-10 lg:grid-cols-2">
              <div className="min-w-0">
                <dl className="divide-y divide-line rounded-unit border border-line bg-surface">
                  {CLI.map(([c, d]) => (
                    <div key={c} className="px-4 py-3">
                      <dt className="overflow-x-auto whitespace-nowrap font-mono text-body">{c}</dt>
                      <dd className="mt-0.5 text-small text-ink-2">{d}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-6 space-y-2">
                  <p className="text-small font-medium">Build from source</p>
                  <Copy text={`git clone ${REPO} && cd scut && bun install && ./scripts/build-app.sh`} />
                </div>
              </div>
              <div className="min-w-0">
                <h3 className="text-h3">How it fits together</h3>
                <p className="mt-2 text-body text-ink-2">The app only manages sandboxes. The agent lives inside one: <code className="font-mono text-small">agentd</code> is PID 1 and the agent is its own relay.</p>
                <dl className="mt-5 space-y-3">
                  {PIECES.map(([p, d]) => (
                    <div key={p} className="grid gap-x-4 sm:grid-cols-[170px_1fr]">
                      <dt className="font-mono text-small text-ink">{p}</dt>
                      <dd className="text-small text-ink-2">{d}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </Section>
        </div>

        <Section id="status" kicker="// 05 · status" title="Early, and honest about it."
          lede={<>Beamhop is v{VERSION} and built in the open. Here's what's proven and what isn't yet. Every release is in the <a href={`${REPO}/blob/main/CHANGELOG.md`}>changelog</a>.</>}>
          <div className="mt-12 grid gap-4 md:grid-cols-2">
            {[["Tested", TESTED, "working"], ["Not yet tested against real services", UNTESTED, "needs"]].map(([h, items, st]) => (
              <div key={h as string} className="rounded-unit border border-line bg-surface p-5">
                <h3 className="text-h3">{h as string}</h3>
                <ul className="mt-4 space-y-2 text-body">
                  {(items as string[]).map((t) => <li key={t} className="flex gap-2.5"><span className="mt-[3px] font-mono text-ink-3">{st === "working" ? "✓" : "?"}</span>{t}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        <div className="chassis border-t border-line">
          <div className="mx-auto max-w-[1200px] px-4 py-24 text-center sm:px-8">
            <h2 className="hero mx-auto max-w-[12ch] !text-[clamp(40px,7vw,88px)]">give it a computer.</h2>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button variant="primary" icon={DownloadSimpleIcon} className="h-11 px-5 text-ui-lg" onClick={go(DOWNLOAD)}>Download</Button>
              <Button icon={GithubLogoIcon} iconEnd={ArrowRightIcon} className="h-11 px-5 text-ui-lg" onClick={go(REPO)}>Read the source</Button>
            </div>
            <p className="mx-auto mt-4 max-w-[52ch] text-small text-ink-3">Downloads come from the latest CI run (Actions → build → scut-apps) until there's a tagged release.</p>
          </div>
        </div>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-4 px-4 py-8 text-small text-ink-3 sm:px-8">
          <span className="flex items-center gap-2"><Logo /><span className="wordmark text-body text-ink">Beamhop</span></span>
          <span>Agents with their own computer.</span>
          <span className="flex-1" />
          <a href={REPO} className="text-ink-2">GitHub</a>
          <a href={`${REPO}/blob/main/CHANGELOG.md`} className="text-ink-2">Changelog</a>
          <a href={`${REPO}/blob/main/DESIGN.md`} className="text-ink-2">Design system</a>
        </div>
      </footer>
      <Announcer />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
