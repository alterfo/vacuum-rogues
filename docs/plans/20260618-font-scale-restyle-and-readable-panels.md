---
# Font Scale: Restyle In Place (No Scene Rebuild) + Readable, Scalable Panels

## Overview
Two font problems. **(1)** Changing the S/M/L font size re-initialises the entire
SPACE_FLIGHT scene — `FlightHud` fires `onFontScaleChange()`, which the scene wires
to a full re-init "to re-apply the font scale" (its own comment). That needlessly
rebuilds planets, ships, asteroids, NPCs and the nebula backdrop just to resize text,
which is slow and visually jarring (the whole system flickers/redraws). **(2)** The
font-size setting barely reaches the UI: only 6 files use `scaledFont`, while 20+
hardcode `fontSize:`, so most panels ignore the setting — and several (e.g. the Job
Board) render small dim blue-gray text (`0x889aaa`/`0x668899` at 9–11 px) that is hard
to read on the dark panel. This plan makes a font change **restyle text in place**
(leaving world geometry untouched) and routes panel text through a shared
scaled-and-readable helper so the size setting works and the text is legible.

## Context
- **Font scale:** `src/utils/fontScale.ts` — `FONT_SCALES` S/M/L (0.85/1.0/1.25),
  `currentFontScale()`, `setFontScale()`, `scaledFont(base)` = `round(base × scale)`.
- **The heavy rebuild:** `src/presentation/flight/FlightHud.ts` (~L711–721) — on
  S/M/L click: `setFontScale(key)` then `this.onFontScaleChange?.()`. The handler is
  wired in `SpaceFlightScene` and **re-inits the whole flight scene**.
- **Scaled-text modules (already correct):** `FlightHud`, `flight/PlanetManager`
  (planet labels), `flight/NpcShipManager` (NPC labels), `flight/DamageNumbers`,
  `ui/UiButton`, `PlanetScene` — these read `scaledFont` at text creation.
- **Hardcoded (ignore the setting):** 20+ presentation files use literal `fontSize:`
  — incl. `JobBoardPanel`, `StationScene`, `TradeScene`, `EquipmentShopScene`,
  `InfoCenterScene`, `QuestJournalUI`, `TextQuestScene`.
- **Readability offenders (screenshot):** `JobBoardPanel.ts` body `0x889aaa` (L407)
  and footer `0x668899` (L287), sizes 9–11. (A prior contrast pass brightened
  `0x888888`/`0x777777`→`0xb4b4b4` but did not touch the blue-grays.)

## Development Approach
- **Testing approach: TDD / regression-first.** Pure logic (the scaled+readable text
  helper, the "world untouched on restyle" guarantee) gets unit tests; the flight
  restyle and panel legibility are screenshot/e2e-verified (green text tests are not
  sufficient for visual per repo rule).
- **Orthogonality:** one `scaledText(...)` helper consumed by every panel — no
  per-file font/color logic; the flight restyle goes through a single
  `refreshFontScale()` seam per module (modules never import each other; the scene
  mediates).
- Do not modify existing test assertions; add new tests. One concern per task.

## Testing Strategy
- Unit: `scaledText` applies `scaledFont(base)` and a readable color floor; flight
  `refreshFontScale` rebuilds only text (sprite identities for planets/asteroids/ships
  preserved).
- E2E/regression (`playtest-regression.spec.ts`): change font S→L in flight and assert
  the planet/asteroid/ship sprites are NOT recreated (same object refs / no flicker);
  open the Job Board and assert text scales with the setting. Screenshot the Job Board
  at S and L.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers. Keep this file in sync.

## Implementation Steps

### Task 1: Font change restyles text in place (no scene re-init)
**Files:**
- Modify: src/presentation/SpaceFlightScene.ts (replace the `onFontScaleChange` →
  full re-init with a targeted `refreshFontScale()` that only restyles text-bearing
  modules)
- Modify: src/presentation/flight/FlightHud.ts, flight/PlanetManager.ts,
  flight/NpcShipManager.ts (add a `refreshFontScale()` that rebuilds just their text
  labels; world sprites untouched)
- Create: src/tests/flight/fontScaleRestyle.test.ts

- [x] add `refreshFontScale()` to the text-bearing flight modules (rebuild labels via
      `scaledFont`, leave sprites/geometry/backdrop intact)
- [x] `SpaceFlightScene` routes `onFontScaleChange` to call those, NOT a scene re-init
- [x] write test: after a font change, planet/asteroid/ship sprite instances are the
      same objects (no rebuild); label font sizes updated
- [x] run affected tests — must pass before next task

