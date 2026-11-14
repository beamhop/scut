# Beamhop design system ("Instrument")

The guide for anyone building screens. Spec and reasoning are in `DESIGN-PLAN.md` (§1 principles, §2 visual language, §5 a11y, §6 ban
list). Primitives are in `packages/ui/src/ui/` and exported from one barrel:

```ts
import { Button, IconButton, StatusBadge, Plate, Bezel, Readout, Dialog, Drawer, Menu, Field, Input, Segmented, Switch,
  Progress, Tray, HoldButton, announce, useHotkeys, useCommands, money, duration, relativeTime, plural } from "./ui/index.ts";
```

Live reference: run the app and open **`#/design`**. It shows every primitive in light and dark side by side.
Re-shoot it and run axe with `bun scripts/shoot-design.ts http://127.0.0.1:7801 research/shots --states`.

## 1. Tokens (Tailwind v4 utilities, defined in `src/styles.css`)

Colour. Use only these names: `bg-*`, `text-*`, `border-*`, `fill-*`, `ring-*`. Slate, indigo, cyan and the other Tailwind palettes are switched off.
Raw hex/oklch values in components are banned.

| Token | Use |
|---|---|
| `bg` | app chassis (page background) |
| `surface` | panels, cards, drawers, dialogs, inputs |
| `surface-2` | hover, inset wells, readout strip |
| `line` | decorative hairlines between things |
| `line-strong` | borders of controls (inputs, secondary buttons, segmented). ≥3:1 |
| `ink` / `ink-2` / `ink-3` | text: primary / secondary / meta and placeholders. `ink` is also the primary button and selection colour |
| `screen`, `bezel`, `screen-ink`, `screen-ink-2`, `screen-line` | the near-black agent screen frame and text on it (same in both themes) |
| `signal` | **a person is needed**: approval fills, Take over, the "driving" bar, needs-you lamp. Nothing else |
| `signal-ink` / `signal-wash` / `on-signal` | needs-you text / needs-you background / text on a `signal` fill |
| `ok` | the "working" lamp only. Success is ink with a check, not green |
| `warn` | degraded states only |
| `err` | failed, offline, destructive |
| `scrim`, `focus` | modal backdrop, focus ring |

Theme: light by default. Dark follows the OS, or `<html data-theme="dark|light">` (see `useTheme()` / `<ThemeToggle/>`, stored in
localStorage). Any subtree can force a theme with `data-theme`. Portalled overlays copy the theme of the element that opened them.

Type (Mona Sans Variable, 13 px base): `text-micro` 11, `text-small` 12, `text-body` 13, `text-ui-lg` 15/550, `text-h3` 18/650,
`text-h2` 24/650, `text-display` 40/700. Weights: `font-normal` 400, `font-medium` 550, `font-semibold` 650, `font-bold` 750.
Helpers: `wordmark` (expanded, for "Beamhop"), `label-micro` (condensed, sentence case), `readout` (Departure Mono, the readout
strip only). `font-mono` (Commit Mono) is for **machine strings only**: keys, URLs, model ids, codes, log lines. Put
`tabular-nums` on every live number.

Shape: `rounded-control` (6 px) for controls, `rounded-unit` (12 px) for units, panels and bezels. `rounded-full` only for
tags/counts/lamps. Hairline borders separate things. One shadow, `shadow-float`, and only on floating things (menus, dialogs,
drawers).

Motion: `ease-(--ease-out)`, `ease-(--ease-drawer)`; durations `--dur-press` 120, `--dur-pop` 150, `--dur-tray` 240,
`--dur-view` 280. Animations: `animate-pop`, `animate-drawer`, `animate-bar-down`, `animate-lamp`. Buttons get press
feedback from the `pressable` utility. Reduced motion is global (styles.css): movement and scale go, colour and opacity stay.
Don't animate keyboard-driven changes or anything that happens 100 times a day.

Icons: Phosphor (`@phosphor-icons/react`, import the `…Icon` names). 16 px Regular in dense UI, 20 px in action bars, Bold/Fill
for active. Only where an icon speeds up scanning (places, primary actions, status). Not on every menu row.

## 2. Primitives: when to use what

