# 05 — Independent design + accessibility review of the v0.60 "Instrument" UI

Review date: 2026-11-14. Reviewer had no part in the build. Everything below was checked in the **running app** (port 7870 with
Atlas/Nova/Scout on the mock harness, port 7871 with an empty home, then one agent created through the UI), driven with
puppeteer-core + Chrome, axe-core on every screen, at 1440×900, 1280×720, 720×450 (= 1440 at 200% zoom) and 390×844 phone, light
and dark, with and without `prefers-reduced-motion`. Screenshots are in `research/shots/review-*.png`. The v060 shots in
`research/shots/` were read too.

Note on images: the `ghcr.io/beamhop/scut-agent:dev` image was rebuilt at 09:01 during this review. Agents created before that
(Atlas, Nova, Scout) ran the old image and show the old navy robot start page. Echo, created at 09:03, shows the new start page.
Both are judged below.

---

## Verdict in one paragraph

The direction is right, and the app chrome no longer reads as slop. Warm neutrals, one accent, Mona Sans, key plates and real
headings replace the gradients, glow, starfield and mascots. The keyboard trap is gone, and axe reports zero violations on every
screen. But axe-zero hides the real problems. The highest-risk approvals can't be completed with a screen reader or voice
control. The agent's own screen, which is the product's hero, still looks like a stock Chromium window (`127.0.0.1:8080/start?…`
in every preview), and its fonts fail to load. Failures are shown as success or as raw exceptions. Several screens say one thing
in four places and the opposite in a fifth. The "Instrument" idea is so far mostly a skin: a readout strip and a plate. None of
the physical moments the plan promised exist yet: the beam cartridge and track, the approval tray rising from the bezel, the
autonomy switch as an object. Fix the P0s, then spend the craft budget on the three moments that matter: **watching, deciding,
beaming**.

---

## P0: must fix before release

### P0-1 "Hold to allow" can't be done with a screen reader, voice control or switch access
- **Where:** `packages/ui/src/ui/HoldButton.tsx`, used by `ApprovalCard` for every high-risk approval (bench tray, agent view,
  phone).
