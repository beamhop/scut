# Changelog

## v0.31.0 — Beam by file

- New destination in every "Beam to…" menu: **A file, for another computer**. The agent stops here and goes into one encrypted `.beamhop` file with its files, browser logins, memory and chats, locked with your passphrase (PBKDF2-SHA256, 310k rounds + AES-256-GCM over the agent key and bundle key; the bundle itself is the same AES-GCM bundle a live beam sends).
- **Open an agent file** (in the dock, and on the very first screen of a fresh install) brings it back to life on this computer or any connected cloud. Whoever opens it becomes its owner: the agent host accepts the new owner only from someone holding the agent's own key and the bundle key.
- Never two copies: exporting retires the old host with a signed lease that points at the file; the next host gets the next lease.
- Clear errors for a wrong passphrase, a damaged or cut-off file, and an agent that's already here. Lose the passphrase and the file can't be opened — the dialog says so.
- Tests: e2e export → import into a second Beamhop with a different owner (history, memory, replies intact; the old owner is locked out), and a UI test that downloads the file and opens it again.
- Fixed: location chips on narrow tiles no longer wrap onto two lines.

## v0.30.0 — A face on every screen

- The agent's browser now opens on its own start page instead of a blank white tab: its name and mascot in its colour, and "Ready for a task". The crew grid finally shows who is who at a glance.
- The page is self-contained and deliberately still, so idle tiles keep costing almost no frames (checked by the existing frame-budget test, which caught a first animated version).
- An empty chat offers three one-tap starters (look something up, research with links, a daily scheduled task).

## v0.29.0 — Chat app health

- Settings now shows what each chat app is actually doing: "connected as @your_bot", "connecting…", or, if the token doesn't work, "Couldn't sign in with this token. Check it, or disconnect and paste a new one." Before, a wrong token still said "connected".
- If signing in fails (wrong token, or just offline after waking up), the agent keeps retrying quietly and clears the warning as soon as it works.
- Test with a rejected and then a good Telegram token.

## v0.28.0 — Beams survive the app closing

- If the app is closed or crashes in the middle of a beam, it sorts things out on the next start instead of showing "Beaming…" forever with the agent paused:
  - the new host hadn't taken over yet → the agent carries on where it was, the half-made host is removed, and the tile says so;
  - the new host had already taken over → the move is completed and the old host retires, so there are never two copies of one agent.
- The new host is recorded as soon as it's created so this works at every step. Agent hosts now include their signed lease in `/status`.
- Tests for both cases with real containers.

## v0.27.0 — Daily tasks keep local time

- "Daily at 8:00" now means 8:00 where you are, every day: tasks store your time zone and wall-clock time instead of a UTC offset taken on the day you added them, so they no longer drift an hour after a daylight-saving change, wherever the agent is beamed.
- Settings shows the task's time zone when it differs from yours. Older tasks keep working as before.
- Tests across the 25 October 2026 change in Europe/Amsterdam.

## v0.26.0 — Security hardening

- **Fixed a real hole:** any website you visited could send requests to the app's local API (cross-site POSTs are processed even when the reply can't be read), e.g. to start a beam or save a cloud token, and DNS rebinding could read it. The API now refuses requests whose Host isn't localhost or whose Origin isn't the app itself, and anything marked cross-site.
- The app and the agent's phone page can't be framed by other sites (X-Frame-Options DENY + CSP frame-ancestors), so nobody can trick a click on "Allow".
- Agent hosts: constant-time check of the internal token, handoff bodies capped at 1 MB, `..` paths never reach the file system; added nosniff and no-referrer headers.
- Tests: CSRF, rebinding and cross-site requests get 403 while the real UI keeps working; path-traversal probes against a live agent never return its data.

## v0.25.0 — Accessibility audit

