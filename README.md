# scut — Beamhop: beam your agent

AI agents that each have their own computer, live in your chat apps, and can be **beamed** between your laptop and your own cloud in seconds.

- **Own computer:** every agent runs in a sandbox with a Linux desktop and Chromium. Watch it live, click and type alongside it (shared screen).
- **Pluggable harness:** Pi (default), OpenAI Codex CLI, GitHub Copilot CLI or opencode. All get the same computer-use MCP tools.
- **Any model:** any Anthropic- or OpenAI-compatible endpoint (OpenRouter, Ollama, LM Studio…), or a subscription login done on the agent's own screen.
- **Channels:** Telegram today (long polling, no public URL); Slack, Discord and Nostr next.
- **Beam:** the agent's state (`/data`: workspace, browser profile, sessions, memory) is packed, encrypted (AES-256-GCM), handed to the new host with keys sealed to that host (NIP-44), and a signed lease makes sure only one host ever runs the agent.
- **No servers of ours:** each agent is its own relay (one authenticated WSS endpoint). You bring your own cloud keys.

## Layout

| Path | What |
|---|---|
| `packages/protocol` | Types, beam ticket, lease events, owner auth (NIP-98 style), NIP-44 sealing |
| `packages/agentd` | PID 1 in the agent image: desktop, harness, channels, WSS endpoint, beam protocol |
| `packages/agent` | Harness adapters + computer-use MCP server |
| `packages/channels` | Telegram channel (lease-aware) |
| `packages/beam` | Bundle pack/encrypt/restore |
| `packages/drivers` | Host drivers: docker (tested), smolvm, fly, render, railway (untested) |
| `packages/ui` | React + Tailwind app UI |
| `apps/app` | `scut` app server + CLI |
| `image/` | Agent image (Debian, Xvfb, Openbox, Chromium, ffmpeg, Bun, harness CLIs) |

## Try it

```bash
bun install
./scripts/build-image.sh                 # builds UI + ghcr.io/beamhop/scut-agent:dev
SCUT_IMAGE=ghcr.io/beamhop/scut-agent:dev SCUT_SIM_CLOUD=1 bun apps/app/src/main.ts   # http://127.0.0.1:7777
```

CLI:

```bash
scut create Scout --harness pi --model anthropic/claude-haiku-5.5 \
  --model-url https://openrouter.ai/api/v1 --model-key $OPENROUTER_API_KEY
scut beam scout --to sim-cloud
```

## Tests

```bash
bun test tests/e2e.test.ts --timeout 600000     # real containers, desktop, beams, approvals, Pi via mock LLM
OPENROUTER_API_KEY=… TELEGRAM_BOT_TOKEN=… bun test tests/live.test.ts --timeout 600000
```

## Status

See [CHANGELOG.md](CHANGELOG.md). Untested pieces: smolvm driver (needs KVM/HVF/WHP), Fly/Render/Railway drivers (need accounts), Codex/Copilot/opencode harnesses (need logins).
