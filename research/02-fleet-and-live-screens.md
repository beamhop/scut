# 02 — Fleet dashboards, live screens, and the "move things" flow

UX research for Beamhop's crew view, agent view and beam flow. The research was done 2026-11-14. Sources are linked inline, and each finding names its source. Code was not changed.

---

## 0. Where Beamhop is today (from `research/shots/*.png` and `packages/ui/src/*`)

| Area | What it does now | Issue |
|---|---|---|
| Crew grid (`home-v048`) | 3 equal 16:10 tiles in a `grid-cols-1 md:2 xl:3` grid. Each tile shows the live frame, a status chip and a "Beam to…" pill over the frame, then the name, a location badge and a status line. | 1. All 3 idle tiles show the **same "Ready" splash**, so roughly 60% of the screen carries no information. 2. Status is shown **twice** (chip over the frame and the text line under the name). 3. The chip and "Beam to…" pill sit **on top of the agent's own Chromium tab strip and window controls**, so they collide visually with the remote UI. 4. CPU and cost appear **on hover only**. 5. About 45% of the viewport below the tiles is empty. |
| Location | Location is a small monospace badge ("THIS COMPUTER"). Destinations are in a separate bottom dock ("drag one here to move it"). | The app's **core spatial idea, where the agent lives, appears only as a tag**. The dock cards hold **no agents and no counts**, so they read as buttons, not places. Tiles and places are separated in space. |
| Agent view (`settings-v040`) | A top bar (← Crew, name, location, state, CPU/RAM/$, Beam to…, Settings, phone), a screen of about 1020 px, a 380 px settings rail, and a "Pause & let me drive" pill on the screen. The caption reads "Click to use it together". | Settings takes space away from the screen and the chat. Clicking anywhere on the screen takes control, so **takeover can happen by accident**. There is no history or replay. |
| Phone (`phone-v043`) | The screen sits on top, with suggestions and Activity collapsed below. | Primary actions sit at the top, out of thumb reach. |
| Beam (`beam.tsx`) | A modal-less overlay on the tile: a monospace checklist (✓ › ·) of 5 stages, "Stays here until it lands safely", then a receipt ("Arrived on X from Y in Ns · MB · Came along: …") and a toast. On failure, a red strip shows the raw error (up to 120 characters). | Every stage is binary: no bytes, no ETA, no liveness signal. The move is **not shown spatially**: the tile stays put and only its badge text changes. Failure shows raw error text. There is no "beam back". |
| Status vocabulary | `STATE_META` has 7 states, each with a glyph, a label and a tone (◌ ● ◆ ▲ ○). | Good: it doesn't rely on color alone. But 7 states is more than the 5–6 Carbon recommends, and 3 of them share ◌. |

Test contract (`research/ui-test-contract.txt`) to keep working with any change: the "Beam to…" label, `role="menu"`/`menuitem`, "Add a cloud", "Open an agent file", "Talk to all agents", the `aside[aria-label="Crew room"]`, and dialog roles.

---

## 1. Findings by product

### 1.1 Fleet and infra dashboards

**Railway project canvas**
- The Dec 2025 "Smart Canvas" update reworked service states "so you can quickly tell whether a service is online and healthy". A failed service **names the failure on the canvas** ("Build failed"). Cron jobs show their last-run result, and threshold alerts appear on the canvas and link to observability. The stated goal is less cognitive load: health at a glance instead of digging through logs. https://railway.com/changelog/2025-12-05-smart-canvas
- Staged changes: a banner shows how many changes are pending, and affected nodes turn **purple**. "Details" opens a diff, each change can be discarded with an ×, and one "Deploy" commits them all. https://docs.railway.com/deployments/staged-changes
- What users dislike: on a free canvas, nodes **get moved by accident** ("a slight click-and-drag can shift an item"), and the layout drifts over time. They ask for lock toggles, a lock icon with a disabled drag cursor, and an edit/view mode. https://station.railway.com/feedback/feature-request-lock-freeze-services-11d18122
- Lesson: spatial canvases are powerful but need protection against accidental moves. **For Beamhop, an accidental drag starts a paid live migration**, which costs far more than a moved node.

**Vercel dashboard**
- 2019 redesign: project lists show **screenshots of the latest production deployment**. The **browser tab icon and title reflect deployment state** (queued, building, errored, ready) for "users who keep many tabs open". https://vercel.com/blog/dashboard-redesign
- 2026 navigation: horizontal tabs moved to a resizable, hideable sidebar. Team and project pages share the same tabs, so projects act as **filters** and one click moves between team and project views. On mobile, a **floating bottom bar for one-handed use**. https://vercel.com/changelog/dashboard-navigation-redesign-rollout

