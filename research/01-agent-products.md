# 01 — Agent products with a live computer: UX/UI competitive research

Research date: 14 Nov 2026. Scope: products where an AI agent drives a computer or browser, or runs as a persistent assistant in chat apps. For each one: the first-run journey, layout, how it shows what the agent is doing, take-over, approvals, notifications, multi-agent views, mobile, onboarding, cost visibility and failure handling.

Source tags. **[S]** means the claim comes from the linked page, fetched this session. **[M]** means it comes from my own knowledge of the product's launch demos and was not re-verified this session. Treat [M] as a hypothesis to check by using the product.

Market context (late 2026). OpenAI has retired the standalone "ChatGPT agent" and folded it into **ChatGPT Work** (Chat / Work / Codex in one desktop app, with a built-in browser, Computer Use and a picture-in-picture view). Anthropic merged Chat and Cowork into one conversation in Sept 2026 because "customers often struggled to pick the right tab". Perplexity added a "mission control" for background tasks. Manus moved to a desktop app called Manus Studio. The direction everyone is moving in: **one conversation surface, agents running in the background, and the screen as something you glance at, not the main view.**

---

## 0. Beamhop today (baseline, from `research/shots/*.png` and AgentView in App.tsx v0.48)

| Surface | What it does now | Problem against the market |
|---|---|---|
| Crew home (`home-v048`) | 3 identical cards, about 440×270 each, showing a screenshot of each agent's idle "Atlas / Ready for a task" page; "Ready" appears twice per card; "THIS COMPUTER" in mono caps; a dock at the bottom: "WHERE YOUR AGENTS LIVE · DRAG ONE HERE TO MOVE IT" | About 80% of each card is a screenshot that says nothing. No "needs you", no last result, no next run. Every competitor's multi-agent view is status-first (Copilot task view, Cursor "1 working · 1 waiting", Zapier "Needs action"). |
| First run (`firstrun-v044`) | Modal titled "Pick a brain" with 4 provider buttons and an API key field; a progress bar for downloading "2 of 7 parts" | The first screen asks for an API key. OpenClaw's #1 complaint is the same setup cliff. Hermes now offers `hermes setup --portal` (one OAuth). Operator and ChatGPT open with suggested tasks. |
| Agent view (`settings-v040`) | Screen 1280×800 on the left (about 72% of the width); a 384px column on the right that holds either chat or settings; header shows "8% CPU · 1.3/7.8 GB · $0.00 spent"; "Pause & let me drive" pill at the bottom-left of the screen; approvals are amber toasts fixed at the top-right | The screen is the main view even when idle. Settings replaces chat. CPU and RAM are developer telemetry. Approvals float outside any queue and are lost when you navigate away. |
| Settings | "Daily token limit 1000000", "Autonomy: Ask me first / Risky only / Never ask", Slack `xapp-`/`xoxb-` token fields, a "Brain" model id string | Jargon. Zapier and Claude replaced global autonomy radios with scoped rules plus fixed floors that can't be overridden. |
| Phone (`phone-v043`) | Screen on top, three suggestion chips, `▶ ACTIVITY (1)` collapsed in mono caps | Fine bones. The activity log is hidden; there's no approval or "done" pattern. |
| Visual language | Navy-black background, cyan→violet gradient CTA, mono uppercase micro-labels, glowing robot mascots, dashed "+ Add a cloud" boxes | This is the "AI slop" look the owner means: generic dark sci-fi palette, labels in every typeface style, low information density. The leading products (ChatGPT, Claude, Copilot) use neutral surfaces, one accent colour, and content first. |

---

## 1. Per-product findings

### 1.1 OpenAI Operator → ChatGPT agent → ChatGPT Work

**Journey.** Operator (Jan 2025) opened on a ChatGPT-like home that said "What can I help you **do**?", with partner-site suggested tasks below the fold [S: every.to]. ChatGPT agent (Jul 2025) is chosen from the composer's Tools menu or by typing `/agent`. A tooltip near the menu shows how many agent prompts you have left [S: dev.to walkthrough]. A first useful result took about 2–3 minutes for simple research and 15–30 minutes for complex work [S: aitoolanalysis].

**Layout.** In Operator, chat sat on the left and the live browser on the right, the same pattern as Anthropic's computer-use demo [S: Simon Willison]. TechCrunch described it as "a small window will pop up showing a dedicated web browser" [S]. The **ChatGPT agent** shows the virtual computer as an inline frame inside the chat turn, with narration above it, and you click it to expand [M]. ChatGPT Work's desktop app adds **picture-in-picture** "so you can keep an eye on Computer Use while it works" [S: testingcatalog]. The screen is always a secondary, glanceable element in this product line.

**What it's doing.** "On-screen narration" gives "visibility into exactly what ChatGPT is doing" [S: openai.com]. ChatGPT Work shows "the plan … before execution starts" [S: Gopanapalli].

**Take-over.** "Interrupt and take control of the browser whenever needed". You can redirect mid-task "without losing previous progress". Logins go through "… → Take over browser". **No screenshots are captured during takeover**, and after hand-back the agent "attempts to continue from the prior workflow state" [S: help.openai.com]. Reviewers called the takeover picture "fuzzy and awkward" [S: aitoolanalysis].

**Approvals.** The agent asks permission before "actions with real-world consequences". **Watch Mode** means some sites (email) "require your active oversight" [S]. Operator's prompt-injection monitor pauses the run with a dialog, **"Review potential risk to resume task"**, that **quotes the suspicious text** and offers "Keep paused" / "Mark safe and resume" [S: Simon Willison]. Testers said confirmations were "frequent" and called them a source of friction [S: aieducation].

