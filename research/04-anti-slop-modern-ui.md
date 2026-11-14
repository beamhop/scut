# 04 — Anti-slop: making Beamhop look crafted, not generated

Research date: 2026-11-14. Scope: what makes the UI read as "AI slop", what crafted 2025–2026 interfaces do instead, and three directions for Beamhop (desktop app where non-technical people run a crew of agents. Each agent has its own live screen, chat and approvals, and can be "beamed" between a laptop and clouds).

Inputs: `research/shots/{home-v048,firstrun-v044,settings-v040,phone-v043}.png`, `packages/ui/src/styles.css`, `packages/ui/src/App.tsx` (class frequency scan). Every non-obvious claim has a source URL; the full list is in §10.

---

## 0. Diagnosis: what the current screens are doing

Seen in the screenshots and code. The count after each item is how many of Adrian Krebs' measured slop patterns it hits (§1).

| # | What is on screen | Where in code | Slop pattern |
|---|---|---|---|
| 1 | Navy near-black page (`#070912`) with two radial colour glows (violet top-right, cyan bottom-left) | `styles.css` body background | Perma-dark mode, gradients, coloured glows |
| 2 | Starfield `.stars::before` | `styles.css` | Decorative atmosphere with no meaning ("dark + glow = premium") |
| 3 | Primary CTA "+ New agent" as a cyan→violet gradient pill; wordmark "Beam**hop**" in two colours | `bg-gradient-to-r from-beam to-beam2`, `--color-beam #38e1ff`, `--color-beam2 #b06bff` | "VibeCode purple" and blue→purple gradient, which one source calls "the single loudest AI tell in 2026" |
| 4 | Each agent a different neon robot (cyan / magenta / lime) | `Mascot` variants | "Neon palettes competing for attention", cute AI-mascot cliché |
| 5 | Pill buttons everywhere (`rounded-full` appears 32+ times), dashed "+ Add a cloud" ghost tiles | App.tsx | shadcn-default look, capsule badges |
| 6 | Monospace UPPERCASE tracked labels: `THIS COMPUTER`, `WHERE YOUR AGENTS LIVE · DRAG ONE HERE TO MOVE IT`, `BRAIN`, `AUTONOMY`, `ACTIVITY (1)` (`uppercase tracking-widest` ×11, `font-mono` ×34) | App.tsx | "Perma dark mode with medium-grey body text and all-caps section labels" |
| 7 | Three identical cards in a row, then a large empty void, then a dock | Home grid | "Three equal cards / identical spacing, no hierarchy" |
| 8 | Status shown twice per tile ("● Ready" chip on the screen and "Ready" under the name). Name shown three times (screen splash, tile title, mascot). | Tile | "Meaningless status dots", redundancy |
| 9 | Unicode glyph icons (`◌ ◆ ○ ✓ ▶`) and a 📱 emoji button in the agent header | `STATE_META`, header | Emoji/glyphs as UI icons = "no iconography decision made" |
| 10 | Glow rings for state (`.glow`, `.glow-stuck` pulse, `.drop-hot` 40px cyan glow) | styles.css | "Vibrant box shadows" |
| 11 | Beam animation: infinite scanlines plus a `hue-rotate + blur + scaleY` "teleport" loop | `.beam-overlay`, `.teleport` | Decorative motion that tells you nothing about progress |
| 12 | Live screens show raw Chromium chrome (pale-blue tab strip, "Sign in to Chromium?") inside a navy card. The two clash. | AgentView frame | Unfinished seams (the opposite of "thorough down to the last detail") |
| 13 | Reduced-motion rule kills **all** transitions, including colour/focus feedback | `@media (prefers-reduced-motion)` `transition:none!important` | Accessibility done bluntly (the guidance is to keep opacity and colour transitions) |
| 14 | Inter / `system-ui` everywhere with no display face | `--font-sans` | "Inter unchosen signals nobody made a typography decision" |

What already works and should be kept: the **copy** is plain, warm and specific ("Pause & let me drive", "Ask me first — every action needs approval", "Risky only — payments, messages, deletes, logins", "do logins and payments yourself"). That is the opposite of slop copy. Also keep the live screens as the hero, the drag-to-dock beaming model, and the receipt after a beam ("what came along").

The brand drifted. The recorded Beamhop identity (from memory) is midnight indigo `#0B0E1A`, teal "beam" `#5EEAD4`, violet "hop" `#8B7BFF`, and a **kawaii bunny** mascot with expression states plus a GSAP comet/bunny wordmark. The product now ships generic **robots**, not the bunny. The palette also matches the exact cyan/violet-on-navy centre that LLMs converge on (95.4% of AI-generated UI colours sit near 240° per one 2026 analysis). Even the "owned" brand palette is the slop palette.

---

## 1. Catalogue of AI-slop tells, and why each reads as generic

