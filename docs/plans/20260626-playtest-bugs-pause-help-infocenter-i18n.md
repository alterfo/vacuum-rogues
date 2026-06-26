---
# Playtest Bug Pass: Combat-Pause Freeze, Help-Button Overlap, InfoCenter Margin, English i18n Coverage

## Overview
Four bugs surfaced in manual playtesting of the built/preview game:

1. **Active pause does not freeze the fight** — while the combat pause overlay is up,
   the player ship keeps moving and enemy NPCs keep firing. This contradicts the
   documented freeze contract (the pause must halt movement, calendar, NPC AI and all
   fire/projectiles).
2. **The contextual-help «?» button overlaps the credit balance** on the planet screen
   (both sit top-right), so the «?» covers the balance read-out.
3. **InfoCenter trade margins always render as «?»** — the known-systems-only masking is
   hiding the margin number even for routes the player should be able to read, making
   the margin column useless.
4. **The English build still shows Russian** in onboarding/help, the InfoCenter
   (rumor/news text), the **faction-selection / new-game screen** (`RaceSelectionScene`:
   «ВЫБЕРИТЕ ФРАКЦИЮ» + the difficulty titles «Бог/Средний/Сложный» and their
   descriptions), and many other surfaces — the i18n pass left large gaps.
5. **Settings belong on the main menu, not in-flight** — the player wants the ⚙ settings
   (speed / font / language / neural) reachable from the **main menu**, and the in-flight
   ⚙ settings panel **removed**. The main menu is already reachable mid-game (flight →
   system menu → «В главное меню», then «Продолжить»), so speed/etc. stay changeable
   without an in-flight panel.
6. **«Местный подряд» (local delivery) offered with no valid destination** — the quest is
   generated in a system that has a second *planet* but only **one inhabited (habitable)**
   one, so it sends the player to deliver to a barren/uninhabited world (a dead-end). The
   eligibility guard counts **total** planets (`origin.planets.length >= 2`,
   `QuestGenerator.ts:441`) while the destination picker falls back to *any* planet
   (`habitable ?? candidates[0]`, `pickTargetPlanet`, `:643`) — the two must agree on
   **habitable** planets.

Each fix is **regression-first** per the project bug process: reproduce as a failing
test (real-engine playtest for wiring/interaction bugs, E2E screenshot for visual
bugs, unit test for pure logic), then fix until green, then verify.

## Context (from discovery)
- **Bug 1 — combat pause:** `SpaceFlightScene.updateShip` early-returns on
  `this.combatPause.paused` (`src/presentation/SpaceFlightScene.ts:1157`);
  `NpcShipManager.updateCombatPursuit` returns when `deps.isPaused?.()`
  (`src/presentation/flight/NpcShipManager.ts:1764`, gating `steerCombatOrbit` at 1788);
  `CombatModule.isFrozen()` (`src/presentation/flight/CombatModule.ts:634`) returns
  `deps.isPaused()` and gates the player/NPC fire loops + tracer advance. On paper the
  freeze is wired — so the regression must pin the **actual** observable state (a ship
  position delta and an NPC-shot count of **zero** across ticks while paused) to reveal
  whichever path leaks, OR confirm the live failure is a **stale Service Worker bundle**
  served by `npm run preview` (see `browser-debugging-spacerangers` memory: the SW caches
  old modules). Both are addressed below.
- **Bug 2 — «?» overlap:** the help button is pinned top-right in
  `src/presentation/ui/mountSceneHelp.ts` (`helpBtn.x = sw - HELP_BUTTON_SIZE(34) -
  HELP_BUTTON_MARGIN(12)`, `helpBtn.y = 12`). `PlanetScene` mounts it
  (`src/presentation/PlanetScene.ts:31`) and also draws the credit balance in that
  corner — they collide.
- **Bug 3 — InfoCenter margin:** `buildRumorPanel`/`maskTradeNewsMargin`
  (`src/systems/info/rumorPanel.ts`) mask the margin via `isSystemKnown(player, galaxy,
  id)` = `player.hasVisited(id) || system.explored` (`src/systems/galaxy/systemKnown.ts`).
  `InfoCenterScene` threads `player` (so masking is active). If *every* margin shows «?»,
  either the player's known set is empty at the read point (starting system / neighbors
  not flagged explored/visited) or the rule is too strict for the InfoCenter's use.
