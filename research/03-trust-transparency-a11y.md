# 03 — Trust, transparency, cost & accessibility for Beamhop

Research date: 2026-11-14. Scope: approval (human-in-the-loop) UX, transparency/audit, cost and budget UX, accessibility for live remote screens and dense dashboards, and onboarding for non-technical owners.
Inputs: screenshots in `research/shots/` (home-v048, firstrun-v044, phone-v043, settings-v040) and the UI code. During this research `packages/ui/src/App.tsx` was split into `crew.tsx`, `agentView.tsx`, `settings.tsx`, `create.tsx`, `beam.tsx`, `lib.tsx` and `useAgent.ts`. References below use those file and function names. Server-side: `packages/protocol/src/index.ts` (approval messages), `packages/channels/src/index.ts` (Telegram/Slack/Nostr approvals) and `packages/agent/src/index.ts` (the `request_approval` policy and its 1800 s tool timeout).

---

## 0. TL;DR: what the evidence says, in one screen

1. **Most approval prompts become rubber stamps.** Claude Code users accept **93%** of permission prompts ([Anthropic Engineering, auto mode](https://www.anthropic.com/engineering/claude-code-auto-mode)). In a 40k-run / 409k-command game, humans approved about **1 in 3 malicious agent requests**, and scope violations were missed 35% of the time ([The Register via daily.dev](https://daily.dev/posts/humans-in-the-loop-miss-a-third-of-dangerous-ai-coding-agent-requests-823tnlnkc)). Approval rates can pass 95% within about 2 weeks ([habituation curve](https://tianpan.co/blog/2026-04-28-agent-permission-prompt-habituation-curve)). Implication: **ask less often, ask at the right moment, and show the real payload.**
2. **Upfront approval kills runtime scrutiny.** In a 48-person, 192-session study of computer-use agents, users who approved actions in advance scrutinised less later. When control did reach them, they judged whether the action was *correct*, not whether it was *safe* ([Chen et al. 2026, arXiv 2604.04918](https://arxiv.org/abs/2604.04918)). Oversight works by "aligning authority, timing, and attention with decision-critical moments", not by maximising control.
3. **Making traces easier to review does not make oversight more accurate, and it inflates confidence.** In one study the interface raised confidence most when users wrongly accepted bad outputs (g = 0.85). A "specification + explicit assumptions" summary was the most accurate format (77%). Flowchart-style process summaries were the worst (39% on incorrect outputs) ([Grunde-McLaughlin et al. 2026, arXiv 2602.16844](https://arxiv.org/html/2602.16844v1)).
4. **Tier by reversibility.** Magentic-UI's action guards sort actions three ways: *always irreversible* (always ask), *maybe irreversible* (an LLM judge decides) and *never irreversible* (just do it) ([arXiv 2507.22358](https://arxiv.org/html/2507.22358v1)). Anthropic's auto mode uses the same tiering, and on a denial the agent is told to "find a safer path" instead of the session being killed ([Anthropic](https://www.anthropic.com/engineering/claude-code-auto-mode)).
5. **Budgets in money, with staged alerts and a real hard stop.** Vercel's defaults alert at **50/75/100%**, add SMS at 100%, can pause at 100%, and warn that checks lag by minutes, so "set the budget below the absolute maximum" ([Vercel docs](https://vercel.com/docs/spend-management)). Cursor and Vercel both say plainly that **alerts don't stop spend; limits do**.
6. **Beamhop's biggest accessibility bug is a WCAG 2.1.2 (Level A) keyboard trap.** The agent screen calls `preventDefault()` on every key, including Tab and Escape (`agentView.tsx` → `onKey`), and nothing tells the user how to leave.

---

## 1. Human-in-the-loop approval UX

### 1.1 Findings (with sources)

| Finding | Source |
|---|---|
| 93% of prompts accepted, which Anthropic calls "approval fatigue". Auto mode tiers actions: read-only and always-allow rules pass, in-project edits skip the check, everything else goes to a classifier. 20+ default block rules in four groups: destroy/exfiltrate data, degrade security posture, cross trust boundaries, bypass review/affect others. The classifier is "reasoning-blind": it ignores the agent's own justification so a persuasive (possibly injected) rationale can't talk it past. Escalate to a human after 3 consecutive or 20 total denials. Full pipeline: 0.4% false positives, 17% false negatives on real overeager actions. | https://www.anthropic.com/engineering/claude-code-auto-mode |
| Habituation curve: approval passes 95% within about 2 weeks. Treat a consent gate as a control with a measurable decay rate. Log evidence of evaluation (time on prompt, whether the preview rendered, whether the user edited anything), not just "approved". Use per-call, time-limited, scoped consent. | https://tianpan.co/blog/2026-04-28-agent-permission-prompt-habituation-curve |
| Humans missed about a third of malicious requests. `npm run analyze` was approved 65% of the time even though it can run arbitrary scripts. Lesson: innocuous-looking labels hide the real effect. | https://daily.dev/posts/humans-in-the-loop-miss-a-third-of-dangerous-ai-coding-agent-requests-823tnlnkc (original: The Register, 2026-08-06) |
| Six patterns across the action lifecycle: **Intent Preview** (plan with Proceed / Edit / Handle it myself), **Autonomy Dial** (per task type; onboarding starts low), **Explainable Rationale** ("because you set X, I did Y"), **Confidence Signal**, **Action Audit & Undo** ("Undo available for 15 minutes"; say plainly when something becomes permanent), **Escalation Pathway**. Metrics: plan acceptance above 85%, reversion rate below 5%, escalation frequency 5–15%. | https://smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/ |
| Ten tool-approval patterns, including scoped approval, **time-boxed grants (TTL 5–30 min)**, "approve once for this task", risk-tiered step-up, dry-run preview, plan-level checkpoint, post-hoc review with reversible actions. The runtime must enforce revocation; a UI timer alone doesn't count. | https://www.kunalganglani.com/blog/tool-approval-patterns-ai-agents |
| Three friction tiers: **auto-allow + log** (reversible, contained), **notify with a cancel window** (reversible, wider reach), **confirm every time** (irreversible). Describe consequences in plain language, e.g. list the 3 files a delete touches instead of showing `rm -rf`. Prefer undo over confirm. For the irreversible tier, make confirmation deliberate (type the name). | https://www.buildmvpfast.com/blog/approval-fatigue-agent-permission-ux-2026 |
| ChatGPT agent asks for explicit confirmation before consequential actions (purchases), requires active supervision ("Watch Mode") for things like sending email, offers a **takeover mode** for logins where inputs aren't collected, narrates on screen, and lets the user interrupt, pause, ask for a progress summary or stop and get partial results. | https://openai.com/index/introducing-chatgpt-agent/ |
| Claude for Chrome: per-site permissions you can grant and revoke, confirmation before publishing, purchasing or sharing personal data, high-risk site categories blocked (financial, adult, pirated). Prompt-injection attack success fell from 23.6% to 11.2% with mitigations. | https://claude.com/resources/articles/claude-for-chrome |
| Magentic-UI: co-planning (an editable natural-language plan accepted before execution), co-tasking (take over the browser and hand back), action guards by irreversibility, saved "plans" as reusable memory, multi-tasking with a per-session "needs input" indicator. SUS 74.6 (n=12). | https://arxiv.org/html/2507.22358v1 |
| Oversight strategies compared (n=48, 192 live sessions): upfront approval inhibited later scrutiny. Plans constrained unplanned actions but left unlisted safeguards uncovered. Control often came back too early or too late. | https://arxiv.org/abs/2604.04918 |
| Unintended consequences of GUI agents (221 Reddit posts + 14 interviews): unsolicited or destructive actions, CAPTCHA/auth conflicts, looping, **high token costs**. Users want sandboxes, clear permission boundaries and explicit confirmation for sensitive actions. | https://arxiv.org/html/2505.09875v2 |
| AP2 (Agent Payments Protocol) separates a **Cart Mandate** (human present, signs the exact cart: items, amount, currency, payee) from an **Intent Mandate** (human not present, pre-signed bounded authority with categories, payment methods, and **TTL**). This is a good mental model for "approve now" versus "approve a routine's bounds". | https://ap2-protocol.org/topics/core-concepts |
| HumanLayer: approval is enforced *inside the tool* (`@require_approval`), so it still holds if the LLM hallucinates. Approvals route to Slack or email. A **denial carries feedback text back to the LLM**. | https://github.com/gptenv/humanlayer |
| HAX G16 "Convey the consequences of user actions", G8 "Support efficient dismissal", G9 "Support efficient correction", G17 "Provide global controls", G18 "Notify users about changes" (Amershi et al., CHI 2019). | https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/ , https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/ |

### 1.2 What Beamhop does today (from code and screenshots)

- **Approval data model**: `{ id, title, detail?, ts, shot? }` (`protocol/src/index.ts`). There is no risk level, action kind, structured payload, reversibility, cost, expiry, origin (which chat, task or page triggered it), or "always allow" scope.
- **Desktop UI**: amber toasts in a fixed top-right stack, `role="alertdialog"` inside an `aria-live="assertive"` container, with Approve/Deny and an optional screenshot (`agentView.tsx`). Crew cards show only the *first* pending approval as "Atlas wants to …" with Allow/Don't (`crew.tsx`). The window title shows a count and OS notifications fire (`useAgent.ts`, `crew.tsx`). Those are good.
- **`humanize()`** (`lib.tsx`) turns raw titles into plain language, but low-level titles such as "click on the screen" or "press ctrl+l" are **unreviewable**. In "Ask me first" mode every click becomes one of these, which manufactures fatigue.
- **Chat approvals**: Telegram sends "Approval needed: {title}" with inline Approve/Deny buttons. Nostr expects a reply of `yes <id>` or `no <id>`. These messages carry **no detail, no screenshot and no risk level**, and nothing shows that the message is updated after a decision.
- **Timeout**: tools wait up to 1800 s (30 min) for approval (`agent/src/index.ts`), but the UI shows **no countdown, no expiry state, and no defined outcome** on expiry.
- **Policy**: the agent prompt says "Before payments, sending messages to new contacts, deleting data, or entering credentials, call request_approval". This is a *prompt-level* guard. Per HumanLayer and Anthropic, high-risk gates belong in the tool/runtime, not only the prompt.
- **Undo**: none for memory "Forget", scheduled-task delete or skill remove. "Remove agent" is irreversible and says so, which is good, but there is no export-first or soft-delete path.

### 1.3 Recommended approval card anatomy (desktop, phone and chat)

```
┌ [mascot] ATLAS WANTS TO ───────────────────────── HIGH RISK ▲ · can't be undone ┐
│ Send an email to jan@example.nl  (new contact)                                 │  ← verb + object, plain language
│ ┌ Subject: Invoice question                                                   ┐│  ← the REAL payload, verbatim,
│ │ Hi Jan, could you resend invoice #2231? …          [Edit before sending]    ││     editable when that makes sense
│ └─────────────────────────────────────────────────────────────────────────────┘│
│ Why: "You asked me this morning to chase the missing invoice."  — Atlas says   │  ← agent's reason, attributed, not trusted
│ Came from: your Telegram message 09:12  ·  task "Inbox helper"                 │  ← provenance (helps spot prompt injection)
│ [screenshot crop with target highlighted]                    Cost so far: $0.04 │
│ Expires in 28 min → Atlas will skip this and tell you                          │  ← timer + default outcome (deny)
│ [ Allow once ]  [ Don't — tell Atlas why… ]  [ Take over ]   ⋯ Always allow …  │
└────────────────────────────────────────────────────────────────────────────────┘
```

Rules:
- **Payload by type.** *Message*: recipient(s) with "new contact" flag, channel, full text. *Payment*: merchant, amount + currency, card/last4, recurring?, total today. *Login*: site domain (full URL on expand) and which account. *Delete*: count + names of items, where they are, whether they're recoverable. *URL open*: registrable domain, highlighted when it doesn't match the task.
- **Risk badge as text + icon + colour** (never colour alone): `Low · Medium · High`. Derive it from action kind × reversibility × money × audience, not from the agent's self-report.
- **Default outcome on timeout = deny**, and the agent is told so it can take a safer path (Anthropic). Never auto-approve.
- **"Don't" carries a reason** that goes back to the agent (HumanLayer). Offer quick chips: "Wrong person", "Not now", "Ask me first next time", "Never do this".
- **Scoped "Always allow"**: always per *kind × target × duration*, for example "Always allow messages to **Jan** in **Telegram** for **today**" or "… for this routine". It is listed and revocable in Settings → Permissions. Never offer it for payments or credential entry.
- **Step-up for High.** Hold-to-confirm (about 1 s) or retype the amount. Optionally require the desktop app or a passkey, not a chat button, for payments above X.
- **Batch only the safe ones.** "3 low-risk things waiting → Review all" may batch-approve low risk of the same kind. Medium and High are always one by one.
- **Anti-misclick delay.** Disable Allow for about 600 ms after the card appears, and **never auto-focus Allow**. Users are often typing into the remote screen when a card arrives, and a stray Enter must not approve.
- **Resolution echo everywhere.** When it's approved on phone, the desktop card collapses to "Approved by you on Telegram, 14:02". The Telegram message is edited to the same text and its buttons are removed (`editMessageText`), so stale buttons can't double-fire.

### 1.4 Avoiding approval fatigue (Beamhop-specific)

- Replace **"Ask me first — every action needs approval"** with **"Show me the plan first"**. The agent posts an Intent Preview (steps + bounds) and the user approves *the plan*. Only actions that are irreversible or not in the plan interrupt. Per-click approval is the fastest way to reach 95%+ rubber-stamping.
- **Measure the gate.** Log approve/deny, time-to-decision, whether the payload was expanded, and edits. When a kind is approved more than 95% over 2 weeks, offer "Let Atlas do this without asking (you'll see it in the timeline, with undo)". When time-to-decision drops below about 1.5 s for a High item, add friction.
- **Routines get mandates.** A scheduled task is approved once with explicit bounds (AP2 Intent Mandate analogue): who it may message, max spend per run, which sites, and an expiry. Runs inside the bounds don't interrupt. Anything outside them escalates.
- **Interruption levels** (Apple HIG): approvals are *Time Sensitive* (break through quiet hours), failures are *Active*, completions are *Passive* (digest). https://developer.apple.com/design/human-interface-guidelines/managing-notifications

---

## 2. Transparency and trust

### 2.1 Findings

| Finding | Source |
|---|---|
| Verbose traces are hard to review. People missed a cart showing 2 items when the log said 3. "Reasonable-looking process" breeds over-reliance (an "illusion of accountability"). Best format: **requirements checklist + explicit assumptions**, linked to steps, screenshots and live pages. Distinguish **"not found" from "contradicted"**. Avoid all-or-nothing checkmarks. Users prefer **batched clarifying questions**. | https://arxiv.org/html/2602.16844v1 |
| Explain the data an AI uses in terms of **scope, reach and removal**. Optimise for understanding, not completeness. Show confidence only if it changes decisions; categorical (High/Med/Low) with defined meaning beats numeric percentages for novices. Increase automation gradually as trust grows, and remind users of settings when context changes. | https://pair.withgoogle.com/chapter/explainability-trust/ |
| Reviewing agent work after the fact: **flags first** (finished? waiting on you? errors?), then timeline (incl. what was auto-approved), reasoning, diff, decision. | https://crystl.dev/blog/reviewing-agent-work/ |
| Explainable rationale: "because you set X, I did Y", plus View result / Undo. | https://smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/ |
| Batching notifications 3x/day (vs. as-usual) made people happier, more productive, less stressed and more attentive, with fewer unlocks. Hourly batching gave few benefits. Turning alerts off entirely raised anxiety (Fitz et al. 2019, CHB, n≈200). | https://communities.springernature.com/posts/batching-notifications-can-improve-attention-well-being-and-productivity |
| HAX G11 "Make clear why the system did what it did", G12 "Remember recent interactions", G13 "Learn from user behavior", G14 "Update and adapt cautiously". | https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/ |
| ChatGPT's memory model (a "Memory updated" marker in the conversation, a manage-memories list where single items can be deleted, temporary chats that don't use memory) is the de facto mental model users bring. (OpenAI's help pages were unreachable from this environment, so this description of the pattern is not quoted.) | https://help.openai.com/en/articles/8590148 |

### 2.2 Gaps in Beamhop

- "Activity (n)" is a collapsed `<details>` with 11 px mono timestamped narration lines, the last 30 only (`agentView.tsx`). There is no filtering, no link to screenshots, and no distinction between consequential and trivial events.
- `RecentRuns` (`settings.tsx`) is a strong seed: result, duration, tokens, final screenshot. But it is buried in Settings → Scheduled tasks, shows tokens rather than money, and has no "what I assumed / couldn't find".
- Memory (`MemorySettings`) is editable, which is good. But it lacks **provenance** (when and from which chat it was learned), a "Memory updated" moment in chat, undo on Forget, and any statement of *reach* (does the cloud host see it? does it travel with "Beam to…"? The export dialog does say so).
- `SafetyCheck` ("Safety: all good") is a good posture summary but it is collapsed in Settings. It only covers the budget cap and chat pairing, not autonomy level, standing "always allow" grants, connected accounts and logins, skills from the internet, or exposure to the public internet.
- The header's "$0.00 spent" has **no time period**. Is it today, this month, or all time?

### 2.3 Patterns to adopt

- **Unified per-agent Timeline** (replaces "Activity"): one row per *meaningful* event, i.e. messages sent, money spent, logins, files deleted, approvals (and who decided, from where), memory changes, settings changes, task runs. Each row shows time, plain sentence, actor (Atlas / you / "Jan in Slack"), origin, cost, a thumbnail, and **Undo** while possible. Low-level narration (clicks, scrolls) folds into the parent step ("Looked through 4 pages on bol.com").
- **"While you were away" digest**: shown on return to the Crew screen (`document.hidden` for more than N minutes) and optionally sent 1–3×/day to Telegram (Fitz). Order it as **flags first** (waiting on you, failed), then outcomes, then spend, then notable actions. Per run, use the specification format: *Did / Assumed / Couldn't find / Cost*.
- **Replay**: store a keyframe per tool call (Beamhop already captures `shot` for approvals and runs). Scrub with captions taken from narration. Keyboard: Space play/pause, ←/→ step, Home/End.
- **"What Atlas knows about you"**: memory grouped by *About you / Preferences / People / Accounts it's logged into / Files it keeps*. Each item shows "learned 3 Nov from your Telegram chat", Edit, Forget with Undo, and a reach line: "Stored only inside Atlas's computer; travels with Atlas when beamed; never sent to Beamhop."
- **Permissions page**: one table of standing grants ("Always allow"), connected chat apps and who can talk vs. approve, logged-in sites (cookie jar), skills with source URL, schedules and their mandates. Each row has Revoke.
- **Safety posture card on the agent header** (not hidden in Settings): a three-state shield (Good / Look at this / At risk) with the 3 most important items, and every "!" linking to the fix.

---

## 3. Cost and budget UX for usage-billed AI

### 3.1 Findings

| Product | What they do | Source |
|---|---|---|
| **Vercel Spend Management** | Budget in USD per cycle, scoped to team/project/product/org. Web + email alerts at **50%, 75%, 100%** by default, plus **SMS at 100%**. Optional **pause at 100%**. Webhook at thresholds and every further 100% (200%…1000%). Checks run every few minutes, so "set your budget amount below the absolute maximum". Projects don't auto-resume when the budget is raised; the UI offers to resume. All spend actions are logged in the Activity log. | https://vercel.com/docs/spend-management |
| **Cursor** | "Spend alerts don't stop usage." Limits are what cap cost. Alerts are email only, on additional (on-demand) spend, at team or member level. | https://cursor.com/help/account-and-billing/spend-alerts.md |
| **OpenRouter** | Workspace budget plus guardrails per member or key with **daily, weekly or monthly reset**. The first limit hit blocks the request. **Raising a limit doesn't reset the counter.** A new key doesn't reset a member's spend. Example tiers: $50/day for a new user up to $1,000/day. Optional "include BYOK spend". | https://openrouter.ai/docs/guides/best-practices/spend-controls |
| **AWS Budgets** | Actual vs **forecasted** alerts. Forecasts need about 5 weeks of history. Prefer recurring budgets so alerts don't silently stop. | https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-best-practices.html |
| GUI agent users | List "high token costs" and looping among unintended consequences. | https://arxiv.org/html/2505.09875v2 |

### 3.2 Gaps in Beamhop

- The budget is a **daily token** number (`1000000`), with dollars only as a sub-line estimate (`settings.tsx`, "≈ $x a day at most"). `0` means unlimited, and that is the default, which makes `SafetyCheck` flag "No daily spending cap" on a fresh agent.
- Cloud hosting costs (Fly ~$21/mo, Render ~$85/mo, Railway ~$80/mo per agent, from the `Add a cloud` dialog) are **not part of any total**.
- There are no staged alerts and no "what happens at the cap". The UI does not say whether the agent pauses, asks, or switches to a cheaper model.
- There is no crew-wide view ("All agents: $3.12 today, ~$41 this month at this pace").

### 3.3 Patterns to adopt

- **Money-first budgets.** "Atlas may spend up to **€2 a day**" (tokens shown only in a details row). Default a cap at creation (e.g. €2/day per agent, plus a €30/month crew cap) so the safe state is the default state.
- **Two kinds of limit, named honestly:** *Heads-up* (alert) and *Stop* (hard cap). Alerts at 50/75/100%. At 100% the agent **pauses and asks in chat**: "I've hit today's €2 limit halfway through 'Find e-bikes'. [Allow €1 more today] [Stop for today]". This is Vercel's pause plus the owner's chat loop.
- **Forecast line**: "At this pace: ~€38 this month (LLM €17 + cloud €21)". Only show a forecast once there are about 7 days of history, otherwise say "not enough history yet" (AWS lesson).
- **Per-task cost**: every run, timeline row and approval card shows the cost so far. Routines show "≈ €0.06 per run · €1.80/month".
- **Runaway detection**: when the same step repeats more than N times or spend per minute is over X, auto-pause and tell the owner: "Atlas seems stuck in a loop on the login page (12 tries, €0.40)".
- **Ambiguity fixes**: always label the period ("€0.42 today"). Remember that raising a cap mid-day doesn't reset the counter (OpenRouter), so show "used €1.90 of new €3 limit".

---

## 4. Accessibility: live remote screens and dense dashboards

### 4.1 Standards and research

| Item | Requirement | Source |
|---|---|---|
| **2.1.2 No Keyboard Trap (A)** | If focus can enter, the keyboard alone must be able to leave. If leaving needs a non-standard key, **tell the user how** (the example given is Alt+F10 for a rich text editor). | https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html |
| **2.2.1 Timing Adjustable (A)** | Any time limit must be turn-off-able, adjustable to 10× the default, or extendable with ≥20 s warning, ≥10 times. Exceptions: real-time, essential, longer than 20 h. | https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html |
| **2.2.2 Pause, Stop, Hide (A)** | Auto-updating or moving content shown alongside other content needs pause/stop/hide or control of update frequency. Real-time content is covered; on resume, show current state, not stale data. | https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html |
| **2.4.11 Focus Not Obscured (Min) (AA)** | A focused element must not be *entirely* hidden by sticky headers/footers, toasts or non-modal dialogs. Fix with `scroll-padding` (C43), or toasts that close on focus loss. | https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html |
| **2.4.13 Focus Appearance (AAA)** | Indicator at least as large as a 2 CSS px perimeter, with ≥3:1 change between focused and unfocused. A good target even though it's AAA. | https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html |
| **2.5.7 Dragging Movements (AA)** | Anything done by dragging must also work with a single pointer and no drag. | https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html |
| **2.5.8 Target Size (Min) (AA)** | 24×24 CSS px, or 24 px spacing circles that don't overlap. Exceptions: inline, equivalent control, UA default, essential. | https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html |
| **3.3.8 Accessible Authentication (Min) (AA)** | Don't block paste or password managers. WebAuthn, QR and device confirmation are good alternatives. | https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html |
| **4.1.3 Status Messages (AA)** | Status, alert and log roles let AT announce changes without moving focus. `role=log` suits sequential updates such as chat and activity. | https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html |
| **APG alertdialog** | Use only for a *modal* interruption that needs a response: `role=alertdialog`, `aria-modal=true`, `aria-labelledby` (title), `aria-describedby` (message), focus moves into it. | https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/ |
| **APG keyboard** | Composite widgets (grids, toolbars) are one tab stop with arrow keys inside, via roving tabindex or `aria-activedescendant`. Shortcuts supplement navigation, never replace it. Avoid OS/AT/browser conflicts: modifier+Tab/Enter/Space/Esc, Meta+key, CapsLock/Insert+key, Ctrl+Option on macOS. | https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/ |
| **Live regions** | Put regions in the DOM at load. Use one polite + one assertive region. Don't announce too often. Compose the message then insert it once. Clear after about 350–500 ms. Use `role=log` for chat. **Don't put interactive content in toasts; use a focusable, persistent alertdialog. Never move focus for asynchronous messages.** | https://sarasoueidan.com/blog/accessible-notifications-with-aria-live-regions-part-2 |
| **ariaNotify()** | Imperative announcements with `priority: "high" or "normal"`, no DOM hacks. **Baseline newly available**: Chrome/Edge 141 (Sep–Oct 2025), Firefox 150 (Apr 2026), Safari 27 (Sep 2026). Electron/Chromium-based Beamhop can use it now, with a live-region fallback. | https://web-platform-dx.github.io/web-features-explorer/features/arianotify/ , https://blogs.windows.com/msedgedev/2025/05/05/creating-a-more-accessible-web-with-aria-notify/ |
| **A11y-CUA (2026)** | Blind and low-vision users took about 2.3× longer than sighted users (211 s vs 92 s) and were keyboard-only. Arrow and Tab made up about 72% of keystrokes. Computer-use agents give them minimal accessible feedback, so **they need narration, checkable confirmation, and smooth hand-off/take-over**. Claude Sonnet 4.5 success dropped from 78% to 42% when keyboard-only and to 28% under 150% magnification. | https://arxiv.org/html/2602.09310 |

### 4.2 Audit of Beamhop's current screens (measured or read from code)

Contrast was computed against the theme colours `space #070912`, `panel #0e1324` and `panel2 #141b33`:

| Token | On panel | Verdict |
|---|---|---|
| `text-slate-400` (labels, timestamps) | 7.2:1 | Pass, but it's used at **11 px uppercase mono** with wide tracking. Hard to read at that size; use at least 12–13 px for anything longer than a word. |
| `text-slate-600` ("Starting Atlas's screen…" in `crew.tsx`, future beam stages in `beam.tsx`) | **2.44:1** | **Fails 1.4.3.** |
| Input/card borders `border-white/10` | **1.31:1** | **Fails 1.4.11** for input boundaries; needs ≥3:1. `slate-500 #64748b` on panel2 gives 3.58:1. |
| Approval toast: black on amber-400 | 12.6:1 | Pass. |

Code findings:
1. **Keyboard trap (2.1.2, A).** `agentView.tsx` `onKey` calls `e.preventDefault()` on every key and forwards it, including Tab and Escape. There is no exit and no instruction, and focus lands there on click. **This is a blocker.**
2. **Live screen has no text alternative (1.1.1).** `<img src={frame} alt="">` marks informative content as decorative, both on the Crew cards and on the agent view.
3. **Crew card semantics (4.1.2).** It's a `div tabIndex=0` with `aria-label` and no role. `aria-label` on a generic element is not reliably exposed, and it contains nested buttons ("Beam to…", Allow/Don't). Restructure: a heading plus a real primary link/button "Open Atlas", with secondary actions as siblings.
4. **Approval toasts misuse `alertdialog`.** They're non-modal, never focused, sit inside an assertive live region, and lack `aria-describedby`. Screen reader users hear a burst of text that includes button labels and then can't easily reach the buttons. Sighted keyboard users must tab through the whole page to reach them, and the fixed top-right stack can cover focused header controls (2.4.11).
5. **NOW line `aria-live="polite"`** changes on every narration step, so it will chatter constantly while the agent works. Throttle it and let the user choose verbosity.
6. **Timeouts (2.2.1).** Approvals expire silently after 30 min. Add warning, extend and expired states.
7. **Live thumbnails (2.2.2).** The Crew grid shows N live screens updating in parallel with no pause. `prefers-reduced-motion` kills CSS animations (good) but not frame updates.
8. **Target size (2.5.8).** The ✕ buttons (Forget memory, Delete task, Remove skill, Dismiss) are glyph-only and probably under 24 px. Also check the "Beam to…" chip (11 px text, `py-1`) and the "Open Beamhop when I log in" checkbox.
9. **Structure (1.3.1).** Settings section titles ("BRAIN", "AUTONOMY") are styled divs. Use real headings (h2/h3), and wrap the Autonomy radios in a `fieldset` with a `legend`. Recent-run ✓/✕ uses `aria-label` on a `span`, which is unreliable; use visually hidden text.
10. **Good already.** Drag-to-dock has non-drag alternatives (the "Beam to…" menu and the **B** key, which is active only on focus, so 2.1.4 is satisfied). There's a global `prefers-reduced-motion` reset. Error messages use `role="alert"`, the state chip has icon + text (not colour alone), and Telegram pairing by QR avoids typing tokens.

### 4.3 Accessibility requirements checklist for Beamhop

**Crew (home) screen**
- [ ] Agent grid: either one tab stop per card in a simple list (fine up to about 8 agents), or an APG grid with roving tabindex (arrows between cards, Enter opens, B beams, A goes to pending approvals) for larger crews. Announce position ("2 of 5").
- [ ] Card = `<article aria-labelledby=name>` with a visible heading, a primary "Open Atlas" control, and secondary controls as siblings. No nested interactive inside a focusable div.
- [ ] Live thumbnail: `role="img"` + `aria-label="Atlas's screen: bol.com, e-bike search results (updated 14:02)"`, built from the page title/URL the agent already knows. Frames otherwise `aria-hidden`.
- [ ] "Pause live previews" toggle (2.2.2). Auto-on when `prefers-reduced-motion: reduce` or `prefers-reduced-data`. Resume to the *current* frame.
- [ ] Sort order changes (stuck agents float to the top in `crew.tsx`) must not move focus. Announce "Atlas now needs you" once, politely.
- [ ] Dock: keep the drag targets, keep the Beam menu as the equivalent (2.5.7). Add `scroll-padding-bottom` equal to the dock height so focused cards are never hidden (2.4.11).

**Agent view (live screen)**
- [ ] **Two-mode keyboard model.** Focusing the screen does *not* capture keys. Pressing Enter or clicking enters "Typing on Atlas's computer" mode, which is announced. A visible hint plus `aria-describedby` says "Press Esc twice to stop typing here." A single Esc is forwarded after a 400 ms wait. Tab is captured only in that mode. Avoid modifier+Esc chords (OS conflicts per APG).
- [ ] Visible focus ring of at least 2 px at ≥3:1 around the screen when focused, and a different style (e.g. a cyan "KEYS → ATLAS" badge) while capturing.
- [ ] Text alternative: the NOW line is linked with `aria-describedby`. Add a **"Describe screen"** button (the agent reads its own page text/DOM first, which is cheaper and more accurate than vision, and shows the cost) and "Read page text".
- [ ] Narration verbosity setting: *Off / Important only (default) / Every step*. Throttle announcements to at most one every 8–10 s, and merge steps ("Searched 3 shops").
- [ ] "Pause & let me drive" / "Let Atlas continue": state exposed via `aria-pressed`, a keyboard shortcut, and an announcement on change. The "You're driving" banner text is reachable.
- [ ] Remote pointer cursors ("you" / agent) are decorative (`aria-hidden`). Don't rely on the custom cursor alone (`cursor-none`); keep a visible native cursor option for low-vision users.
- [ ] Zoom: the screen must scale to 200–400% zoom without horizontal scroll of the page. Offer "fit / 100% / magnify" with pan via arrow keys when not capturing.

**Approvals**
- [ ] A persistent **"Waiting for you (n)" region** (`role="region" aria-label`) at a fixed spot in the tab order, plus a global shortcut (e.g. Alt+Shift+A, avoiding APG conflicts) that moves focus to the oldest pending item.
- [ ] Arrival is announced with `ariaNotify(msg, {priority:"high"})` (or the assertive region as fallback), **without moving focus**. The message is short: "Atlas asks to send an email to Jan. High risk. Alt Shift A to review."
- [ ] Opening an item gives a true modal `alertdialog` (APG): `aria-labelledby` the verb line, `aria-describedby` the payload, initial focus on the **heading or payload, not Allow**. Esc closes without deciding.
- [ ] Allow is disabled for about 600 ms after open, and a visible countdown is exposed as text ("Expires in 28 minutes"). A warning at 2 min and a "Give me more time" button cover 2.2.1. Expired items stay visible as "Skipped: you didn't answer in time".
- [ ] Risk is conveyed by text + icon + colour. Payload text is selectable and copyable. The screenshot has an alt such as "Gmail compose window with the message above".
- [ ] Targets are at least 24×24 px on desktop and at least 44×44 pt on phone (Apple HIG) for Allow/Deny.

**Chat, timeline, settings**
- [ ] Chat list: `role="log"` with `aria-live="polite"` for *incoming agent messages only*, not the user's own echoes. Each message has a sender + time prefix in text. Messages in other languages get a `lang` attribute.
- [ ] Timeline: a list with day headings (`h3`). Each row is one focusable item with Undo as a button. Filters are a toolbar (roving tabindex). Use the `feed` pattern for infinite history.
- [ ] Replay: a media-player-like control. Space toggles, ←/→ step, slider `role="slider"` with `aria-valuetext="Step 12 of 40, 14:03, opened bol.com"`.
- [ ] Settings: real headings; Autonomy as `fieldset`/`legend` radios; inputs with visible labels (not placeholder-only like "e.g. Keep an eye on my inbox…"); `autocomplete` on secret fields; paste allowed (3.3.8).
- [ ] Destructive ✕ buttons: at least 24×24, with an accessible name that includes the item ("Forget 'I prefer replies in Dutch'"), and Undo via a status toast instead of a confirm dialog.
- [ ] Contrast: replace `slate-600` text and use borders ≥3:1 for inputs, toggles and radio outlines. Minimum text 12 px; avoid long all-caps mono.
- [ ] Status messages ("Saved", "Connected as @atlas_bot", beam progress) via `role="status"`. Beam progress uses `role="progressbar"` with `aria-valuetext` ("Sending the encrypted bundle, step 3 of 5").
- [ ] Consistent Help (3.2.6): a "?" in the same place on every screen.
- [ ] Reduced motion: keep the global reset, and also lower the live frame rate and disable the "teleport" filter effects during beaming.

**Phone / remote**
- [ ] Phone page (`phone-v043`): 44 pt targets, the screen collapsible so approvals and chat come first, and an approval card that is reachable without scrolling past the live screen.
- [ ] Telegram/Slack approval messages are plain text first (screen readers in chat apps read text, not images). The image goes in a separate message with a caption.

---

## 5. Onboarding non-technical users

### 5.1 Findings

| Finding | Source |
|---|---|
| Training-wheels interfaces (start with core features, unlock more later): users were **21–26% faster**, learned **21–69% more**, and stayed **52% faster** on advanced tasks later (Carroll). | https://www.nngroup.com/articles/training-wheels-user-interface/ |
| Empty states in complex apps: (1) communicate system status, and don't show "No records" while loading; (2) provide learning cues; (3) provide **direct pathways** (a button that starts the task, or demo data). | https://nngroup.com/articles/empty-state-interface-design |
| Measure **time-to-first-value**, not time-to-first-click. "Three clear examples beat twenty". Ask for configuration only *after* value. Use the user's own context, not generic sample data. Treat latency as an onboarding problem. B2B SaaS average activation is about 37.5%. | https://tianpan.co/blog/2026-04-17-magic-moment-ai-onboarding-converts-skeptics |
| Start autonomy low during onboarding and raise it per task type. | https://smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/ |
| Set expectations early, explain benefits not technology, offer a low-commitment sandbox, and let people correct the system (PAIR). HAX G1 "Make clear what the system can do", G2 "Make clear how well the system can do what it can do". | https://pair.withgoogle.com/chapter/explainability-trust/ , https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/ |

### 5.2 Beamhop first run today (`firstrun-v044.png`, `create.tsx`)

- Step 1 of 2 is **"Pick a brain"**: four provider tiles plus an API-key field ("sk-or-…"). For a non-technical owner this is the hardest decision and it comes *first*, before any value. The escape hatch for ChatGPT/Copilot subscribers is a small-print link.
- The progress bar "Getting your agents' computer ready (first time only): 2 of 7 parts" is good (it shows system status), but there's no time estimate and no way to use the wait.
- The phone empty state (`phone-v043.png`) is good: three concrete suggestions, one of them a routine ("Every morning at 8…").

### 5.3 Patterns to adopt

- **Lead with the job, not the brain.** Screen 1 asks "What should your first agent help with?" with 3 templates (Personal assistant / Research & shopping / Daily briefing) plus free text. Screen 2 is "Give it a brain". Make "Use my ChatGPT subscription" a first-class tile, and give a plain explanation of API keys: "a key is like a prepaid card for the AI; you set a limit; about €0.02 per simple task".
- **Use the provisioning wait.** While the 7 parts download, the user writes the first task and sets the budget. The first task runs the instant the computer is ready. Target: first visible useful result in under 2 min after the key is entered.
- **Let the agent do the setup** (Beamhop already has the prompt recipes in `lib.tsx` for Telegram BotFather and provider sign-up). Offer "Atlas can create the key for you; you'll only type your password and payment yourself" as the first option.
- **Training wheels.** First day: autonomy "Show me the plan first", €1/day cap, no routines until the first task succeeds. Then nudge: "Atlas did 5 tasks without problems. Let it handle low-risk steps on its own?"
- **Empty states with direct paths.** Timeline: "Nothing yet. When Atlas does something important, like sending a message or spending money, it shows up here with an undo button. [Give Atlas a task]". Memory: "Atlas hasn't learned anything about you yet. Tell it one thing: [I prefer replies in Dutch]". Approvals: "Nothing waiting. Atlas asks before payments, messages to new people, deletes and logins."
- **One concept per screen**: the Crew screen shouldn't show "Add a cloud / Open an agent file / drag to move" until there is more than one agent or the user asks. Progressive disclosure of the beaming metaphor.

---

## 6. Concrete ideas for Beamhop (prioritised)

**P0: safety and compliance**
1. **Fix the keyboard trap.** Use the two-mode screen focus (navigate vs. "typing on Atlas's computer"), an exit by Esc ×2, a visible plus `aria-describedby` hint, and a mode badge (WCAG 2.1.2).
2. **Structured approval payloads.** Extend `approval.request` with `kind` (message/payment/login/delete/open/other), `risk` (low/med/high), `reversible`, `payload` (typed fields), `origin` (chat/task/page URL), `costSoFar` and `expiresAt`, enforced in the tool layer, not only the system prompt. Render the anatomy in §1.3 on desktop, phone and Telegram.
3. **Approval queue instead of toasts.** A persistent "Waiting for you" region, an `ariaNotify` announcement, no auto-focus, a 600 ms anti-misclick delay, and modal review per APG. Stops accidental approvals from keystrokes aimed at the remote screen.
4. **Expiry that's visible and safe.** A countdown and warning, "Give me more time", and timeout = deny + "Atlas skipped it and told you". The agent gets the denial as an instruction to find a safer route.
5. **Money caps on by default.** €/day per agent plus a €/month crew cap. Alerts at 50/75/100%. At 100%, pause and ask in chat with [Allow €1 more] / [Stop for today]. Show period labels everywhere ("today").

**P1: trust and transparency**
6. **"Show me the plan first"** replaces "Ask me first — every action". It produces an editable Intent Preview (Proceed / Edit / I'll do it), and only off-plan or irreversible steps interrupt.
7. **Scoped "Always allow…"** by kind × target × duration (today / this routine / always), listed on a **Permissions** page with Revoke. Never offered for payments or credentials.
8. **Approval-health meter.** Track approve rate, time-to-decide and payload expansion per kind. Suggest automation (with undo) when a kind passes 95% approval, and add friction when High items are approved in under 1.5 s.
9. **Routine mandates.** A schedule carries bounds (who it may message, max € per run, allowed sites, expiry) approved once, like an AP2 Intent Mandate. Runs within bounds are silent; anything outside escalates.
10. **Unified Timeline with Undo.** Meaningful events only (messages, money, logins, deletes, memory and settings changes, approvals with "decided by you on Telegram"). Undo windows: "Undo for 10 min". Low-level clicks fold into steps.
11. **"While you were away" digest.** On return, and optionally as a 1–3×/day Telegram summary: flags first, then outcomes, spend and notable actions. Each run uses *Did / Assumed / Couldn't find / Cost* (specification format, which beat flowcharts in accuracy).
12. **Replay with captions.** Scrub keyframes per tool call with narration captions. Fully keyboard operable. Linked from any timeline row ("see what happened").
13. **"What Atlas knows about you"** grouped memory with provenance ("learned 3 Nov from Telegram"), reach ("stays inside Atlas, travels when beamed"), a "Memory updated · Undo" chip inline in chat, and Undo on Forget.
14. **Safety posture in the header.** A shield (Good / Look at this / At risk) next to the state chip, covering autonomy, caps, standing grants, logged-in sites, internet skills and unpaired channels. Each issue links to its one-click fix.
15. **Send-delay for autonomous messages.** In "Never ask" or under a standing grant, outgoing messages wait 20–30 s in an "Outbox" with Cancel/Edit (Gmail-style undo send), turning irreversible actions into reversible ones.

**P2: cost, accessibility polish, onboarding**
16. **Forecast and total cost of ownership.** "At this pace ~€38/month (AI €17 + cloud €21)", shown after 7 days of history. Per-run and per-routine costs ("≈ €1.80/month").
17. **Loop/runaway breaker.** Auto-pause on repeated identical steps or a spend-per-minute spike, with "Atlas seems stuck on the login page (12 tries, €0.40). [Take over] [Stop]".
18. **Chat approvals done right.** Telegram: a text-first message with payload and risk, then a photo with caption. After a decision, `editMessageText` to "Approved by you (desktop) 14:02" with the buttons removed. "Deny + reason" via force-reply. High-risk items say "Approve in the Beamhop app" (step-up).
19. **Describe-screen button and narration verbosity** setting for screen-reader and low-vision owners (A11y-CUA). The agent reads its own DOM text before falling back to vision, and the cost is shown.
20. **Pause live previews** on the Crew grid (2.2.2), automatically when reduced motion or data saver is set. This also cuts bandwidth and CPU.
21. **Contrast and target-size sweep.** `slate-600` → `slate-400`, input borders at ≥3:1, ✕ buttons at 24 px with item-specific names, 12 px minimum text, real headings and fieldsets in Settings.
22. **Job-first onboarding.** "What should your agent help with?" comes first, then the brain (ChatGPT subscription first-class, "Atlas can make the key for you"). Write the first task while the computer provisions; first result in under 2 min; training-wheels defaults on day one.
23. **Export before remove.** The "Remove Atlas" dialog offers "Save a copy as a file first", or a 7-day "Recently removed" soft delete.

---

## 7. Sources (all fetched or listed during this research)

Approvals and agents
- Anthropic, Claude Code auto mode (engineering): https://www.anthropic.com/engineering/claude-code-auto-mode
- Habituation curve of agent permission prompts: https://tianpan.co/blog/2026-04-28-agent-permission-prompt-habituation-curve
- Humans miss a third of dangerous agent requests (The Register summary): https://daily.dev/posts/humans-in-the-loop-miss-a-third-of-dangerous-ai-coding-agent-requests-823tnlnkc
- Smashing Magazine, Designing for Agentic AI (Feb 2026): https://smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/
- 10 HITL tool approval patterns: https://www.kunalganglani.com/blog/tool-approval-patterns-ai-agents
- Approval fatigue and permission UX: https://www.buildmvpfast.com/blog/approval-fatigue-agent-permission-ux-2026
- OpenAI, Introducing ChatGPT agent: https://openai.com/index/introducing-chatgpt-agent/
- Claude for Chrome safety: https://claude.com/resources/articles/claude-for-chrome
- Magentic-UI (Microsoft Research, arXiv 2507.22358): https://arxiv.org/html/2507.22358v1
- Comparing Human Oversight Strategies for Computer-Use Agents (arXiv 2604.04918): https://arxiv.org/abs/2604.04918
- Unintended consequences in human–GUI agent collaboration (arXiv 2505.09875): https://arxiv.org/html/2505.09875v2
- AP2 core concepts: https://ap2-protocol.org/topics/core-concepts
- HumanLayer: https://github.com/gptenv/humanlayer

Transparency and trust
- Overseeing Agents Without Constant Oversight (UW/MSR, arXiv 2602.16844): https://arxiv.org/html/2602.16844v1
- Google PAIR, Explainability + Trust: https://pair.withgoogle.com/chapter/explainability-trust/
- Microsoft HAX guidelines: https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/ and paper https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/
- Reviewing agent work after the fact: https://crystl.dev/blog/reviewing-agent-work/
- Fitz et al. 2019, batching notifications: https://communities.springernature.com/posts/batching-notifications-can-improve-attention-well-being-and-productivity
- Apple HIG, Managing notifications (interruption levels): https://developer.apple.com/design/human-interface-guidelines/managing-notifications
- OpenAI Memory FAQ (fetch blocked; referenced for pattern only): https://help.openai.com/en/articles/8590148

Cost
- Vercel Spend Management: https://vercel.com/docs/spend-management
- Cursor spend alerts: https://cursor.com/help/account-and-billing/spend-alerts.md
- OpenRouter spend controls: https://openrouter.ai/docs/guides/best-practices/spend-controls
- AWS Budgets best practices: https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-best-practices.html

Accessibility
- WCAG 2.2 Understanding: 2.1.2 https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html · 2.2.1 https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html · 2.2.2 https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html · 2.4.11 https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html · 2.4.13 https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html · 2.5.7 https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html · 2.5.8 https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html · 3.3.8 https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html · 4.1.3 https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
- WAI-ARIA APG: alertdialog https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/ · keyboard interface https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/
- Sara Soueidan, live regions part 2: https://sarasoueidan.com/blog/accessible-notifications-with-aria-live-regions-part-2
- ariaNotify: https://web-platform-dx.github.io/web-features-explorer/features/arianotify/ · https://blogs.windows.com/msedgedev/2025/05/05/creating-a-more-accessible-web-with-aria-notify/
- A11y-CUA dataset (arXiv 2602.09310): https://arxiv.org/html/2602.09310

Onboarding
- NN/g training wheels UI: https://www.nngroup.com/articles/training-wheels-user-interface/
- NN/g empty states in complex apps: https://nngroup.com/articles/empty-state-interface-design
- AI onboarding "magic moment": https://tianpan.co/blog/2026-04-17-magic-moment-ai-onboarding-converts-skeptics

---

## 8. Summary (10 lines)

1. Approval prompts decay into rubber stamps (93% accepted; about 1 in 3 malicious requests approved), so Beamhop should ask *less often*, *at the decisive moment*, and *with the real payload*.
2. Today's approvals carry only `title/detail/shot`. Add kind, risk, reversibility, typed payload, origin, cost and expiry, and enforce them in the tool layer.
3. Replace per-click "Ask me first" with an editable plan ("Show me the plan first"), scoped "Always allow" grants, and routine mandates with bounds and TTL (AP2-style).
4. Timeouts must be visible, extendable, and default to deny. Chat approvals need payload text, a "decided elsewhere" echo, and step-up for payments.
5. A unified Timeline with Undo, a "while you were away" digest (flags first; Did/Assumed/Couldn't find/Cost) and keyframe Replay beat raw activity logs, which can inflate false confidence.
6. Memory needs provenance, reach and undo. Safety posture belongs in the header, not collapsed in Settings.
7. Budgets should be money-first, capped by default, with 50/75/100% alerts, pause-and-ask at the cap, forecasts including cloud cost, and a loop breaker.
8. Accessibility blocker: the agent screen is a WCAG 2.1.2 keyboard trap. Also fix the decorative `alt=""` on live screens, misused non-modal `alertdialog` toasts, chatty live regions, `slate-600` text (2.44:1) and 1.31:1 input borders.
9. Use `ariaNotify` (Baseline 2026) without stealing focus, an approval queue landmark with a shortcut, pausable live previews (2.2.2), 24 px targets, and "Describe screen" plus narration-verbosity settings for blind and low-vision owners.
10. Onboarding should lead with the job rather than the API key, use the provisioning wait to write the first task, aim for a useful result in under 2 min, and start with training-wheels defaults (plan-first, €1/day).