**Notifications and scheduling.** A phone push arrives when the task is done [S: openai.com]. After a task finishes, a **Clock icon** lets you repeat it daily, weekly or monthly; everything is managed at `chatgpt.com/schedules` (pause, edit, delete) [S: help.openai.com]. iOS notifications now open the completed task directly [S: releases.sh].

**Cost.** A message quota (Plus 40/month, Pro 400). "Only initial user-initiated agent requests count", so clarifications and logins are free [S].

**Failure.** For long or stuck tasks you can "pause, request a progress summary, or stop it and get partial results" [S]. Complaints: a "loop for 45 minutes" on a 5-minute task, CAPTCHAs need a human, results needed "multiple human interventions" [S: aitoolanalysis], and a context-limit error after about an hour [S: MacStories]. Operator saved finished tasks as reusable workflows, and the session video was called "sleek" [S: every.to].

Sources: https://openai.com/index/introducing-chatgpt-agent/ · https://help-lb.openai.com/en/articles/11752874-chatgpt-agent · https://simonwillison.net/2025/Jan/23/introducing-operator/ · https://every.to/chain-of-thought/we-tried-openai-s-new-agent-here-s-what-we-found · https://techcrunch.com/2025/01/23/openai-launches-operator-an-ai-Agent-that-performs-tasks-autonomously · https://aieducation.substack.com/p/operator-can-ai-learn-to-use-a-computer · https://aitoolanalysis.com/chatgpt-agent-mode-review/ · https://www.macstories.net/notes/some-early-tests-and-notes-on-chatgpt-agent/ · https://www.testingcatalog.com/openai-launches-chatgpt-work-for-pro-enterprise-and-edu-plans/ · https://manojgopanapalli.substack.com/p/deep-dive-chatgpt-work · https://dev.to/proflead/chatgpt-agent-mode-full-walkthrough-1f0m

### 1.2 Anthropic: computer-use demo, Claude in Chrome, Cowork (+ Dispatch, scheduled tasks, computer use)

**Computer-use reference demo (2024).** A web UI with chat plus "a large noVNC panel showing exactly what was going on". The chat narrates steps with screenshots interleaved, the desktop runs at 1280×800, and there's a red "Caution" box about prompt injection [S: Simon Willison]. **Beamhop's current agent view is essentially this developer demo layout.**