| Need | Use | Notes |
|---|---|---|
| The one main action in a view | `<Button variant="primary">` | solid ink. One per view |
| Normal action | `<Button>` (secondary) | `size="sm"` in cards and rows |
| Low-weight action in bars | `<Button variant="quiet">` | |
| A person is needed (Allow, Take over) | `<Button variant="signal">` | never decorative |
| Destructive | `<Button variant="danger">` + `<Dialog variant="alert">` | |
| Button on the signal "driving" bar | `<Button variant="on-signal">` | Give back |
| Icon-only | `<IconButton label="Settings" icon={GearIcon}/>` | label is required; it is also the tooltip. `pressed` for toggles |
| Shortcut hint | `<Kbd keys="mod+k"/>`, `<Button shortcut="mod+k">` | ⌘ on macOS, Ctrl elsewhere |
| Agent status | `<StatusBadge status={toStatus(state, {needs, beaming, failed})}/>` | 5 states: needs, working, free, moving, problem. `emphasis` puts needs-you on a wash. `onScreen` inside a bezel |
| Status shape only | `<Lamp status="working"/>` | decorative unless `label` |
| Agent identity | `<Plate pubkey={agent.agentPubkey} name={agent.name} size="sm|md|lg"/>` | replaces `Mascot`. Decorative by default (put the name next to it). `callsign(name)` gives "ATL" |
| An agent's live screen | `<Bezel label="Atlas's screen" bar={…} state="watching|driving">{img}</Bezel>` | bar holds lamp + headline + Take over. `ScreenNote` for empty screens |
| Live numbers under a screen | `<Readout items={[{value:"Working",status:"working"},{value:"01:42",srLabel:"elapsed"},{value:"€0.03",label:"today"}]}/>` | the only uppercase in the product |
| Modal question/form | `<Dialog open title description footer onClose>` | APG: focus trap, Esc, restore. `initialFocus={ref}` |
| Confirm destructive | `<Dialog variant="alert" initialFocus={cancelRef}>` | role=alertdialog, no outside-click close, focus on the safe button |
| Side panel (settings) | `<Drawer open title onClose placement="fixed|contained">` | `contained` fills the nearest `relative` parent (the bezel side only) |
| Menu button (Beam to…) | `<Menu trigger={<Button>Beam to…</Button>} heading="Beam Atlas to…" items={[…]}/>` | role=menu/menuitem, arrows, typeahead, Esc. Items take `hint` and `description` (pre-flight line) |
| 2–4 position choice | `<Segmented legend=… value onChange options/>` | radiogroup in fieldset/legend. Use for autonomy |
| Text, select, area | `<Field label hint error><Input/></Field>` | visible label always. `mono` for keys |
| Setting that applies at once | `<Switch checked onChange label description/>` | role=switch |
| Real progress | `<Progress label value/>` or `<Progress label stages current/>` | role=progressbar + aria-valuetext. No indeterminate shimmer |
| Row of cards (inbox, dock) | `<Tray title="Waiting for you" count={n}>` | role=region, horizontal scroll. Titles must be unique |
| High-risk approval | `<HoldButton onConfirm>Hold to allow</HoldButton>` | 700 ms hold (pointer or Space/Enter), inert 600 ms after mount. Never autofocus |
| Tell screen readers | `announce("Atlas arrived on Fly.io")` | `{assertive:true}` for failures. `{key, throttleMs:8000}` for activity |
| Keys | `useHotkeys({ n: create, "alt+shift+a": focusInbox })` | ignored while typing and inside modals unless a modifier is used. `{scope: ref}` for local keys |
| ⌘K entries | `useCommands([{id, title, synonyms, group, shortcut, hint, run}], [deps])` | shown in the palette. `shortcut` is **also bound globally**, so don't bind it again |
| Theme | `<ThemeToggle/>`, `useTheme()` | |

`<Announcer/>` and `<CommandPalette/>` are already mounted once in `main.tsx`. Don't mount them again.

## 3. Formatting (`ui/format.ts`, also as `fmt.*`)

- `money(0.42, {period:"today"})` → "€0.42 today" · `money(18, {approx:true, period:"month"})` → "~€18/month" ·
  `money(0, {zero:"free"})` → "free" · `money(0.001)` → "<€0.01". Locale-aware (nl-NL: "€ 0,42").
- `tokensEur(tokens, agent.price)` turns `$`/1M-token prices into euros (`usdToEur`, `EUR_PER_USD` is an approximate constant).
  **Money, never tokens. Always with a period.**
- `duration(ms)` "01:42" · `durationWords(ms)` "11 s", "4 min" · `relativeTime(ts)` "2 min ago" · `timeLeft(until)` "23 min" ·
  `clock(ts)` "14:02" · `plural(2, "agent")` · `bytes(42e6)` "42 MB" · `compact(1.25e6)` "1.3M" · `list(["Atlas","Nova"])`.

## 4. Anti-slop ban list (enforced in review; DESIGN-PLAN §6)

- No gradients (the beam track fill is the only exception). No glow, no coloured shadows, no `backdrop-blur` glass.
- No starfield or background decoration.
- No `rounded-full` except tags, counts and status lamps. No pill buttons.
- No uppercase tracked labels (`uppercase tracking-widest`), mono or not. The `readout` strip is the only uppercase.
- No emoji and no unicode glyph icons (◌ ◆ ○ ✓ ▶ 📱). Use Phosphor or the status shapes.
- No robot mascots. Use `Plate`.
- No new accent colours. Every colour is a token. Orange (`signal`) means a person is needed and nothing else.
- Every status has a word and a shape. Never colour alone.
- No "AI ✨" copy, no buzzwords.
- No Inter, Space Grotesk, Instrument Serif or Geist.
- No three equal cards with half a screen of nothing. Give the thing that matters more room.
- No toasts for things that need a decision. Approvals go in the tray or on the unit.
- `font-mono` only for machine strings.
- The legacy colour names in `styles.css` (`panel`, `panel2`, `beam`, `space`, `white`, `black`, `slate-*`, `red-*`, `amber-*`…) only
  keep the old screens readable. Don't use them in new code. Delete them once no screen does.