- **What:** the button confirms only on pointer-down hold or a held Enter/Space key. `onClick` is `preventDefault()`. I fired a
  plain `click()`, which is exactly what VoiceOver (VO+Space), NVDA/JAWS in browse mode, Dragon/Voice Control ("click Hold to
  allow") and switch access send. Nothing happened: the label stayed "Hold to allow" and the card did not resolve. These users
  can **refuse** a payment but never **allow** one. Shot: `review-appr-bench-light-1440.png` (right card).
- **Why:** WCAG 2.1.1 Keyboard and 4.1.2 Name/Role/Value (the role says button; activation does nothing). It also breaks
  DESIGN-PLAN §5 "every action reachable".
- **Fix:** keep the hold for pointer and physical keys. When `onClick` fires with no hold in progress (`e.detail === 0` or no
  pointerdown seen), morph in place into a deliberate second step instead of ignoring it: label "Allow: are you sure?", plus
  `[Yes, allow]` (inert 600 ms, not focused) and `[Cancel]`, with `announce("Press Yes, allow to confirm. High risk.")`. Add a
  unit test that a synthetic `click()` followed by a click on "Yes, allow" calls `onConfirm`.

### P0-2 The agent's screen, the hero of every view, is a raw browser window, and on existing agents it is still the old robot
- **Where:** `packages/agentd/src/desktop.ts` `startBrowser()` (`--start-maximized`, no `--kiosk`/`--app`), `packages/agentd/src/main.ts:783`
  (unauthenticated allowlist), `main.ts:1005` (`startPage`), and agent container lifecycle (no image upgrade).
- **What:**
  1. Every preview, approval thumbnail and the agent view show Chromium's tab strip, window buttons and an address bar reading
     `127.0.0.1:8080/start?name=Atlas&color=%2338e1ff`. Shots: `review-zoom-agentscreen.png`, `review-agent-appr-light-1440.png`,
     `review-solo-light-1280.png` (new image: `127.0.0.1:8080/start?name=Echo`).
  2. Agents created before the image rebuild **keep the old navy/neon robot page forever**. Nothing upgrades a running agent's
     image; even Nova, re-created by a beam at 09:01, came up on the old image ID `ae5ec8e5`. Every existing user will see the
     "AI slop" robot inside the new UI. Shots: `review-appr-bench-dark-1440.png`, `review-nova-driving-dark.png`.
  3. On the new image, `GET /fonts/*.woff2` returns **401**: `main.ts:783` lets `/`, `/assets`, `.js` and `.css` through without
     auth, but not `/fonts/`. The new start page's `@font-face` (line 1012) fails, so it renders in DejaVu Sans
     (`review-create-progress-6000.png`), and so does the whole phone page (P1-9).
- **Why:** research 04 day-one checklist #6 ("hide Chromium chrome… consistent bezel") was never done. It shows internal URLs
  to non-technical users, the old look survives in the most-viewed pixels, and the fonts are an unfinished seam ("nobody finished
  the job").
- **Fix:**
  - (a) Launch Chromium with `--app=<url>` (or `--kiosk`) and `--window-size=1280,800`. Move "where it is" into Beamhop's own bezel
    bar as a location line, registrable domain in `font-medium`, e.g. **bol.com** / `www.bol.com/…`, with a lock or warning icon.
    This keeps the trust value of the URL without the chrome.
  - (b) Add `p.startsWith("/fonts/")` to the public allowlist at `main.ts:783`.
  - (c) On app start, recreate local agents whose image ID ≠ the current `SCUT_IMAGE`, via the same quiesce/restore path as a
    beam, or at least show a "Restart Atlas to update its computer" row.
  - (d) In the new start page copy, change "Free for a task" to "Ready for a task" (see P1-2).

### P0-3 A brain-less agent fails silently and the UI reports success
- **Where:** `create.tsx` ("Skip this" → "None yet. Add one later in Settings."), `bench.tsx` `Details`, `agent-activity.tsx`,
  `settings.tsx` `safetySummary`.
- **What:** I followed the path the UI recommends to unsure users ("Not sure? Skip this and choose later in Settings") and gave a
  first task. Result: the reply is `(no reply)`, the Activity log shows "**✓ Finished**", status is "Free", the header says
  "Safety: all good", and the bench shows "Last result, 1 min ago: (no reply)". Nothing tells the user the agent has no brain.
  Shots: `review-create-progress-6000.png`, `review-solo-light-1440.png`.
- **Why:** time-to-first-value is the onboarding metric (research 03 §5). This makes the product look broken on the first try. It
  also breaks principle 3 (honest status) and Rams's "honest".
- **Fix:**
  - While `brain` is unset, the unit and the agent view show status **Problem ✕ "No brain yet"** with a primary
    `Add a brain` button that opens Settings → Brain.
  - The composer keeps the text but sends nothing. It shows inline: "Echo can't think yet. Add a brain first (2 min)."
  - Never log "Finished" with a check for a run that produced no output. Log "Didn't start: no brain".
  - In create step 3, "Brain: None yet" gets a warning line plus `Back`.

### P0-4 Saying "Don't" leaves the agent showing a raw exception as its headline, flagged as needing you
- **Where:** `bench.tsx` `Unit` headline (`st.headline`), agent-side denial handling (`packages/agent`, `request_approval`
  result parsing).
- **What:** after "Don't" on Scout's high-risk approval, the unit headline became `Stuck: JSON Parse error: Unexpected identifier
  "denied"`, status ▲ Needs you, with "Scout is stuck and asked for help · Take a look". Shot: `review-decide-after-3000.png`.
  The user did the safe thing and is punished with an error that implies they broke something.
- **Why:** research 03 §1.3: "Default outcome… = deny, and the agent is told so it can take a safer path". It also breaks copy
  rule 1 (no jargon on the main path).
- **Fix:**
  - Agent side: a denial is a normal tool result (`{ok:false, reason}`), not an exception.
  - UI side: never render a headline that matches `/error|exception|parse|ECONN|undefined/i`. Map it to "Scout hit a problem and
    stopped" plus a `Details` disclosure holding the raw text.
  - After a denial, the headline is "Didn't open shop.example.com: you said no" and the status is Free.

### P0-5 "Open on your phone" shows a QR code that can never work for local agents, and the copy is wrong
- **Where:** `agentView.tsx` `PhoneLink`, `/api/agents/:id/phone`.
- **What:** for every agent on This computer (the default for every new user) the link is `http://127.0.0.1:<port>/?auth=…`.
  A phone can't reach 127.0.0.1. The dialog says "the link only works on this computer's network", which is false: it works only
  on this computer. Yet it shows a 208 px QR code and a "Copy link" button. Shot: `review-phonelink-dialog.png`.
- **Why:** this is a primary header button on every agent view, and it's broken for the default case. It erodes trust.
- **Fix:** either serve the phone page on the LAN address (bind the agent port on `0.0.0.0` behind the signed ticket, and pick
  the first private IPv4), or don't show a QR for local agents. Instead show "Your phone can't reach this computer directly.
  Beam Nova to a cloud, or pair Telegram to answer from your phone" with buttons `Beam to…` and `Pair Telegram`. Make the
  phone button in the header reflect this (no QR icon promise).

---

## P1: should fix before release

### P1-1 The idle bench is the banned "three equal cards and a mostly empty screen"
- **Where:** `bench.tsx` `Unit` compact branch, lanes, "More places" section.
- **What:** with 3 idle agents, three identical 280 px cards sit top-left reading "Nothing done yet."×3. Below them, the **empty**
  "Cloud (simulated)" dashed slot plus two dashed promo boxes ("In a file", "Your own cloud") take more area than all the agents
  together, and about 60% of the 1440×900 viewport is empty. Shots: `review-bench3-light-1440.png`, `review-bench3-dark-1280.png`.
  Idle units show **no screen at all**, although §4.1 says "dimmed still of the last frame".
- **Why:** DESIGN-PLAN §6 / research 04 §1.3 ("three equal cards… half a screen of nothing"; "dashed ghost tiles" was diagnosis
  #5). The things that matter (agents) get less room than the things that don't (marketing for clouds).
- **Fix:**
  - Compact units always show a 16:10 still of the last frame (one frame on mount, refreshed every 60 s, `opacity:.55`), with
    the last result as the headline. That's an instrument rack, not a list of text cards.
  - Empty lanes collapse to one 40 px row: "Cloud (simulated) · nothing here · Beam an agent here".
  - Merge "In a file" and "Your own cloud" into one quiet footer row of two links. They are already in the Beam menu and ⌘K.
  - When everything is idle, put a one-line "today" summary at the top ("3 ready · nothing waiting · €0.00 today") instead of
    leaving the top empty.

### P1-2 "Free" means three different things
- **Where:** `ui/status.tsx` (`free: "Free"`), `bench.tsx` lane header (`"free"` cost), `statusSentence` ("All 3 free"), start page
  ("Free for a task").
- **What:** on one screen: "All 3 free" (status sentence), "3 agents · free" (cost), "○ Free since 8:52 AM" (status), "FREE"
  (readout), and in the Beam menu "Cloud (simulated) · free" (cost). `review-bench3-light-1440.png`, `review-solo-dark-1440.png`.
  A non-technical user can't tell "idle" from "costs nothing". The known "3 agents  free" lane header is the worst case.
- **Why:** copy rule 1 (plain, specific). FAA/Carbon: one word, one meaning.
- **Fix:** rename the status to **Ready** ("Ready since 14:02", "All 3 ready"). Say cost as **"No running cost"** in lane headers
  and **"€0/month"** in menus. Lane header becomes `This computer · 3 agents · no running cost`.

### P1-3 "Needs you" is shown 4–5 times per agent, so orange stops signalling
- **Where:** `bench.tsx` `Unit` (`needsRow`, `Readout`, border), `ApprovalCard` in the tray, top bar.
- **What:** with two approvals at 1440×900, orange appears about 14 times: top-bar link, 2 tray risk words, 1 Allow, 1 Hold, 2
  unit borders, 2 readout ▲NEEDS YOU, 2 washed needs rows, 2 "Review" buttons, plus the favicon. Each approval is shown in the tray,
  in the unit border, in the readout and in the needs row. `review-appr-bench-light-1440.png`.
- **Why:** principle 2 (one accent, one meaning) only works if it's scarce. This is the same "status shown twice" fault research
  04 diagnosed (#8), now four times over.
- **Fix:** when the approval is visible in the tray, the unit keeps only the signal border and the lamp in its readout. Drop
  `needsRow` and its "Review" button; clicking the readout lamp scrolls to the card. Keep `needsRow` only for `stuck` (no card
  exists). Tray cards keep the single signal fill (Allow).

### P1-4 Approval cards don't give enough to decide on, and one label reads as a button
- **Where:** `ui/ApprovalCard.tsx`, `approvalTitle`, `RiskBadge`, `protocol` `assessApproval`.
- **What:**
  - The title is the raw URL ("Open https://shop.example.com/checkout"). Domains aren't emphasised, so look-alike domains pass.
  - "High risk" carries no reason. Here it is high only because the URL contains "checkout".
  - The screenshot is taken *before* the action, so it shows the idle start page and says nothing (`review-agent-appr-light-1440.png`).
  - The medium-risk word "**Check this**", with an eye icon at top-right, is an imperative verb styled like a link, so people will
    click it.
  - "Don't" sends no reason back to the agent.
- **Why:** research 03 §1.3 (payload by type, "registrable domain highlighted when it doesn't match the task", "Don't carries a
  reason"). The 93% rubber-stamp evidence: if the card doesn't inform, people stamp.
- **Fix:**
  - Title: "Open **shop.example.com**" with the path as a second mono line.
  - Risk line: word plus reason, e.g. "▲ High risk · looks like a payment page" or "· first visit to this site". Derive the reason
    from the same rule that set the risk, and return `{risk, reason}` from `assessApproval`.
  - Rename medium to **"Worth a look"** (not a verb), with no eye icon (eye = "watch only" elsewhere).
  - Drop the thumbnail unless the action targets something on the current screen; for `open_url`, show the domain's favicon
    instead.
  - Add reason chips after "Don't": "Wrong site", "Not now", "Ask me first next time".

### P1-5 Beam: the Undo and progress appear off-screen; nothing happens where you acted; focus drops to `<body>`; the signature moment is missing
- **Where:** `beam.tsx` `BeamCountdown`, `BeamGhost`, `bench.tsx` lane render.
- **What:**
  - At 1440×900 with an approval tray, choosing "Beam to → Cloud (simulated)" from Nova's menu puts "Starting in 5 s · Undo" in
    the Cloud dock at y≈890, **below the fold**. Nova's own card doesn't change for 5 s. Shot: `review-beam-t300.png` (bottom
    edge).
  - Once it commits, the Undo button unmounts and `document.activeElement` is **`<body>`** for the whole flight (6–12 s) until
    landing restores it.
  - The "track" is a 3 px bar inside the ghost card. There is no cartridge and no travel between docks: the beam is a dashed box
    with a timer (`review-beamback-t9000.png`).
  - There is no Cancel during flight.
- **Why:** WCAG 2.4.3 Focus Order (focus lost), principle 7 ("motion explains space"), and DESIGN-PLAN §2.4, where beam is one of
  the only three crafted moments.
- **Fix:**
  - Show the countdown **on the source unit** ("Beaming to Cloud in 4 s · Undo · Beam now") and
    `scrollIntoView({block:"nearest"})` the target ghost.
  - On commit, move focus to the source unit's article; don't unmount the focused element.
  - Build the plan's moment: the source screen collapses to a line (180 ms), a cartridge chip (plate + "49 MB") travels along an
    SVG path drawn between the two lane headers, and the track fills ink→signal by real stage. Reduced motion: a crossfade plus
    the text log.
  - Add `Cancel` until "Starting Nova".

### P1-6 The top bar has "Pause previews" but no way to pause or stop agents from the bench, and no global stop
- **Where:** `bench.tsx` top bar `IconButton` (Pause icon), `useCommands`.
- **What:** a bare ‖ icon next to "Talk to all agents" reads as "pause everything", but it pauses **previews**. ⌘K "pause" on the
  bench returns only "Pause previews" (`review-palette-pause.png`). DESIGN-PLAN §4.7 promised Pause/Resume/Stop {agent} and
  Settings of {agent} globally; they exist only inside an agent view. There's no "Pause all agents" anywhere.
- **Why:** HAX G17 "Provide global controls". For agents that spend money and send messages, the emergency stop is the most
  important control the product can have. The current icon promises it and doesn't deliver.
- **Fix:**
  - Replace the icon with a labelled `Pause all` button (or Stop-all with `HoldButton`) that sends `pause` to every agent and
    turns into "Resume all (3 paused)".
  - Move previews to the view options (`Previews: on/off` in ⌘K and a small text toggle near the lanes).
  - Register Pause/Resume/Stop/Settings per agent at app level so they work on the bench.

### P1-7 "Free since…" while you're driving; the bench says Free for an agent someone else is driving (known; confirmed)
- **Where:** `agent-status.ts` (`free = … (!paused || driving)` → `headline = "Free since …"`), `bench.tsx` `Unit` ignores `paused`.
- **What:** while driving Nova, the agent view says "**Free since 9:01 AM** · Ready for a task. Message Nova to start one." next to
  "You're driving · Nova is waiting" and readout "PAUSED". That's four statements and two contradictions. The bench meanwhile shows
  Nova as "○ Free since 9:01" with a Send box (solo layout) while it's paused under a person's control. Shots:
  `review-nova-driving-dark.png`, `review-bench-while-driving-dark.png`.
- **Fix:**
  - Driving: headline "You have Nova's computer", meta "Nova is paused until you give it back".
  - Bench: add a `paused`/`driven` status word ("Paused · someone has control") and disable the task box.
  - Remove the `|| driving` from `free`.

### P1-8 After deciding an approval, keyboard focus falls to `<body>`
- **Where:** `ApprovalCard` (buttons unmount on answer), `bench.tsx` tray.
- **What:** Alt+Shift+A → Tab → Enter on Allow; afterwards `activeElement` is `BODY`. The next Tab starts again at the top of the
  page.
- **Why:** WCAG 2.4.3. This is the most frequent keyboard flow in the product.
- **Fix:** on answer, focus the next pending card (`[data-approval]`), or the "Waiting for you" heading if none are left, and
  announce "Allowed. 1 more waiting."

### P1-9 The phone page served from the agent container loses all brand fonts
- **Where:** `agentd/src/main.ts:783` (see P0-2b).
- **What:** Mona Sans, Commit Mono and Departure Mono all return 401, so the phone page renders in the system font. The readout
  falls back to a generic monospace. Shot: `review-phone-container-light.png` (compare `review-phone-app-light.png`).
- **Fix:** same one-line allowlist fix. Add an e2e check that `document.fonts` has no `error` entries on the phone page.

### P1-10 Paid beam confirm puts focus on "Beam"
- **Where:** `beam.tsx` `BeamConfirm` (`ref.current?.focus()` on the primary Beam).
- **What:** the Enter that picked the menu item lands focus on a button that commits about €18–73/month. A held or repeated
  Enter can confirm.
- **Why:** principle 4 ("acting is deliberate"). Approvals already follow the 600 ms inert, no-autofocus rule; a money action
  should too.
- **Fix:** focus the group, not the button; make Beam inert for 600 ms; keep Enter-to-confirm only after the arm delay.

### P1-11 Reduced motion turns every preview into a black box
- **Where:** `bench.tsx` (`previewPref` defaults off under reduced motion; there's no frame until previews are on).
- **What:** with `prefers-reduced-motion`, the bench shows large black bezels saying "Preview paused"
  (`review-beamback-t9000.png`). Reduced-motion users lose all screen information, not just the motion.
- **Why:** WCAG 2.2.2 asks for pause, not removal. Research 03: "Resume to the current frame".
- **Fix:** paused means still frames: fetch one thumbnail on mount and every 60 s (or on hover/focus), and show it at full
  opacity with a small "Still · 14:02" tag.

### P1-12 Agent view at 200% zoom: the agent's own name truncates and the screen shrinks to 270 px
- **Where:** `agentView.tsx` `DesktopLayout` (desktop layout until 700 px, chat `MIN_CHAT=360`).
- **What:** at 720 css px the h1 shows "**Atl…**", the breadcrumb shows "This compu…", the safety shield loses its words, and the
  bezel is about 270 px wide. Shot: `review-zoom200-agent.png`.
- **Why:** WCAG 1.4.10/1.4.4. The h1 is the one thing that must never truncate.
- **Fix:**
  - Switch to the stacked (phone) layout below about 960 px, or start in Focus mode there.
  - Drop the breadcrumb place label first, then the plate callsign. Give the h1 `shrink-0`.

### P1-13 In the agent view, the decision sits far from where you're looking
- **Where:** `agentView.tsx` (`Headline` top-right, `ApprovalStack` bottom-left above the composer).
- **What:** the eye goes to the orange headline "▲ Waiting for you: Open https://www.bol.com" (top right). The only place to
  answer is about 900 px diagonally away, bottom-left. The headline isn't interactive.
  Shot: `review-agent-appr-light-1440.png`.
- **Fix:** follow research 04 B: the approval rises as a tray from the **bottom edge of the bezel**, over the screen the agent is
  about to act on, with the same card. Keep a compact echo above the composer. As a minimum, make the headline a button that
  focuses the card.

### P1-14 Phone bench targets are 28–32 px (known; confirmed)
- **Where:** `bench.tsx` (`Button size="sm"` in units, top bar `IconButton`s).
- **What:** on the 390 px bench, Open, Beam to…, Open an agent file and Add a cloud are 28 px tall; Search, Pause previews, Theme
  are 32×32; the autostart switch is 30×18. The phone agent view does use 44 px (`BIG_TARGETS`). Shot: `review-bench3-phone.png`.
- **Why:** this passes 2.5.8 (24 px) but fails the plan's own 44 px phone rule (§5) and Apple HIG.
- **Fix:** add `max-sm:h-11 max-sm:px-4` to the `sm` button size, or reuse `BIG_TARGETS` on the bench root at `max-sm`. Make the
  Switch hit area 44 px.

---

## P2: nice to have

| # | Where | What (shot) | Fix |
|---|---|---|---|
| P2-1 | `bench.tsx` top bar | `€0.00 today` is an estimate, said only in a `title` tooltip (known; confirmed) | Prefix `≈`, e.g. "≈ €0.42 today", and an info popover: "Estimated from tokens × model price. Your provider's bill is the truth." |
| P2-2 | `ui/Bezel.tsx` dark | Dark bezel `oklch(.155)` on card `oklch(.225)` is about 1.3:1; the frame disappears (known; `review-appr-bench-dark-1440.png`) | In dark: `ring-1 ring-line-strong` outside the bezel, or bezel L .10 with a 1 px `screen-line` highlight on the top edge |
| P2-3 | `bench.tsx` unit header | `1/2/3` keycaps on every card are power-user noise, and numbers change after a beam (Nova 2→3) | Show keycaps only while Alt/? is held or after the first arrow-key use; number by stable name order |
| P2-4 | Tray | "Waiting for you **0**" while two decided echoes are still shown (`review-decide-after-3000.png`) | Hide the count at 0, or title the tray "Just decided" |
| P2-5 | `ui/theme.tsx`, top bar | Theme toggle is a monitor icon; Safety shield goes icon-only below xl (`review-agent-appr-dark-1280.png`) | Theme lives in ⌘K/settings, not the top bar. Keep the safety word at ≥1024 px |
| P2-6 | ⌘K on agent view | First results are "Open Atlas/Nova/Scout" and 6 beam commands; the current agent's Take over / Pause / Settings are below the fold (`review-palette-agent.png`) | Rank the current-context group first; hide "Open {current}" |
| P2-7 | `bench.tsx` empty lane | "Drag an agent here" on touch screens (`review-bench3-phone.png`) | `@media (pointer:coarse)`: "Use Beam to… on an agent" |
| P2-8 | Phone layout | Take over and Pause hide behind "Show the screen" (two taps); the §4.6 floating bar (Talk · Take over · Pause · Settings) isn't built | Add the 4-button bar above the composer when the screen is collapsed |
| P2-9 | Large free unit | Shows "Ready for the next task" instead of what it just found; the last result appears only on compact units (`review-decide-after-3000.png`, Atlas) | Free large unit: headline = last result, meta "Ready since 9:07" |
| P2-10 | `BeamReceipt` | In a 280 px card the receipt wraps as "in 9 s ·" / "49 MB" (`review-beam-landed-full.png`) | Two lines: "Arrived from This computer · 9 s · 49 MB" / "Came along: logins and files" |
| P2-11 | In-flight source | Dimmed card says "↗ Moving" and "Free" at once (`review-beamback-t9000.png`) | Hide the status sub-line while beaming |
| P2-12 | `settings.tsx` spending | For unknown-price brains the limit is "in million tokens… the units providers bill in" (jargon) (`review-settings-full-light.png`) | "Limit: 1 million words-ish per day"; or ask "What does this brain cost?" once and then show € |
| P2-13 | Create step 1 | The first run is a centred form card; the welcome is one 12 px line. Nothing shows what an agent *is* (its own computer) before asking for a job (`review-first-light-1440.png`) | A 1-line hero plus a still of a unit with a bezel ("This is Atlas's own computer. You watch; it asks before risky steps."). The brand bunny's one sanctioned appearance (research 04 §6) |
| P2-14 | First run footer | "Open Beamhop when I log in" toggle shown before any agent exists | Show after the first agent is created |
| P2-15 | `ApprovalCard` HoldButton look | At rest "Hold to allow" (wash + outline) looks *disabled* next to the solid "Allow" on the low-risk card | Solid outline signal with a hold glyph (a small ring that fills), so it reads as active |
| P2-16 | Agent view idle | "Free since 8:52 AM" as an h3 headline is a timestamp, not news (`review-phonelink-dialog.png` background) | Headline: last result or "Ready. Give Nova a task →", with the time in the meta line |

---

## Accessibility: axe-core results (real violations per screen)

All counts are axe-core (`axe.run(document)`, violations only) on the live app.

| Screen | Light | Dark | Notes |
|---|---|---|---|
| Bench, 3 idle agents, 1440 / 1280 | 0 / 0 | 0 / 0 | |
| Bench, 3 agents, phone 390 | 0 | — | targets 28–32 px (P1-14) |
| Bench with 2 approvals (low + high), 1440 / 1280 | 0 / 0 | 0 | |
| Agent view with approval, 1440 / 1280 | 0 / 0 | 0 / 0 | |
| Settings drawer | 0 | — | |
| ⌘K palette (agent view) | 0 | — | |
| Phone-link dialog | 0 | — | |
| Phone agent view (app) | 0 | 0 | |
| Phone agent view (container link) | 0 | 0 | fonts 401 (P1-9) |
| Beam menu / in flight / landed | 0 / 0 / 0 | 0 / 0 / 0 (reduced motion) | focus on `<body>` in flight (P1-5) |
| First run 1440 / 1280 / 390, create step 2, step 3 | 0 each | 0 (1440) | |
| Solo bench 1440 / 1280 / 390 | 0 each | 0 | |
| Shortcuts, Crew room, Add a cloud, Export dialogs | 0 each | — | |
| **Total** | **0** | **0** | |

axe-zero is real and worth keeping as a CI gate. But every serious a11y problem found here is invisible to axe:
- Hold-to-allow is not operable by AT (P0-1).
- Focus is lost after a decision and during a beam (P1-8, P1-5).
- The h1 truncates at 200% zoom (P1-12).
- Status text is false ("Finished" ✓ for a no-op, "Free" while driven; P0-3, P1-7).

Add puppeteer assertions for these, as I did here: synthetic `click()` on HoldButton, `activeElement !== body` after answer/beam,
h1 `scrollWidth <= clientWidth` at 720 px, and `document.fonts` has no `error` entries.

Checked and good:
- **Keyboard:** visible 2 px focus everywhere (ink on surfaces; flips to light inside bezels). The tab order is sane. Arrow/Home/End
  roving between units works, as do `1–9`, `B`, Alt+Shift+A, `?`, `F`/Esc and the Splitter keys.
- **Driving model:** Take over → keys captured, Tab forwarded (expected); Esc Esc → focus on "Give back"; Give back → focus on
  "Take over". **The 2.1.2 trap is fixed.**
- **Dialogs and drawer:** focus trap and Esc restore work (verified the Settings drawer restores to the Settings button, and the
  phone dialog to its trigger).

---

## What's genuinely excellent: keep

- **The palette and type.** Warm neutrals with one orange that means "a person is needed", plus Mona Sans with real weight
  contrast. No gradient, glow or starfield anywhere in the chrome. It looks chosen, not defaulted.
  (`review-first-light-1440.png`, `review-settings-full-light.png`)
- **The watch/drive model.** "Watch only" bar, a single click shows the "Watching. Press Take over…" hint, the signal bar slides
  down, `Esc Esc` hints, focus choreography and announcements. This is better than most remote-desktop products.
  (`review-agent-driving.png`, `review-agent-watch-nudge.png`)
- **Approval card fundamentals.** Visible expiry with a consequence ("Decide within 23 min, then Atlas skips it"), "Came from",
  risk as word + shape, 600 ms inert, never autofocused, and the resolution echo ("Allowed by you in Beamhop, 9:07 AM").
- **Plates.** The key-derived dot glyph plus callsign is ownable, honest and calm. It also reads well at 16 px.
- **Copy.** "This moves Atlas. It does not make a copy." (export and Beam menu); "Stays here until it lands safely"; "Atlas reads
  this before every task. Plain words work best."; "No key needed. Echo asks you to sign in once, on its own screen."
- **Job-first create flow** with the "No extra cost" subscription tile first, a summary plate on step 3, and the first task typed
  during the download.
- **Settings drawer** contained to the screen side, so the chat stays. The section order (Safety first), the segmented autonomy
  radiogroup and real headings are right.
- **Beam receipt with "Beam back"**, the staged progress with `aria-valuetext`, and source/ghost two-place presence.
- **Phone agent view** puts Waiting for you first on a wash, with 44 px targets and a collapsible screen.
- **Window title and favicon badge** ("(2) 2 need you · Nova free · Beamhop").

---

## Is anything still slop-like?

Yes, in four places:
1. **The idle bench** (P1-1): three equal text cards, dashed ghost boxes, and 60% empty. This is the exact pattern the ban list
   names.
2. **Cards inside cards** (research 04 §1.3): a receipt box inside a unit card, a washed needs row inside a card, a bordered
   readout inside a card, and an approval card inside a bordered composer area. Every container has a 1 px border and a 12 px
   radius, which is the shadcn rhythm under a new palette.
3. **The readout strip as decoration.** It repeats the status badge in uppercase ("▲ NEEDS YOU · €0.00 TODAY") on every unit, and
   on idle units it says only "FREE · €0.00 TODAY". That's a "stat banner" with nothing to report. Show it only when something
   ticks (working: elapsed, steps, €), and drop it on idle units.
4. **The agent's screen** (P0-2): stock browser chrome (and, on existing agents, the neon robot) inside a crafted bezel. It is
   the most-viewed surface, and it's the least designed.

## What would make it world-class (concrete, beyond the plan)

1. **Make the screen the interface, not a picture of a browser.**
   - Run app-mode Chromium.
   - The bezel bar becomes a *location plate*: favicon, **domain** in medium weight, page title in ink-2, a lock or "first visit"
     tag.
   - Draw the agent's next target on the screen: a pulsing ring where it's about to click and the text it's about to type,
     ghosted in.
   - Approvals rise from the bezel's bottom edge *over the thing they're about*, so "Allow" is decided while looking at the
     button the agent will press. Nobody does this well yet; it removes the "unreviewable click" problem from research 03.
2. **A real "Pause all" key** in the top bar, as physical as the product metaphor promises. It is signal-ringed when anything is
   running, mirrored as `/pauseall` in Telegram, and announced. This is the one control every owner will look for in their first
   scary moment.
3. **"While you were away" strip on the bench.** On return (after more than 10 min hidden), one line above the docks:
   "Since 13:40: Atlas found 3 e-bikes · Scout skipped a payment (you didn't answer) · €0.31". Flags first. Each item opens its
   timeline row. This turns the bench from a status board into the place you check.
4. **Make beaming the signature moment, honestly.**
   - The screen powers down to a line, and a labelled cartridge (plate + "49 MB") travels a track drawn *between the lane
     headers*, filling by real stage.
   - The source stays as a dashed outline; the landing settles with a 0.15 spring.
   - The receipt slides out of the cartridge.
   - Under reduced motion it is a crossfade plus the stage log.
   - It happens once a week per user, so it can afford craft.
5. **Rack mode for idle crews.** Idle units become a tight row of small still screens, each with a plate and a one-line last
   result, like a rack of instruments with their displays dimmed. Working or needs-you units pop out to large size. This fixes
   P1-1 and scales to 20 agents.
6. **Risk with reasons the system actually knows**, not keyword guesses:
   - "first time Scout visits this site"
   - "domain doesn't appear in your task"
   - "page has a card number field"
   - "sends to a new contact"
   Each comes with a one-tap scoped "Always allow bol.com for Atlas today" (never for payments). This addresses the 93%
   rubber-stamp problem directly.
7. **An honest empty brain.** Offer "Try with the practice brain" as a labelled third option in create step 2. It answers with
   canned replies, and a persistent "Practice mode" tag stays on the unit, so the first run produces *something* visible in
   10 seconds without a key.

---

## Method and housekeeping

- **Driver scripts:** written to `/tmp/rv/*.ts`, outside the repo. No source files were edited.
- **Agents:** Atlas, Nova and Scout were created with `--harness mock` in `SCUT_HOME=/tmp/review-home`. Echo was created through
  the UI in `/tmp/review-empty`. All four were removed with `main.ts rm`.
- **Shutdown:** both app servers (7870, 7871) were stopped and the temp homes deleted.
- **Approvals:** created over the agent socket (`autonomy: ask` + chat), the same way `scripts/shoot-bench.ts --ask` does.
  Decisions were made through the UI (keyboard Allow on Atlas, click "Don't" on Scout).
