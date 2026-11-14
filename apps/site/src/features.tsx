import { useState, type ReactNode } from "react";
import { ChatsCircleIcon, UsersThreeIcon, BrainIcon, ShieldCheckIcon, NotebookIcon, PlugsConnectedIcon, type Icon } from "@phosphor-icons/react";
import { Plate, Segmented, Readout, Kbd } from "../../../packages/ui/src/ui/index.ts";
import { ATLAS_KEY, NOVA_KEY } from "./shared.tsx";

function Card({ icon: I, title, children, demo }: { icon: Icon; title: string; children: ReactNode; demo?: ReactNode }) {
  return (
    <li className="flex flex-col rounded-unit border border-line bg-surface p-5">
      <I size={22} aria-hidden />
      <h3 className="mt-4 text-h3">{title}</h3>
      <p className="mt-2 text-body text-ink-2">{children}</p>
      {demo && <div className="mt-auto pt-5">{demo}</div>}
    </li>
  );
}

const AUTONOMY = [
  { value: "ask", label: "Ask", description: "Atlas asks before every step that changes something." },
  { value: "risky", label: "Risky only", description: "Atlas asks before payments, sending, deleting and logins." },
  { value: "auto", label: "Autonomous", description: "Atlas just does it, inside your daily spending cap." },
] as const;

export function Features() {
  const [mode, setMode] = useState<(typeof AUTONOMY)[number]["value"]>("risky");
  return (
    <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card icon={ChatsCircleIcon} title="Lives where you chat" demo={
        <div className="rounded-control border border-line bg-surface-2 p-3 font-mono text-small">
          <div className="text-ink-3">telegram · slack · discord · nostr</div>
          <div className="mt-1">you: <span className="text-ink">/pair 4F2K-9Q</span></div>
          <div className="text-ink-2">atlas: paired. only you can approve.</div>
        </div>}>
        Pair once. Anyone in the channel can chat; only you can approve risky actions. All outbound, no public URL.
      </Card>
      <Card icon={UsersThreeIcon} title="A crew, not a bot" demo={
        <div className="space-y-2 rounded-control border border-line bg-surface-2 p-3 text-small">
          <div className="flex items-center gap-2"><Plate pubkey={ATLAS_KEY} name="Atlas" size="sm" /><span className="text-ink-2">Nova, can you file the receipt?</span></div>
          <div className="flex items-center gap-2"><Plate pubkey={NOVA_KEY} name="Nova" size="sm" /><span className="text-ink-2">On it. Filed under travel.</span></div>
        </div>}>
        Your agents share a private crew room (Nostr NIP-17) and hand work to each other, with a loop guard so they never spin.
      </Card>
      <Card icon={ShieldCheckIcon} title="Safe by default" demo={
        <Segmented legend="Autonomy" size="sm" value={mode} onChange={setMode} options={AUTONOMY.map((a) => ({ ...a }))} />}>
        Approvals that wait for you (up to 25 min, then “no”), hold-to-allow for high risk, a daily cap, Stop, and Pause & let me drive.
      </Card>
      <Card icon={BrainIcon} title="Your models, your keys" demo={
        <div className="flex flex-wrap gap-1.5 font-mono text-small">
          {["pi", "codex", "copilot", "opencode", "openrouter", "openai", "anthropic", "ollama"].map((t) => (
            <span key={t} className="rounded-full border border-line px-2 py-0.5 text-ink-2">{t}</span>
          ))}
        </div>}>
        Any Anthropic- or OpenAI-compatible endpoint, checked before use and stored on your computer only. Four harnesses, or sign in with a ChatGPT/Copilot subscription.
      </Card>
      <Card icon={NotebookIcon} title="Learns and remembers" demo={
        <Readout items={[{ value: "Every day 08:00", status: "free" }, { value: "Next in 9h", srLabel: "next run" }, { value: "14", label: "runs" }]} />}>
        Editable memory, Agent Skills (<code className="font-mono text-small">SKILL.md</code>), and routines it schedules itself, with the screen at the end of every run.
      </Card>
      <Card icon={PlugsConnectedIcon} title="No middleman" demo={
        <p className="text-small text-ink-3">Open the command palette anywhere with <Kbd keys="mod+k" />.</p>}>
        Each agent is its own relay: one authenticated endpoint, owner-bound tokens, a local API that refuses other websites. No Beamhop servers in the path.
      </Card>
    </ul>
  );
}