## 5. Copy rules

- Plain verbs, sentence case, specific: "Beam Atlas to Fly.io", "Allow", "Don't", "Take over", "Give back to Atlas".
- Lead with the person's question: what needs me, what's happening, what it cost, what's next.
- No jargon on the main path. Say "Brain: Claude Haiku (OpenRouter)", not a model id. Put CPU/RAM behind "Computer health".
- Name the agent: "Atlas wants to…", "Atlas stayed on This computer".
- Money with a period. Times as "Free since 14:02", "2 min ago", "Decide within 23 min".
- Don't stack em dashes. Use a colon or a new line.
- Keep labels the UI tests rely on (`research/ui-test-contract.txt`): "Beam to…", "Open", "Settings", "Talk to all agents", "Move to file", …

## 6. Accessibility rules (must pass; axe has zero violations on `#/design`)

- Focus is always visible: a global 2 px `focus` ring with 2 px offset (it flips to light inside `.on-screen`/bezels). Never
  `outline-none` without a replacement.
- Targets are at least 24 px (`size="sm"` = 28 px). Use 44 px on the phone layout.
- Text contrast is ≥4.5:1. `ink-3` passes on `bg`, `surface` and `surface-2`. Control borders use `line-strong` (≥3:1). `signal` is
  a fill colour; for text use `signal-ink`.
- Status is never colour only (StatusBadge = shape + word).
- Modals use `Dialog`/`Drawer`, which give you the focus trap, Esc and focus restore. Don't build your own.
- Approvals never take focus. Use `HoldButton` for high risk. Allow is inert for 600 ms.
- Live regions: use `announce()`. Don't add new `aria-live` regions. Throttle activity narration (`key` + `throttleMs: 8000`).
- One `h1` per view, headings in order, landmarks `main`/`nav`/`aside`, region labels unique.
- Radio groups go in `fieldset`/`legend` (`Segmented` does this). Every drag action also needs a menu equivalent (`Menu`).
- No keyboard traps. Screens that capture keys must have a visible way out (Esc twice) and announce it.

## 7. Examples

```tsx
// Unit header
<header className="flex items-center gap-2">
  <Plate pubkey={agent.agentPubkey} name={agent.name} size="sm" />
  <h2 id={`u-${agent.id}`} className="text-ui-lg">{agent.name}</h2>
  <StatusBadge status={toStatus(a.state, { needs })} size="sm" emphasis />
  <span className="ml-auto text-small tabular-nums text-ink-2">{money(eurToday, { period: "today" })}</span>
</header>

// Screen with bar + readout
<Bezel label={`${agent.name}'s screen`} state={driving ? "driving" : "watching"} bar={driving
  ? <><span className="flex-1 font-medium">You're driving · {agent.name} is waiting</span><Button size="sm" variant="on-signal" onClick={giveBack}>Give back to {agent.name}</Button></>
  : <><Lamp status={status} onScreen /><span className="min-w-0 flex-1 truncate">{headline}</span><Button size="sm" variant="signal" onClick={takeOver}>Take over</Button></>}>
  {frame ? <img src={frame} alt={`${agent.name}'s screen: ${headline}`} className="h-full w-full object-cover" /> : <ScreenNote>Starting {agent.name}'s screen…</ScreenNote>}
</Bezel>
<Readout label={agent.name} items={[{ value: STATUS[status].word, status }, { value: duration(elapsed), srLabel: "elapsed" }, { value: money(eur), label: "today" }]} />

// Beam menu (keeps the "Beam to…" label and role=menu/menuitem contract)
<Menu trigger={<Button size="sm" iconEnd={CaretDownIcon}>Beam to…</Button>} heading={`Beam ${agent.name} to…`} items={[
  { items: dests.map((d) => ({ id: d.id, label: d.label, disabled: d.id === here,
      hint: d.monthlyUsd ? money(usdToEur(d.monthlyUsd), { approx: true, period: "month" }) : "free", onSelect: () => beam(d.id) })) },
  { items: [{ id: "file", label: "A file, for another computer…", hint: "offline", onSelect: exportIt }] },
]} />

// Palette commands
useCommands(agents.flatMap((ag) => [
  { id: `open.${ag.id}`, title: `Open ${ag.name}`, group: "Agents", run: () => (location.hash = `#/agent/${ag.id}`) },
  ...dests.map((d) => ({ id: `beam.${ag.id}.${d.id}`, title: `Beam ${ag.name} to ${d.label}`, synonyms: ["move", "send", "transfer"], group: "Beam", run: () => beam(ag.id, d.id) })),
]), [agents, dests]);

// High-risk approval
<HoldButton onConfirm={() => send({ t: "approval", id, ok: true })} aria-describedby={riskId}>Hold to allow</HoldButton>
```