**Claude in Chrome.**
- The side panel "stays visible while you browse".
- Tabs Claude opens go into a **separate tab group with its own colour**, and you can drag tabs into Claude's group to share them.
- Good prompts can be saved as `/` shortcuts and scheduled from a clock icon (daily, weekly, monthly, annually). A record button lets you teach a workflow by demonstration (classic panel only) [S: support 12012173].
- Permission modes: **Manually approve / Automatically approve (default) / Skip all approvals**. In manual mode Claude writes a **plan listing the sites it will visit** with "Approve plan" / "Make changes", and after approval it won't leave those sites without asking.
- Per-site prompt "New permissions required": "Allow this action" / "Always allow actions on this site" / "Decline" (Cowork's panel words it "Allow all for this website / Allow this time only / Deny").
- Even with "always allow" it still asks before downloads, sensitive input, or granting authorizations.
- **Prohibited regardless of mode:** purchases, creating accounts, handling card or ID data, following instructions found in emails or web content.
- Revoking access lives under Settings → "Your approved sites" plus a **permission history** [S: support 12902446].

**Cowork (Jan 2026 → now).**
- Three columns: a left sidebar ("+ New task", task list); a main transcript with expandable "Running command" blocks; a right sidebar with **Progress** (circular step markers, "Steps will show as the task unfolds"), **Artifacts**, **Context** (selected folders, connectors) and **Working files** [S: Simon Willison].
- Critique: the right sidebar couldn't be closed, so artifacts were "cramped into a thin column". Simon also called it unfair to ask non-programmers to watch for "suspicious actions that may indicate prompt injection" [S].
- Claire Vo praised that "the way Cowork surfaces Steps, Progress, and Questions is elegant". She disliked that intermediate files (JS, HTML slide pages) were exposed ("If I'm a non-technical user, do I want to see this?"), found terminal errors alarming, thought it asked for confirmation too often, and hit a connector failure on her starter task [S: coworkhow].
- **Scheduled tasks**: `/schedule` in any chat runs a conversational setup (Claude asks questions with options), or you use the "Scheduled" sidebar form (name, prompt, cadence, model, folder). You can see **upcoming and past runs**, pause, resume, or run now. The prompt is rewritten after the first run based on what Claude learned. Tasks run in the cloud when no local folder is attached, "even when your computer is off" [S: aiblewmymind].
- **Dispatch**: one **persistent thread** that "doesn't reset", synced phone↔desktop. Pushes arrive when "a task is done or when Claude needs your go-ahead", and it reports outcomes rather than steps. Limits: "your computer needs to be awake and the Claude Desktop app open", and there's only one thread [S: support 13947068]. Tom's Guide: "there is no 'Dispatch' button", setup is strict, and the reviewer was unsure whether checking the output erases the time saved [S].
- **Computer use in Cowork**: Claude asks permission **per application**, and asks before taking the full screen the first time in a session. On macOS 15+ it works in background windows by default and "generally waits if you're in the middle of typing". Trading and crypto apps are blocked by default, and there's a user blocklist. Tool priority: connectors, then browser, then screen [S: support 14128542].
- Sept 2026: Chat and Cowork merged into one conversation, because users struggled to pick the right tab. Memory was unified on 25 Aug [S: sqmagazine]. "Live artifacts" (dashboards that refresh when reopened) shipped in April 2026 [S: yourstory].

Sources: https://simonwillison.net/2024/Oct/22/computer-use · https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome.md · https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide · https://simonwillison.net/2026/Jan/12/claude-cowork/ · https://coworkhow.com/blog/claire-vo-cowork-review · https://aiblewmymind.substack.com/p/claude-cowork-scheduled-tasks-6-ways · https://support.claude.com/en/articles/13947068-assign-tasks-from-anywhere-in-claude-cowork · https://www.tomsguide.com/ai/i-sent-claude-a-task-from-my-phone-and-it-finished-it-on-my-laptop-without-me-touching-a-thing · https://support.claude.com/en/articles/14128542-let-claude-use-your-computer-in-cowork · https://sqmagazine.co.uk/anthropic-merges-claude-chat-cowork-one-interface/ · https://yourstory.com/ai-story/claude-cowork-live-dashboards-ai-bi-disruption

### 1.3 Manus (→ Manus 2.0 / Studio)

**Layout.**
- Three panes: a task list on the left, chat in the middle, and a right panel called **"Manus's Computer"**. Its header says which tool is in use ("Manus is using Browser / Terminal / Editor"). Below the screen sits a **playback scrubber with a "Jump to live" control**. A collapsible plan sits above the composer with a "3/7" step counter [M].
- Teardown details [S: aiuxplayground]: a floating status chip above the composer reads "Manus is working" **with an elapsed timer (0:08)**, but has **no cancel control**. You can send messages mid-run to steer. File-edit cards are collapsed by default. A completion chip reads "✓ Read and summarize… 1/1" and ties the output back to the request.

**Replay and share.** You can replay past sessions [S: techjockey]. Public replay links were Manus's main growth loop at launch [M].

**Take-over.** "Manus will prompt users to take over when it requires assistance", or you can take over yourself; it covers browser and VS Code [S: help.manus.im]. It "picks up exactly where it left off" after CAPTCHA or MFA, and flags you instead of "failing silently" [S: lindy.ai].

**Plan.** "Reverse prompts": Manus proposes a plan and asks clarifying questions, but five questions at once was confusing. It also offered an "enable confirm before proceeding" rule pop-up [S: uxdesign.cc].

**Multi-agent.** **Wide Research** fans out to parallel instances and returns "a structured spreadsheet with citations" where "every row is filled with the same depth" [S: lindy.ai]. Pro allows 20 concurrent tasks [S: preuve].

**Manus 2.0.** "Tell Manus what you need from your phone and watch it work on your desktop". "With Computer Use, Manus works in its own workspace on your computer while you stay in yours" [S: manus.im/desktop]. Event triggers (new email, Slack message, calendar, Notion) plus an always-on paid "Cloud Computer" [S: preuve].

**Cost (the dominant complaint).**
- "One prompt to build a website used over 6000 credits". Cost is unknown before running. Credits are deducted even when the result is wrong; refunds only cover "technical issues on our end".
- Trustpilot 1.2/5 (94% one-star): bot-only support, surprise annual charges [S: preuve].
- The UX critic asked for an **estimated cost plus confirmation before execution**, and a dispute path [S: uxdesign.cc].

**Progress theatre.** "Green checkmarks across the board" while the built app "looked like it was designed in 2005" [S: lindy.ai].

Sources: https://aiuxplayground.com/teardowns/manus/output · https://uxdesign.cc/manus-ai-real-or-hype-404254922290 · https://preuve.ai/blog/manus-ai-review · https://www.lindy.ai/blog/manus-ai · https://help.manus.im/en/articles/11711218-how-can-i-take-over-manus-browser-or-vs-code · https://manus.im/desktop · https://www.techjockey.com/blog/how-to-use-manus-ai

### 1.4 Perplexity Comet

**Layout.** The assistant sidebar sits next to the page and reacts to what you're viewing. Reasoning streams "live in the side panel". **A glow appears on the page while the agent acts.** It can work in one tab while you work in another ("without grabbing your attention") [S: androidauthority].

**Approvals.** Staged: "built incrementally, category by category with my approval". It surfaced an availability conflict before checkout. "The breakthrough wasn't speed — it was control" [S: uxdesign.cc].

**Background assistant (Oct 2025).** "A team of assistants working for you", tracked from a central dashboard called **"mission control"**. You can step in to finish a task (for example, send the email) or take over, and you get a notification on completion [S: TechCrunch].

**Failures.** Silent constraint violations ("cilantro seeds" instead of fresh cilantro, wrong dates). About 70% success on simple tasks and about 30% on complex ones. It looped for minutes when an item wasn't available in the user's region. Slower than Chrome [S: uxdesign.cc, androidauthority]. Brave documented prompt injection [S].

Sources: https://uxdesign.cc/what-perplexitys-ai-browser-reveals-about-ux-s-future-d7a702529a4a · https://www.androidauthority.com/perplexity-comet-hands-on-3577968 · https://techcrunch.com/2025/10/02/perplexitys-comet-ai-browser-now-free-max-users-get-new-background-assistant/

### 1.5 Genspark (Super Agent, AI browser, phone calls)

- Mixture-of-agents with a reflection step. The "AI phone call" feature places real calls: about 83% success over 47 calls, with failures on phone menus, at about 1 credit per second.
- Everything is metered in credits with no rollover, and the pricing page is login-gated.
- Trustpilot about 1.5/5: "burnt 42% of my genspark credits in the first hour", "3500 credits gone within minutes".
- Praised for slides [S: eesel]. (The source is a competitor, so the bias is noted.)
- Lesson: **an agent that phones people needs a call transcript plus a recording as its "screen".**

Source: https://www.eesel.ai/blog/genspark-ai-review

### 1.6 Devin (Cognition)

**Layout.** The session view has Shell / IDE / Browser tabs; Browser becomes **"Computer"** when computer use is on. A **Progress tab** is "one unified view" of commands, edits and browser actions, and clicking a step jumps there.

**Time travel.** Shell history is a time scrubber: click a command to jump to that moment, and **"greyed-out commands run at a future point in time"** when you're scrubbed back.

**Side chats.** `/btw` or the hover menu opens a read-only side chat **without interrupting the main run**.

**Take-over.** "Stop the session to take over" in the IDE, then "tell Devin about your changes when you resume". The Interactive Browser is for CAPTCHAs and MFA. "Save the browser profile" proposes a one-time blueprint update that you approve, so logins persist across sessions [S: docs.devin.ai].

**Cost.** ACUs. Sessions **sleep after about 0.1 ACU idle, and "sleeping sessions do not consume usage"**; a message wakes them. Session Insights labels sessions **XS–XL** and flags L/XL as unhealthy, but only after the session completes; there's no live meter [S: fast.io].

Sources: https://docs.devin.ai/work-with-devin/devin-session-tools · https://fast.io/resources/devin-acu-guide/

### 1.7 Replit Agent 3

- **App Testing**: a browser preview in the Agent pane where you "watch Agent's cursor". Afterwards you **replay the session as a video with sliders to jump to sections**. When blocked (for example, by a login), it shows a **"Begin take over"** button and then hands back. "Skip" ends testing, and **after 10 minutes with no response it auto-skips** [S: docs.replit.com].
- **Cost backlash.** Effort-based pricing folds many steps into one charge, so per-step cost disappears.
  - Users reported $1k in a week and $70 in one night.
  - "Can no longer see total charges per conversation, just per prompt"; charges continue after rollback; "kept coding even after they pressed stop".
  - It reset a user's password while testing a form, and redesigned an app nobody asked it to.
  - Users asked for per-app spend, separate plan/test/build modes, and the option to go back to Agent 2 [S: The Register, Replit forum].

Sources: https://docs.replit.com/replitai/app-testing · https://www.theregister.com/2025/09/18/replit_agent3_pricing/ · https://replit.discourse.group/t/agent-3-experience-feedback/7059

### 1.8 Cursor background agents / Cursor 3 Agents window

- **Agents window**: a sidebar listing all local and cloud agents. Agent tabs arrange "side-by-side, in a grid, or stacked". Each cloud agent gets "its own full development environment with a desktop, browser", and agents "record video demos of their completed work". **"Agent sessions can migrate between cloud and local environments"**, including pushing local to cloud "to keep running after you close your laptop" [S: dev.to Cursor 3 review].
- Web and mobile: an installable PWA, follow-ups, one-click "open in desktop" [S: forum].
- iOS **Live Activity** shows "1 working · 1 waiting" on the lock screen. There's a bug report that it showed Waiting while the agent was working, and users expect the summary to "match the agent's real state" [S: forum 172561].
- Complaint thread: "difficult to know when agent is done". The old end-of-turn markers disappeared and the completion chime was flaky. Users asked for "an icon … after the completion of the last output". OS notifications were added in 1.5 [S: forum 129431].
- The switch to credit pricing "confused many users" [S].

Sources: https://dev.to/jangwook_kim_e31e7291ad98/cursor-3-review-background-agents-and-the-agent-first-ide-7me · https://forum.cursor.com/t/introducing-cursor-on-web-mobile/111183 · https://forum.cursor.com/t/cursor-ios-agents-live-activity-shows-waiting-while-agent-is-actively-working/172561 · https://forum.cursor.com/t/difficult-to-know-when-agent-llm-are-done-working-on-prompt/129431

### 1.9 GitHub Copilot coding agent ("mission control")

- One centralized view where session logs sit beside the **Overview** and **Files changed** tabs.
- "See task status at a glance and jump in when Copilot needs your input".
- **Steering mid-session: a typed message is applied "as soon as its current tool call completes"** (no restart needed).
- You can comment inline in Files changed.
- Tasks can be started from many entry points (agents panel, `/task` in chat, GitHub Mobile) and continued in Codespaces, VS Code or the CLI [S: GitHub changelog].
- Jan 2026: an Agents tab in each repository [S].

Source: https://github.blog/changelog/2025-10-28-a-mission-control-to-assign-steer-and-track-copilot-coding-agent-tasks/

### 1.10 OpenClaw (ex-Clawdbot / Moltbot)

- **The UI is your chat app** (Telegram, WhatsApp, Slack, Discord, iMessage…). You text it "like a colleague". **Heartbeats** (cron) send a morning brief to Telegram around 6–8 AM. Reviewers call it "Claude with hands", and it messages you proactively [S: taskade, elephas].
- **Setup cliff.** It needs Docker, Node and API keys. The creator says: "Most non-techies should not install this." Claire Vo's first install "took 8 hours and deleted her family calendar". Her fix was a **permissions ladder**: separate machine and fresh Gmail → read-only calendar → email drafts that need approval [S: taskade].
- **Security defaults.** 900+ gateways were exposed, some with zero auth [S: elephas].
- **Cost.** $300 in 2 days; 180M tokens estimated at $2.7–5.4k [S: elephas].
- **Control UI.** Session rail, Details panel (environment, changes, background tasks), Processes with **Stop**, Subagents, and Automations / Dashboards / Sessions / **Usage** pages. Devices are paired with a copied setup code. "Approval queues stay in memory during a disconnect" and approving needs a live connection [S: docs.openclaw.ai].
- Users report "command execution approval workflows are inconsistently triggered or bypassed in Telegram direct messages", plus context loss during compaction or channel switches, and cron jobs that fail to deliver [S: ReadYourUsers W14].
- Power users vibe-code their own **"Mission Control"** dashboards: an approval queue for drafts, subagent tracking, live status (working / thinking / idle), deliverables, action logs and weekly security audits. One AI-written post claimed its human "will forget the dashboard exists within 48 hours" (treat as anecdote) [S: taskade].

Sources: https://www.taskade.com/blog/moltbook-clawdbot-openclaw-history.md · https://elephas.app/blog/opean-claw-clawdbot-viral-launch · https://docs.openclaw.ai/web/control-ui.md · https://study8677.github.io/ReadYourUsers/en/archive/2026-W14/openclaw-openclaw.html

### 1.11 Hermes Agent (Nous Research)

- A desktop installer, or a curl one-liner. **`hermes setup --portal`: one OAuth covers a model plus web search, image generation, TTS and browser**, with no API-key juggling.
- One gateway for 20+ platforms. Built-in cron "with delivery to any platform".
- Six sandbox backends (local, Docker, SSH, Daytona, Modal, Vercel). Daytona and Modal **hibernate when idle**.
- "Bot Mode" runs named bots, each with its own model, memory and skills [S: hermes docs].
- Reviewers praise memory that is **inspectable and deletable** (`hermes memory forget <keyword>`), which is why a legal team chose it.
- **Auto-skills**: a nightly job writes markdown skills from repeated failures; the reviewer recommends reviewing them weekly.
- Complaints: 118 skills including about 28 redundant ones, and 3–5K tokens of manifest loaded at every startup [S: heyuan110].

Sources: https://hermes-agent.nousresearch.com/docs · https://www.heyuan110.com/posts/ai/2026-04-24-hermes-agent-v010-deep-review/

### 1.12 Lindy

- Most praised for ease of use (125 of 171 G2 reviews mention it) and its template library.
- **The iMessage/SMS assistant is "the best version of the product"**: text "move my 2pm to Thursday", send voice notes, or a screenshot of someone's availability.
- Draft-and-approve by default ("Nothing goes out without your approval"), with per-action confirmation toggles you loosen over time.
- Credits are a "black box" and per-step cost is only visible afterwards. Hitting the limit pauses the assistant; overage is opt-in at 2×.
- Failures: a Gmail send loop burned "thousands of credits in failed loops"; a silent filter hid Zoom invites ("I missed a few important meetings"); support email bounces [S: usecarly].

Source: https://www.usecarly.com/blog/lindy-ai-review/

### 1.13 Zapier Agents + Sidekick (the best-documented approval design)

- **Statuses.** Needs action / In progress / Failed / Cancelled / Completed (+ Test), shown on each Activity row. Approvals count as "Needs action" [S: Zapier help].
- **Sidekick's published approval design** [S: zapier.com/blog]:
  1. The buttons went from "Block / Once / Always" to **scope-naming buttons** ("Allow editing files for this chat"). The shipped card is **Cancel / Allow / Allow and configure rule**.
  2. **Approvals persist server-side and can be answered anywhere, including Slack**, and an inbox collects the ones you haven't answered.
  3. **The review panel sits on the input box, not in the transcript**, so requests aren't buried in scrollback. It stays out of the way until something needs review.
  4. Permission rows read **Allow / Ask first / Deny + scope + "Only when …" + account name**. A friendly label is allowed, but **the real scope always shows underneath it**. A single confirmation line lands in the transcript ("Permission configured: only sending DMs to myself for Slack").
  5. **Floors.** Payments and legal terms are never allowed, sending outside asks first, and changes to the agent's own permissions always ask. "Never" beats "ask first", which beats "allow".
  6. YOLO mode is being retired. Modes only decide what happens when no rule covers an action.
  7. A badly worded reviewer instruction made the agent ask before searching the user's own files, so they now state explicitly that **reading your own data is fine**.
  8. Experiment: **suggested standing permissions** built from your past one-off Allows.

Sources: https://zapier.com/blog/how-much-should-ai-decide-without-asking/ · https://ob-zapier.helpjuice.com/understand-your-agent-s-statuses

### 1.14 Relevance AI

- "Approvals & Escalations": a task list where each row has Approve / Decline, "Let agent decide", or "Approval".
- Escalations go to Slack (#finance-approvals) or email.
- Rules are set in plain language ("Describe when to pause, escalate, or run — no config"), and "feedback on each decision sharpens the next one" [S].

Source: https://relevanceai.com/approvals-escalations

### 1.15 Browser Use Cloud

- Developer infrastructure. `live_view_url` gives a live view the human can take over.
- The agent doesn't pause mid-run: you plan a checkpoint in the task, keep the browser alive (`keepAlive` 120–14400 s, billed), and resume with the same `session_id`, which emits `browser.reattached`.
- "Treat live-view URLs as credentials."
- Their advice for web apps: "**Replace the terminal prompt with an explicit Continue control**" [S].

Source: https://docs.browser-use.com/cloud/agent/human-in-the-loop.md

### 1.16 Convergence Proxy

- Acquired by Salesforce (May 2025) and folded into Agentforce.
- Its Browserbase case study credits **live session URLs** and the ability to "intervene in browser sessions for edge cases" as a differentiator over headless competitors [S].
- Proxy had a routines/templates library [M]. There's little public UX detail now.

Sources: https://www.plushcap.com/content/browserbase/blog/browserbase-how-live-view-became-convergences-secret-weapon · https://salesforce.com/news/stories/salesforce-signs-definitive-agreement-to-acquire-convergence-ai/

---

## 2. Cross-cutting patterns that work

1. **The screen is a glanceable window, not the main view.**
   - Consumer products shrink the live computer: Operator's "small window", ChatGPT Work's picture-in-picture, Cowork's right column, Comet's page glow.
   - Developer tools make it one tab among several (Devin's Shell / IDE / Browser).
   - The **result** and the **current step** get the main real estate.
2. **One status vocabulary, sorted by "needs you".** Zapier's "Needs action", Cursor's "1 working · 1 waiting", Copilot's "jump in when Copilot needs your input". Users scan for what's blocked on them, not for what is idle.
3. **Approvals are objects, not toasts.** They persist server-side, have an inbox, can be answered from any channel (Zapier → Slack, Dispatch → phone push, Codex phone approvals, Relevance → Slack channel), sit attached to the composer, and their buttons name the scope.
4. **Plan, then a scoped run.** Claude in Chrome's plan lists the sites it will visit and stays inside them. ChatGPT Work shows the plan before it executes. Manus proposes a plan with clarifying questions. Comet builds the result in approved stages.
5. **Fixed floors plus adjustable rules beat global autonomy radios.** Claude in Chrome's prohibited list and Zapier's never > ask-first > allow precedence: payments, account creation, ID data and self-permission changes can't be unlocked.
6. **Take-over is requested with a reason, and hand-back carries context.** Manus and Replit prompt take-over at blockers ("Begin take over"). ChatGPT Work captures no screenshots during take-over. Devin says to "tell Devin about your changes". Replit auto-skips after 10 minutes.
7. **Replay is a scrubber, not a log.** Devin's greyed "future" commands, Replit's video sliders, Operator's session video, Manus replay links, Cursor's recorded demos.
8. **Steer without stopping.** Copilot applies a message after the current tool call. Devin's `/btw` side chats. Manus accepts mid-run messages. ChatGPT redirects "without losing previous progress".
9. **Make it recurring from a finished result.** ChatGPT's clock icon after a task, Cowork's `/schedule` conversation and "Scheduled" list with upcoming and past runs plus run-now, Claude in Chrome's shortcut → schedule, Operator's "save as workflow".
10. **Chat apps as the primary interface for non-technical owners.** Lindy's iMessage is "the best version of the product". OpenClaw's morning brief. Dispatch's single persistent thread.
11. **Idle costs nothing, and the UI says so.** Devin sleeps after about 0.1 ACU idle and wakes on a message; Hermes and Modal hibernate.
12. **Visual identity for agent-owned surfaces.** Claude's coloured tab group and Comet's glow mark "this is the agent's, not yours".

## 3. Anti-patterns and recurring complaints

| Anti-pattern | Evidence |
|---|---|
| **Opaque metered cost and paying for failures** | Manus (6000 credits for one prompt, charged for wrong output), Genspark (42% of credits in the first hour), Replit (per-conversation totals removed, charged after rollback), Lindy ("credits are black box"), OpenClaw ($300 in 2 days), Cursor (credit switch "confused many users"). This is the #1 complaint across every product. |
| **Progress theatre** | Manus's "green checkmarks across the board" on a bad result; Comet's silent constraint violations; Lindy's silently filtered invites. Finishing every step was treated as success. |
| **Approval fatigue** | Operator's confirmations "frequent", "constant reassurance"; Cowork "asked for confirmation too often, especially when opening files"; Zapier's agent asking before reading the user's own files. |
| **Approvals that get lost or skipped** | OpenClaw approvals "inconsistently triggered or bypassed in Telegram DMs" and dropped on disconnect; Beamhop's floating amber toasts have the same shape. |
| **Exposing internals to non-technical users** | Cowork's intermediate JS/HTML files, alarming terminal errors; Beamhop's CPU/RAM header, `xoxb-` fields, model id strings, "1000000" tokens. |
| **Surface or mode confusion** | Anthropic merged Chat and Cowork because users "struggled to pick the right tab"; Replit users asked for clearer modes. Beamhop has Crew vs Agent vs Settings vs Dock vs "Talk to all agents". |
| **Setup cliff** | OpenClaw: Docker, Node, keys, 8-hour first install; Beamhop's first screen is an API key field. |
| **Insecure defaults** | 900+ exposed OpenClaw gateways; live-view URLs that work as credentials. |
| **"Stop" that doesn't stop, and loops** | Replit "kept coding even after they pressed stop"; ChatGPT's 45-minute loop; Comet looped for minutes; Lindy's credit-burning send loop. |
| **Lying or ambiguous status** | Cursor's Live Activity showed "Waiting" while working; "difficult to know when agent is done"; Manus's working chip had no cancel. |
| **Blurry, laggy take-over** | ChatGPT agent take-over "fuzzy and awkward". |
| **Host must stay awake** | Dispatch and Cowork local tasks need the computer on. **This is Beamhop's opening: beam to cloud.** |
| **Fixed panels that cramp outputs** | Cowork's right sidebar couldn't close, so artifacts were squeezed into a thin column. Beamhop's settings replace chat in the same 384px column. |
| **Bot-only support and billing traps** | Manus (Trustpilot 1.2), Genspark (1.5), Lindy (support email bounces). |

---

## 4. Ideas Beamhop should steal or invert (each tied to evidence)

**1. Crew home is a "needs you" board, not a screenshot gallery.**
- Replace the three identical screenshot cards with rows or cards sorted **Needs you → Working → Scheduled next → Idle**.
- Each card shows: agent name and colour, a one-line plain-English status ("Waiting for you to approve: send invoice to Jan"), the last result (title plus a thumbnail of the *artifact*, not the desktop), the next routine ("Tomorrow 08:00 · HN digest"), and where it lives as a small location glyph.
- Show the live screen thumbnail **only while Working**, and pulse it in the agent's colour.
- Evidence: Zapier statuses, Copilot "status at a glance", Cursor "1 working · 1 waiting", Comet "mission control". Today every Beamhop card shows an identical idle "Ready" page.

**2. A single top-bar summary line, mirrored on the phone lock screen.**
- "2 working · 1 needs you · next: Scout at 08:00". Clicking "1 needs you" opens the approval inbox.
- It must reflect real state: Cursor's Live Activity bug shows the trust cost of getting this wrong.

**3. Approvals become a persistent Inbox attached to the composer, answerable from Telegram, Slack and Discord.**
- Kill the floating amber toasts. Each request is a card with:
  - a verb-first title ("Send email to jan@acme.nl")
  - the screenshot at the moment it asked (keep this; it's good)
  - a diff or preview of what will be sent
  - **scope-naming buttons**: `Allow once` · `Always allow sending to jan@acme.nl` · `Deny` · `Edit first`
- The same card is posted to the paired chat with inline buttons. Answering in one place resolves it everywhere; requests are queued server-side and survive disconnects.
- Evidence: Zapier Sidekick (#2, #3, #4), Claude in Chrome's per-site prompt, Relevance → Slack, Dispatch push. The OpenClaw anti-pattern: approvals dropped on disconnect or skipped in DMs.

**4. Replace the "Autonomy" radios with a Rules page that has locked floors.**
- Top section, padlocked and never unlockable: "Never: pay, create accounts, enter card/ID numbers, change its own permissions".
- Middle: "Ask first" rows. Bottom: "Allowed" rows.
- Each row reads: `Allow | Ask first | Deny` + scope + "Only when …" + account. A row is created automatically whenever you click "Always allow…" on an approval.
- Add "Suggested rules" built from your past one-off approvals ("You approved 6 Hacker News posts to Telegram — always allow?").
- Evidence: Zapier's floors and precedence plus suggested standing permissions; Claude in Chrome's prohibited list. Also state explicitly that reading its own files never asks (Zapier's lesson).

**5. Plan card before long or risky tasks only.**
- For tasks estimated at more than about 2 minutes or touching new sites or apps, show a plan card: steps, **sites/apps it will touch**, estimated time and **estimated cost range**, with `Start` / `Change plan`.
- After Start, leaving the listed sites triggers an approval.
- Skip the card for quick tasks to avoid fatigue.
- Evidence: Claude in Chrome's "Approve plan / Make changes"; ChatGPT Work's plan before execution; the Manus critic asking for an estimate before execution; complaints about Operator and Cowork confirmations.

**6. Invert the agent-view layout: the conversation and result are the main view; the screen docks as a resizable picture-in-picture.**
- Default: transcript and outputs on the left (about 60%), the live screen docked top-right at about 480px wide with a status strip under it.
- One click (or `F`) enlarges the screen to full canvas, which is the "watch / take over" mode.
- Settings never replaces chat; it opens as a sheet or drawer.
- Evidence: ChatGPT Work's PiP, Operator's "small window", Cowork's cramped-sidebar critique, the Anthropic dev demo that Beamhop currently copies.

**7. Take-over as a mode with a reason, a privacy promise and a hand-back note.**
- When the agent needs you, the screen frame turns amber with the reason chip "Needs you: log in to Gmail" and a `Take over` button pinned **in the frame's top bar**, not floating over page content as the current pill does.
- In take-over: the frame border switches from the agent's colour to "you" white, the transcript collapses to a strip, and a banner says "Not recorded while you drive" (and recording really is off).
- Hand back with `Done — continue` plus an optional field "Anything I should know?"
- If no response in N minutes, the agent says what it will do instead (skip, wait, or try another route).
- Evidence: the ChatGPT agent's no-screenshots-in-takeover; Replit's "Begin take over" and 10-minute auto-skip; Devin's "tell Devin about your changes"; Manus prompting take-over. Also raise stream quality during take-over, because ChatGPT's take-over was "fuzzy and awkward".

**8. Replace the collapsed `ACTIVITY (n)` mono log with a scrubbable timeline under the screen.**
- A filmstrip of keyframes, one per step, labelled in plain language ("Opened booking.com", "Filled dates").
- Drag back to see the screen at that moment. Steps after the playhead are **greyed as "future"**. A `Live ●` button returns to now.
- After a task, the same strip becomes the replay, and it can be exported as a short video for the owner's records.
- Evidence: Devin's greyed future commands, Replit's video sliders, Operator's session video, Manus's replay.

**9. One honest status chip with an elapsed timer, and always a Stop that really stops.**
- `Atlas is comparing e-bike prices · 1:42 · Stop` sits above the composer.
- Stop must halt the run within one action. Show "Stopping…" then "Stopped after 14 steps; here's what I had", with partial results.
- Evidence: Manus's timer chip without cancel; Replit "kept coding" after stop; ChatGPT's "stop and get partial results".

**10. An unmistakable "done" moment.**
- A completion card with the outcome first ("Found 3 e-bikes under €2,000"), then artifacts, then "Repeat this…" and "Ask a follow-up".
- An OS notification plus an optional chime, and the phone push deep-links to that card.
- Evidence: Cursor's "difficult to know when agent is done"; OpenAI's iOS notifications opening completed tasks directly; Dispatch reporting outcomes, not steps.

**11. Separate "steps done" from "goal met".**
- The completion card asks the agent to self-check against the original request ("You asked for under €2,000 with links: ✓ price ✓ links ✗ one is out of stock in NL").
- It shows unmet constraints in amber instead of a wall of green ticks, plus a one-tap 👍/👎 that feeds memory.
- Evidence: Manus progress theatre; Comet's silent constraint violations ("cilantro seeds"); Lindy's silent failures.

**12. Cost in euros per task, with an estimate beforehand and a receipt afterwards; never tokens.**
- Replace "Daily token limit 1000000" with a "Monthly budget per agent: €10" slider, and an "Ask me if one task would cost more than €0.50" toggle.
- Every completion card has a receipt line ("€0.07 · 3 min · 41 steps"). Per-agent and per-routine monthly totals live on the agent page.
- Asleep or idle agents show "Sleeping · costs nothing".
- Evidence: every metered product's top complaint (Manus, Genspark, Replit "no per-conversation totals", Lindy "black box", OpenClaw). Devin's "sleeping sessions do not consume usage".

**13. Onboarding: no API key on screen one; a first useful result in under 2 minutes.**
- Step 1: name and colour your first agent (with a default).
- Step 2: "Connect a brain" as OAuth-style buttons ("Use my ChatGPT", "Use my Claude", "Use OpenRouter"). Pasting a key is the fallback under "Other".
- Step 3: run a sample task while the computer image downloads, showing the download as the agent "moving in".
- Step 4, only after the first success: "Want Atlas on your phone? Scan to pair Telegram."
- Evidence: Hermes `setup --portal`; Operator/ChatGPT suggested tasks; OpenClaw's setup cliff; Claire Vo's onboarding failure on a connector.

**14. Make the chat app the primary interface, and the desktop app the control room.**
- Lead first-run and empty states with "Text Atlas on Telegram" (QR code).
- Everything (approvals, done cards, take-over requests with a link to the live screen) works from the chat app.
- The desktop app's job becomes watching, taking over, rules, routines, beaming and history.
- Evidence: Lindy's iMessage "best version of the product"; OpenClaw's appeal; Dispatch's persistent thread. Guard against OpenClaw's DM-approval bugs by making the chat-app approval the same server-side object as idea 3.

**15. Pitch beaming by what the user wants, not where the agent goes.**
- Replace "Beam to…" with intents: **"Keep working while my laptop is closed"** (→ your cloud), "Bring back to this computer", "Save to a file (encrypted)".
- Show the move as one physical animation (the agent's mascot walks from the laptop to the cloud) with a stage line and a receipt ("Moved in 48 s · 1.2 GB · memory, skills, logins intact").
- Evidence: Dispatch/Cowork "computer must stay awake" as the competitor's weakness; Cursor 3 "push to the cloud to keep running after you close your laptop". Beamhop already has stages and a receipt; the change is in the framing.

**16. Routines are made from results, not from forms.**
- Every completion card has `Repeat…` (Daily / Weekdays / Weekly / When something happens).
- A Routines list per agent and crew-wide shows **next run, last run result, and cost per month**, with run now, pause and edit.
- Creation can also be conversational ("every morning at 8…" → a confirmation card).
- Evidence: ChatGPT's clock icon and chatgpt.com/schedules; Cowork's `/schedule` and upcoming/past runs; Manus event triggers. Beamhop's current scheduled-tasks text box sits deep in settings.

**17. Steer without stopping, and add side questions.**
- Messages typed while working are queued and applied after the current action, shown as "Will apply after this step".
- A "Quick question" mode answers from the agent's context without derailing the run.
- Evidence: Copilot's steering after the current tool call; Devin's `/btw` side chats; Manus's mid-run steering.

**18. A prompt-injection pause that quotes the evidence.**
- When the safety monitor trips, show "Atlas paused: this page told it to '…download Support Tool and run it'" with `Keep paused` / `It's fine, continue` / `Take over`.
- Do the same in chat apps.
- Evidence: Operator's "Review potential risk to resume task" dialog; Simon Willison's point that asking non-programmers to spot injections themselves is unfair.

**19. A permissions ledger with history and revoke.**
- An "Access" tab lists each site, app, account and channel the agent has been allowed into, when, and by which approval, with Revoke.
- Add a "Wipe this agent's logins" button and a "Fresh computer for this task" option on high-stakes tasks.
- Evidence: Claude in Chrome's "Your approved sites" and permission history; ChatGPT's one-click delete of browsing data; Simon's fresh-session advice.

**20. Memory and skills are visible, editable and reviewable.**
- A "What Atlas knows" page with plain-language memory cards (edit, forget) and "Skills Atlas learned this week" (keep or discard).
- Keep the list short (Hermes users complain about 28 redundant skills).
- Evidence: Hermes praised for "inspectable and deletable" memory; the weekly skill-review advice; OpenClaw's context-loss complaints.

**21. Agent colour as a "this is the agent's" marker, never decoration.**
- Use each agent's colour only for things that belong to the agent: the screen frame while it acts, its cursor, its messages in mixed crew chat, and tabs or windows on its computer.
- Everything else stays neutral.
- Evidence: Claude's coloured tab group and Comet's page glow. This also removes the slop palette (gradient buttons, glowing everything).

**22. A crew chat with routing, not "Talk to all agents" broadcast.**
- One persistent crew thread where you ask for something and the crew picks the agent ("Scout will take this; Nova is busy"), with a visible @mention to override.
- Parallel fan-out ("Ask all three to research one city each") renders as a **grid of mini-screens plus a merged table at the end**.
- Evidence: Dispatch routing into Code vs Cowork; Manus Wide Research's merged spreadsheet; Cursor's grid/stack agent tabs; ChatGPT Work's Ultra mode (four parallel agents).

**23. Speak the user's language in every label.**
- Remove CPU and RAM from the header (they move to a "Computer health" disclosure).
- No `xapp-` placeholders on the main path; use "Set it up for me" wizards with screenshots.
- No model id strings; say "Brain: Claude (smart, €€)".
- Errors read as "Atlas couldn't open the file. Try again / Show details".
- Evidence: Claire Vo on intermediate files and alarming errors; Anthropic merging tabs to cut cognitive load.

**24. Phone = approvals plus "what's happening", not a shrunken desktop.**
- The mobile layout leads with the needs-you inbox and the status line; the screen is one tap away.
- Approve or deny from the notification, with the screenshot attached.
- Evidence: Dispatch's done and needs-go-ahead pushes; Codex's "phone as approval layer"; the Cursor Live Activity summary.

---

## 5. To verify hands-on (gaps in public sources)
- Exactly where ChatGPT Work places the PiP and take-over controls, and how the transcript collapses during take-over (the [M] claims in 1.1).
- The current Manus Studio layout (whether the right-hand "Manus's Computer" panel, "Jump to live" and the plan counter survived 2.0).
- What a Comet "mission control" card shows per task.
- How Claude Cowork's merged interface (Sept 2026) shows computer-use activity: overlay, indicator, stop.