- Ran axe-core (all rules, WCAG 2.2 AA plus best practices) on the crew grid, New agent, Add a cloud, the agent view and Settings. WCAG rules already passed; fixed the remaining structure issues: one level-one heading per screen (Beamhop / the agent's name), a main landmark around the agent's screen, a labelled chat/settings sidebar, and the destination dock as a labelled navigation region.
- New UI test fails if any axe violation appears on the main screens.
- `scripts/axe.ts <url>` audits a running app.

## v0.24.0 — Laptop sleep

- Fixed: a daily task added after today's time (say "daily at 8:00" added at 10:00) ran straight away. Tasks now remember when they were added and first run at the next 8:00.
- A daily task that was due while the laptop slept runs once on wake, then keeps its normal time.
- New test: pause an agent's computer (as laptop sleep does), drop its network connections, wake it — Telegram and Slack reconnect and answer, and the agent is still running.
- The image build drops bun's download cache in the same step.

## v0.23.0 — 75 MB lighter

- The UI build now starts clean and ships without inline source maps. Stale chunks had piled up to 55 MB and were embedded in every app binary and in the agent image; the UI is now 432 KB.
- App binaries: Linux x64 185 MB → 110 MB, macOS arm64 → 90 MB, Windows → 116 MB. Agent image 3.76 GB → 3.6 GB.
- Smoke-tested the compiled Linux binary: serves the current UI and API with nothing installed.
- UI test for creating an agent no longer depends on whether a brain was saved by an earlier test.

## v0.22.0 — Local models and model suggestions

- Picking "Local (Ollama)" looks for Ollama on this computer right away: it uses an installed model, says how many it found, or explains what's missing ("Ollama isn't running…", "no models yet: ollama pull …").
- After a key check, the Model field suggests the models your provider actually offers; if the chosen one isn't offered, Advanced opens so you can pick another.
- Re-ran the live suite (real model on OpenRouter, Telegram, Nostr DMs, crew room): 6/6.

## v0.21.0 — The brain is remembered and checked

- Fixed: agents created after the first one got no API key. The app now remembers your brain (endpoint, model, key) in `~/.scut/brain.json` (readable only by you), and new agents reuse it. New agent shows "Brain: OpenRouter · model — Change".
- "Pick a brain" checks the key before moving on (OpenRouter, OpenAI-compatible, Anthropic, Ollama): a rejected key, an unreachable endpoint, or a model the provider doesn't offer is explained in plain words, with "Continue anyway".
- "Skip this" on the brain step for people using a Codex or Copilot subscription.
- Tests: UI test for the key check, e2e test that a second agent uses the saved key.

## v0.20.0 — Clean typecheck

- The whole repo now typechecks cleanly (`bun run typecheck`), and CI fails if it doesn't.
- Fixed typing around binary responses, Web Crypto inputs, async-iterated streams, and the mock chat servers.
- Tiles in the crew grid no longer stretch to match a taller neighbour (e.g. one showing a beam receipt).

## v0.19.0 — Run history for scheduled tasks

- Every scheduled run is kept (last 10, survives beams): whether it worked, what the agent answered, how long it took, tokens used, and the screen when it finished.
- "Recent runs" under Scheduled tasks in Settings; tap a run to see the result and the screenshot.
- "Run now" on each task to try it without waiting.

## v0.18.0 — Safety check

- Settings open with a plain-language safety check: sandboxed computer, autonomy level, daily spending cap (with a dollar estimate and today's use), who can approve risky actions on each connected chat app, and encrypted single-copy beams.
- Shows "all good" collapsed, or opens itself and lists what to look at (e.g. "Never ask", no cap, a chat app nobody has paired with yet).

## v0.17.0 — Beam receipts, streamed beams

- After a beam lands, the tile says where the agent arrived, where from, how long it took, how big the move was, and what came along (messages, memories, skills, scheduled tasks, browser logins, files, reconnected chat apps). Dismissible.
- The beam overlay names both ends and says the agent stays put until it lands safely.
- The app now streams the encrypted bundle straight from the old host to the new one instead of holding it in memory (300 MB beam: 16.5 s).

## v0.16.0 — Skills

- Each agent can learn Agent Skills (SKILL.md). Add one in Settings → Skills by pasting it or linking it (GitHub blob/tree links work).
- Skills land in the agent's home (`~/.agents/skills`, plus `~/.codex/skills` for Codex), and the harness restarts once it's idle so it picks them up.
- Bad SKILL.md files (missing name/description frontmatter) are rejected with a clear error.
- Test: e2e checks that an added skill shows up in the model's system prompt.

## v0.15.0 — 2026-11-14 03:03

Agents do their own setup chores, as decided in the UX plan.

- Settings → Telegram → **Set it up for me**: the agent opens BotFather on its own screen, asks you (approval with a screenshot) to log in, creates its bot, and connects itself with the new `connect_channel` tool. Tokens never appear in chat.
- Add a cloud → **Ask <agent>**: the agent opens the provider's key page, asks you to sign in (you do payment details), creates a key and hands it to your app with the new `give_cloud_key` tool; the app verifies and adds the destination.
- Live-tested with Claude Haiku 5.5: given the Telegram task, the agent opened web.telegram.org/BotFather and asked "Please log in to Telegram on my screen". Mock-tested: `connect_channel` connects Telegram and shows the pairing code; `give_cloud_key` reaches the owner and not the chat.
- Tests: 27/27 e2e, 8/8 UI, live assisted-setup check.

## v0.14.0 — 2026-11-14 02:58

- Memory: each agent keeps a long-term memory in `/data/memory.json` (so it beams along). The agent saves facts itself with new MCP tools `remember`, `forget`, `list_memories`; you can add and delete memories in Settings → Memory. Memories are given to the agent with every prompt.
- Approval requests now include a screenshot of the agent's screen at the moment it asked, shown in the approval card, so you can see what you're approving.
- Tests: Pi (via a mock model) saves a memory with the `remember` tool; owner memories reach the prompt and survive a beam; approvals carry a screenshot. 25/25 e2e, 8/8 UI.

## v0.13.0 — 2026-11-14 02:54

A fresh-eyes design review (separate reviewer, screenshots of every screen) drove this release.

- Approvals can be answered right on the crew grid: "Atlas wants to open example.com — Allow / Don't", in plain words instead of tool names.
- One accent colour, used for beaming and the main call to action only; neutral location badges and Send buttons; contrast raised to WCAG AA (no more slate-500 or 10 px text); native controls render dark.
- New agent: templates first, then "describe your agent"; coding tool, Telegram and Nostr moved under "More options"; Nostr off by default; "Create agent" needs a description or a name.
- Agent view: Settings replace the chat instead of squeezing it, with Done and a pressed state; "Pause & let me drive" sits on the agent's screen; the NOW bar only appears while the agent works; Open on phone is an icon; the Nostr address lives in Settings.
- Crew grid: CPU/memory/cost only on hover, idle agents no longer look disabled, "Beam to…" always visible, destinations show price in plain words, "Ready" instead of "Idle".
- Crew room ("Talk to all agents"): correct agent count, "end-to-end encrypted", @mention chips, grid makes room for the panel.
- Add a cloud: price is the headline, "Get your Fly.io key", Connect disabled until a key is pasted.
- Bug found by the UI tests: messages typed before the agent's connection opened were silently dropped. They are now queued and sent on connect.
- Tests: 22/22 e2e, 8/8 UI, smolvm availability check.

## v0.12.1 — 2026-11-14 02:46

- Beams of big workspaces: agentd accepted at most 128 MB per request (Bun's default), so an agent with a large workspace or browser profile could not beam. Raised to 8 GB (configurable). Tested: a 300 MB workspace beams in ~18 s with an identical sha256 on arrival.
- README rewritten for the current product.

## v0.12.0 — 2026-11-14 02:44

- smolvm driver rewritten on the official `smolmachines` SDK (v1.32.4, Apache-2.0): embedded microVM engine for Linux (KVM) and Apple Silicon, detached machines that outlive the app, published port 8080, outbound network. The driver is loaded lazily as an optional native dependency.
- The app now asks the engine whether a local microVM is possible (`localAvailability()`) and falls back to Docker with the engine's own reason. On this build machine it reports "KVM unavailable", so microVM boot remains untested here; `tests/drivers.test.ts` boots the image automatically on a machine with KVM or Apple Silicon.
- Still open: Windows has no prebuilt smolvm engine in the SDK, and the compiled app needs the engine's helper + guest files shipped next to it (or downloaded on first run).

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