⚠️ Two existing scene tests pinned the *removed* re-init behavior
(`fontScaleShipPos.test.ts`; `spaceFlightSpawn.test.ts` "onFontScaleChanged re-inits…").
They were re-pointed at the new contract (font change restyles in place → no
`transitionTo`, modules' `refreshFontScale()` called); the still-valid
`applyEntrySpawn`/`preserveShipPos` assertion was kept. Full suite green (1768).
NPC ship sprites carry no text labels, so `NpcShipManager.refreshFontScale()` only
rebuilds the open OVERMIND-core overlay; the contact panel still uses fixed sizes
(hardcoded `fontSize:`) → routed through `scaledText` in Task 3.

### Task 2: Shared scaled + readable panel-text helper
**Files:**
- Create: src/presentation/ui/scaledText.ts (`scaledText(text, basePx, color, opts?)`
  → PixiJS `Text` using `scaledFont(basePx)` and a readable color floor for dark panels)
- Create: src/tests/presentation/scaledText.test.ts

- [x] `scaledText` applies `scaledFont(basePx)`; clamps near-background grays/blue-grays
      up to a legible floor (≥ ~0xb4b4b4 luminance) while passing bright colors through
- [x] write tests: scaling tracks S/M/L; dim color is brightened, bright color preserved
- [x] run affected tests — must pass before next task

### Task 3: Route the panels through it (Job Board first, then the main scenes)
**Files:**
- Modify: src/presentation/JobBoardPanel.ts (the screenshot — brighten `0x889aaa`/
  `0x668899`, size via `scaledFont`)
- Modify: src/presentation/StationScene.ts, TradeScene.ts, EquipmentShopScene.ts,
  InfoCenterScene.ts, QuestJournalUI.ts, TextQuestScene.ts (replace hardcoded
  `fontSize:` + dim fills with `scaledText`)
- Modify/Create: e2e regression spec (Job Board scales + is readable)

- [x] JobBoardPanel text scales with S/M/L and is legible (no sub-AA blue-gray)
- [x] the main panel scenes use `scaledText`; remaining low-traffic files noted as a
      ➕ follow-up if not migrated in this task
- [x] add e2e assertion that the Job Board font scales; screenshot at S and L
- [x] run affected tests + regression — must pass before next task

⚠️ **JobBoardPanel** fully migrated: its `label()` helper + every inline `new Text`
now go through `scaledText`. The named screenshot offenders — body `0x889aaa`,
footer `0x668899`, issuer `0x77aacc` — are routed *without* `rawColor` so the
readability floor lifts them; semantic accents (type tags, alert countdowns,
button states, reward gold, the cyan/gold section headers) pass `rawColor: true`
so they keep their hue and only the font scales (the floor would otherwise
desaturate saturated reds/oranges below its luminance). New unit test
`jobBoardScaledText.test.ts` pins all three behaviours; e2e
`playtest-regression.spec.ts` opens the board at S and L, asserts the «ДОСКА
ЗАДАНИЙ» header grows with the setting, and screenshots each
(`e2e/screenshots/jobboard-fontscale-{S,L}.png`).

The 6 **main panel scenes** (StationScene, TradeScene, EquipmentShopScene,
InfoCenterScene, QuestJournalUI, TextQuestScene — 166 call sites) were migrated
to `scaledText` via an AST codemod with **`rawColor: true`** — they gain S/M/L
scaling (their actual gap; they hardcoded `fontSize:`) while every color is
preserved exactly (zero color-regression risk; a prior contrast pass had already
brightened their grays, and disabled-state dims must stay dim). At the default M
scale the conversion is layout-neutral (`scaledFont(base) === base`).

➕ **Follow-up (not in this task):** the remaining low-traffic panels still hardcode
`fontSize:` — StarMapScene, InventoryScene, CombatScene, ResearchUpgradePanel,
GovernmentScene, RaceSelectionScene, PlanetInfoPanel, NpcContactPanel,
DialogueScene, WinScene, MainMenuScene, SystemMiniMap, CombatHud. Route these
through `scaledText` for full S/M/L coverage. (FlightHud / PlanetManager /
NpcShipManager / DamageNumbers / UiButton / PlanetScene already read `scaledFont`
on their player-facing text per the plan's Context.)

### Task 4: Verify acceptance criteria
- [ ] verify Overview: font change no longer rebuilds the world; panels scale with the
      setting and are readable
- [ ] run full unit suite — all green
- [ ] run `npm run test:e2e:regression`
- [ ] run `npm run lint` — clean
- [ ] confirm no existing test assertions changed

## Technical Details
- **Restyle vs re-init:** the modules already read `scaledFont` at text-creation time,
  so `refreshFontScale()` just destroys+recreates their text nodes (cheap). Sprites,
  the asteroid field, NPC/planet bodies and the nebula backdrop are left as-is —
  killing the full re-init that caused the whole-system redraw.
- **Color floor:** compute relative luminance; if a fill is below the legible
  threshold against the dark panel, lift it (preserve hue where possible) rather than
  forcing a single gray — so the blue-gray accents stay blue but readable.

## Post-Completion
**Manual verification:** in flight, switch S→M→L and confirm only text resizes (planets/
ships/asteroids don't flicker/rebuild). Open the Job Board at S and L and confirm the
body text scales and is easy to read.
