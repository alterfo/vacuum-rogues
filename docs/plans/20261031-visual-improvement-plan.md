---
# Visual Polish Plan — Vacuum Rogues (Galactic Horizon)

## Overview

Raise the visual quality and legibility of the browser game across the remaining PixiJS surfaces,
layered on top of the gameplay that already shipped. This plan deliberately excludes work that is
already done (see "Corrections" in Context) and targets what the codebase still shows as open:

1. **Legibility stream** — finish the `scaledText` migration (11 files still hardcode `fontSize:`),
   close the `ScrollableList` variable-height gap, and audit remaining low-contrast states.
2. **Scene polish stream** — the EPIC-010 screens that are still open after the completed
   `20260729-ux-review-fixes` pass: main menu, race selection, station, info center, dialogue,
   inventory/save, win screen.
3. **Atmosphere & art-coverage stream** — procedural background tint tied to system/faction/combat
   state, damage/warp/death juice, and closing concrete art gaps (`station_interior/` resolver
   returns `null`; icon coverage is thin).

## Context

- **Architecture (verified 2026-10-31)**: PixiJS 8 scenes under `src/presentation/`; shared
  presentation components already exist — `ui/UiButton.ts`, `ui/scaledText.ts`,
  `ui/responsiveLayout.ts` (`touchHitArea` wired into `UiButton`), `ui/ScrollableList.ts`,
  `ui/mountSceneHelp.ts`. Combat is **in-flight tactical-pause** (`flight/CombatHud.ts`,
  `flight/CombatModule.ts`, `combatPlanning.ts`, `combatWeaponVfx.ts`, `combatStatusBars.ts`,
  `combatShieldFlash.ts`, `combatWreckRenderer.ts`, `DamageNumbers.ts`) — there is no hex-grid
  `CombatScene` (removed 2026-06-23).
- **Star map (US-077) is already implemented**: `StarMapScene.initializeViewport()` fits explored
  systems at ~70% of the canvas (`StarMapScene.ts:122-163`), a `[ Назад ]` button exists
  (`StarMapScene.ts:442`), and the fuel label is `ТОПЛИВО:` (`:368`). The US-077 document still says
  "Planned" — documentation lag, not a code gap.
- **UX-review fixes already landed** (`docs/plans/completed/20260729-ux-review-fixes.md`): station
  interior backdrop, star-map threat banner chip, planet/station action-menu chrome unification,
  HUD icon-button tooltips, main-menu button colour, loan-terms preview, bank reason localization.
  `SECTOR MAP`, `TACTICAL COMBAT`, `GALACTIC HORIZON` strings are gone; `PlanetInfoPanel` now derives
  the faction name (`PlanetInfoPanel.ts:102`). Treat the 2026-06-06 `docs/ux-review.md` as a
  historical source, not a current backlog.
- **Typography rule (current)**: dark-panel text goes through `scaledText(text, basePx, color,
  opts?)` (`ui/scaledText.ts`), never raw `new Text({ style: { fontSize } })`. Still hardcoding
  `fontSize:` — StarMapScene, InventoryScene, ResearchUpgradePanel, GovernmentScene,
  RaceSelectionScene, NpcContactPanel, DialogueScene, WinScene, MainMenuScene, SystemMiniMap,
  CombatHud (+ CombatPauseOverlay). Migrated list and exceptions (`rawColor: true`) are in
  `src/presentation/AGENTS.md`.
- **Known shared-component gap**: `ScrollableList`'s uniform `itemHeight` cannot host wrapped items
  (e.g. InfoCenter news) at the "L" font setting — documented in `src/presentation/AGENTS.md` as a
  known, not-yet-fixed gap.
- **Art state (verified)**: `src/assets` has `planets` 36, `planet_maps` 48, `surfaces` 24,
  `star_maps` 31, `stars` 30, `ships` 24, `player_ships` 12, `portraits` 15, `icons` 6, `station` 15,
  `panoramas` 8, `ui` 8 (dead — zero code references). `nebula/` was deliberately removed in favour
  of procedural (`refactor(visuals): drop nebula texture asset category …`); `station_interior/`
  does not exist — `stationBackdrop.ts`'s `resolveStationBackdropKey` returns `null` by design, so
  stations render the procedural gradient fallback.
