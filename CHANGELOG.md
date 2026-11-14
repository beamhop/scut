# Changelog

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
