# Beamhop redesign plan — "Instrument"

Status: approved for build (v0.60 series). Sources: `research/01-agent-products.md`, `research/02-fleet-and-live-screens.md`,
`research/03-trust-transparency-a11y.md`, `research/04-anti-slop-modern-ui.md`. Every rule below cites the evidence there.

## 0. The problem in one paragraph

Today's UI is a dark navy sci-fi template: gradient buttons, glow, starfield, neon robot mascots, pill buttons, mono uppercase
labels, three identical "Ready" screenshots and half a screen of nothing. It also has real UX faults: clicking an agent's screen
silently takes control and traps the keyboard (WCAG 2.1.2), approvals are floating toasts that a stray Enter can approve, status
is shown twice and sits on top of the agent's own browser chrome, cost is in tokens with no time period, settings squeeze the chat
out, and the first screen asks a non-technical person for an API key.

## 1. Principles (the tests every screen must pass)

1. **What needs me comes first.** Every screen answers, in this order: is anything waiting on me, what is happening, what did it
   cost, what's next. (Zapier "Needs action", Cursor "1 working · 1 waiting", Copilot mission control.)
2. **One accent, one meaning.** Orange (`signal`) means *a person is needed* — approvals, take-over, a stuck agent. Nothing else
   is coloured for decoration. Brand, selection and links are ink. (Nothing, Things, FAA colour rules.)
3. **Status = word + shape + (colour).** Never colour alone. Five states only. (Carbon, WCAG 1.4.1.)
4. **Watching is safe; acting is deliberate.** The live screen is watch-only until you press *Take over*. Approve buttons never
   take focus and are inert for 600 ms. Risky approvals are hold-to-confirm. (Steel, TeamViewer, research 03 §1.3.)
