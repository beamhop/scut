# Beamhop — beam your agent

AI agents that each have their own computer, live in your chat apps, and move between your laptop and your own cloud in seconds.

- **Their own computer.** Every agent runs in a sandbox with a Linux desktop and Chromium. Watch it live, click and type alongside it, or take control for logins and CAPTCHAs.
- **Lives where you chat.** Telegram, Slack, Discord and Nostr. Pair once with `/pair <code>`; only you can approve risky actions, anyone in a channel can chat.
- **A crew, not a bot.** All your agents share a private crew room (Nostr NIP-17) and can hand work to each other, with a loop guard so they never spin.
- **Beam it.** Drag an agent onto a destination: its workspace, browser profile, chat history, memory, skills and schedules travel encrypted; the new host gets the keys sealed to it; a signed lease guarantees one active copy. Failed beams roll back, and a beam interrupted by the app closing is rolled back or completed on the next start. A receipt on the tile says what came along.
- **Beam by file.** Move an agent into a passphrase-locked `.beamhop` file and open it in Beamhop on any other computer — with no network path between the two. Whoever opens it becomes its owner.
- **Your models, your clouds.** Any Anthropic- or OpenAI-compatible endpoint (OpenRouter, OpenAI, Anthropic, Ollama), checked before use and remembered on your computer only. Four harnesses — Pi (default), Codex, Copilot CLI, opencode — all run on that key, or on a ChatGPT/Copilot subscription you sign in to on the agent's screen. Change an agent's model or key any time in Settings. Bring your own Fly.io, Render or Railway account, and start agents there directly.
- **Learns and remembers.** Per-agent memory you can edit, Agent Skills (`SKILL.md`, paste or link), and routines: agents schedule their own tasks ("every morning at 8 …") in your local time, with a run history, the screen at the end of each run, and a notification when one finishes.
- **Safe defaults.** Autonomy ladder (ask / risky only / autonomous) with approvals that wait for you (up to 25 minutes, then "no"), daily token cap, Stop, Pause & let me drive, a plain-language safety check per agent, owner-bound sign-in tokens, a local API that refuses other websites, no Beamhop servers in the path.

## Quick start

1. Download `scut` for your OS from the latest CI run (Actions → build → `scut-apps`), or build it: `./scripts/build-app.sh`.
2. Run it. The app opens in its own window.
3. Pick a brain (paste an OpenRouter key, or choose a local Ollama model — it's checked before you continue), describe your agent, press **Create agent**.
4. Optional: **+ Add a cloud** to connect Fly.io, Render or Railway, then drag your agent onto it.
5. Moving to a new computer? **Beam to… → A file**, then **Open an agent file** on the other side.
6. Tick **Open Beamhop when I log in** (in the dock) so agents on this computer come back by themselves after a restart.

Agents use the public image `ghcr.io/beamhop/scut-agent:latest`. Nothing to install: Beamhop picks the best way to run agents on your computer, checks it works, and remembers it.

| Rung | Where | What it is |
|---|---|---|
| 1. smolvm microVM | Apple Silicon Macs, Linux with KVM | a lightweight VM per agent |
| 2. Built-in sandbox | Windows: WSL2 · Linux without KVM: gVisor | WSL2 is built into Windows (if it's off, Beamhop turns it on: one admin prompt and a restart); gVisor is downloaded once and runs rootless. The image is pulled without Docker |
| 3. Docker or Podman | only if already installed | a container per agent |
| 4. No sandbox | only if you choose it | the agent runs as a normal program, with a headless browser of its own (never your screen or mouse). Same tools, approvals, Take over and beams; it asks before touching anything outside its folder, and says "No sandbox" everywhere |

If none of 1–3 works, creating an agent offers: run it in your cloud, or run it here without a sandbox. Intel Macs aren't supported. `SCUT_LOCAL_DRIVER=smolvm|wsl|gvisor|docker|podman|host` forces one (`none` pretends there is none, for testing).

## How it works

| Piece | What it does |
|---|---|
| `packages/agentd` | PID 1 in the agent image: the screen (in a sandbox a whole Linux desktop: Xvfb, Openbox, Chromium; without one a headless Chromium over DevTools), harness, channels, one authenticated WebSocket endpoint (the agent is its own relay), beam protocol, approvals, schedules. The app runs the same code itself for agents without a sandbox (`scut agentd`) |
| `packages/agent` | Harness adapters (Pi default, Codex CLI, Copilot CLI, opencode) + the computer-use MCP server they all share (`screenshot`, `click`, `type_text`, `key`, `scroll`, `open_url`, `request_approval`, `crew_post`, `crew_list`) |
| `packages/channels` | Telegram (long polling), Slack (Socket Mode), Discord (Gateway), Nostr (NIP-17 DMs + crew room) — all outbound, no public URL |
| `packages/beam` | Bundle pack, AES-256-GCM encryption, restore |
| `packages/protocol` | Types, beam ticket, signed lease, owner auth (NIP-98 style, host-bound), NIP-44 sealing |
| `packages/drivers` | the local ladder (`local.ts`): smolvm (SDK), WSL2, gVisor, Docker/Podman, no sandbox (`host.ts`); an OCI puller (`oci.ts`) so WSL2 and gVisor need no Docker; Fly.io, Render, Railway |
| `packages/ui` | React + Tailwind app: crew grid, agent view, create flow, add-a-cloud, crew room, phone view |
| `apps/app` | `scut` app server + CLI, compiled to one file per OS |
| `image/` | The agent image |

## Develop

```bash
bun install
./scripts/build-image.sh                       # UI + agent image (ghcr.io/beamhop/scut-agent:dev)
SCUT_IMAGE=ghcr.io/beamhop/scut-agent:dev SCUT_SIM_CLOUD=1 bun apps/app/src/main.ts
bun test tests/e2e.test.ts tests/ui.test.ts --timeout 600000
# Engines and no sandbox. One file per run: each sets its own SCUT_HOME before loading the app.
# gVisor and WSL2 (a stand-in wsl.exe; needs root) pull from a registry, so push the dev image to a local one first.
docker run -d -p 127.0.0.1:5000:5000 registry:2 && docker tag ghcr.io/beamhop/scut-agent:dev localhost:5000/scut-agent:dev && docker push localhost:5000/scut-agent:dev
for f in ladder screen-cdp host host-pi gvisor gvisor-agent wsl; do bun test tests/$f.test.ts --timeout 1500000; done
OPENROUTER_API_KEY=… TELEGRAM_BOT_TOKEN=… bun test tests/live.test.ts --timeout 600000
```

CLI: `scut create <name> [--harness pi|codex|copilot|opencode|mock] [--to <destination>]`, `scut ls`, `scut beam <agent> --to <destination>`, `scut export <agent> [--out FILE]`, `scut import FILE [--to <destination>]`, `scut rm <agent>`.

Checks: `bun run typecheck` (CI-enforced), `bun scripts/axe.ts <app-url>` for an accessibility audit (also a UI test).

## Status

See [CHANGELOG.md](CHANGELOG.md). The `engines` workflow runs on real Linux (with KVM), macOS (Apple Silicon) and Windows runners: a whole agent boots on smolvm (Linux/KVM), WSL2 (Windows) and gVisor; the no-sandbox services (systemd, LaunchAgent, logon task) are registered, recover from a crash and are removed. Not yet tested: smolvm booting on a real Mac (the macOS runner has no nested virtualization; Beamhop detects that and moves on), Fly/Render/Railway accounts, real Slack/Discord apps, Codex/Copilot/opencode logins.