**Render**
- Refreshed dashboard: a **context-aware left menu**, a header showing "where you are" (production vs staging), breadcrumbs that jump between resources, and global search to jump to any service. The problems it addressed were not knowing where you are, mixing up environments, and having to go back to the home page. https://render.com/blog/introducing-renders-new-cli-and-refreshed-dashboard

**Fly.io**
- What users dislike: the dashboard showed apps as "pending" forever and long-destroyed machines as "created". Fly's own reply: "The Fly dashboard has never quite figured out Machines", and users fall back to `flyctl`. https://community.fly.io/t/ui-dashboard-shows-incorrect-statuses-states/9913
- Lesson: **a status that is wrong is worse than no status.** Beamhop wraps Fly, so it must reconcile against the provider's real state and show *when* it last checked.

**Tailscale (admin console and client)**
- The Machines page has a search bar plus **text filters** (`lastseen:<5d`, `lastseen:connected`, `version:update-available`, `disabled:expired`). Active filters show as removable chips, and **filters are stored in the URL** so a view can be shared. https://tailscale.com/kb/1176/filter-devices/
- The new macOS client (third-party write-up) replaces one flat list with **sections: This Device / My Devices / Shared / Exit Nodes / Quick Actions**. Rows show an OS icon, a **direct-vs-relay indicator** and a **last-seen time for offline devices**. Device search is on ⌘K. https://dev.to/onsen/tailscales-new-macos-home-whats-changed-25ej (single unofficial source, so treat the details as indicative)
- Lesson: group by **place/relationship** ("This Device" first), and pair "offline" with "last seen X ago".

**Docker Desktop / OrbStack / UTM / Parallels / VMware Fusion**
- Docker 4.14 added per-container CPU, memory, disk and network columns, aggregated per Compose project, with start, stop, restart and logs **inline** in the same view. https://www.docker.com/blog/docker-desktop-4-14-greater-visibility/
- OrbStack: a menu-bar applet controls containers and machines "from anywhere without opening a main window", `*.orb.local` names replace port juggling, and the native app idles at about 0.1% CPU. Praise centres on speed ("Every operation feels 100x faster"). https://orbstack.dev/blog/orbstack-1.0
- Parallels Control Center: a user asks to **turn off live VM previews** and see "just the O/S icon", and their workaround is closing Control Center. https://forum.parallels.com/threads/control-center-disable-preview.339314/ Another user complains that even "compact" mode looks "almost triple-spaced", so "we have to scroll when it could have been possible to make the whole list fit". https://forum.parallels.com/threads/additional-control-center-compactness-option.345299
- UTM: a template gallery of pre-built machines. Still described as "a bit clunky", but far easier than QEMU flags. https://kvibber.com/reviews/software/utm/
- Lesson: live thumbnails are **not automatically useful**. Power users ask for a dense list, and idle previews are noise.

### 1.2 Live remote screens and multi-session viewing

**Apple Screen Sharing, High Performance mode**: a toolbar of **round icon buttons with labels** (Control, Dynamic resolution, HDR, Apps, Mission Control, Desktop, Cursor). Dynamic Resolution resizes the virtual display to fit your window. The remote screen **goes black for privacy**. Praised as a "high-speed display tunnel instead of a jerky remote view". https://sixcolors.com/post/2026/06/high-performance-mode-allows-sharing-another-macs-display-as-if-your-own/

**TeamViewer session toolbar**: sits at the top, **collapses**, shows **context-dependent quick actions** (disabled features are hidden) with overflow in a chevron, and can be customised on macOS. It offers "Disable remote input", "Show black screen", and a **lock icon next to ×** meaning "the remote device locks when you close". https://www.teamviewer.com/nl/global/support/knowledge-base/teamviewer-remote/remote-control/remote-session-toolbar/