5. **Money, not tokens; periods, always.** "€0.42 today", "~€6/month". (Every metered product's #1 complaint.)
6. **Physical metaphors for the one new idea.** Agents are *units* in *docks*; beaming is a cartridge travelling between docks.
   Everything else is plain software. (Arc's novelty tax: one new concept, explained by familiar objects.)
7. **Honest motion.** Motion only explains space or real progress. No shimmer, no loops while idle, no glow. Reduced motion keeps
   colour/opacity feedback.
8. **Keyboard-complete.** Every action reachable by keyboard; ⌘K finds anything; no traps.
9. **Calm by default.** Idle agents don't stream video; previews pause when the window is hidden or reduced motion is set.

## 2. Visual language

### 2.1 Palette (OKLCH, warm neutrals h=85, accent h=42). Light is default; dark follows the OS (`prefers-color-scheme`) and a
manual toggle (`data-theme`).

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` (chassis) | `oklch(0.925 0.006 85)` #E8E6E2 | `oklch(0.185 0.004 85)` #131311 | app background |
| `surface` (panels) | `oklch(0.975 0.004 85)` #F8F7F4 | `oklch(0.225 0.005 85)` #1D1C19 | cards, panels, drawers |
| `surface-2` | `oklch(0.95 0.005 85)` | `oklch(0.26 0.005 85)` | hover, inset wells |
| `line` | `oklch(0.86 0.006 85)` | `oklch(0.30 0.006 85)` | hairlines (decorative) |
| `line-strong` | `oklch(0.60 0.006 85)` | `oklch(0.52 0.006 85)` | input/control borders (≥3:1) |
| `ink` | `oklch(0.23 0.008 85)` | `oklch(0.93 0.006 85)` | text, primary buttons |
| `ink-2` | `oklch(0.46 0.008 85)` | `oklch(0.74 0.006 85)` | secondary text |
| `ink-3` | `oklch(0.545 0.006 85)` | `oklch(0.64 0.006 85)` | meta, placeholders (≥4.5:1) |
| `screen` | `oklch(0.17 0.004 85)` | `oklch(0.12 0.003 85)` | bezel interior |
| `signal` | `oklch(0.66 0.20 42)` #F15B00 | `oklch(0.72 0.18 45)` | "needs you" fills (ink text on it) |
| `signal-ink` | `oklch(0.53 0.17 38)` | `oklch(0.78 0.14 55)` | "needs you" text |
| `signal-wash` | `oklch(0.94 0.03 50)` | `oklch(0.28 0.05 45)` | needs-you backgrounds |
| `ok` | `oklch(0.49 0.115 150)` | `oklch(0.76 0.14 150)` | working lamp only |
| `warn` | `oklch(0.52 0.11 75)` | `oklch(0.82 0.14 80)` | degraded |
| `err` | `oklch(0.53 0.19 27)` | `oklch(0.70 0.17 25)` | failed |

No gradients anywhere except the beam track fill. No coloured shadows. One shadow level (`0 1px 0 line, 0 8px 24px -12px
rgb(0 0 0/.18)`) for floating things only.

### 2.2 Type
- **Mona Sans Variable** (OFL, wdth 75–125) for UI. **Commit Mono** (OFL) for machine strings only (keys, URLs, model ids, codes).
  **Departure Mono** (OFL) only in the unit readout strip. Self-hosted via `@fontsource*` (offline, zero dependencies).
- Scale (13 px base, 4 px grid): micro 11/14 (wdth 85, sentence case), small 12/16, body 13/19, ui-lg 15/20 w550, h3 18/24 w600,
  h2 24/28 w650, display 40/40 wdth 115 w700. Weights 400/550/650/750 only.
- `tabular-nums` on every live number. Numbers formatted with `Intl.NumberFormat` (nl-NL aware).
- **Banned:** Inter-as-identity, Space Grotesk, Instrument Serif, Geist, uppercase tracked mono labels.

### 2.3 Shape, icons, identity
- Radius: 6 px controls, 12 px units/panels, pills only for tags/counts. Hairline borders, not shadows, separate things.
- Icons: **Phosphor** (MIT) at 16 px Regular / 20 px in action bars, Bold or Fill for active. Icons only where they speed scanning
  (places, primary actions, status shapes). No emoji, no unicode glyph icons.
- **Agent identity = Plate**: a 5×5 dot-matrix glyph derived from the agent's public key (mirrored, Nostr-identicon style) plus a
  3-letter callsign (ATL, NOV, SCT) and the name. Monochrome ink. **Robot mascots are retired** from product chrome.
- Status shapes (Phosphor fills): ▲ Needs you (`signal`), ● Working (`ok`, gently pulsing lamp unless reduced motion),
  ○ Free (ink-3 ring), ↗ Moving (ink, arrow), ✕ Problem (`err`). Labels always visible.

### 2.4 Motion tokens
`--ease-out: cubic-bezier(.23,1,.32,1)`, `--ease-drawer: cubic-bezier(.32,.72,0,1)`; press 120 ms (scale .97), pop 150 ms, tray 240 ms,
view 280 ms. Only three crafted moments: **beam** (screen collapses to a line → cartridge travels the track → expands at the new
dock), **take over** (bezel bar turns signal, "You're driving" bar slides down), **task done** (one check). Reduced motion =
crossfade + text log; colour/opacity transitions kept.

## 3. Information architecture

```
Bench (home)                         ⌘K palette (global)
 ├─ Top bar: wordmark · status sentence · € today · ⌘K · New agent · theme
 ├─ Waiting for you (approvals inbox, only when non-empty)
 ├─ Docks (one lane per place: This computer, each cloud, "In a file" ghost)
 │    └─ Units (adaptive size) ─ Beam to… · Open
 └─ Footer: "Open Beamhop when I log in" · Connect a cloud · Open an agent file
Agent (#/agent/:id)
 ├─ Header: ‹ Bench › Dock › Plate+name · status · € today · Safety shield · Beam to… · Phone · Settings
 ├─ Left: Conversation (transcript, done cards, plan/approval cards attached to the composer, steer-while-working)
 ├─ Right: Bezel (watch-only screen) + control bar (Take over · Pause · Stop · Fit/Focus) + readout strip
 │         + Activity (narration timeline, grouped, with times)
 └─ Settings = right drawer with sections (never replaces chat)
Phone (#/agent via phone link): Needs-you first, status sentence, screen collapsible, floating bottom bar.
```

Copy rules: plain verbs, sentence case, no jargon on the main path ("Brain: Claude Haiku (OpenRouter)" not model ids; CPU/RAM move
to a "Computer health" disclosure).

## 4. Screens

### 4.1 Bench (crew home)
- **Top bar (56 px):** wordmark "Beamhop" (Mona Sans wdth 115, ink, no gradient) · *status sentence* generated from state:
  "1 needs you · 2 working · Scout free" — the "needs you" part is a link to the inbox · `€0.42 today` (tabular) · ⌘K search
  button ("Search or do anything ⌘K") · **New agent** (solid ink button) · theme toggle. Window title + favicon badge mirror it.
- **Waiting for you** (only when any): a horizontal tray of ApprovalCards (see 4.3), oldest first, each naming the agent with its
  Plate. Region `role=region aria-label="Waiting for you"`; shortcut `Alt+Shift+A` focuses the oldest.
- **Docks:** one horizontal lane per place, in order: This computer, then clouds (alphabetical), then a dashed **In a file** dock
  (drop target for export). Lane header: place icon + name, `2 agents`, cost (`free` / `~€21/month each`), health ("key OK").
  Empty lane: dashed slot "Nothing here yet. Drag an agent here or use Beam to…". Units stay in **stable name order**; a
  needs-you unit is not reshuffled — it's highlighted and also listed in the tray.
- **Unit (adaptive):**
  - *Large* (working or needs you, or the only agent): bezel with the live screen (small 480 px frames), plate + name, status
    line as a headline sentence ("Comparing e-bike prices on bol.com"), readout strip `● Working · 01:42 · €0.03 today`, actions
    `Open`, `Beam to…`, and when needed an inline `Take over` / approval link.
  - *Compact* (free, nothing happening for 30 s+): no live video. Plate, name, "Free since 14:02", last result line, next routine
    ("Tomorrow 08:00 · HN digest"), dimmed still of the last frame (opacity .35) or nothing. Same actions.
  - Card semantics: `<article aria-labelledby>` with a heading; `Open {name}` is the primary button; no nested interactive in a
    focusable div. Live image has `alt` built from the narration ("Atlas's screen: comparing e-bike prices").
- **Keyboard:** arrows move between units (roving tabindex), Enter opens, `B` beam menu, `1–9` focus unit N, `N` new agent, `?`
  shortcut sheet, ⌘K palette.
- **Pause previews** toggle in the top bar (auto-on for reduced motion / hidden window).
- **First run / no agents:** the bench shows the Create flow inline (not a modal over a blank page).

### 4.2 Beam flow
- Triggers: `Beam to…` menu (keeps the label and `role=menu/menuitem` contract), drag a unit onto a dock (with menu equivalent),
  ⌘K "Beam Atlas to Fly.io (move)".
- **Pre-flight line** in the menu per destination: ✓ key works · cost (`free` / `~€21/month`) · what changes ("Keeps working while
  this computer is off"). Paid destinations show a one-line **confirm bar** in the target dock ("Beam Atlas to Fly.io · ~€21/month ·
  Beam / Cancel", Enter confirms). Free destinations start immediately with a 5 s **Undo**.
- **In flight (two-place presence):** source unit stays in its dock, dimmed, "Stays here until it lands safely"; a **ghost unit**
  appears in the target dock with the stage sentence ("Packing", "Starting the new computer", "Sending 42 MB", "Starting Atlas",
  "Online"), elapsed time, and a `role=progressbar` with `aria-valuetext`. A thin track between the docks fills (ink → signal, the
  one allowed gradient). Live region announces start and arrival; focus is restored to the unit in its new dock.
- **Landing:** receipt line on the unit: "Arrived on Fly.io from This computer in 11 s · 42 MB · came along: 23 messages,
  4 memories, logins, 2 routines" + `Beam back` + dismiss.
- **Failure:** "Beam failed — Atlas stayed on This computer" + one human sentence + `Try again` + `Details` disclosure.
- **File:** menu item "A file, for another computer…" (contract) opens the export dialog with Nintendo-style copy: "This moves Atlas.
  It does not make a copy."

### 4.3 Approvals (everywhere)
ApprovalCard anatomy: plate + "{Agent} wants to" · verb-first title · risk badge (word + icon: Low / Check this / High, derived from
`kind` + keywords, never colour alone) · payload/detail (selectable) · screenshot at the moment it asked (click to enlarge) ·
origin ("from your Telegram message", "routine: HN digest") when known · **expiry countdown** ("Decide within 23 min — then Atlas
skips it") · buttons **Allow** / **Don't** (+ `Take over` when the agent is on screen). Allow is disabled 600 ms after the card
appears and never auto-focused; **High** risk uses hold-to-allow (700 ms fill; keyboard: hold Enter/Space). Resolution echoes
("Allowed by you on Telegram, 14:02").

### 4.4 Agent view
- **Layout:** two resizable columns with a draggable divider (keyboard-resizable, `role=separator`). Default: conversation
  420 px (min 360) on the left, bezel on the right taking the rest. `F` / button = **Focus screen** (conversation collapses to a 56 px
  rail with unread count); `Esc` restores.
- **Header (52 px):** `‹ Bench` · dock breadcrumb (link → beam menu) · Plate + name (h1) · status (shape+word) · `€0.03 today` ·
  safety shield (Good / Look at this, opens the Settings safety section) · `Beam to…` · phone · `Settings`.
- **Bezel:** near-black frame with a thin top bar inside: status lamp, page title/what it's doing, and the **Take over** button
  (when not driving). Screen is **watch-only**: pointer events are ignored except a click anywhere shows a hint "Watching — press
  Take over to use Atlas's computer". **Driving mode** (Take over or Enter on the focused screen): bar turns `signal`, label "You're
  driving · Atlas is waiting", keys and mouse go to the agent, `Give back to Atlas` button; **Esc twice** releases keyboard
  (announced; hint visible, `aria-describedby`). Remote cursors decorative (`aria-hidden`).
- **Control bar** under the bezel: Take over / Give back · Pause (agent) · Stop (when working) · Fit / 1:1 · Focus. Then the
  **readout strip** in Departure Mono: `WORKING · 01:42 · €0.03 TODAY · 12 STEPS` (the one place we allow small caps readouts).
- **Activity** (under the readout): grouped narration timeline with times, newest first, max 6 visible + "Show all", replaces
  the collapsed mono `<details>`. Polite live region throttled: announces at most one step every 8 s.
- **Conversation:** `role=log`. Messages as plain text blocks (no bubbles-with-gradients): sender + time line, then text. Agent
  replies get a left rule. Starter suggestions when empty (keep the three). Composer pinned at the bottom: textarea (Enter sends,
  Shift+Enter newline), "Will apply after this step" hint while working, approvals for this agent attached **above the
  composer**. Pairing card (Telegram one-tap + QR) sits at the top of the conversation when unpaired channels exist.
- **Settings drawer** (right, 440 px, over the bezel side only, Esc closes, focus-trapped): sections with real headings, in this
  order: Safety · What {name} does · Brain · How much it may do on its own (3-position segmented control: Ask first / Risky only /
  Never ask, as a `radiogroup` with a `legend`) · Daily spending limit **in €** (converted to tokens with the model price; shows
  "0 = no limit") · Chat apps · Scheduled tasks (+ recent runs) · Memory ("What {name} knows", editable) · Skills · Computer
  health (CPU/RAM) · Remove. Contract strings stay ("Autonomy" is the section's subtitle or legend text).

### 4.5 Create flow (job first)
Inline on the bench (first run) or as a sheet (later): **1. What should it help with?** three template cards + free text + name
(optional) → **2. Give it a brain** (tiles: "Use my ChatGPT or Copilot subscription" first-class, OpenRouter, OpenAI, Anthropic,
Local (Ollama); key check stays; "Skip this" stays) → **Create** (shows the first-run download progress inside the sheet; first
task can be typed while it downloads). "Open an agent file" link on step 1. Keep all test-contract labels.

### 4.6 Phone (agent alone)
Single column: header (plate, name, status) → Waiting for you → status sentence + readout → screen (collapsed by default to a
16:10 thumbnail, tap to expand) → conversation → floating bottom bar (Talk · Take over · Pause · Settings), 44 pt targets.

### 4.7 Command palette (⌘K / Ctrl+K)
Fuzzy search over commands with synonyms: Open {agent}, Beam {agent} to {place} (move/send/transfer), Pause/Resume {agent},
Stop {agent}, Talk to all agents, New agent, Connect a cloud, Open an agent file, Move {agent} to a file, Settings of {agent},
Toggle theme, Pause previews. Shows shortcuts. `role=dialog` + `combobox`/`listbox` APG pattern.

## 5. Accessibility checklist (must pass)
WCAG 2.2 AA: no keyboard trap (two-mode screen), focus visible ≥2 px at 3:1 everywhere (`:focus-visible` ring in ink with 2 px
offset), targets ≥24 px (44 px on phone), contrast text ≥4.5:1 and controls ≥3:1, no colour-only status, live regions present at load
(one polite, one assertive) and throttled, approvals never steal focus, modal dialogs per APG (focus trap, Esc, restore focus),
headings and landmarks (`main`, `nav`, `aside`, one `h1`), fieldset/legend for radio groups, non-drag alternative for every drag,
reduced motion respected, live previews pausable, zoom to 200% without loss. axe-core: zero violations (existing test).

## 6. Anti-slop ban list (enforced in review)
No gradients (except beam track) · no glow or coloured shadows · no starfield/background decoration · no `rounded-full` except
tags/counts/status lamps · no uppercase tracked mono labels (only the readout strip) · no emoji/unicode-glyph icons · no robot
mascots · no new accent colours; every colour is a token · every status has a word and a shape · no "AI ✨" copy · no Inter/Space
Grotesk/Instrument Serif/Geist · no three-equal-cards with empty half screen · no toasts for things that need a decision.

## 7. Build plan (parallel agents)

**Phase 1 — Foundation (one agent, blocking):** tokens in `styles.css` (Tailwind v4 `@theme`, light + dark + `data-theme`),
fonts and Phosphor installed and self-hosted, primitives in `packages/ui/src/ui/`:
`Button` (primary ink / secondary / quiet / signal / danger; sizes), `IconButton` (with tooltip + aria-label), `StatusBadge` +
`Lamp` (5 states), `Plate` (key-derived dot glyph + callsign), `Bezel` (screen frame + top bar slot), `Readout`, `Drawer`,
`Dialog` (APG modal), `Menu`, `Segmented` (radiogroup), `Field`/`Input`/`Textarea`/`Select`/`Switch`, `Kbd`, `Progress`,
`Announcer` (polite+assertive live regions + `announce()`), `useHotkeys`, `CommandPalette` shell with a command registry, `Tray`,
`HoldButton`, `money()`/`fmt` helpers. A `#/design` route showing every primitive in both themes. `DESIGN.md` with the ban list.

**Phase 2 — Screens (four agents in parallel, each owns its files):**
- A **Bench + Beam** (`crew.tsx`, `beam.tsx`): top bar, status sentence, inbox tray, docks, adaptive units, drag + menu + confirm
  + ghost + receipt, palette commands, keyboard model, pause previews, footer.
- B **Agent view + Phone** (`agentView.tsx`): layout + divider, header, bezel watch/drive modes and keyboard fix, control bar,
  readout, activity timeline, conversation + composer + attached approvals, phone layout.
- C **Settings + Create + dialogs** (`settings.tsx`, `create.tsx`, add-cloud/export/import dialogs): drawer, € limit, segmented
  autonomy, memory/skills/routines restyle, job-first create, dialogs on `Dialog`.
- D **Backend for transparency** (`packages/protocol`, `packages/agentd`, `packages/agent`): structured approvals
  (`kind`, `risk`, `expiresAt`, `origin` on `approval.request`; `request_approval` tool accepts kind/risk), approval expiry
  surfaced, richer Telegram approval text, `headline` (current task sentence) + `lastActiveAt` in `state`/`stats` messages so the
  bench can show "Free since 14:02".

**Phase 3 — Integration & verification (lead):** merge, update UI tests (same flows, new copy where intended), axe zero,
screenshots in both themes and phone, independent design review against §1/§6, fix round, version, push, report.

## 8. Decisions taken while the owner was away (reversible)
- Direction **Instrument** (light-first, warm neutrals, orange "needs you") over the recorded teal/violet palette, because that hue
  band is where generated UIs cluster. Alternative kept in research 04 §4.3 (teal as single accent).
- **Robot mascots retired** for agent identity (key-derived plates instead): cute mascots lower vigilance exactly where agents send
  messages and money. The brand mascot can return in marketing and the app icon.
