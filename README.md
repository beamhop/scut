# Beamhop — beam your agent

AI agents that each have their own computer, live in your chat apps, and move between your laptop and your own cloud in seconds.

- **Their own computer.** Every agent runs in a sandbox with a Linux desktop and Chromium. Watch it live, click and type alongside it, or take control for logins and CAPTCHAs.
- **Lives where you chat.** Telegram, Slack, Discord and Nostr. Pair once with `/pair <code>`; only you can approve risky actions, anyone in a channel can chat.
- **A crew, not a bot.** All your agents share a private crew room (Nostr NIP-17) and can hand work to each other, with a loop guard so they never spin.
- **Beam it.** Drag an agent onto a destination: its workspace, browser profile, chat history and memory travel encrypted; the new host gets the keys sealed to it; a signed lease guarantees one active copy. Failed beams roll back.
- **Your models, your clouds.** Any Anthropic- or OpenAI-compatible endpoint (OpenRouter, Ollama, LM Studio), or your Claude/ChatGPT subscription through the Codex or Copilot CLI harness. Bring your own Fly.io, Render or Railway account.
- **Safe defaults.** Autonomy ladder (ask / risky only / autonomous), daily token cap, Stop, owner-bound sign-in tokens, no Beamhop servers in the path.

## Quick start

1. Download `scut` for your OS from the latest CI run (Actions → build → `scut-apps`), or build it: `./scripts/build-app.sh`.
2. Run it. The app opens in its own window.
3. Pick a model (paste an OpenRouter key, or choose a local model), describe your agent, press **Beam it in**.
4. Optional: **+ Add a cloud** to connect Fly.io, Render or Railway, then drag your agent onto it.

Agents use the public image `ghcr.io/beamhop/scut-agent:latest`. On Linux with KVM and on Apple Silicon they run as smolvm microVMs; elsewhere in Docker.

## How it works

| Piece | What it does |
|---|---|
| `packages/agentd` | PID 1 in the agent image: desktop (Xvfb, Openbox, Chromium), harness, channels, one authenticated WebSocket endpoint (the agent is its own relay), beam protocol, approvals, schedules |
| `packages/agent` | Harness adapters (Pi default, Codex CLI, Copilot CLI, opencode) + the computer-use MCP server they all share (`screenshot`, `click`, `type_text`, `key`, `scroll`, `open_url`, `request_approval`, `crew_post`, `crew_list`) |
| `packages/channels` | Telegram (long polling), Slack (Socket Mode), Discord (Gateway), Nostr (NIP-17 DMs + crew room) — all outbound, no public URL |
| `packages/beam` | Bundle pack, AES-256-GCM encryption, restore |
| `packages/protocol` | Types, beam ticket, signed lease, owner auth (NIP-98 style, host-bound), NIP-44 sealing |
| `packages/drivers` | smolvm (SDK), Docker, Fly.io, Render, Railway |
| `packages/ui` | React + Tailwind app: crew grid, agent view, create flow, add-a-cloud, crew room, phone view |
| `apps/app` | `scut` app server + CLI, compiled to one file per OS |
| `image/` | The agent image |

## Develop

```bash
bun install
./scripts/build-image.sh                       # UI + agent image (ghcr.io/beamhop/scut-agent:dev)
SCUT_IMAGE=ghcr.io/beamhop/scut-agent:dev SCUT_SIM_CLOUD=1 bun apps/app/src/main.ts
bun test tests/e2e.test.ts tests/ui.test.ts --timeout 600000
OPENROUTER_API_KEY=… TELEGRAM_BOT_TOKEN=… bun test tests/live.test.ts --timeout 600000
```

CLI: `scut create <name> [--harness pi|codex|copilot|opencode|mock] [--to <destination>]`, `scut ls`, `scut beam <agent> --to <destination>`, `scut rm <agent>`.

## Status

See [CHANGELOG.md](CHANGELOG.md). Not yet tested against real services: smolvm boot (needs KVM or Apple Silicon), Fly/Render/Railway accounts, real Slack/Discord apps, Codex/Copilot/opencode logins.