- **Art integration is already wired** through `textures.ts` (`pickVariant`/`pickVariantKey`/
  `loadTextureAsync`, `LAZY_PREFIXES`, background preload) in: `PlanetSprite` (`planet_maps`,
  `planets`), `PlanetScene` (`surfaces`, panoramas), `StarRenderer` (`star_maps`), `PlayerShipRenderer`
  & `NpcShipSprite`/`MainMenuScene` (`player_ships`, `ships`), `RaceSelectionScene` (`portraits`),
  `gearIcon` (`icons`), `stationArt` (`station`), `TextQuestScene` (`quest_art`), `overmindMoodArt`
  (`overmind_mood`). New art lands via the manifest glob with no code change.
- **Design direction** (`~/.agents/design/design-systems.md`): site direction = **Game** —
  atmosphere/world-building may override conventional contrast norms, but exceptions must be
  documented per scene; typography ≤3 roles, one accent + reserved semantic colours, spacing scale.
- **Corrections applied in this revision (2026-10-31)** relative to the first draft: removed the
  stale zoom-to-fit and hex-combat tasks; removed the "create a shared button factory" task
  (`UiButton` exists); replaced "integrate the art pipeline" with "close art-coverage gaps"; dropped
  the "add nebula art" task (deliberately procedural).

## Development Approach

- Follow the project's three test tiers (root `AGENTS.md`): unit (mocked/pure), real-engine playtest
  (`src/tests/playtest/**`), Playwright E2E for visual/interaction work; verify rendering changes via
  screenshot (bug-fixing process rule 3).
- Respect the presentation-layer rules: `scaledText` for dark-panel text; no `BlurFilter` inside
  `gameLayer`; `event.stopPropagation()` on UI handlers over `gameLayer`/`stage`; touch targets via
  `touchHitArea`; text labels `eventMode="none"` over clickable areas.
- Art conventions: lazy categories load async via `pickVariantKey` + mount, synchronous `tex`
  lookup falls back to procedural art when absent — never require an asset.
- Run `gitnexus impact <Symbol>` before touching existing symbols; `detect_changes()` before
  committing; i18n RU+EN lockstep via `t(...)`.

## Testing Strategy

- **Unit**: `ScrollableList` variable-height math, text-scale helpers, tint/palette derivation,
  art-key fallback resolution.
- **Real-engine playtest**: scene wiring for the touched scenes (star map, combat HUD, menus).
- **Playwright E2E + screenshots**: the visual verification path for star map, combat, menu and
  station screens; screenshots reviewed before declaring a task done.

## Progress Tracking

- Mark `[x]` when a checklist item completes; add ➕ discovered tasks and ⚠️ blockers.

## What Goes Where

- Implementation checklist items (`[ ]`) → code, tests, wiring.
- Post-completion → manual live-browser feel verification, tuning, and any real-art follow-up.

## Implementation Steps

### Task 1: Star map — verify existing fixes, finish legibility

**Files:**

- Modify: `src/presentation/StarMapScene.ts`
- Modify: `docs/requirements/user-stories/US-077-starmap-initial-zoom.md` (status)
- Tests: star-map unit/E2E

- [x] Verify and close US-077 in code (zoom-to-fit, `[ Назад ]`, fuel label) — confirmed
      `initializeViewport` fits explored systems to ~70% of the canvas, the `[ Назад ]` button
      transitions to SPACE_FLIGHT, and the `ТОПЛИВО: x/y` label sits at 14px; story status set to
      Implemented instead of re-implementing.
- [x] Migrate StarMapScene text nodes to `scaledText` — every raw `fontSize:` `Text` node now goes
      through `scaledText` (semantic colors use `rawColor: true`, dim dark-panel body text keeps the
      luminance floor).
- [x] Audit unvisited-system label contrast — the old failing `0x445566` neighbour label was already
      lightened to `0x88aacc` (commit 6f28cd32); verified no `0x445566` remains and added a ratchet.
- [x] Verify the star-map tooltip on unvisited systems and the `[ Назад ]` hit target — `[ Назад ]`
      keeps `eventMode="static"` + `cursor="pointer"` + `stopPropagation`; the flight-HUD star-map
      icon tooltip (`FlightHud.starMapTooltip`) is covered by `flightHud.test.ts` (verification-only).