Root cause, stated by Anthropic's own frontend-design guidance: models sample the "high-probability centre" of their training data. This is **distributional convergence**, and without direction they produce safe, generic design ([claude.com](https://claude.com/blog/improving-frontend-design-through-skills)). A specific mechanism: Tailwind's demo colour `bg-indigo-500` was copied so widely that models learned "purple = modern" ([prg.sh](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website); [dev.to/alanwest](https://dev.to/alanwest/why-every-ai-built-website-looks-the-same-blame-tailwinds-indigo-500-3h2p)). Key line from prg.sh: "The model can execute. You have to direct."

**Measured prevalence.** Adrian Krebs ran deterministic DOM/CSS checks on Show HN submissions (Playwright, no LLM judging, ~5–10% false positives). Of 1,590 scored, 22% had ≥4 slop patterns ([adriankrebs.ch](https://adriankrebs.ch/blog/design-slop/)). In GIGAZINE's summary of the 500-site sample: gradients 28%, default shadcn/ui 23.5%, centred titles 23.5%, always-dark 20.3%, templated feature grid 20.1%, glass panels 17.1%, trendy fonts 15.8%, coloured accent lines on cards 13%, stat banners 12.2%, purple CTAs 10.7%, all-caps headings 10.5% ([gigazine](https://www.gigazine.net/gsc_news/en/20260423-design-slop)).

### 1.1 Colour
| Tell | Why it reads as generic | Source |
|---|---|---|
| Blue→purple / cyan→violet gradients | "nobody's brand color". It shows the default was accepted, not chosen. "The Times New Roman of AI-generated design." | [utsubo](https://www.utsubo.com/blog/built-with-ai-trust-signals-2026), [Fountain](https://www.thefountaininstitute.com/blog/signs-vibe-coded-ui), [925studios](https://www.925studios.co/blog/ai-slop-design-tells) |
| Hue collapse to 210–270° | 95.4% of AI-generated UI colours near 240°, 0% outside 210–270° (sample not fully described) | [dev.to/kenimo49](https://dev.to/kenimo49/why-ai-generated-uis-are-all-the-same-color-and-the-data-to-prove-it-12oe) |
| 5–6 neon accents at full saturation | No hierarchy, so everything shouts at once | [Fountain](https://www.thefountaininstitute.com/blog/signs-vibe-coded-ui) |
| Decorative dark-mode glow / radial blobs | "dark background plus glow equals premium" was absorbed as a rule. The glow carries no state. | [Fountain](https://www.thefountaininstitute.com/blog/signs-vibe-coded-ui), [Krebs](https://adriankrebs.ch/blog/design-slop/) |
| Perma-dark with barely passing grey body text | Dark is the template default, and contrast is usually too low | [Krebs](https://adriankrebs.ch/blog/design-slop/) |
| Multicoloured side stripes on cards | Each looks styled locally. Across the page they "conflict and cancel out". | [Fountain](https://www.thefountaininstitute.com/blog/signs-vibe-coded-ui), [Krebs](https://adriankrebs.ch/blog/design-slop/) |
| Status dots on everything | "look like data without communicating any" | [Fountain](https://www.thefountaininstitute.com/blog/signs-vibe-coded-ui) |

### 1.2 Type
| Tell | Why | Source |
|---|---|---|
| Inter everywhere, no display face | "Inter unchosen signals nobody made a typography decision" | [925studios](https://www.925studios.co/blog/ai-slop-design-tells), [utsubo](https://www.utsubo.com/blog/built-with-ai-trust-signals-2026) |
| The *second-order* defaults: **Space Grotesk, Instrument Serif, Geist**, and one italic serif word in an Inter hero | LLMs already learned the "tasteful alternatives", and Anthropic notes even guided models drift to Space Grotesk | [Krebs](https://adriankrebs.ch/blog/design-slop/), [claude.com](https://claude.com/blog/improving-frontend-design-through-skills) |
| All-caps tracked section labels (often mono) | Template label style paired with perma-dark | [Krebs](https://adriankrebs.ch/blog/design-slop/) |
| Timid scale (1.2–1.5× steps, all 400/600) | No hierarchy. Anthropic recommends 3×+ jumps and extreme weight contrast for expression. | [claude.com](https://claude.com/blog/improving-frontend-design-through-skills) |

### 1.3 Layout and components
| Tell | Why | Source |
|---|---|---|
| Three equal cards in a row, identical gaps | "Real design has hierarchy: things that matter get more room." | [utsubo](https://www.utsubo.com/blog/built-with-ai-trust-signals-2026), [prg.sh](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website) |
| Cards inside cards | "In AI-generated interfaces, everything goes in a card." Use cards only for independently actionable objects. | [Fountain](https://www.thefountaininstitute.com/blog/signs-vibe-coded-ui) |
| Default shadcn/ui, pill badges above titles, glass panels | The component kit's defaults *are* the look | [gigazine](https://www.gigazine.net/gsc_news/en/20260423-design-slop) |
| Centred hero, "1-2-3" steps, stat banners | Template skeleton | [Krebs](https://adriankrebs.ch/blog/design-slop/) |
| **Dark + dense "Linear look"** | Now "the default output of every AI design tool". A dark dense UI increasingly reads as "someone pressed enter in a builder and shipped". | [buildmvpfast](https://www.buildmvpfast.com/blog/linear-aesthetic-tokens-density-keyboard-first-ux-2026) |
| Missing finish: no error/empty states, placeholder alt, unreviewed code | "Nobody finished the job." | [utsubo](https://www.utsubo.com/blog/built-with-ai-trust-signals-2026), [prg.sh](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website) |

### 1.4 Iconography and illustration
| Tell | Why | Source |
|---|---|---|
| Emoji as nav/section icons | Shows no icon system was chosen | [Fountain](https://www.thefountaininstitute.com/blog/signs-vibe-coded-ui), [Krebs](https://adriankrebs.ch/blog/design-slop/) |
| Thin-line generic icons on every item | Icon on every row makes menus *less* scannable (Tonsky on macOS Tahoe menus) | [designcompass](https://designcompass.org/en/2026/01/13/apple-tahoe-icon-design-that-has-lost-usability/), [925studios](https://www.925studios.co/blog/ai-slop-design-tells) |
| Plastic AI illustration | "slightly too smooth, slightly too symmetrical" | [utsubo](https://www.utsubo.com/blog/built-with-ai-trust-signals-2026) |
| Cute AI mascots ("cutewashing") | Everyone has one, so "no one has a memorable anthropomorphic AI mascot". Cuteness also nudges users to forgive agent errors. | [Fast Company](https://www.fastcompany.com/91620091/big-tech-is-cutewashing-its-ai-agents) |

### 1.5 Motion
| Tell | Why | Source |
|---|---|---|
| Identical fade-ups and hover lifts everywhere | "Motion with no purpose" | [utsubo](https://www.utsubo.com/blog/built-with-ai-trust-signals-2026) |
| Looping decorative effects (pulses, scanlines, shimmer) | Animation on high-frequency surfaces becomes "cognitive burden after the hundredth time" | [Rauno](https://rauno.me/craft/interaction-design), [Emil](https://emilkowal.ski/ui/great-animations) |
| Animating keyboard actions, `ease-in` curves, `scale(0)` entrances | Feels slow and artificial | [Emil skill](https://www.ui-skills.com/skills/emilkowalski/emil-design-eng) |

### 1.6 Copy
| Tell | Source |
|---|---|
| Weightless slogans ("Build faster. Ship smarter."), buzzwords ("seamless", "robust"), "In today's fast-paced world", em-dash confetti, emoji bullets, hedging | [utsubo](https://www.utsubo.com/blog/built-with-ai-trust-signals-2026), [925studios](https://www.925studios.co/blog/ai-slop-design-tells) |

Beamhop's copy mostly passes. Watch for em-dash density in settings copy (e.g. "Ask me first — …", "Never ask — acts on its own — not…"). Use a colon or a line break instead of stacked em-dashes.

**Rule of thumb.** Slop is not any one of these. It is **several defaults stacked with no reason** ("the problem lies in using what AI outputs as is", Krebs via [gigazine](https://www.gigazine.net/gsc_news/en/20260423-design-slop)). Each visual element must be able to answer "what does this tell the user?". If it can't, remove it.

---

## 2. What feels crafted in 2026: references, and what to steal from each

| Reference | What exactly it does | Steal for Beamhop |
|---|---|---|
| **Linear** (2024 redesign, 2025 refresh, Mar-2026 "calmer" UI) | Theme generator moved HSL→**LCH**. 98 theme variables collapsed to **3 inputs: base, accent, contrast**, which gives free high-contrast themes. Inter Display for headings only. Sidebar "a few notches dimmer" so content leads. Fewer and smaller icons; coloured team-icon backgrounds removed. Principles: "Don't compete for attention you haven't earned" and "Structure should be felt not seen". ([redesign](https://linear.app/now/how-we-redesigned-the-linear-ui), [refresh](https://linear.app/now/behind-the-latest-design-refresh), [changelog](https://linear.app/changelog/2026-03-12-ui-refresh)) | Generate the whole theme from 3 OKLCH inputs. Dim the chrome; agent screens get full contrast. **Do not copy the surface** (dark, dense, blue accent), which is now the slop default ([buildmvpfast](https://www.buildmvpfast.com/blog/linear-aesthetic-tokens-density-keyboard-first-ux-2026)). |
| **Raycast** | Larger search field, bigger result icons for scanning, Compact Mode, a **bottom action bar** that unifies the current title, toasts and context actions *with their shortcuts shown*. Keycap app icon. No UI animation, and it feels right. ([Raycast](https://raycast.com/blog/a-fresh-look-and-feel), [Emil](https://emilkowal.ski/ui/great-animations)) | A persistent bottom action bar in the agent view: state, current step, "Take over", "Beam…", with keys shown. Make keyboard actions instant. |
| **Arc → Dia** | Arc's lesson in Josh Miller's words: "too different, with too many new things to learn, for too little reward". Only 5.52% of DAUs used more than one Space. Dia aims to "hide complexity behind familiar interfaces". ([Browser Company](https://browsercompany.substack.com/p/letter-to-arc-members-2025)) | For non-technical users, **one novel concept at most** (beaming). Everything else is familiar: list, screen, chat, switch. |
| **Things 3** | Neutral UI with colour reserved for meaning (yellow = Today, red = deadline). The ~500 ms completion ritual (fill, check, sound) is a reward. "Keyboard accelerates, mouse welcomes." ([Crosley](https://blakecrosley.com/blog/design-study-things), [MacStories](https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/)) | Approving an action and finishing a task are the two moments that earn a crafted micro-ritual. Nothing else does. |
| **Notion Calendar (Cron)** | Extreme type-scale contrast in one family. Grid lines at ~9% opacity ("Borders should organize, not decorate"). Monospaced numerals in the time gutter. Fully keyboard-operable, and "keyboard-first justifies visual minimalism". ([Crosley](https://blakecrosley.com/guides/design/notion-calendar)) | Tabular figures for cost/CPU/time. Hairlines, not boxes. Single-key shortcuts (`n` new agent, `b` beam, `t` take over). |
| **Figma UI3** | Tested floating panels and **reverted** them: they cramped the canvas, let designs peek through, and slowed heavy users. Kept "Minimize UI". Labels became full tooltips for accessibility. "Speed is a feature." ([Figma](https://www.figma.com/blog/our-approach-to-designing-ui3/)) | Fixed, resizable side panel for chat/settings, not floating glass. The agent's screen is "the canvas". |
| **Family wallet** (Benji Taylor) | Simplicity, fluidity, delight. **Trays** that overlay context instead of replacing it, with varied heights so transitions read. **Text morph** ("Continue" → "Confirm") on higher-stakes steps. Spatial navigation: "We fly instead of teleport." Delight concentrated on *infrequent* features. ([benji.org via reader](https://hn.jakechampion.name/reader/https://benji.org/family-values)) | Approvals as a tray over the agent screen. "Approve" morphs to "Hold to approve" for risky actions. Beaming should *fly*, not teleport, which literally contradicts the current hue-rotate "teleport" effect. |
| **Rauno Freiberg** | Kinetic physics (gestures keep momentum), interruptible animation, lightweight actions mid-gesture but **destructive actions on gesture end**, motion weighed against frequency, spatial consistency, reuse real-world metaphors. ([rauno.me](https://rauno.me/craft/interaction-design)) | Drag-to-beam: show the drop preview mid-drag, commit only on release, and keep the throw momentum on landing. Allow cancel while beaming. |
| **Emil Kowalski** (Sonner, Vaul) | Under 300 ms. ease-out by default, never ease-in. Never animate keyboard actions. Press `scale(.97)`. Popovers grow from their trigger. Animate only transform/opacity. ([great-animations](https://emilkowal.ski/ui/great-animations), [skill](https://www.ui-skills.com/skills/emilkowalski/emil-design-eng)) | Motion tokens in §5 come from here. |
| **Vercel Geist** | Colour scale by **purpose**: 100–300 component backgrounds (default/hover/active), 400–600 borders, 700–800 high-contrast fills, 900–1000 text ([Geist colors](https://vercel.com/geist/colors.md)). Geist Sans is built on Swiss principles (Univers lineage); OFL ([repo](https://github.com/vercel/geist-font)). | Copy the token *structure*, not the font (Geist is now on Krebs' "LLM font" list). |
| **Radix Colors** | 12 steps: 1–2 app background, 3–5 component (normal/hover/pressed), 6–8 borders (8 = focus), 9–10 solid, 11–12 text. Steps 11/12 guaranteed APCA Lc 60/90 on step 2. ([Radix](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)) | Same: status colours get a solid/text/wash triple, never ad-hoc `/10` opacities. |
| **Teenage Engineering OP-1 field** | Constraints as aesthetic: one small screen, 4 encoders mapped to 4 on-screen parameters, every function ≤2 presses away. Playful animated feedback (tape reels, dancing waveforms). Monospace across product/docs. A limited palette. "Depth, texture and character" without imitating analog. ([Crosley TE guide](https://blakecrosley.com/de/guides/design/teenage-engineering), [TE](https://teenage.engineering/products/op-1)) | Agent state as *instrument readouts*. Few controls, each always in the same place. Playful motion only where the machine is actually working. |
| **Nothing OS** | Black, white and **one red**. Dot-matrix type (Ndot, proprietary) as the most ownable asset. Transparency that shows real internals. "disciplined minimalism plus one bold accent" ([madegooddesigns](https://madegooddesigns.com/nothing-brand-guidelines/)) | One accent with one meaning. A dot-matrix identity glyph per agent, derived from its key (see §6). Show the agent's real internals (its live screen) instead of a decorative splash. |
| **Braun / Dieter Rams** | "Good design is honest… unobtrusive… thorough down to the last detail… as little design as possible" ([IxDF](https://ixdf.org/literature/article/dieter-rams-10-timeless-commandments-for-good-design)) | Honest beaming: show real stages and bytes, not a decorative loop. |
| **macOS Tahoe / Liquid Glass critiques** | Contrast measured as low as 1.5:1 in beta. Text fades into backgrounds, and blur confuses what is interactive ([Infinum](https://infinum.com/blog/apples-ios-26-liquid-glass-sleek-shiny-and-questionably-accessible/)). Called "skeuomorphism in disguise… Contrast suffers. Legibility collapses." ([WDD](https://webdesignerdepot.com/how-apple-quietly-brought-skeuomorphism-back-to-life/)). Menu icons on every item made menus "obnoxious, distracting, hard to read" (Tonsky via [designcompass](https://designcompass.org/en/2026/01/13/apple-tahoe-icon-design-that-has-lost-usability/)). | **No glass over live screens.** Keep text on opaque surfaces. Icons only where they speed scanning. |
| **Swiss / "precision turn"** | 2026 framing: when generated output defaults to elaborate, "the deliberate becomes distinctive"; "precision as a position, restraint as a creative argument" ([studio2am](https://studio2am.co/blogs/news/the-precision-turn-why-minimalist-geometric-design-is-reasserting-itself-in-2026)) | Grid, flush-left, hairlines, real hierarchy. |
| **Brutalist / editorial web** | Broken layouts, raw HTML, monospace rising as a counter-movement to ubiquitous bento: "It is not retro nostalgia. It is positioning." Glassmorphism retreating to nav/modals. ([studiomeyer](https://studiomeyer.io/en/blog/webdesign-trends-2026-reality-check)) | Usable as an accent, but risky for non-technical users. |
| **Terminal-inspired UIs** (Charm, Warp, Ghostty) | Monospace and box-drawing done with discipline ([Charm/Lip Gloss](https://charm-docs.vercel.app/docs/lipgloss)). Note that mono uppercase labels on dark are themselves a slop tell when used as decoration ([Krebs](https://adriankrebs.ch/blog/design-slop/)). | Mono only for machine data: keys, URLs, logs, costs. |
| **Skeuomorphic / tactile revival** | Physical-media revival lessons: ownership, tangibility, deliberate friction, while avoiding neumorphism's "uncanny UI valley" ([UX Collective](https://uxdesign.cc/what-digital-ux-can-learn-from-the-physical-media-revival-b06ccbb44852)). **Cassette futurism** ("NASA-punk") is the lived-in alternative to the shiny space look "that almost every game uses" ([Film Stories](https://filmstories.co.uk/features/cassette-futurism-alternatives-to-the-sci-fi-space-aesthetic-that-almost-every-game-uses/)). | The `.beamhop` file *is* a portable owned object. Treat it like a cartridge. Starfield sci-fi is the generic option; instrument and used-future sci-fi is the crafted one. |
| **Mission control: NASA Open MCT, FAA ATC displays** | Open MCT: composable views of live and historical telemetry ([NASA](https://nasa.github.io/openmct/about-open-mct)). FAA terminal display standard: "Use of color in general should be kept to a minimum". Red = warning and yellow = caution "cannot be violated". Critical info must not rely on colour alone. No pure blue for text or fine detail. ([FAA JO 7210.3](https://www.faa.gov/air_traffic/publications/atpubs/foa_html/chap3_section_9.html)) | Colour is reserved for states that need a human. Every status is redundantly encoded (word + shape + position). |

---

## 3. Typography

### 3.1 Avoid
- **Inter alone** (the current default via `system-ui`) and the second-order "tasteful" defaults LLMs now emit: **Space Grotesk, Instrument Serif, Geist** ([Krebs](https://adriankrebs.ch/blog/design-slop/)). Anthropic's skill also lists Inter, Roboto, Open Sans, Lato and system fonts as "never use" ([claude.com](https://claude.com/blog/improving-frontend-design-through-skills)).
- Mono uppercase tracked labels as decoration.

### 3.2 Open-licence pairings for a dense tool UI with personality
All licences checked against the foundry or package page where linked. Google Fonts families are SIL OFL 1.1; re-check at download time.

| Pairing | UI / text | Display / identity | Data / mono | Licence | Character |
|---|---|---|---|---|---|
| **P1 Instrument** (rec.) | **Mona Sans** var: wght 200–900, **wdth 75–125**, ital | Mona Sans Expanded (wdth 125) for wordmark and big readouts. Condensed (wdth 75–85) for engraved-style labels. | **Commit Mono** (var 200–700, "anonymous and neutral") for keys/URLs/logs. **Departure Mono** (pixel, "lo-fi, techy") *only* for LCD-style readouts. | Mona: OFL 1.1 ([GitHub](https://github.com/github/mona-sans)). Commit: OFL 1.1 ([fontsource](https://fontsource.org/fonts/commit-mono/about)). Departure: SIL OFL ([site](https://departuremono.com/)). | One variable family gives the whole hardware vocabulary (condensed labels, wide numerals). Not on any slop list. |
| **P2 Flight strip** | **IBM Plex Sans** + **Plex Sans Condensed** | Plex Sans Condensed SemiBold for callsigns | **IBM Plex Mono** | OFL 1.1 | Engineering heritage. Plex supports `tnum` ([dev.to](https://dev.to/alanwest/tabular-numbers-in-css-font-variant-numeric-vs-monospace-hacks-25cn)). Condensed widths fit strips. |
| **P3 Editorial** | **Schibsted Grotesk** (built for a news publisher) | **Newsreader** (opsz axis, Production Type) or **Fraunces** (opsz/SOFT/WONK) | Commit Mono | OFL 1.1 | Real newspaper hierarchy. Serif for headlines only, never in controls. |
| Accessibility option | **Atkinson Hyperlegible Next** (2025, more weights) + **Atkinson Hyperlegible Mono** | n/a | Atkinson Mono | Free from Braille Institute, OFL on Google Fonts/fontsource ([Tietze](https://christiantietze.de/posts/2025/02/atkinson-hyperlegible-font-next-mono/), [fontsource](https://fontsource.org/fonts/atkinson-hyperlegible-mono/about)) | For a "high-legibility" setting; mirrors Linear's contrast input. |

Self-host via `@fontsource-variable/*` so the desktop app works offline. This fits the "no external dependencies" constraint.

### 3.3 Type scale (desktop tool, 13 px base)
Linear-class tools run a 13 px body on a 4 px grid, with 32–36 px rows ([buildmvpfast](https://www.buildmvpfast.com/blog/linear-aesthetic-tokens-density-keyboard-first-ux-2026)). Hierarchy comes from **big jumps**: Notion Calendar pairs 64 px with 12 px in one family ([Crosley](https://blakecrosley.com/guides/design/notion-calendar)), and Anthropic's guidance asks for 3×+ jumps.

| Token | px / line-height | Use |
|---|---|---|
| `--t-micro` | 11 / 14, wdth 85, +0.02em, sentence case | Plate labels, units ("CPU", "€ today") |
| `--t-small` | 12 / 16 | Secondary meta, timestamps |
| `--t-body` | 13 / 19 (1.45) | Everything default |
| `--t-ui-lg` | 15 / 20, 550 | Agent name in lists, dialog body |
| `--t-h3` | 18 / 24, 600 | Panel titles |
| `--t-h2` | 24 / 28, 650, -0.01em | View titles |
| `--t-display` | 40 / 40, wdth 112–125, 700, -0.02em | Agent name on its own screen, empty states, beam-in moment |
| `--t-readout` | 32–48, mono/pixel, `tnum` | Live counters on the instrument plate (cost, elapsed) |

Weights: 400 / 550 / 650 / 750 only. Drop `font-semibold` sprinkled on 16+ elements. Prefer size or weight changes over colour for hierarchy. On mobile, scale the base to 15 px rather than shrinking 11 px labels.

### 3.4 Numeric needs
- `font-variant-numeric: tabular-nums` on every live number: CPU %, RAM, € spent, token counts, timers, beam bytes, queue counts. Otherwise digits jitter as they tick. Use `tabular-nums slashed-zero` for codes and token counts. `tnum` silently does nothing if the font lacks it, so verify per font ([dev.to](https://dev.to/alanwest/tabular-numbers-in-css-font-variant-numeric-vs-monospace-hacks-25cn), [MDN](https://developer.mozilla.org/docs/Web/CSS/font-variant-numeric)). Tailwind: `tabular-nums`, `slashed-zero`.
- Real monospace only for machine strings: API keys (masked `sk-or-…9f2c`), URLs, `/pair 4821` codes, log lines, model IDs (`anthropic/claude-…`).
- Format numbers for humans: "€0.00 today", "1.3 of 7.8 GB", "1 M tokens/day" rather than `1000000` in a raw input. Use `Intl.NumberFormat` with locale, which matters in NL (comma decimals).

---

## 4. Colour

### 4.1 Method (OKLCH, generated, three inputs)
1. **Work in OKLCH.** L is perceptual, so the same L gives roughly the same contrast across hues. HSL's L doesn't ("Different hues represent different 'real' lightness values"). OKLCH can also address P3 ([Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)). Tailwind v4's palette is already OKLCH.
2. **Generate from 3 inputs like Linear:** `base` (neutral hue + tiny chroma), `accent` (one hue), `contrast` (scales the L spread; gives a high-contrast theme for free) ([Linear](https://linear.app/now/how-we-redesigned-the-linear-ui)).
3. **Name tokens by purpose** (Radix/Geist structure): `bg`, `surface`, `surface-hover`, `line`, `line-strong`, `ink`, `ink-2`, `ink-3`, and per status `X-solid`, `X-ink`, `X-wash`.
4. **Neutrals carry a temperature.** Linear moved to "a warmer gray that still feels crisp, but less saturated" ([Linear](https://linear.app/now/behind-the-latest-design-refresh)). Beamhop should leave hue 250–270 (navy) entirely. Use warm hue 85 at chroma ≤0.008.
5. **One accent, one meaning.** Nothing (one red), Things (colour = meaning), FAA ("kept to a minimum"). For Beamhop the accent should mean **"a human is needed"**: approvals, takeover, stuck agent. Brand, selection and links are ink, not accent. That one decision removes most of the slop.
6. **Status colours are redundant.** Always pair a word and a shape: ▲ needs you, ■ stopped, ● working, ✕ failed. Colour must never be the only carrier (FAA, WCAG 1.4.1).
7. **Contrast targets:** text ≥4.5:1 (WCAG AA); UI boundaries and state indicators ≥3:1 (WCAG 1.4.11). Lc 60/90 if checking APCA (Radix's guarantee). Dark themes must not drift into the "barely passing" grey Krebs measures.

### 4.2 Recommended palette (Direction B "Instrument"). All values computed from OKLCH and contrast-checked (WCAG 2 ratio).

**Light (default; light-first is itself a differentiator now that dark/dense is the AI default):**

| Token | OKLCH | Hex | Contrast |
|---|---|---|---|
| `bg` (chassis) | 0.925 0.006 85 | `#E8E6E2` | — |
| `surface` (panels) | 0.975 0.004 85 | `#F8F7F4` | — |
| `line` | 0.86 0.006 85 | `#D3D1CD` | hairline (decorative) |
| `line-strong` (input borders) | 0.70 0.006 85 | `#A09E9A` | 2.5:1 on surface. Use `ink-3` for inputs where 3:1 is required. |
| `ink` | 0.23 0.008 85 | `#1F1D19` | 15.7 on surface / 13.5 on bg |
| `ink-2` | 0.46 0.008 85 | `#5A5853` | 6.6 / 5.7 |
| `ink-3` (placeholder, meta) | 0.545 0.006 85 | `#72706C` | 4.6 on surface |
| `screen` (bezel interior) | 0.17 0.004 85 | `#100F0D` | — |
| **`signal`** (accent fill: "needs you") | 0.66 0.20 42 | `#F15B00` | `ink` on it: **5.0**. White on it: 3.4 (avoid for text). |
| `signal-ink` (accent as text) | 0.53 0.17 38 | `#B83B07` | 5.3 on surface. White on it: 5.7. |
| `signal-wash` | 0.94 0.03 50 | `#FDE6DA` | `signal-ink` on it: 4.8 |
| `ok-ink` | 0.49 0.115 150 | `#23723B` | 5.5 / 4.8 |
| `warn-ink` | 0.52 0.11 75 | `#8D5E00` | 5.2 / 4.5 |
| `err-ink` | 0.53 0.19 27 | `#C22826` | 5.4 / 4.7 |

**Dark ("night shift"; warm charcoal, not navy):**

| Token | OKLCH | Hex | Contrast |
|---|---|---|---|
| `bg` | 0.185 0.004 85 | `#131311` | — |
| `surface` | 0.225 0.005 85 | `#1D1C19` | — |
| `line` / `line-strong` | 0.30 / 0.42 0.006 85 | `#2F2E2A` / `#4E4D49` | — |
| `ink` / `ink-2` / `ink-3` | 0.93 / 0.74 / 0.60 | `#EAE8E3` / `#ACAAA7` / `#82807C` | 13.9 / 7.4 / 4.3 on surface (ink-3 for ≥18 px or non-text only) |
| `screen` | 0.12 0.003 85 | `#060605` | — |
| **`signal`** | 0.72 0.18 45 | `#FD7933` | 6.5 on surface. `bg` text on it: 7.0. |
| `signal-ink` | 0.78 0.14 55 | `#FB9D59` | 8.2 |
| `signal-wash` | 0.28 0.05 45 | `#3D2013` | `signal-ink` on it: 7.1 |
| `ok` / `warn` / `err` | 0.76 0.14 150 / 0.82 0.14 80 / 0.70 0.17 25 | `#68CA80` / `#F3B94C` / `#F66D67` | 8.4 / 9.7 / 5.9 |

Notes:
- `signal` (orange, h≈42) and `err` (red, h≈27) are close in hue on purpose: both mean "look". They are separated by L, by **shape** (▲ vs ✕) and by **word**. Errors are rare; "needs you" is common. If testing shows confusion, move `err` to magenta-red h≈15 and keep `warn` (h 75–80) for degraded states only.
- Success is mostly **not coloured**. "Done" in `ink` with a check glyph. Green only on the small "working" LED. This follows Things and FAA: colour reserved for attention.
- Agent identity is **not** a colour (no cyan/magenta/lime robots). See §6.
- Avoid pure blue for text and fine detail (FAA). Links are underlined `ink`.

### 4.3 Escaping the cyan/purple cliché without losing "Beamhop"
- The recorded brand teal/violet sits in the exact hue band (210–270°) where generated UIs pile up ([dev.to](https://dev.to/kenimo49/why-ai-generated-uis-are-all-the-same-color-and-the-data-to-prove-it-12oe)). Options, from most to least distinctive: (a) retire it for signal-orange on warm neutrals (B); (b) keep **one** of them, e.g. teal `oklch(0.80 0.11 180)`, as the accent on warm neutrals with violet removed, and never as a gradient; (c) keep both only in the marketing wordmark animation, never in product chrome.
- **No gradients** in product UI except one functional one: the beam trail during a transfer (§7). It encodes direction and progress.

---

## 5. Motion and micro-interaction

### 5.1 Principles
1. **Frequency decides.** 100+/day (keyboard, palette, list nav) gets none. Tens/day (hover) gets minimal. Occasional (dialogs, trays) gets standard. Rare (first run, beam landing, first approval) can delight ([Emil skill](https://www.ui-skills.com/skills/emilkowalski/emil-design-eng); Rauno: frequent actions lose novelty, [rauno.me](https://rauno.me/craft/interaction-design); Family: delight concentrated on infrequent features).
2. **Motion explains space.** Agents move between *places*, so beaming must travel from origin to destination ("we fly instead of teleport"). Popovers grow from their trigger; modals from centre.
3. **Interruptible, velocity-preserving.** Springs retarget with current velocity; CSS keyframes restart from zero ([WWDC23 notes](https://wwdcnotes.com/notes/wwdc23/10158), [Emil](https://emilkowal.ski/ui/great-animations)). Drags and drops use springs.
4. **Honest.** Progress motion maps to real stages and bytes (Rams: "honest"). No indefinite shimmer while waiting on a known pipeline.
5. **Hardware-accelerated only:** `transform` and `opacity`.

### 5.2 Tokens
```css
--ease-out:   cubic-bezier(0.23, 1, 0.32, 1);   /* enter/exit default */
--ease-inout: cubic-bezier(0.77, 0, 0.175, 1);  /* on-screen move/morph */
--ease-drawer:cubic-bezier(0.32, 0.72, 0, 1);   /* trays, side panel */
--dur-press: 120ms;  /* :active scale(.97) */
--dur-pop:   150ms;  /* tooltip, menu (from scale .97, origin = trigger) */
--dur-tray:  240ms;  /* approval tray, side panel */
--dur-view:  280ms;  /* crew ↔ agent view */
/* never: ease-in for UI, scale(0) entrances, >300ms for routine UI */
```
Springs (Motion for React): default `{ type: "spring", duration: 0.35, bounce: 0 }`. Drop/landing `{ duration: 0.5, bounce: 0.15 }`. Never more than 0.3 bounce in UI; Apple says caution above ~0.4 ([WWDC23](https://wwdcnotes.com/notes/wwdc23/10158)). Stagger lists 30–50 ms. Exit faster than enter. Hover effects behind `@media (hover:hover) and (pointer:fine)`.

### 5.3 Micro-interactions worth crafting (and only these)
- **Approve:** for risky actions, a hold-to-confirm (≈700 ms linear fill, 200 ms ease-out release, after Emil's hold-to-delete pattern). The button label morphs "Approve" → "Hold to approve" (Family text-morph). Low-risk approvals stay a single click. This gives weight exactly where money or messages are involved.
- **Take over / "let me drive":** the screen bezel's status lamp turns `signal` and a thin top bar slides down 160 ms with "You're driving · Atlas is waiting". Releasing slides it back.
- **Beam:** see §7 B.
- **Task done:** Things-style 400–500 ms check, once per task, with optional sound off by default.

### 5.4 Reduced motion (fix the current rule)
The current rule `*{animation:none!important;transition:none!important}` also removes colour and focus feedback. Instead:
```css
@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{ animation-duration:1ms!important; animation-iteration-count:1!important;
    transition-property: opacity, color, background-color, border-color, box-shadow !important; }
}
```
Keep opacity and colour transitions; remove translation, scale and travel ([Emil skill](https://www.ui-skills.com/skills/emilkowalski/emil-design-eng)). Beaming under reduced motion is a crossfade plus a step-by-step text log ("Packing 42 MB… Sending… Starting on Hetzner… Online"). Status updates must never depend on motion.

---

## 6. Iconography and the mascot

**Icon set.** Phosphor (MIT; six weights, including Bold and Fill for active states and a weight system instead of stroke tweaking) suits the instrument direction. Lucide (ISC; one restrained 2 px stroke style) suits ATC or editorial ([comparison](https://dev.to/svgicons/lucide-vs-tabler-vs-phosphor-which-free-icon-set-fits-your-ui-4ocl)). Pick **one**. Rules:
- Icons only where they speed scanning: locations (laptop, cloud, file), primary actions (beam, take over, approve, pause), status shapes. **No icon on every menu row** (Tahoe lesson). One meaning per icon ([designcompass](https://designcompass.org/en/2026/01/13/apple-tahoe-icon-design-that-has-lost-usability/)).
- 16 px in dense UI (Regular), 20 px in the action bar; never mixed weights in one row.
- Replace the unicode glyph states (`◌ ◆ ○`) and the 📱 emoji with set icons or the four status shapes.
- **Custom glyphs, about 6:** beam (an arrow crossing a bracket, the "hop"), local machine, cloud host, `.beamhop` cartridge/file, "needs you" key, driving/takeover hand. Draw them on the same grid as the chosen set. This is where brand lives, not in a mascot.

**When to drop the mascot.** Drop robot mascots from product chrome now:
- Cute agent mascots are the 2025–26 big-tech default ("cutewashing"). If everyone has one, nobody's is memorable ([Fast Company](https://www.fastcompany.com/91620091/big-tech-is-cutewashing-its-ai-agents)).
- Cuteness makes people "forgive mistakes but not … expect mistakes" (Dale, same source). For agents that send messages and make payments, the UI should **raise** vigilance at approval time, not lower it.
- The current robots are not even the brand's bunny, so they dilute the one asset that was distinctive.

**What replaces it as agent identity.** A **key-derived dot-matrix plate**: a 7×7 or 5×7 dot glyph generated from the agent's public key, plus a 2–3 letter callsign (ATL, NOV, SCT). It is honest (the agent's identity *is* its key; Beamhop's own key infrastructure, per memory), unique, colourless, and Nothing-like. It also travels well in Telegram/Slack avatars.

**Where the bunny may live:** app icon, the wordmark animation, first-run welcome (once), a single empty state ("No agents yet"), and the beam-landing receipt if anywhere. Never as status, never per agent, never in approvals.

---

## 7. Three directions

All three share: light and dark themes from 3 OKLCH inputs; one accent meaning "a human is needed"; live screens as the hero inside a proper bezel with Chromium chrome hidden (kiosk/app mode or cropped) so they read as *screens*, not browser windows; a fixed side panel (chat/settings), never glass; a bottom action bar with shortcuts; plain copy (already good).

### Direction A — "Tower" (air-traffic flight strips)

- **Concept.** Each place (This laptop, Hetzner FSN-1, Fly AMS, File) is a **sector**. Each agent is a **flight strip**, a horizontal paper-like row with callsign plate, current task, elapsed time, cost, autonomy and owner, racked in its sector's bay. Strip colour encodes *location type* (buff = local, pale blue = cloud), like real departure/arrival strips. Selecting a strip opens the agent's screen in a large "scope" pane. Alerts follow FAA convention: yellow = caution, red = warning, colour is never alone, otherwise minimal.
- **Palette (dark default — a scope; computed):** `bg #111815` (0.20 0.012 165, dark green-grey, *not navy*), `surface #1A211E`, `ink #DFE7E3`, `ink-2 #9EA7A3` (6.6:1), strip local `#E7DEC4` (0.90 0.035 90) with strip-ink `#201A10` (12.9:1), strip cloud `#C1DCEA` (0.88 0.035 230; 12.2:1), caution `#F2CF3B` (0.86 0.16 95), alert `#F84C41` (0.66 0.21 28; use dark ink on it, 5.3:1), radar-green `#6ED889` for the "working" sweep only. **Light:** `bg #EAF0ED`, `ink #161C19`, caution-ink `#976B03` (4.5), alert-ink `#C92420` (5.4), radar-ink `#26753E` (5.5).
- **Fonts:** IBM Plex Sans Condensed (strips, callsigns), IBM Plex Sans (body), IBM Plex Mono (times, costs, codes). All OFL.
- **Layout signature:** vertical **bays** side by side (one per location) with strips stacked inside; the scope pane opens to the right. The home is a live rack, not a card grid. Density scales well to 20+ agents, which the current 3-card grid does not.
- **Signature beaming interaction: "handoff".** Drag a strip from bay A to bay B. On release (commit on gesture end, per Rauno), the strip **splits**: a dashed ghost stays in A labelled "Handing off → Hetzner", and a live strip appears in B with a progress rule filling left to right as real stages tick ("packed 42 MB", "sent", "starting", "online"). On "online" B's strip goes solid with a 150 ms flash, and A's ghost collapses (height to 0, 200 ms). Failure: B's strip shakes once (spring, bounce 0.2), turns `alert`, and A's ghost goes back to solid ("stayed put").
- **Risks:** jargon and density can intimidate non-technical users (Arc's "novelty tax"). Keep words plain ("Moving to Hetzner", never "HANDOFF"). Dark-first can slide back into "dense dark = AI default". Strips work less well on phone (use a single-column stack).

### Direction B — "Instrument" (field hardware, Braun × TE × Nothing) — **recommended**

- **Concept.** Beamhop is a calm piece of equipment on your desk. Each agent is a **unit** with a real screen in a bezel, a printed name plate (key-derived dot glyph and callsign), a status lamp and three physical-feeling controls: a **3-position autonomy switch** (Ask first · Risky only · Never ask), a **Take-over** key, and a **Beam** lever. Locations are **docks** along the bottom edge, drawn as slots, like a rack or cartridge bay. Playful sci-fi is preserved, but as instrument / used-future sci-fi (cassette futurism) instead of starfield-and-glow.
- **Palette:** §4.2 (light chassis `#E8E6E2`, panels `#F8F7F4`, ink `#1F1D19`, **signal orange `#F15B00`** = "needs you"; dark charcoal `#131311` with `#FD7933`). Screens sit in near-black bezels (`#100F0D`) in both themes, so the agent's own UI is always framed the same way.
- **Fonts:** Mona Sans var (condensed caps-free labels, wide display numerals), Commit Mono (machine strings), Departure Mono only for the per-unit readout strip (elapsed, € today, CPU), all OFL.
- **Layout signature:** home = **bench**. Units are laid out at different sizes by importance: the agent that needs you (or is working) is large and others are compact, which breaks the three-equal-cards tell with real hierarchy. Under each screen a **readout strip** shows `STATE · task · 00:04:12 · €0.03` in tabular figures. Docks run along the bottom with capacity readouts ("This laptop · 3 units · 1.3/7.8 GB"). The agent view is a full-bleed bezel with a fixed right panel (chat with live narration, then approvals, then settings) and a bottom action bar (Raycast).
- **Signature beaming interaction: "eject and slot".** Pull the Beam lever, or drag the unit's plate onto a dock. (1) The screen powers down CRT-style: it collapses vertically to a bright line (`scaleY` to 0.01, 180 ms ease-in-out), which is honest about the agent pausing. (2) A **cartridge** (the `.beamhop` package, labelled with the plate and real size "42 MB") slides out of the unit and travels along a thin track to the target dock on a spring that keeps drag velocity. The track fills with the one allowed gradient, `ink` to `signal`, as stages complete. (3) At the dock the cartridge seats with a small 0.15-bounce settle and an optional click. The screen line expands back to full in the new location and the unit moves to its new dock. A receipt tray shows "Came along: files, logins, memory, 3 chats · 42 MB · 11 s". Cancel works at any point before "starting" (interruptible). Reduced motion: crossfade plus a text log. The same cartridge metaphor powers "Move to file / Open an agent file": the file is literally the cartridge, which gives ownership and tangibility.
- **Approvals:** a tray rises from the bottom of the unit's bezel (Family), never a toast over the screen. It shows the agent's screenshot of the pending action, a plain sentence, and **Approve / Not this time**. Risky categories (payments, messages, deletes, logins) use hold-to-approve. The unit's lamp and the dock both show ▲ in `signal` until resolved.
- **Risks:** (1) *Kitsch*: skeuomorphic toys (fake screws, leather, knurled knobs) would be a new cliché. Stay at TE's level of abstraction: flat shapes, hairlines, one shadow level, no textures, no neumorphism ([UX Collective](https://uxdesign.cc/what-digital-ux-can-learn-from-the-physical-media-revival-b06ccbb44852)). (2) *Light-first desktop app* may surprise users who expect dark; ship both and follow the OS setting. (3) *Orange as accent* conflicts with error red unless shape and word rules are enforced (§4.2). (4) More bespoke components (switch, lamp, cartridge) means more build effort than restyling. Mitigate by building 6 primitives first.

### Direction C — "The Daily Crew" (editorial front page)

- **Concept.** Home is a **front page** written by your crew. Each agent has a column whose headline is its latest outcome, in its own words ("Found three e-bikes under €2,000"). A deck shows what it's doing now, and a thumbnail "photo" is its live screen. Approvals are **"For your signature"** items in a boxed column with the editor's red pencil. Activity is a dated log, i.e. the paper's record.
- **Palette (computed):** **light** newsprint `bg #F6F3EB` (0.965 0.012 90), `surface #FCFAF4`, ink `#1A1512` (16.4:1), ink-2 `#5A5453` (6.7), **editor red `#C51F1C`** (0.53 0.20 28; 5.3 on paper; white text on it 5.9) = needs your signature, link-blue `#1F5596` for linked pages only, ok `#2B7440`. **Dark "night edition":** `bg #171310`, ink `#E8E4DC` (14.6), red `#F66E60` (6.4), blue `#7FAEE9`.
- **Fonts:** Newsreader or Fraunces (headlines, opsz), Schibsted Grotesk (UI and decks), Commit Mono (datelines, costs). OFL.
- **Layout signature:** a 12-column grid with hairline column rules. The lead story is the agent that most needs you, spanning 6–8 columns; others run 3–4. Datelines like "ATLAS — THIS LAPTOP, 14:02". The agent view is a single article: screen as lead photo, chat as the body text, settings as a sidebar "masthead box".
- **Signature beaming interaction: "dateline change".** On drop, the dateline retypes character by character ("THIS LAPTOP" → "HETZNER · FALKENSTEIN"), using Family's text-morph so shared letters stay put. The column then **slides to its new section** (sections = locations), with a "Moved from This laptop" correction line underneath that fades after the receipt is read.
- **Risks:** text-heavy, so it can feel slow for monitoring 10+ agents. The print metaphor clashes with live video-like screens. Serif headlines in a tool UI can drift into "Instrument-Serif italic word" slop if used decoratively. Dark mode is less natural. It is the strongest *brand* statement but the weakest *control* surface.

### Rejected but noted: "terminal-native"
Mono everywhere, box-drawing, green-on-black. It is authentic for developers and alienating for the stated non-technical audience. Mono-uppercase-on-dark is already one of the measured slop tells ([Krebs](https://adriankrebs.ch/blog/design-slop/)). Borrow only the discipline (mono for machine strings, keyboard everything).

### Recommendation: **B — Instrument**, with two borrowings
Why B:
1. **The product's nouns are physical.** Each agent *has a computer*; it lives *somewhere*; it *moves*; you *take over*; you *approve*. Hardware metaphors (unit, screen, switch, dock, cartridge) map one-to-one, so the single novel concept (beaming) is learned through familiar objects. This is the Arc/Dia lesson.
2. **Non-technical users understand switches and lamps.** A 3-position autonomy switch explains the policy better than radio buttons with em-dash prose, and a lamp plus shape is FAA-grade status encoding.
3. **It breaks every current tell at once:** light-first warm neutrals instead of navy, one accent with a meaning instead of a gradient, bezels and readouts instead of glow, key plates instead of neon robots, real hierarchy instead of three equal cards.
4. **It keeps the "playful sci-fi" brief** (recorded UX decision) but moves it from the generic space-glow look to the crafted, lived-in kind (TE, Nothing, cassette futurism).
5. **The cartridge unifies three features** that are currently separate UI: beam to cloud, export to file and import from file. The `.beamhop` file becomes a visible, ownable object.

Borrow from A: the **dashed ghost in the origin dock** during transfer, and the bay/rack layout once a user has more than about 6 units (switch the bench to a compact rack view). Borrow from C: **headline-style status sentences** on each unit ("Drafted 4 replies, waiting for you") instead of bare "Ready".

---

## 8. Day-one checklist (no-regret changes, any direction)

1. Delete `.stars`, both radial body glows, `.glow`, `.drop-hot` glow, `.teleport`, and the infinite `.beam-overlay` scanlines (styles.css lines 17–47).
2. Remove `bg-gradient-to-r from-beam to-beam2`. The primary button becomes solid `ink` on light or `ink` on dark. Only "needs you" actions use `signal`.
3. Retire the 3 neon robot variants as agent identity. Use a key-derived dot plate and callsign.
4. Replace mono uppercase tracked labels with 11–12 px sentence-case `ink-2` labels in the UI face. Keep mono for keys, URLs, model IDs and codes.
5. Show status once per agent: word + shape + lamp. Remove the duplicate "Ready" chip on the screen.
6. Hide Chromium chrome in agent screens (kiosk/app window) and wrap each screen in a consistent bezel.
7. Replace `◌ ◆ ○ ✓ ▶` and 📱 with one icon set.
8. Add `tabular-nums` to CPU/RAM/€/token/timer readouts. Format the token limit as "1 M per day".
9. Fix the reduced-motion rule to keep colour and opacity transitions (§5.4).
10. Make `rounded-full` the exception. Use radius 6 px on controls and 10–12 px on units/bezels, with pills only for true tags.

### Tailwind v4 token sketch (Direction B)
```css
@theme {
  --color-bg: oklch(0.925 0.006 85);   --color-surface: oklch(0.975 0.004 85);
  --color-line: oklch(0.86 0.006 85);  --color-line-strong: oklch(0.70 0.006 85);
  --color-ink: oklch(0.23 0.008 85);   --color-ink-2: oklch(0.46 0.008 85); --color-ink-3: oklch(0.545 0.006 85);
  --color-screen: oklch(0.17 0.004 85);
  --color-signal: oklch(0.66 0.20 42); --color-signal-ink: oklch(0.53 0.17 38); --color-signal-wash: oklch(0.94 0.03 50);
  --color-ok: oklch(0.49 0.115 150);   --color-warn: oklch(0.52 0.11 75);    --color-err: oklch(0.53 0.19 27);
  --font-sans: "Mona Sans Variable", ui-sans-serif, sans-serif;
  --font-mono: "Commit Mono", ui-monospace, monospace;
  --font-readout: "Departure Mono", "Commit Mono", monospace;
  --radius-control: 6px; --radius-unit: 12px;
  --ease-out: cubic-bezier(0.23,1,0.32,1); --ease-drawer: cubic-bezier(0.32,0.72,0,1);
}
@media (prefers-color-scheme: dark) { :root {
  --color-bg: oklch(0.185 0.004 85); --color-surface: oklch(0.225 0.005 85);
  --color-line: oklch(0.30 0.006 85); --color-line-strong: oklch(0.42 0.006 85);
  --color-ink: oklch(0.93 0.006 85); --color-ink-2: oklch(0.74 0.006 85); --color-ink-3: oklch(0.60 0.006 85);
  --color-screen: oklch(0.12 0.003 85);
  --color-signal: oklch(0.72 0.18 45); --color-signal-ink: oklch(0.78 0.14 55); --color-signal-wash: oklch(0.28 0.05 45);
  --color-ok: oklch(0.76 0.14 150); --color-warn: oklch(0.82 0.14 80); --color-err: oklch(0.70 0.17 25);
}}
```
(Generate these from `{base: h85 c0.006, accent: h42, contrast: 1.0}` in a small script so a high-contrast variant is free, as Linear does.)

---

## 9. How to keep it from regressing into slop

- Put this ban list in the repo's agent instructions (CLAUDE.md or a design skill): no gradients except the beam trail; no glow/box-shadow colour; no `rounded-full` except tags; no Inter/Space Grotesk/Instrument Serif/Geist; no mono uppercase labels; no emoji or unicode glyph icons; no new accent colours; every colour must map to a token; every status needs a word and a shape. Anthropic's guidance: name the dimensions explicitly and ban defaults, or models drift back to the centre ([claude.com](https://claude.com/blog/improving-frontend-design-through-skills), [prg.sh](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website)).
- Run a Krebs-style deterministic check in CI (Playwright plus computed styles: gradient backgrounds, coloured shadows, uppercase+letter-spacing labels, `border-radius: 9999px` count, font-family). His method is public ([adriankrebs.ch](https://adriankrebs.ch/blog/design-slop/)).
- Review screenshots in both themes at 100% and 200% and with reduced motion. Test contrast with real agent screens behind panels (the Liquid Glass lesson).

---

## 10. Sources

AI-slop tells and causes
- https://claude.com/blog/improving-frontend-design-through-skills
- https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website
- https://dev.to/alanwest/why-every-ai-built-website-looks-the-same-blame-tailwinds-indigo-500-3h2p
- https://www.thefountaininstitute.com/blog/signs-vibe-coded-ui
- https://www.utsubo.com/blog/built-with-ai-trust-signals-2026
- https://www.925studios.co/blog/ai-slop-design-tells
- https://adriankrebs.ch/blog/design-slop/
- https://www.gigazine.net/gsc_news/en/20260423-design-slop
- https://dev.to/kenimo49/why-ai-generated-uis-are-all-the-same-color-and-the-data-to-prove-it-12oe
- https://www.buildmvpfast.com/blog/linear-aesthetic-tokens-density-keyboard-first-ux-2026
- https://www.fastcompany.com/91620091/big-tech-is-cutewashing-its-ai-agents

Crafted references
- https://linear.app/now/how-we-redesigned-the-linear-ui
- https://linear.app/now/behind-the-latest-design-refresh
- https://linear.app/changelog/2026-03-12-ui-refresh
- https://raycast.com/blog/a-fresh-look-and-feel
- https://browsercompany.substack.com/p/letter-to-arc-members-2025
- https://blakecrosley.com/blog/design-study-things
- https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/
- https://blakecrosley.com/guides/design/notion-calendar
- https://www.figma.com/blog/our-approach-to-designing-ui3/
- https://hn.jakechampion.name/reader/https://benji.org/family-values (Benji Taylor, "Family Values")
- https://rauno.me/craft/interaction-design
- https://emilkowal.ski/ui/great-animations
- https://www.ui-skills.com/skills/emilkowalski/emil-design-eng
- https://vercel.com/geist , https://vercel.com/geist/colors.md
- https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale
- https://blakecrosley.com/de/guides/design/teenage-engineering , https://teenage.engineering/products/op-1
- https://madegooddesigns.com/nothing-brand-guidelines/
- https://ixdf.org/literature/article/dieter-rams-10-timeless-commandments-for-good-design
- https://infinum.com/blog/apples-ios-26-liquid-glass-sleek-shiny-and-questionably-accessible/
- https://webdesignerdepot.com/how-apple-quietly-brought-skeuomorphism-back-to-life/
- https://designcompass.org/en/2026/01/13/apple-tahoe-icon-design-that-has-lost-usability/
- https://studio2am.co/blogs/news/the-precision-turn-why-minimalist-geometric-design-is-reasserting-itself-in-2026
- https://studiomeyer.io/en/blog/webdesign-trends-2026-reality-check
- https://uxdesign.cc/what-digital-ux-can-learn-from-the-physical-media-revival-b06ccbb44852
- https://filmstories.co.uk/features/cassette-futurism-alternatives-to-the-sci-fi-space-aesthetic-that-almost-every-game-uses/
- https://nasa.github.io/openmct/about-open-mct
- https://www.faa.gov/air_traffic/publications/atpubs/foa_html/chap3_section_9.html
- https://charm-docs.vercel.app/docs/lipgloss

Type, colour, motion, icons
- https://github.com/github/mona-sans
- https://fontsource.org/fonts/commit-mono/about
- https://departuremono.com/
- https://github.com/vercel/geist-font
- https://christiantietze.de/posts/2025/02/atkinson-hyperlegible-font-next-mono/ , https://fontsource.org/fonts/atkinson-hyperlegible-mono/about
- https://dev.to/alanwest/tabular-numbers-in-css-font-variant-numeric-vs-monospace-hacks-25cn
- https://developer.mozilla.org/docs/Web/CSS/font-variant-numeric
- https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl
- https://wwdcnotes.com/notes/wwdc23/10158
- https://dev.to/svgicons/lucide-vs-tabler-vs-phosphor-which-free-icon-set-fits-your-ui-4ocl

Palette values in §4 and §7 were computed from OKLCH to sRGB (OKLab matrices) with WCAG 2 contrast ratios; out-of-gamut candidates were adjusted down in chroma until they fit in sRGB.

---

## Summary (10 lines)
1. The current UI hits about 10 of the ~16 measured slop patterns: navy perma-dark, cyan→violet gradient CTA, radial glows, starfield, pills, mono-caps labels, neon robots, 3 equal cards, emoji/glyph icons, decorative loops.
2. The cause is distributional convergence. Even the recorded brand palette (teal and violet on midnight indigo) sits in the 210–270° band where generated UIs cluster.
3. The dark, dense "Linear look" is now itself an AI default, so going light-first on warm neutrals is a real differentiator.
4. What crafted tools share: colour reserved for meaning (Things, Nothing, FAA), dimmed chrome (Linear), hierarchy through scale and weight, and motion that is spatial, interruptible and rare (Rauno, Emil, Family).
5. Type: Mona Sans var (wdth axis) + Commit Mono + Departure Mono for readouts, all OFL. Avoid Inter-only and the new LLM favourites (Space Grotesk, Instrument Serif, Geist). 13 px base, big jumps, tabular figures on every live number.
6. Colour: generate from 3 OKLCH inputs. One accent, signal orange `#F15B00` / `#FD7933`, meaning "a human is needed". Status is always word + shape. All values in §4 are contrast-checked.
7. Motion: under 300 ms, ease-out, springs for drag and drop, nothing on keyboard actions. Fix reduced-motion so colour and opacity still transition.
8. Drop the robot mascots and use key-derived dot-matrix plates plus callsigns. Keep the bunny only for app icon, wordmark, first run and one empty state.
9. Three directions: A "Tower" (flight strips and handoff), B "Instrument" (units, switches, docks, cartridge beaming), C "Daily Crew" (editorial front page and dateline morph).
10. Recommend B: physical nouns fit the product and non-technical users, it removes every current tell at once, and the cartridge unifies beam, export and import into one ownable object.