**Kasm Workspaces in-session control panel**: one side panel holds clipboard sync, an **upload/download tray** (files in the session's Downloads), streaming quality presets, fullscreen, and a **Share link** that others can open to view or interact. https://docs.kasm.com/docs/tutorials/user-guide/control-panel

**Parsec for Teams**: users praise a **catalog of ready machines** instead of "launching a VPN and working through a list of IP addresses", plus fast login and multi-monitor handling. https://unity.com/blog/industry/3-reasons-editors-love-parsec-for-teams

**Browserbase**
- Live view is **read/write by default**, and read-only comes from `pointer-events:none`. Each tab has its own live URL. The view shows a **disconnect message** when the session ends and posts a `browserbase-disconnected` event. Takeover use cases are credentials, odd iframes and uploads. https://docs.browserbase.com/features/session-live-view
- Replay: the old DOM-reconstruction replay (rrweb) was "the weakest feature in our product". It was often wrong, and it could show *today's* data instead of what was on screen. It was rebuilt as a **CDP screencast that records only when the screen changes** (idle = no frames), delivered as HLS video for **instant seeking**, with up to 10 tabs on one timeline. https://browserbase.com/blog/session-recordings
- The Inspector has a status bar (ID, status *with termination reason*, region, duration), replay at 0.5×–4×, and an events/console/network timeline. https://docs.browserbase.com/features/session-inspector

**Steel**: the embed takes `interactive=true|false` and `showControls`. Multi-tab view **switches automatically to newly created tabs**. The human-in-the-loop sample shows a banner, **"Automated session – Click inside to take control"**, and recommends a minimum height of about 600 px. https://docs.steel.dev/overview/guides/view-and-embed-live-sessions · https://docs.steel.dev/overview/sessions-api/human-in-the-loop

**ChatGPT agent (OpenAI)**: "an on-screen **narration** provides visibility into exactly what ChatGPT is doing". You can **interrupt, take over the browser, or stop at any point**, and the agent resumes "without losing earlier progress". It asks "explicitly … before taking actions with real-world consequences". **Watch Mode** is required for critical tasks such as email. A **phone notification** fires on completion. https://openai.com/index/introducing-chatgpt-agent/

**Cursor 3 Agents Window (2026)**: the closest analogue to Beamhop. **All local and cloud agents are in one sidebar.** A local session can be **pushed to the cloud so it "keeps running even after the laptop is closed"**, and a cloud session can be pulled back to local. Cloud agents **produce screenshots and demos for review**. User reactions are split: some say they lose their connection to the work. https://the-decoder.com/new-cursor-3-ditches-the-classic-ide-layout-for-an-agent-first-interface-built-around-parallel-ai-fleets/ · https://infoq.com/news/2026/04/cursor-3-agent-first-interface/

**Conductor (parallel Claude Code)**: a workspace sidebar with an input at the bottom, a terminal and a diff. The reviewer found the **auto-renamed workspaces** ("Sacramento" became the task name) confusing, felt the agent's identity had been changed without asking, and found workspace, task and branch naming muddled. https://thenewstack.io/a-hands-on-review-of-conductor-an-ai-parallel-runner-app/

**Security-camera NVR grids**
- UniFi Protect/Viewport: the user builds a grid by dragging cameras into slots, with a **practical cap of 16 streams** on the Viewport. Slots can **cycle on a timer or on motion**. Users complain about choppy streams. https://lazyadmin.nl/home-network/unifi-viewport-review/ Protect 6 adds **Spotlights**, which surface key activity when you open the app, plus per-camera event summaries you can jump to. https://blog.ui.com/article/introducing-protect-6-0
- iSpy Agent DVR: layouts are built from **slot types**. Alert slots (red) show devices in an alert state, Motion slots (blue) show devices with motion, Interval slots cycle, Grid slots auto-fit, and there is a Main Display for the selected device. "Skip Offline" avoids cycling through dead feeds. https://www.ispyconnect.com/docs/agent/layouts
- Frigate **Birdseye**: modes are `continuous`, `motion` and `objects`. A camera is **hidden after 30 s of inactivity**. `max cameras` shows only the most recently active ones, with a **cooldown so cameras don't switch too often**. **Default order is by name "so the view stays consistent".** https://docs.frigate.video/configuration/birdseye

**Streaming multiview**: YouTube TV's equal 2×2 grid "squeezes" the stream you care about. Amazon's **one large primary plus three stacked secondaries** is judged better. https://www.androidauthority.com/amazon-multiview-feature-beats-youtube-tv-why-3602572

**Video calls**: the Stanford VHIL studies of "Zoom fatigue" (Fauville et al. 2023) link it to **nonverbal overload, hyper-gaze (many faces at once), mirror anxiety, and constant cue monitoring**. https://vhil.stanford.edu/publications/videoconferencing/video-conferencing-usage-dynamics-and-nonverbal-mechanisms Inference: a wall of constantly moving screens has the same monitoring cost. Slack Huddles let **several people share screens at once and draw with live cursors**. The huddle **thread saves to the channel**, so people outside can catch up later. https://slack.com/blog/productivity/introducing-new-ways-to-work-in-slack-huddles

### 1.3 Moving and migrating things

- **Apple Migration Assistant**: users can't tell whether it is working. The ETA freezes ("4 hours 37 minutes" … still 4:37), jumps without explanation, and the rate rises while the ETA doesn't move. They can't switch transport (Wi-Fi vs Thunderbolt) without cancelling. "Safe to retry, no duplicates" comes from forum users, not the UI. https://discussions.apple.com/thread/251034176
- **iPhone Quick Start**: the old phone showed "5 minutes remaining" **for hours**, with no completion signal and no guidance on whether cancelling was safe. One user cancelled after 7 hours and everything was fine. https://forums.macrumors.com/threads/how-do-i-know-when-transferring-data-to-iphone-is-done.2267539
- **Android Quick Share** added a **percentage for the receiver too**, where before only the sender saw it. https://9to5google.com/2024/11/03/quick-share-android-percentage/
- **Apple Handoff**: an app available on another device appears in the Dock with **"a small symbol of the device that is handing off the task"**, and first in ⌘-Tab. https://support.apple.com/en-gb/102426
- **vMotion wizard**: picking a target updates a **Compatibility panel** live. Results are "Compatibility checks succeeded", **warnings that don't block**, and **errors that block Next**. https://docs.vmware.com/en/VMware-vSphere/8.0/vsphere-vcenter-esxi-management/GUID-C0CB4619-0824-4BCC-A3D6-5999A35857E7.html
- **Nintendo Switch save transfer**: separate **Send/Receive roles**. Explicit copy: "**This does not create a copy of your save data**", meaning it is removed from the source. An overwrite warning says "cannot be recovered". Both consoles must stay near each other. https://www.nintendo.com/en-gb/Support/Troubleshooting/How-to-Transfer-Your-Save-Data-To-a-Nearby-Console-1549113.html
- **PlayFab cloud-save conflicts**: **one** clear choice ("Keep Local" or "Keep Cloud"), not one per slot. The UI should state the consequences, and **the discarded version is kept for rollback**. https://devdocs.xbox.com/services/playfab/player-progression/game-saves/conflicts
- **Arc Spaces**: loved for separating contexts and for the Command Bar. Abandoned because of a "**novelty tax**", a steep first week, and accidental tab closures that erode trust. Lessons: keep familiar anchors, protect basic actions, show the payoff early. https://jtbdux-protocol.pages.dev/discovery-and-research/choosing-to-switch/arc-browser-and-the-progress-timeline-from-first-thought-to-abandonment

### 1.4 Multi-pane productivity layouts, keyboard and command palettes

- **Linear redesign**: "reduce visual noise", limit how much the accent color drives the system, raise contrast, **density in the chrome (sidebar, tabs, headers) and focus on content**, "A redesign should not completely disassemble the product". https://linear.app/now/how-we-redesigned-the-linear-ui
- **Superhuman command palette**: one shortcut works everywhere and pressing it again dismisses. It is **omnipotent** (every action is a UI element, a shortcut and a command). It is **forgiving** (fuzzy matching, so "opn" finds Open) and supports **synonyms**, shown as "Mark Done (Archive)". It is **contextual** and **teaches shortcuts** by showing them. https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/
- **Raycast Action Panel**: Enter runs the primary action. **⌘K opens every action for the selected item**, each with its shortcut shown, plus fuzzy search. https://manual.raycast.com/action-panel
- **VS Code**: **Toggle Maximize Editor Group** (⌘K ⌘M, or double-click the tab), **Zen Mode** (⌘K Z), and grid presets (2 columns, 3 columns, 2×2). https://code.visualstudio.com/docs/configure/custom-layout. tmux `prefix z` zooms a pane in place and toggles back (same pattern).
- **Carbon status indicators**: **don't rely on color alone**, and use at least 3 of: symbol, shape, color, text. Keep 3:1 contrast. "More than five or six indicators can overwhelm users." When statuses combine, **show the highest-attention one**. **Avoid reusing one shape in different colors.** https://www.carbondesignsystem.com/patterns/status-indicator-pattern
- **NN/g progress indicators**: use a spinner for 2–10 s and **percent-done for 10 s or more**. **Say what is happening** ("Updating 3 of 50"). Use **rough ETAs** ("About 3 minutes"). Never stall at the end, and let users stop long operations. https://nngroup.com/articles/progress-indicators
- **NN/g drag and drop**: give a grab handle or cursor change. **Highlight the drop zone** and use **magnetism**. Make the dragged item look lifted (ghost or shadow). Provide **keyboard alternatives** and **announce state**. Avoid drag on touch, where **menus are less error-prone**. https://www.nngroup.com/articles/drag-drop/
- **Atlassian Pragmatic DnD a11y**: offer an **action menu as the alternative to drag**, name the item in the button ("Move task 'X' to …"), use a **live-region announcement with item, old position and new position**, and **restore focus** to the moved item. https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines/

---

## 2. Patterns that work

1. **Group by place, and put "this device" first** (Tailscale sections, Cursor 3's unified local+cloud sidebar). Where something lives is a first-class grouping, not a tag.
2. **Attention surfaces itself; everything else stays calm and in a stable order** (Frigate inactivity hide + name order + cooldown, iSpy Alert slots, UniFi Spotlights, Railway names failures on the canvas).
3. **One primary, several secondary** (Amazon multiview beats the equal 2×2; Zoom speaker view; VS Code maximize-group or tmux zoom as an *in-place* toggle).
4. **Status = glyph + label (+ color), at most 6 states, highest attention wins** (Carbon). Show it once per object, in a fixed position.
5. **Push status outside the window**: tab favicon and title (Vercel), Dock badge (Handoff), phone notification on completion (ChatGPT agent).
6. **Narrate, then let me rewind** (ChatGPT narration, Browserbase change-only screencast with seekable replay at 0.5–4×).
7. **Take control on purpose, with a clear mode and an obvious way to hand control back** (Steel banner, TeamViewer disable-input/lock indicators, ChatGPT take over and resume "without losing progress").
8. **Check before moving, with non-blocking warnings and blocking errors** (vMotion Compatibility panel).
9. **Honest progress: stages + quantity + rough ETA + a liveness signal, on both ends** (NN/g, Quick Share receiver %). The Migration Assistant and Quick Start complaints are what happens without it.
10. **Make the "one copy" invariant explicit and keep a way back** (Nintendo's "does not create a copy", PlayFab rollback copy).
11. **Every drag has a menu twin, an announcement and focus restore** (NN/g, Atlassian).
12. **⌘K that does everything, forgives wording and teaches shortcuts** (Superhuman, Raycast).
13. **Mobile: one-handed bottom bar** (Vercel).
14. **Context in the header: where am I, and on what** (Render breadcrumbs, prod vs staging).

## 3. Anti-patterns to avoid

- **A wall of identical live previews.** Idle screens add nothing, and users ask to disable them (Parallels) or want denser lists. *Beamhop's home screen currently does this.*
- **Equal tiles for unequal attention** (the YouTube TV 2×2 critique).
- **Auto-reshuffling layout** that breaks spatial memory. Frigate uses name order and a cooldown for this reason.
- **Free-floating canvas without move protection** (Railway accidental moves). For Beamhop an accidental drop is a paid migration.
- **A status that drifts from reality** (Fly "pending" forever). Stale is worse than nothing, so show "checked 20 s ago".
- **Frozen or dishonest ETAs** and no completion signal (Migration Assistant, Quick Start).
- **Raw error dumps** instead of a named failure with a next action (contrast with Railway's "Build failed").
- **Click-anywhere-to-take-over** with no explicit mode (Steel needs a banner; TeamViewer exposes input state).
- **Overlaying app chrome on top of the remote app's own chrome.** Beamhop's chip and pill sit on the agent's Chromium tab strip.
- **Renaming or re-identifying the agent without asking** (Conductor auto-rename).
- **A novel spatial model with no familiar fallback** (Arc's novelty tax).
- **Too many simultaneous moving faces or screens** (Zoom-fatigue mechanisms: hyper-gaze, monitoring load).

---

## 4. Concrete ideas for Beamhop (each tied to evidence)

### Crew view

**C1. Show where agents live as lanes, not badges.** Replace the bottom "Where your agents live" dock with **horizontal lanes (or columns), one per place**: "This computer" first, then each cloud. Tiles live *inside* their lane. The lane header shows the place name, the agent count, the monthly cost ("2 agents · ~$6/mo"), and health ("Fly.io token OK · checked 30 s ago"). The empty lane shows a dashed ghost slot: "No agents here yet. Drag one in, or press B on an agent." *Evidence:* Tailscale's This Device / My Devices sections; Cursor 3 lists local and cloud agents in one sidebar; Railway's canvas puts health on the node; Fly's stale-status complaint calls for the "checked N s ago" text. *Hedge for Arc's novelty tax:* keep a "Grid" toggle that renders today's layout.

**C2. Show one primary agent plus calm secondaries, never a wall of identical splash screens.** Adapt the layout to the number of agents: **1 agent → one large view** (not a third of the width); **2 → side by side**; **3–4 → 1 large + stacked secondaries** (the Amazon multiview pattern); **5+ → large focus + a filmstrip or compact rows**. The large slot goes to the agent that **needs you** or was **most recently active**. *Evidence:* Amazon multiview vs the YouTube TV 2×2; iSpy Main Display + Alert slots; Frigate `max cameras`.

**C3. Show idle agents as cards, not screens.** If an agent is `running` (Ready) and its frame hasn't changed for 30 s or more, show a **compact idle card**: avatar, "Free since 14:02", last task summary, and a still of the **last meaningful frame** dimmed with its time ("last screen, 2 h ago"). Show live frames only while the agent is working or needs you. *Evidence:* Frigate hides cameras after 30 s of inactivity; Parallels users ask for an OS icon instead of a live preview; Vercel shows the *latest production* screenshot rather than a generic splash; Browserbase records only on change.

**C4. Keep the order stable, and promote by highlighting, not by reshuffling.** Keep tiles in **name order** (or the user's order) inside each lane. When an agent needs you, add it to a **"Needs you" strip pinned at the top** (avatar, "Atlas wants to pay €12.99 · Allow / Don't") and keep its tile in place. Apply a 10 s cooldown before any layout change. *Evidence:* Frigate orders by name "so the view stays consistent" and uses a cooldown; UniFi Spotlights surface activity on open.

**C5. Show status once, with a vocabulary of 5.** Merge the states into 5 user-facing states, each with a **distinct glyph, a word and a color**: ▲ **Needs you** (amber), ◆ **Working** (cyan, animated), ● **Free** (neutral), ↗ **Moving** (blue, used for beaming in, packing up and booting), ✕ **Stopped / problem** (red), plus "Beamed away" as a lane ghost. Put it **in one place**: the line under the name. Remove the chip over the frame. Today ◌ is used for 3 different states, which Carbon advises against ("avoid reusing one shape in different colors"). *Evidence:* Carbon (glyph + text + color, at most 5–6 states, highest attention wins).

**C6. Move overlays off the remote app's chrome.** Remove the status chip and the "Beam to…" pill from inside the frame. Put "Beam to…" in the tile's footer (or in the ⌘K/B action menu; keep the exact "Beam to…" label for the test contract). The frame should show only what the agent sees, plus urgent approval bars at the bottom. *Evidence:* screenshot `home-v048`, where the pills overlap the Chromium tab strip and window controls; Linear "reduce visual noise".

**C7. Add keyboard-first crew navigation.** Use **1–9** to focus an agent, **arrows** to move between tiles, **Enter** to open, **Space** to **zoom the tile in place** (toggle, like tmux `prefix z` or VS Code ⌘K ⌘M) without leaving the crew view, **B** to beam (already there), **A** to Allow the top approval, **T** to "Talk to all", and **?** to show a cheat sheet. *Evidence:* VS Code maximize group, tmux zoom, Superhuman/Raycast.

**C8. Add a ⌘K command palette with plain-language synonyms.** Commands like "Beam Atlas to Fly.io", "Pause Nova", "Open Scout's screen", "Export Atlas to a file", "Add a cloud". Match synonyms like **move / migrate / send / transfer → Beam** and **sleep / stop → Pause**, and display the term being taught, as in "Beam Atlas to Fly.io (move)". Show each command's shortcut. When an agent is focused, **⌘K shows only its actions** (the Raycast Action Panel). *Evidence:* Superhuman's 9 principles; Raycast.

**C9. Show status outside the window.** Make the **window and tab title** read "Beamhop · 1 needs you", add a **favicon/Dock badge** with the needs-you count, and send **OS and phone notifications** when an agent needs approval or finishes a scheduled task. *Evidence:* Vercel's tab favicon reflects deploy state; ChatGPT agent notifies on completion; the Handoff Dock badge.

**C10. Use a calm grid budget.** Off-focus tiles should get **at most 1 fps, or frames on change only**, and pause entirely when the window is hidden. Only the focused or large tile streams smoothly. *Evidence:* Zoom-fatigue findings (hyper-gaze, monitoring load); UniFi Viewport's choppy-stream complaints; OrbStack is praised for idling near 0% CPU.

**C11. Add filter chips once a crew exceeds about 6 agents.** "Needs you · Working · Free · On this computer · On Fly.io", plus a search box, with **the filter stored in the URL hash** so a view can be saved. *Evidence:* Tailscale filters, chips and URL-saved views; Vercel uses projects as filters.

### Agent view

**A1. Put the screen first, with one collapsible right rail.** The rail has **two tabs: "Chat & narration" and "Settings"**, and collapses to 0 with ⌘\. Add a **Focus mode** (⌘K Z style) that hides everything except the screen and a slim control bar. Settings stops taking 380 px by default. *Evidence:* VS Code Zen Mode and panel maximize; Linear's density in the chrome and focus on content.

**A2. Make takeover explicit, and watching the default.** By default the screen is **watch-only** (no click-through). One big control, "**Take over**" (also on a key, e.g. ⌘⏎), switches modes: a full-width banner reads "**You're driving · Atlas is waiting**", the frame gets a thick inset border of a different style, the cursor labels show who has control, and a "**Give back to Atlas**" button appears, plus Esc×2 to hand back. When control is handed back, the agent posts "Picked up where you left off: …". Replace the caption "Click to use it together". *Evidence:* Steel's "Click inside to take control" banner; Browserbase read-only via pointer-events; ChatGPT agent take over and resume "without losing progress"; TeamViewer shows input-lock state.

**A3. Add a narration rail synced to the screen, then replay.** Each agent step becomes a one-line narration ("Opened bol.com", "Typed 'e-bike'") with a timestamp and a thumbnail. **Clicking a line seeks a replay** of the frames recorded on change. Add a scrubber at 1×/4× and "**While you were away (12 min) ▶**" when you open an agent. *Evidence:* ChatGPT agent narration; the Browserbase rebuild (record on change, HLS-style instant seek, 0.5–4×, and pixels rather than reconstructed DOM because reconstruction "misrepresented what happened").

**A4. Build a contextual control bar, like the Screen Sharing and TeamViewer toolbars.** A compact bar under the screen with **labelled round icon buttons**: Take over, Pause, Fit or 1:1, Fullscreen, Clipboard, **Files** (a tray for the agent's Downloads folder, plus upload), and Phone. Hide controls that don't apply (e.g. Files when there are none) and put the rest in overflow. *Evidence:* Apple High Performance toolbar; TeamViewer's context-dependent quick actions; Kasm's clipboard and upload/download tray.

**A5. Put where and how in the header.** Use a breadcrumb: "Crew › **This computer** › Atlas", with the location as a link that opens the beam menu. Show live **"checked N s ago"** health for cloud agents, and **direct/relay or latency** for remote agents ("Fly.io · Amsterdam · 38 ms"). *Evidence:* Render's "where you are" header; Tailscale's direct-vs-relay indicator and last-seen.

**A6. Use human failure copy and a next action.** Map known errors to one sentence and one button. "Fly.io didn't accept the key → **Reconnect Fly.io**". "Not enough room on Render's free plan → **Choose another place**". Raw text goes behind a "Details" disclosure. *Evidence:* Railway names the failure ("Build failed") on the node; current code shows `error.slice(0,120)`.

**A7. Phone: one-handed.** Put a **floating bottom bar** with Talk, Take over, Pause and Beam. Keep the screen at the top. *Evidence:* Vercel's mobile floating bottom bar for one-handed use; NN/g says to avoid drag on touch, so the phone gets only the menu-based "Beam to…".

### Beam flow

**B1. Run a pre-flight check in the destination picker.** When the user picks a destination (in the menu, or while hovering a lane during a drag), show a **check list** like vMotion's Compatibility panel: ✓ "Fly.io key works", ✓ "Room for 1 more agent", ⚠ "Costs ~$3/month" (a warning; you can continue), ✕ "Render free plan sleeps after 15 min, so scheduled tasks would stop" (blocks, or warns, depending on policy). Add a **"What changes" line**: "Keeps working when this computer is off · Reachable from your phone". *Evidence:* vMotion warnings vs errors; Cursor 3 pitches cloud handoff as "keeps running even after the laptop is closed". This line is the user's reason to beam.

**B2. Make dropping deliberate, with undo.** Dropping on a **paid** destination opens a one-line confirm bar in the lane ("Beam Atlas to Fly.io · ~$3/mo · **Beam** / Cancel", where Enter confirms). Dropping on a free one starts after a **5 s undo toast**. While dragging, highlight every valid lane, use **magnetism**, show a ghost of the tile, and dim invalid targets with a reason ("Atlas is already here"). *Evidence:* Railway's accidental-move complaints; NN/g on drop-zone highlight, magnetism and the lifted look.

**B3. Make the move visible: a two-place presence.** During a beam, the source tile stays **in its lane, dimmed, labelled "Still running here until it lands"**, and a **ghost tile appears in the destination lane** with the stage progress. On landing, the ghost turns solid and the source becomes a faded "cold copy" chip for a while. This makes the "only one copy runs, nothing is lost" invariant **visible**, instead of only a sentence. *Evidence:* Nintendo's explicit "does not create a copy"; the Handoff device symbol on the icon; Cursor 3 local↔cloud drag.

**B4. Make progress honest.** Each stage shows **what is happening and a quantity**, e.g. "Sending the encrypted bundle · 212 of 480 MB", plus a **rough ETA** ("about 1 minute") once it exceeds 10 s. Add a **liveness heartbeat**: a small moving byte counter, and "still working, last progress 3 s ago". If no progress for 20 s or more, change the text to "Slower than usual: waiting for Fly.io to start the machine" and offer **Cancel (Atlas stays here)**. Never show a frozen ETA. Show the same % on both the ghost and the source. *Evidence:* NN/g (percent-done above 10 s, rough ETA, let users stop); the frozen ETAs that drove the Migration Assistant and Quick Start complaints; Quick Share's receiver %.

**B5. Show a receipt with "Beam back" and "What came along".** Keep today's receipt, which is good, and add: **"Beam back to This computer"** (available while the cold copy exists) and a **checklist with counts** ("✓ 23 messages · ✓ 4 memories · ✓ browser logins · ✓ 2 scheduled tasks, next run 08:00 Amsterdam time"). If something did **not** come along, say so clearly ("Telegram needs reconnecting → Fix"). *Evidence:* PlayFab keeps the discarded version for rollback; Nintendo states the consequences plainly.

**B6. Make every beam accessible.** Keep the menu twin ("Beam to…", which already exists). Name items in their buttons ("Beam Atlas to Fly.io"). Announce in a live region: "Atlas is moving from This computer to Fly.io", then "Atlas arrived on Fly.io in 34 seconds". **Restore focus to Atlas's tile** in its new lane. *Evidence:* Atlassian Pragmatic DnD a11y guidance; NN/g keyboard alternatives.

**B7. Make the export file a send/receive pair.** Rename the menu item to "**Send to another computer (file)…**". The dialog leads with Nintendo-style plain copy: "**This moves Atlas. It does not make a copy.** Atlas stops here and lives in the file until you open it elsewhere." On import, if an agent with the same identity exists, offer **one** clear choice ("Keep the one here" / "Use the one from the file"), with consequences, and keep the other as a backup. *Evidence:* Nintendo's Send/Receive roles and copy; PlayFab's single choice and rollback.

**B8. Show the beam outside the window.** The title, favicon and Dock badge show "Moving Atlas… 60%". Send an OS notification when the beam lands or fails, so the user can leave the app. *Evidence:* Vercel's favicon status; ChatGPT agent completion notifications.

---

## 5. Priority suggestion (impact ÷ effort)

1. **C6 + C5** (remove the overlays, show status once with a 5-state vocabulary): a small change with immediate clarity.
2. **C3 + C2** (idle cards, layout adapted to the agent count): fixes the "3 identical splashes plus empty half screen" problem.
3. **A2** (explicit takeover): a safety issue, since clicking anywhere currently hands control.
4. **B4 + B2** (honest progress, deliberate drop with undo): trust in the signature feature.
5. **C1 + B3** (lanes, two-place presence): the big spatial bet. Run a usability test with a "Grid" fallback, because of the Arc novelty tax.
6. **C8 + C7 + C9** (⌘K, keys, status outside the window): power and ambient awareness.
7. **A3** (narration + replay): needs backend recording on change.

---

## 6. Summary (10 lines)

1. Beamhop's crew view spends most of the screen on identical idle splash screens. Status appears twice, and the pills sit on the agent's own browser chrome.
2. Where an agent lives, the core concept, is only a small badge. The dock of places holds no agents and has no counts.
3. Fleet tools that work group by place (Tailscale "This Device" first, Cursor 3 local+cloud in one list) and name health directly (Railway "Build failed").
4. Camera NVRs and multiview show the pattern to copy: stable name order, hide inactive feeds, one large primary for whatever needs attention (Frigate, iSpy, Amazon).
5. Status should use a glyph, a word and a color, with at most 5–6 states, shown once, with the highest attention winning (Carbon). It should also reach outside the window (Vercel favicon, Dock badge, notifications).
6. Live screens should be watch-only by default. Takeover should be an explicit mode with an obvious "give back" (Steel, ChatGPT agent, TeamViewer).
7. Narration plus a seekable replay recorded on change (ChatGPT agent, Browserbase rebuild) answers "what did it do while I was away?".
8. Moves need a pre-flight check (vMotion), a deliberate drop with undo (Railway drift), and honest progress with quantities, a rough ETA and a liveness signal. Migration Assistant and Quick Start show the cost of frozen ETAs.
9. Make "one copy, nothing lost" visible: a ghost in the destination lane while the source stays dimmed, then a receipt with "Beam back" (Nintendo, PlayFab).
10. Top priorities: C6/C5, C3/C2, A2, then B4/B2. Test the lane-based spatial model with a grid fallback because of Arc's novelty tax.