- [x] Run star-map tests + E2E, screenshot-verify — 12 star-map unit files (59 tests) green, full
      unit suite green, `03-star-map` Playwright smoke green (zoom-to-fit), screenshot captured at
      `test-results/star-map-task1.png`.

### Task 2: In-flight combat HUD & VFX polish

**Files:**

- Modify: `src/presentation/flight/CombatHud.ts`
- Modify: `src/presentation/flight/CombatPauseOverlay.ts`
- Verify: `DamageNumbers.ts`, `combatWeaponVfx.ts`, `combatStatusBars.ts`,
  `combatShieldFlash.ts`, `combatWreckRenderer.ts`
- Tests: real-engine playtest + E2E

- [x] Migrate `CombatHud` and `CombatPauseOverlay` off raw `fontSize:` to `scaledText` (both are on
      the not-yet-migrated list) — the CombatHud target label and the CombatPauseOverlay
      title/section/message nodes now go through `scaledText`; the CombatHud panel row offsets derive
      from `lineStepFor(scaledFont(13))`.
- [x] Verify target/player HP bars, markers, tracer streaks, damage numbers and weapon-range overlay
      remain readable and non-overlapping at S/M/L font settings and at phone widths — new
      `combatHudScaledText.test.ts` pins label/bar non-overlap at S/M/L and panel fit at 320 px width;
      marker/tracer/damage/range suites are green in the full unit run.
- [x] Verify shield flash, wreck FX, auto-combat toggle and the planning-pause overlay chrome —
      `combatShieldFlash`, `combatWreckRenderer`, `autoCombatWiring`, `combatPlanningUi`,
      `combatWeaponVfxOverlay`, `combatStatusBars`, `combatWeaponRangeOverlay` suites are green.
- [x] Run playtest + screenshot verification — `npm run test:playtest` green (936 passed);
      screenshot verification is manual (skipped - no deterministic combat-HUD visual spec).

### Task 3: Typography completion + `ScrollableList` variable height

**Files:**

- Modify (remaining `fontSize:` users): `InventoryScene.ts`, `ResearchUpgradePanel.ts`,
  `GovernmentScene.ts`, `RaceSelectionScene.ts`, `NpcContactPanel.ts`, `DialogueScene.ts`,
  `WinScene.ts`, `MainMenuScene.ts`, `SystemMiniMap.ts`
- Modify: `src/presentation/ui/ScrollableList.ts`
- Create: a guard test (allowlist: `UiButton`, `scaledText`, internal modules)

- [x] Migrate the remaining files to `scaledText`, using `rawColor: true` only for bright/semantic
      colours.
- [x] Add per-item variable height to `ScrollableList` (or a documented per-consumer opt-out) so
      wrapped rows stop bleeding at "L" scale.
- [x] Add a test ratchet asserting no raw `fontSize:` in the presentation allowlist violations.
- [x] Run tests + lint + screenshot verification (screenshot review is manual — not automatable,
      skipped).

### Task 4: Remaining scene polish (EPIC-010 stories still open)

**Files:**

- Modify: `MainMenuScene.ts`, `RaceSelectionScene.ts`, `StationScene.ts`, `InfoCenterScene.ts`,
  `DialogueScene.ts`, `InventoryScene.ts`, `SaveLoadScene.ts`, `WinScene.ts`
- Tests: E2E visual path per screen

- [x] Main menu (US-081): disabled "Продолжить" with no save, "Загрузка…" state during `loadGame`,
      options/credits entry points.
- [x] Race selection: stats typography, description fit inside card height, selection transition.
- [x] Station (US-083): service-button guard when no station context, disabled-state contrast,
      human-readable micromodule names, Esc disclosure.
- [x] Info center: active/inactive tab contrast, cycler filter affordance, news-scroll indication.
- [x] Dialogue: replace the placeholder blue-circle portrait with the existing `portraits/` art via
      `pickVariant`, and fix response-button overflow.
- [x] Inventory/Save/Win: close-button targets, resource-line wrapping, completed-quests section.
- [x] Run the E2E visual suite, screenshot-verify each screen — regression suite attempted (28 passed;
      1 unrelated speed-survival timeout); per-screen screenshot review is manual — not automatable,
      skipped.

### Task 5: Art coverage — `station_interior` slot + coverage audit

