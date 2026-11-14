# Changelog

## v0.11.0 — 2026-11-14 02:42

- "Add a cloud" is a real flow now: pick Fly.io, Render or Railway, follow the deep link to the provider's token page, paste, and Beamhop verifies the token before adding the destination (Fly: lists apps; Render: finds your workspace; Railway: creates or reuses a "beamhop" project and environment). Wrong tokens get a plain error.
- Tested in real Chrome against a mock Fly API (wrong token → error, right token → Fly.io tile appears). Real provider calls still need your tokens.
- Tests: 22/22 e2e, 8/8 UI.

## v0.10.0 — 2026-11-14 02:38

- Slack channel (Socket Mode: outbound WebSocket, no public URL): answers DMs and @mentions, ignores other channel chatter, approvals as Block Kit buttons.
- Discord channel (Gateway): answers DMs and @mentions, approvals as message buttons with interaction acks, heartbeats and reconnects.
- One pairing code for all chat apps: send `/pair <code>` (or `pair <code>`) to the agent on Telegram, Slack or Discord; approvals go to the paired owner on each, and only the owner's clicks count. Scheduled-task results go to every paired channel.
- Connect Slack and Discord from agent Settings; pairing card lists every unpaired channel.
- Tested against mock Slack Web API + Socket Mode and mock Discord REST + Gateway (owner pairing, mention filtering, guest clicks ignored, owner approval). Not yet tested with real Slack/Discord apps (no tokens here).
- Tests: 22/22 e2e, 7/7 UI.

## v0.9.0 — 2026-11-14 02:33

- Bandwidth: each viewer picks its frame rate (crew tiles 1 fps, agent view 8 fps) and frames identical to the last one sent are skipped, so an idle agent costs ~1 frame per 5 s per viewer instead of a constant stream. Desktop capture raised to 8 fps for a snappier agent view.
- Connect or disconnect Telegram and Nostr from an agent's Settings after creation (channels restart live, pairing code appears).
- Failed beams roll back cleanly: tested with a provider that refuses to create a machine; the agent keeps running where it was. Found and fixed a hang where restarting the desktop after an aborted beam blocked on certutil.
- Test suite frees each test's agents (every agent runs a full Chromium), keeping memory flat.
- Tests: 20/20 e2e, 7/7 UI.

## v0.8.0 — 2026-11-14 01:56

Found by running a demo crew overnight: two agents got into a reply loop in the crew room, and some crew messages were lost.

- Crew loop guard: an agent answers at most 4 messages from other agents per 10 minutes (the owner is never limited) and only when @mentioned. If the owner @mentions specific agents, only those answer. Tested live: two agents told to keep mentioning each other stop after 10 messages.
- Nostr delivery fixes: messages sharing a timestamp were dropped (cursor used <=); publishing retries with backoff because public relays rate-limit bursts from one IP; relay order prefers primal + damus.
- New agents get a default daily cap of 1,000,000 tokens (change it in Settings; 0 = none).
- Crew messages are logged by agentd for debugging.
- The dev app prefers the UI on disk over the copy embedded for the compiled binary.
- Tests: 17/17 e2e, 7/7 UI, 5/5 live (OpenRouter, Telegram, Nostr DMs, crew room, loop guard).

## v0.7.0 — 2026-11-14 01:40

- Open on phone: a QR code / link that signs you in to one agent for 15 minutes, served by the agent itself (cloud agents are reachable from anywhere; local agents warn that the link only works on this computer). The token is moved out of the address bar after loading.
- Agent view is responsive: on phones the screen sits above the chat.
- The agent image is now published by CI as a public multi-arch image: `ghcr.io/beamhop/scut-agent:latest`, so the app works without building anything.
- New UI tests: phone link on a 390×844 touch viewport, creating an agent through the UI.
- Tests: 17/17 e2e, 7/7 UI.

## v0.6.0 — 2026-11-14 01:37

- Crew room: a private group chat (NIP-17 group DMs) between you and all your Nostr-enabled agents. Public NIP-29 relays refused programmatic group creation (hzrd149: browser-only; pyramid: members-only), so the crew room uses NIP-17 groups, which work on any relay and stay end-to-end encrypted.
- Agents answer the owner always and other agents only when mentioned by name (no agent ping-pong).
- New MCP tools for every harness: `crew_post`, `crew_list`.
- The app keeps the crew list in sync with every agent; a Crew room drawer in the UI lets you talk to everyone at once.
- Tested live: owner → "@Alpha" (mock) replies in the room; "@Bravo" (Pi + Claude Haiku 5.5) used `crew_post` on its own.