- **Bug 4 — i18n:** catalogs live in `src/i18n/ru.ts` + `src/i18n/en.ts`, accessed via
  `t()` (`src/i18n/i18n.ts`); a Cyrillic-literal helper exists
  (`src/i18n/cyrillicLiterals.ts`) and parity is gated by `src/tests/i18n/parity.test.ts`
  + `migratedScenes.test.ts`. Gaps: `src/systems/onboarding/helpContent.ts` (titles/bodies
  are hardcoded Russian), InfoCenter rumor/news **text generation** (`describeRumor`,
  `buildNews`, trade rumor lifecycle strings under `src/systems/trade/`), and other scenes
  not yet migrated.

## Development Approach
- **Testing approach: TDD / regression-first** (mandated by the project bug process).
  Each task writes the failing test BEFORE the fix and goes green before the next task.
- Route interaction/wiring regressions into the **real-engine playtest harness**
  (`src/tests/playtest/**`), pure-logic into unit tests, and visual/layout into
  **Playwright E2E** (`e2e/playtest-regression.spec.ts`) with a screenshot.
- Keep changes minimal and additive; respect the standing rules: never weaken existing
  test assertions, money only through the ledger, dark-panel text through `scaledText`,
  no `git commit --no-verify`.
- **Blast-radius first:** before editing `updateShip`, `CombatModule`, `NpcShipManager`,
  `mountSceneHelp`, `rumorPanel`, or the i18n catalogs, confirm callers (impact/grep) and
  change only the minimal set.
- i18n is **presentation/string only** — no domain/schema/save change.

## Testing Strategy
- **Unit tests**: required for every task (pure helpers — masking predicate, layout math,
  catalog key coverage).
- **Real-engine playtest**: the combat-pause freeze (Task 1) and InfoCenter margin
  wiring (Task 3) assert observable engine state + zero logged errors.
- **E2E**: the «?»/balance overlap (Task 2) needs a rendered screenshot + a
  non-overlap geometry assertion; an English-build smoke check (Task 6) screenshots key
  scenes with `language=en` and asserts no Cyrillic in rendered labels where feasible.

## Progress Tracking
- Mark completed items `[x]` immediately; add ➕ for discovered tasks, ⚠️ for blockers.

## What Goes Where
- **Implementation Steps**: code, tests, catalog edits, the parity gate.
- **Post-Completion**: manual in-browser verification (hard-reload to bypass the SW),
  visual confirmation of the English build.

## Implementation Steps

### Task 1: Combat active-pause must freeze ship movement and NPC fire
**Files:**
- Create: `src/tests/playtest/combatPauseFreezesLiveFight.test.ts`
- Modify: `src/presentation/SpaceFlightScene.ts`, `src/presentation/flight/NpcShipManager.ts`, `src/presentation/flight/CombatModule.ts` (only the leaking path, if any)
- Modify: Service Worker cache versioning (`public/sw.js` or the SW source / `vite.config.ts` build stamp) so a new deploy never serves a stale combat bundle

- [x] write a real-engine playtest (`combatPauseFreezesLiveFight.test.ts`): boots into SPACE_FLIGHT, engages a controlled hostile, runs a real-time control phase (ship + NPC actually move), then raises the active pause and asserts player ship `(x,y)`, NPC `(x,y)` and both hulls are unchanged across 5 fire-interval frames (zero shots), zero logged errors
- [x] ran it: **GREEN** — the wired scene's freeze is correct on every path (`updateShip` early-return, `NpcShipManager.update` `!isTurnRunning()`, `updateCombatPursuit` `isPaused`, `CombatModule.isFrozen`). So the live failure is the **stale SW bundle**; proceeded to cache-busting (hard-reload verification documented in Post-Completion)
- [x] versioned the SW cache name per build: root cause was `sw.ts` reading `globalThis.__BUILD_VERSION__` (a *member* access `define` never substitutes → frozen at `'dev'`). Now reads the inlined bare `__BUILD_VERSION__`/`__BUILD_SHA__` defines and keys the name on version **+ SHA** via the pure `buildCacheNames` (`src/systems/sw/cacheNames.ts`); the existing `activate` sweep purges every non-current name → previous build's stale cache is dropped each deploy
- [x] added a unit test (`src/tests/sw/cacheNames.test.ts`) asserting the cache key changes when the build SHA **or** version changes, is stable for the same identity, and keeps app/model caches distinct
- [x] ran tests — combatPause freeze unit + playtest suites (26 files / 260 tests) green, tsc + eslint clean

### Task 2: Move the «?» help button so it never covers the credit balance
**Files:**
- Modify: `src/presentation/ui/mountSceneHelp.ts` and/or `src/presentation/PlanetScene.ts`
- Create: `e2e/` screenshot assertion in `playtest-regression.spec.ts`
- Create/Modify: `src/tests/presentation/helpButtonLayout.test.ts`

