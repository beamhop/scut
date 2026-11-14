# Phase 2 brief: screen rebuild (read fully before coding)

Repo: /home/claude/scut (Bun/TS monorepo). You are one of three agents rebuilding the Beamhop UI in parallel in the SAME working tree. The owner said the old UI is "much too AI slop" and expects "the best user experience and interface for such a product". Bar: Linear / Teenage Engineering / Vercel dashboard level craft. Calm, dense, legible, warm-neutral, one orange accent meaning "a person is needed".

## Read first (in this order)
1. `DESIGN-PLAN.md` — the plan. Your screens' sections are authoritative.
2. `DESIGN.md` — the design system guide: tokens, primitives, when to use which, ban list, copy and a11y rules.
3. `packages/ui/src/ui/index.ts` and the primitives it exports; `packages/ui/src/design.tsx` (the gallery at `#/design`) shows every primitive in use. Look at `research/shots/design-light.png` / `design-dark.png`.
4. `research/ui-test-contract.txt` — selectors/texts the UI tests depend on.
5. `research/03-trust-transparency-a11y.md` (approval card anatomy + a11y audit) and `research/02-fleet-and-live-screens.md` for the reasoning.
6. The backend just added (protocol `packages/protocol/src/index.ts`): `StatusMsg` (`t:"status"`: headline, since, task{prompt,origin,startedAt}, lastResult, nextRun, pending, dayTokens, paused), `ApprovalRequest` with `kind`, `risk`, `expiresAt`, `origin`; `approval.resolved` with `by`, `via`, `at`; `state.since`; `stats.dayTokens`. Helpers: `RISK_WORD`, `assessApproval`, `clock`, `nextRunAt`. Use these — they are what make the UI transparent.

## Rules
- Use ONLY the primitives in `packages/ui/src/ui/` and token colours. If you need a new primitive, add it inside your own files (or a new file under `packages/ui/src/ui/` named for your area, e.g. `ui/bench-*.tsx`), never rewrite an existing primitive's API. Small additive fixes to a primitive are OK if essential; re-read the file right before editing (others may be editing too).
- No old classes (`panel`, `panel2`, `beam`, `space`, `slate-*`, `white/…`, `glow-*`, gradients, rounded-full buttons, uppercase tracked labels, emoji, unicode glyph icons, Mascot). The legacy mappings in styles.css will be deleted in Phase 3 — your screens must not depend on them.
- `Mascot`/robot identity is retired → `Plate`.
- Money in euros with a period via `fmt.money`. Tokens never shown as the primary figure.
- Every status = word + shape (`StatusBadge`/`Lamp`). Approvals never via toast; never auto-focused; Allow inert 600 ms; high risk → `HoldButton`.
- Keyboard-complete; register palette commands with `useCommands` (its `shortcut` binds globally — don't double-bind). `<Announcer/>` and `<CommandPalette/>` are already mounted.
- Copy: plain, short, verb-first buttons, sentence case, no "AI ✨", no exclamation marks, no jargon (no "harness", "container", "MCP", "pubkey" in primary UI; can live in a details disclosure).
- Light and dark must both look right. Phone width (390) must work for anything reachable on phone.
- Shared files: `lib.tsx` (types/api/helpers) and `useAgent.ts` (the per-agent socket hook) are shared. Edits there must be ADDITIVE ONLY (add fields/exports; don't rename or remove), small, and done by re-reading right before editing. Old exports that become unused are removed in Phase 3, not by you.
- Keep your files compiling at every save: others build `packages/ui/dist` from the same tree. If a build fails in a file you don't own, wait a minute and retry; don't fix others' files.
- Tests: `tests/ui.test.ts` covers flows. If you intentionally change copy/selectors, update ONLY the tests for your area (re-read the file right before editing; small targeted edits) and keep each flow covered. Don't delete tests. Run only your area's tests: `cd /home/claude/scut && bun run --cwd packages/ui build && SCUT_DEV_CA=$HOME/.ccr/ca-bundle.crt bun test tests/ui.test.ts -t "<pattern>" --timeout 600000` (needs Docker; if `docker info` fails, start it: `(nohup dockerd > /tmp/dockerd.log 2>&1 &)` then wait). Note ui tests share one browser/agent across the file, some depend on earlier ones — run a pattern that includes setup ones if needed, or the whole file once at the end.
- Typecheck: `bunx tsc --noEmit -p .` must be clean for your files.
- Screenshots to judge your own work (do this, and look at them with Read, iterate until it's genuinely great): build the UI, then run the app on YOUR port:
  `SCUT_IMAGE=ghcr.io/beamhop/scut-agent:dev SCUT_HOME=/tmp/<area>-home SCUT_SIM_CLOUD=1 SCUT_NO_WINDOW=1 SCUT_NO_CREW=1 SCUT_DEV_CA=$HOME/.ccr/ca-bundle.crt bun apps/app/src/main.ts app --port <yourport>` (create agents first with `SCUT_HOME=… bun apps/app/src/main.ts create Atlas --harness mock`). Use `scripts/screens.ts` / `scripts/shoot-design.ts` as examples for puppeteer shots (Chrome at /usr/bin/google-chrome). Save final shots to `research/shots/v060-<area>-*.png` (light, dark, and phone where relevant).
- Run axe (see `scripts/axe.ts` / shoot-design.ts) on your screens: zero violations.
- Do NOT commit or push. Do NOT touch packages/protocol, agentd, agent, channels, apps/ (unless your brief says so). Never print or store secrets from ~/.scut/secrets.env.
- Think outside the box within the plan: where the plan is thin, make the choice a world-class product designer would, and note it in your report.

## Report (final message)
Files changed; what each screen now does; deviations from the plan and why; screenshot paths; tests run + results; axe result; anything left undone or that the integrator must reconcile (especially shared-file additions).