## v0.5.0 — 2026-11-14 01:33

- Nostr channel: every agent can be DMed privately over NIP-17 gift wraps using its own key; replies go back privately; the agent publishes a profile (kind 0).
- Approvals by Nostr DM: the owner's npub gets "Approval needed … reply yes/no <id>"; only that npub can answer.
- A processed-message cursor in /data means restarts and beams never replay old DMs.
- UI: Nostr DMs toggle + "your npub" in agent creation; the agent's npub is shown (click to copy) in the agent view.
- Tested live on nos.lol + relay.primal.net: user DM → approval DM → "yes <id>" → private reply.
- Tests: 17/17 e2e, 5/5 UI, 3/3 live (OpenRouter, Telegram, Nostr).

## v0.4.0 — 2026-11-14 01:35

- Single-file desktop app: `scripts/build-app.sh` compiles `scut` for Linux, macOS and Windows (x64/arm64) with the UI embedded; no files or installs next to it. Verified the Linux binary end to end from an empty folder (create agent, serve UI, API, remove).
- The app opens itself as an app window (Chrome/Edge/Chromium `--app` mode) or falls back to the default browser.
- CI workflow: builds the multi-arch agent image to `ghcr.io/beamhop/scut-agent`, runs e2e + UI tests, and uploads the app binaries.

## v0.3.0 — 2026-11-14 01:28

- Owner tokens are bound to the agent's host (a token for one agent can't be replayed against another) and live 15 minutes; the app caches them so viewers no longer reconnect on every poll.
- Take control / Hand back: pauses the agent's actions (it keeps observing) while you work on its screen, e.g. for logins and CAPTCHAs.
- Scheduled tasks per agent (daily at a local time, or every N minutes); results are also sent to your paired Telegram.
- Cost shown per agent for OpenRouter models (live pricing), tokens otherwise.
- Tests: 17/17 e2e, 5/5 UI.

## v0.2.1 — 2026-11-14 01:23

- Fix: agent view crashed in current Chrome (effect returned scrollIntoView's promise).
- Pending approvals are replayed to clients that connect late (tiles now show "Approve?" banners reliably).
- Chromium no longer shows the --no-sandbox infobar; state chips readable on light pages.
- New UI test suite in real Chrome (puppeteer-core): first run, live tile, keyboard Beam menu, chat, settings, history replay, zero console errors.
- Tests: 14/14 e2e, 5/5 UI.

## v0.2.0 — 2026-11-14 01:15

- Chat history persisted in /data and replayed on reconnect; survives beams.
- Per-agent settings over the agent's socket: autonomy ladder (ask / risky / auto), daily token budget with hard stop, persona.
- Stop button aborts the current run and denies pending approvals.
- Telegram owner pairing (/pair <code>), approvals only accepted from the paired owner; anyone in a channel can still chat.
- open_url navigates the current tab instead of piling up windows.
- UI from UX research: state chips (icon + label), needs-you tiles first, Beam to… menu + B shortcut (WCAG 2.5.7), beam checklist and "what came along" toast, Stop/Settings in agent view, Telegram pairing card, activity drawer, empty states, reduced-motion support, mascot silhouettes per variant with a status visor.

## v0.1.0 — 2026-11-14

First vertical slice, tested end to end.

- Agent image: Xvfb + Openbox + Chromium desktop, MJPEG frames over WebSocket, xdotool input, Pi/Codex/Copilot/opencode installed.
- agentd: authenticated WSS endpoint (owner-signed tokens), chat, narration, approvals, stats, shared cursors.
- Beam protocol: encrypted bundle, NIP-44 key handoff to an ephemeral host key, signed lease, retire-on-commit, abort/rollback.
- Harnesses: Pi over RPC with the computer-use MCP server (direct exposure); CLI adapters for Codex, Copilot CLI, opencode; mock harness.
- Telegram channel with long polling, lease-gated, inline-button approvals.
- Drivers: docker (tested), smolvm, Fly, Render, Railway (written, untested).
- UI: crew grid of live desktops, drag-to-beam dock, agent view with shared screen + chat + narration, approvals toasts, first-run wizard.
- Tests: 9 e2e (docker) + 2 live (OpenRouter claude-haiku-5.5 browsing example.com and remembering it across a beam; Telegram lease handover). Local-to-cloud beam of a running agent: ~2.7 s.