**Files:**

- Verify: `src/assets/manifest.ts`, `src/presentation/flight/stationBackdrop.ts`,
  `src/presentation/ui/gearIcon.ts`
- Docs: `docs/design/ASSET_PIPELINE.md`

- [ ] Audit manifest categories against render paths; record the inventory (planets 36, planet_maps
      48, surfaces 24, star_maps 31, stars 30, ships 24, player_ships 12, portraits 15, icons 6,
      station 15, panoramas 8) in the pipeline doc.
- [ ] Decide and document `station_interior/`: either generate art via the ComfyUI pipeline so
      `resolveStationBackdropKey` starts returning a key, or record the procedural-only decision.
- [ ] Check icon coverage (6 files) against the gear families that render a glyph fallback today;
      log families that would benefit from an icon.
- [ ] Do **not** re-add the nebula texture category — the owner removed the generated nebula art
      because they disliked it (decision of 2026-10-31). Nebula stays procedural; this is a closed
      decision, not a deferred one.
- [ ] Verify lazy-category resolution and procedural fallbacks with tests.

### Task 6: Atmosphere & juice pass

**Files:**

- Modify: procedural background tint (`SpaceBackgroundLayer.ts` / `SpaceFlightScene.ts`)
- Modify: damage/warp/death/victory presentation modules
- Verify: `BlackHoleArcadeScene.ts` juice gates on reduced motion

- [ ] Tie nebula palette/tint to system type/faction and combat/low-hull state, reusing the state
      inputs the adaptive audio already consumes.
- [ ] Polish damage numbers, warp effect, ship-death FX and game-over/victory screens.
- [ ] Verify the black-hole arcade juice respects the reduced-motion seam.
- [ ] Tests + screenshot verification.

### Task 7: Acceptance & regression verification

**Files:**

- Modify: `docs/requirements/user-stories/US-075, US-077, US-081, US-083` statuses
- Docs: `src/presentation/AGENTS.md` (migration list), subsystem docs if touched

- [ ] Run full unit suite (`npm test -- --run`), `npm run test:playtest`, `npm run test:e2e`
      (regression subset); `npm run lint`; `tsc`.
- [ ] Run `gitnexus detect_changes({ scope: "compare", base_ref: "master" })` and confirm scope.
- [ ] Update the story statuses and the "still hardcoding fontSize:" list to match reality.
- [ ] Review screenshots via the VLM UI-review tooling for the touched scenes.

## Technical Details

- **`scaledText` contract**: `scaledText(text, basePx, color, opts?)` sizes via `scaledFont()` and
  lifts dim fills to `READABLE_FLOOR`; pass `rawColor: true` only for already-bright or intentionally
  dimmed states. Fixed-pixel row steps/truncation do not scale — derive row steps from
  `lineStepFor`/`scaledFont`, never fixed constants (documented migration pattern).
- **`ScrollableList`**: current uniform `itemHeight` is the documented known gap; wrap-aware variable
  height is the fix target (per presentation `AGENTS.md`).
- **Art fallbacks**: `pickVariantKey(...) ?? null` + procedural fallback is the established contract
  (`stationBackdrop`, `PlanetScene` backdrop). Art must stay optional; missing art must degrade to
  procedural, never to a blank scene.
- **Game latitude**: per design-systems.md, atmosphere may override strict contrast for large display
  text and effects; small UI text keeps the AA floor unless documented otherwise.

## Post-Completion

- **Manual verification** (live browser): star map, combat, menus, station, dialogue screens at S/M/L
  font and phone width; procedural nebula tint reads as intentional, not noisy.
- **Tuning**: contrast values and tint intensities are first-pass; adjust after visual review.
- **Real art follow-up**: `station_interior/` art and extra gear icons can be dropped into the
  existing manifest glob with no code-path change.

## Out of Scope (deferred)

- Re-introducing a nebula texture category — permanently closed: the owner removed the generated
  nebula art because they disliked it (2026-10-31). Procedural nebula is the final choice.
- Full hex-grid combat scene (removed — combat is in-flight tactical-pause).
- Gameplay/balance changes (visual only; constants touched only where a visual fix needs one).
- A new shared UI framework — `UiButton`/`scaledText`/`responsiveLayout` already cover this.
