# Changelog

## v0.2.1 — 2026-11-14 01:30

- Fix: agent view crashed in current Chrome (effect returned scrollIntoView's promise).
- Pending approvals are replayed to clients that connect late (tiles now show "Approve?" banners reliably).
- Chromium no longer shows the --no-sandbox infobar; state chips readable on light pages.
- New UI test suite in real Chrome (puppeteer-core): first run, live tile, keyboard Beam menu, chat, settings, history replay, zero console errors.
- Tests: 14/14 e2e, 5/5 UI.

## v0.2.0 — 2026-11-14 01:20

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