- [x] write a **failing** layout unit test: the «?» button rect (`sw-34-12, 12, 34×34`) and the planet-screen balance read-out rect must not intersect — `src/tests/presentation/helpButtonLayout.test.ts` sweeps screen widths × text widths × font heights against `helpButtonRect`/`creditsHudAnchor`
- [x] fix by relocating the colliding element — exposed the reserved «?» rect as the single source of truth `helpButtonRect(screenWidth)` in `mountSceneHelp.ts`; the planet credit read-out now anchors via the pure `creditsHudAnchor(w)` (right edge parked 10 px left of the reserved corner zone, same top line), so it stays clear of the «?» and of the bottom-right «Оставить issue» overlay
- [x] add an E2E screenshot of the planet screen and visually confirm the «?» no longer overlaps the balance — `e2e/playtest-regression.spec.ts` lands on a planet, screenshots `e2e/screenshots/planet-help-balance.png`, and asserts the rendered global bounds of the «?» button and the top «₡» read-out don't intersect (cropped screenshot confirms «1 000 ₡» sits clearly left of the «?»)
- [x] verify the «?» still opens the help panel and the auto-show-once behaviour is intact — covered by the unchanged `mountSceneHelp.test.ts` (button placement only refactored through `helpButtonRect`, identical x/y); all 53 onboarding tests green
- [x] run tests — must pass before next task — helpButtonLayout + planetScene unit suites + onboarding green, E2E green, tsc + eslint clean

