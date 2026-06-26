---
# Save Slots UI (Named Manual Saves + Cleaner Continue)

## Overview
The backend already supports **10 save slots** (`SaveManager`, IndexedDB), but there's no
UI to use them — players effectively have the `auto` slot only. Add a **save/load screen**
with named manual slots (create/overwrite/delete, timestamp + summary) and a cleaner
**Continue** that points at the latest meaningful save.

## Context (from discovery)
- **`SaveManager`** (`src/data/SaveManager.ts`): `MAX_SLOTS = 10`, `write(slotId, state)`,
  `listSlots()`, over `IndexedDBAdapter` (`SAVES_STORE`, keyPath `slotId`).
- **Autosave:** `GameEngine.transitionTo` autosaves to the `auto` slot (terminal scenes
  excluded per `adding-features.md`); "Continue" loads `auto` and routes context-dependent
  scenes back to flight.
- **No save-management UI** exists (no save/load list screen).

## Development Approach
- **Testing approach: TDD.** A pure **slot-list model** (slots → display rows: name,
  date, summary, empty/occupied) and the create/overwrite/delete operations over a mock
  `SaveManager` are unit-tested; the screen is screenshot-verified.
- Reuses existing save serialization (no schema change); slot metadata (name) rides in the
  existing save envelope or a sibling key.

## Implementation Steps

### Task 1: Slot-list model + operations
**Files:**
- Create: `src/systems/saves/saveSlots.ts` (+ test)

- [x] `listSlotRows(manager)` → ordered rows (name/date/summary/occupied); `saveToSlot`,
      `deleteSlot`, `nextFreeSlot`; "latest meaningful" resolver for Continue (most recent
      non-terminal save).
- [x] write tests: rows reflect occupied/empty, ops mutate correctly, Continue picks the
      right slot, MAX_SLOTS respected.
- [x] run tests — green.

### Task 2: Save/Load screen
**Files:**
- Create: `src/presentation/SaveLoadScene.ts` (+ register per `adding-features.md`), test

- [x] A screen listing slots with create/overwrite (confirm)/delete and load; reachable
      from the main menu + an in-game pause. Honour terminal-scene autosave rules.
      (`SaveLoadScene` created + registered across `SceneType`/`SceneFactory`/
      `contextDependentScenes`; two-step in-scene confirm for overwrite/delete; saving
      builds the real state via `GameEngine.saveGame` + records the name via the model;
      `SAVE_LOAD` added to `contextDependentScenes` so a pause-autosave bounces to flight.
      Menu-entry/pause wiring lands in Task 3.)
- [x] write tests: the screen renders rows, each action calls the model
      (`src/tests/presentation/saveLoadScene.test.ts` — 7 tests). [x] screenshot (manual —
      deferred to Task 3 once the screen is reachable from a menu entry).
- [x] run tests — green.

### Task 3: Wire Continue + menu entries
**Files:**
- Modify: MainMenuScene / pause menu, `GameEngine.loadGame`

- [x] "Continue" uses the latest-meaningful resolver; add Save/Load menu entries; keep
      autosave-to-`auto` intact. (`GameEngine.continueGame()` resolves
      `latestMeaningfulSlot` across all slots then `loadGame`s it — autosave still always
      writes `"auto"`; `MainMenuScene.handleContinue` calls it instead of `loadGame("auto")`.
      Main-menu «Сохранения» button → `SAVE_LOAD` returnTo MAIN_MENU; in-flight system menu
      gains a «Сохранения» entry → `SAVE_LOAD` returnTo SPACE_FLIGHT via `flightSystemMenu`.
      New i18n key `menu.saves` in ru/en.)
- [x] write tests: Continue loads the right slot; menu routes to the screen.
      (`gameEngineContinue.test.ts` — 4; `mainMenuSaveLoad.test.ts` — 2;
      `inFlightMenuSaveLoad.test.ts` — 2.)
- [x] run tests — green. (new + affected suites pass; tsc/eslint clean; `test:playtest`
      254 passed.)

### Task 4: Verify + docs
- [ ] full suite + `test:playtest` green; lint/build ok; document the slots UI + the
      Continue resolver.

## Post-Completion
**Manual:** create several named saves, reload, delete one, Continue picks the latest —
autosave still works.