### Task 3: InfoCenter shows the real margin for known routes (masking not over-broad)
**Files:**
- Modify: `src/systems/galaxy/systemKnown.ts` and/or `src/systems/info/rumorPanel.ts`
- Modify: `src/presentation/InfoCenterScene.ts` (only if the player/known set isn't threaded correctly)
- Create: `src/tests/info/infocenterMarginVisibility.test.ts` (extend existing rumor tests)

- [x] write a **failing** test: a rumor/route whose endpoints are **known** (player has visited or the system is `explored`) must render the numeric margin, NOT «маржа ~?%»; a route touching an undiscovered system stays masked — `src/tests/info/infocenterMarginVisibility.test.ts` (real-engine playtest) boots a new game and asserts a home↔neighbour rumor shows a number while a rumor into an unexplored system stays masked
- [x] reproduce the "all margins are «?»" case: assert that at game start the player's current system and its revealed neighbours are flagged known (`hasVisited`/`explored`) so their routes show numbers — RED confirmed: pre-fix only the home system was known (neighbours unrevealed until the star map was opened), so under the both-endpoints rule *every* cross-system rumor masked to «~?%»
- [x] fix the over-broad masking: **known-detection was wrong** — `GameEngine`'s new-game block flagged only `systems[0].explored` and never revealed neighbours, leaving a single known system that can never anchor a cross-system route. Fix: call `galaxy.revealSystemAndNeighbors(currentSystemId)` at new-game time (the same call the star map makes on open) so the home cluster is known from turn 1. The masking **rule is unchanged** (both endpoints must be known; a route touching an undiscovered system stays masked) — documented in the test
- [x] keep the news-feed `maskTradeNewsMargin` masking consistent with the panel rule (no leak / no over-mask) — same `isSystemKnown` predicate, unchanged, so the news feed benefits from the game-start reveal identically; the locked `infoCenterRumors.test.ts` (panel + news parity) stays green
- [x] run tests — must pass before next task — new test GREEN (3/3); infoCenterRumors/systemKnown/fogOfWar/systemVisibility/chartedNames/questKnownSystems (57) + playtest journeys/invariants + GameEngine core (26) all green; tsc + eslint clean

### Task 4: Localize onboarding/contextual-help content (helpContent.ts)
**Files:**
- Modify: `src/systems/onboarding/helpContent.ts`, `src/i18n/ru.ts`, `src/i18n/en.ts`
- Modify: `src/tests/i18n/migratedScenes.test.ts` (add onboarding keys)

- [x] move every `HELP_CONTENT` title/body/controls string into the `ru`/`en` catalogs under stable keys and have `helpFor(key)` resolve through `t()` (so the help panel re-reads on language change like other migrated scenes) — `helpContent.ts` rebuilt: `HELP_SPEC` drives `help.<key>.{title,body{N},control{N}}` keys, each `HELP_CONTENT` entry is a live getter resolving through `t()`; object identity per key preserved (the locked `helpFor(key).toBe(HELP_CONTENT[key])` test stays green). Panel chrome «Управление:»/«Понятно» in `HelpPanel.ts` also routed through `t()` (`help.controlsHeader`/`help.gotIt`)
- [x] add English translations for all onboarding entries in `en.ts` — every `help.*` key added to both `ru.ts` (verbatim) and `en.ts` (translated)
- [x] write tests: every onboarding key exists in both catalogs (parity) and `helpFor` returns the active-language string — `src/tests/onboarding/helpContentI18n.test.ts` asserts key parity + RU-default + EN resolution + live re-read on switch
- [x] verify the welcome/combat one-shot hints also resolve through `t()` — covered by the test (EN resolution + no-Cyrillic-leak assertion on the combat entry)
- [x] run tests — must pass before next task — onboarding + i18n suites (12 files / 92 tests incl. the locked `helpContent.test.ts`, parity, migrated-scenes guard with `HelpPanel.ts` + `helpContent.ts` appended) green; tsc + eslint clean

### Task 5: Localize InfoCenter rumor + news generated text
**Files:**
- Modify: `src/systems/info/rumorPanel.ts`, `src/systems/trade/*` (rumor lifecycle / `describeRumor`), `src/presentation/InfoCenterScene.ts` (`buildNews`), `src/i18n/ru.ts`, `src/i18n/en.ts`

- [ ] route the rumor/news **text generators** (`describeRumor`, news descriptions, route/commodity labels) through `t()` with interpolated params (system names, commodity, percent) instead of hardcoded Russian
- [ ] add the corresponding `ru`/`en` keys with `{param}` placeholders (parity-safe)
- [ ] write tests: a rumor/news line renders in English under `language=en` and in Russian under `ru`, with params filled correctly
- [ ] run tests — must pass before next task

### Task 6: Full audit — migrate remaining hardcoded-Russian UI surfaces
**Files:**
- Modify: the **faction-selection / new-game screen** `src/presentation/RaceSelectionScene.ts` (the «ВЫБЕРИТЕ ФРАКЦИЮ» heading + the `GAME_MODES` difficulty titles «Бог/Средний/Сложный» and their `desc` strings — user-reported still-Russian), plus remaining scenes/components surfaced by the audit (e.g. `StarMapScene`, `InventoryScene`, `GovernmentScene`, `DialogueScene`, toasts in `PlanetScene`, etc.), `src/i18n/ru.ts`, `src/i18n/en.ts`
- Create: `e2e/` English-build smoke screenshots in `playtest-regression.spec.ts`

- [ ] localize `RaceSelectionScene` first (explicitly user-reported): heading + difficulty titles/descriptions through `t()` with English values
- [ ] enumerate all user-facing Cyrillic string literals in `src/presentation/**` and `src/systems/**` (use `src/i18n/cyrillicLiterals.ts` / a scan) and triage which are user-visible UI vs. logs/ids
- [ ] migrate each user-visible string into the catalogs and through `t()`; add English values
- [ ] add an E2E pass that boots key scenes with `language=en` and screenshots them; visually confirm no Russian leaks in the main flows
- [ ] write/extend tests covering the newly migrated keys (parity)
- [ ] run tests — must pass before next task

### Task 7: Parity gate — fail the build on new hardcoded user-facing Russian
**Files:**
- Modify: `src/i18n/cyrillicLiterals.ts`, `src/tests/i18n/parity.test.ts` (or a new `noHardcodedCyrillic.test.ts`)

- [ ] add a test that scans the agreed UI source set for Cyrillic string literals not sourced from the catalogs and fails with the offending file:line (allow-list logs/ids/comments)
- [ ] seed the allow-list with any intentional exceptions discovered in Task 6 so the gate is green-on-clean
- [ ] document the "add a string ⇒ add a key" rule in the i18n section of the relevant CLAUDE.md / README
- [ ] run tests — must pass before next task

### Task 8: Relocate settings to the main menu; remove the in-flight ⚙ panel
**Files:**
- Modify: `src/presentation/MainMenuScene.ts` (add a «Настройки»/`menu.settings` button that opens the shared `SettingsPanel`)
- Modify: `src/presentation/flight/FlightHud.ts` (remove the `gearButton` ⚙ + `SettingsPanel` mount/teardown), `src/presentation/SpaceFlightScene.ts` + `src/presentation/flight/flightKeyHandler.ts` (drop the `isSettingsPanelOpen` settings branch from the Esc/`closeModals` priority chain — leave the other surfaces intact)
- Modify: `src/i18n/ru.ts`, `src/i18n/en.ts` (the new `menu.settings` key)
- Create/Modify: `src/tests/presentation/MainMenuScene.test.ts`, `src/tests/flight/flightKeyHandler.test.ts`

- [ ] add a «Настройки» button to `MainMenuScene` (localized) that opens the shared `SettingsPanel` (speed/font/language/neural), wired to the same `gameSettings` accessors + live-apply callbacks; closes on its own control / outside-click
- [ ] confirm speed/font/language/neural set from the main menu persist and apply on «Продолжить» (speed → `gameSpeedMultiplier`, font/lang restyle, neural flag) — they already write through `gameSettings`, so this is a re-mount of the existing panel, not new state
- [ ] remove the in-flight ⚙ `gearButton` + `SettingsPanel` from `FlightHud` (keep the ♿ accessibility quick-toggle in flight — it's an in-the-moment aid, not a settings panel; note this decision so it can be revisited)
- [ ] drop the settings branch from `flightKeyHandler`'s Esc priority chain + the click `isBlockingModalOpen` guard, leaving combat-pause/contact/journal/planet-info handling unchanged
- [ ] write tests: MainMenuScene opens the SettingsPanel and a control writes through `gameSettings`; `flightKeyHandler` no longer references the settings panel; FlightHud no longer mounts a gear button
- [ ] run tests — must pass before next task

### Task 9: «Местный подряд» needs a habitable in-system destination (no dead-end contract)
**Files:**
- Modify: `src/systems/quests/QuestGenerator.ts` (the `originHasNeighbour` guard at `:441` and `pickTargetPlanet` at `:634` — local-delivery must require a habitable neighbour)
- Modify/Create: `src/tests/quests/localDeliveryQuest.test.ts`

- [ ] write a **failing** test: a board in a system with exactly one habitable planet (plus ≥1 barren planet) must **not** emit a «Местный подряд» (it falls back to a text quest); only a system with **≥2 habitable** planets may
- [ ] write a **failing** test: when a local delivery IS generated, its destination planet is always habitable and ≠ the issuer planet (never a barren/uninhabited world)
- [ ] fix the guard so `originHasNeighbour` counts **habitable** planets (a real delivery destination ≠ issuer exists), matching the picker
- [ ] fix the destination selection so local delivery targets only a **habitable** neighbour (a dedicated picker or a `habitableOnly` flag on `pickTargetPlanet`) — without changing `pickTargetPlanet`'s behaviour for its other callers (check blast radius first)
- [ ] verify the existing local-delivery tests still pass (their fixtures must use ≥2 habitable planets); if one reds, re-diagnose rather than weaken it
- [ ] run tests — must pass before next task

### Task 10: Verify acceptance criteria
- [ ] verify all reported items are fixed: pause freezes movement+fire (Task 1), «?» clears the balance (Task 2), known routes show numeric margins (Task 3), English build shows no Russian incl. faction-selection (Tasks 4–7), settings live on the main menu with the in-flight ⚙ gone (Task 8), and no dead-end «Местный подряд» in single-habitable systems (Task 9)
- [ ] run the full unit suite (`npm test -- --run`), the playtest gate (`npm run test:playtest`), and the i18n parity gate
- [ ] run the E2E regression suite for the visual fixes (`npm run test:e2e:regression`)
- [ ] run the linter — all issues fixed
- [ ] confirm no domain/schema/save change slipped in (these are presentation/logic-only fixes); `npm run test:save-compat` stays green

## Technical Details
- The combat-pause freeze signal is the single `combatPause.paused` (`CombatModule.isFrozen`
  = `isPaused()`); do not introduce a second pause concept — gate any leaking path on the
  existing one.
- The «?» reserved zone is the top-right `34+12` px square; keep all corner HUD elements
  out of it (or move the «?»), and keep it clear of the bottom-right issue overlay.
- `isSystemKnown` is the one masking predicate; the InfoCenter rule change (if any) lives
  in `rumorPanel.ts`, not at the call site.
- i18n: keys carry `{param}` placeholders that must match across `ru`/`en` (parity test);
  generated rumor/news text becomes templated strings, not concatenated literals.

## Post-Completion
**Manual verification:**
- Hard-reload the preview (DevTools → Application → Service Workers → Unregister, or
  Empty-Cache-and-Hard-Reload) before re-testing combat pause, to rule out a stale SW
  bundle; confirm the ship and enemies are fully frozen while the pause overlay is up.
- Switch the language to English in ⚙ Settings and walk onboarding → InfoCenter → planet
  → star-map → inventory, confirming no Russian leaks.
- Confirm the planet-screen «?» sits clear of the credit balance at a few window sizes.
