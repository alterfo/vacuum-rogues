---
# In-Flight Load-Save: Dead-End Recovery

## Overview
A player can reach an unwinnable **dead-end while still alive**: ship attacked, hull < 30% (engines
auto-stop — "Корпус < 30% — двигатели остановлены"), credits at zero (spent repairing before
take-off, then attacked en route to the system edge), and every quest is in another system with no
fuel/funds to get there. There is currently **no way to load a save without dying** — load is only
reachable from the main menu before a session, and (per the death plan) on the game-over screen.
Add an **always-available in-flight system menu** with **«Загрузить сохранение»** (load the autosave)
and **«В главное меню»**, so the player can escape any dead-end at any time. General by design — not a
fragile auto-detect of "stuck".

## Context
- **Dead-end state:** `src/presentation/SpaceFlightScene.ts` — at `hullFraction < 0.3` engines stop
  (`lowHullStopped`, ~L1259-1266). Combined with zero credits (no repair) and out-of-system quests,
  the player is stranded with no in-flight escape.
- **Load is already wired:** `GameEngine.loadGame("auto")` (~L967); MainMenu "Продолжить" →
  `handleContinue` → `loadGame("auto")` (`MainMenuScene.ts` ~L408-423); `saveManager.hasSave()` gates
  availability. `loadGame` performs its own `transitionTo`, so calling it from flight is safe.
- **HUD:** `src/presentation/flight/FlightHud.ts` owns the bottom HUD — Play/Pause, speed, and a gear
  (⚙) button that **only opens the font-size panel** (no general settings menu). The HUD exposes scene
  callbacks (`onPlayPause`, `onSpeedCycle`, …). A new menu button + panel belongs here.
- **No flight→MAIN_MENU path** exists today (grep found none); this plan adds one via
  `transitionTo(SceneType.MAIN_MENU)`.
- **Autosave source:** the `"auto"` slot is the load target. The death+autosave plan
  (`20260619-player-death-gameover-and-takeoff-autosave.md`) adds autosave-on-takeoff, which makes the
  recovered state the last take-off — this plan **works with whatever `"auto"` save exists** and does
  not require that plan.
- **Size guard:** `SpaceFlightScene.ts` must stay **< 1900 lines** (an enforced test). Keep new logic
  in `FlightHud` / a small menu component, not in the scene.
- **Decision (confirmed):** always-available in-flight menu (not auto-detect).

## Development Approach
- **TDD where logic is testable** (menu open/close + action wiring + hasSave gating are unit-testable;
  the panel is a thin renderer). **Visual-verify** the menu by screenshot/E2E.
- **Reuse, don't fork:** load = existing `loadGame("auto")`; main-menu = `transitionTo(MAIN_MENU)`. No
  new save/load path.
- Run `impact` on `FlightHud` and any `SpaceFlightScene` method touched before editing; warn on
  HIGH/CRITICAL. **Do not modify existing test assertions** (standing rule); add new tests. Keep
  `SpaceFlightScene` additions tiny (size guard) — put the panel in the HUD.
- One concern per task; full suite green between tasks.

## Testing Strategy
- Unit: the menu opens/closes via its button; exposes «Загрузить сохранение» (gated on `hasSave()`)
  and «В главное меню»; load routes through a confirm then `loadGame("auto")`; main-menu routes
  through `transitionTo(MAIN_MENU)`; the load action is disabled/hidden when no save exists.
- Integration: invoking load from flight calls `loadGame("auto")` once; main-menu transitions away.
- E2E/regression: open the in-flight menu, see both actions; the menu opens even when engines are
  stalled at <30% hull (the dead-end).

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers. Keep in sync.

## Implementation Steps

### Task 1: In-flight system-menu button + panel (HUD)
**Files:**
- Modify: src/presentation/flight/FlightHud.ts (a menu button + a small panel with «Продолжить» /
  «Загрузить сохранение» / «В главное меню»; new callbacks `onLoadSave`, `onMainMenu`; open/close)
- Create: src/tests/flight/inFlightMenu.test.ts

- [x] add a HUD menu button that toggles a panel exposing the three actions (readable contrast,
      scaled fonts); panel destroys cleanly on close/HUD teardown
- [x] write tests: button toggles the panel; panel exposes the actions; close/destroy leaks nothing
- [x] run affected tests — must pass before next task

### Task 2: Wire load + main-menu actions from the scene
**Files:**
- Modify: src/presentation/SpaceFlightScene.ts (wire `onLoadSave` → confirm → `loadGame("auto")`;
  `onMainMenu` → `transitionTo(SceneType.MAIN_MENU)`) — keep additions minimal (size guard < 1900)
- Create: src/tests/flight/inFlightMenuActions.test.ts

- [ ] «Загрузить сохранение» asks a confirm (discards current progress), then calls `loadGame("auto")`
      once; «В главное меню» transitions to MAIN_MENU
- [ ] write tests: load → one `loadGame("auto")`; main-menu → one `transitionTo(MAIN_MENU)`
- [ ] confirm `SpaceFlightScene.ts` stays under the 1900-line guard
- [ ] run affected tests — must pass before next task

### Task 3: Gate load on an existing save + dead-end reachability
**Files:**
- Modify: src/presentation/flight/FlightHud.ts / SpaceFlightScene.ts (disable/hide «Загрузить» when
  `saveManager.hasSave()` is false, with a clear hint; ensure the menu opens while engines are
  stalled at <30% hull)
- Create: src/tests/flight/inFlightMenuGating.test.ts

- [ ] «Загрузить сохранение» is disabled with a hint when no save exists; enabled when one does; the
      menu is reachable in the low-hull-stalled dead-end (not blocked by the engine stall)
- [ ] write tests: no-save → disabled; save present → enabled; menu opens regardless of turn/stall state
- [ ] run affected tests — must pass before next task

### Task 4: Verify acceptance criteria
- [ ] verify Overview: an in-flight menu offers Load + Main-menu any time; loading recovers from the
      dead-end (attacked, <30% hull, zero credits, quests elsewhere)
- [ ] visually verify the menu + load via screenshot
- [ ] add e2e: open the in-flight menu and confirm both actions are present/usable
- [ ] run full unit suite — all green; `npm run test:e2e:regression`; `npm run lint` clean
- [ ] confirm no existing flight/HUD/save test assertions changed

## Technical Details
- **General, not auto-detect:** the menu is always reachable, so it covers every dead-end (this
  scenario and others) without trying to define "stuck" — avoids false positives/negatives.
- **Load semantics:** «Загрузить сохранение» loads the `"auto"` slot via the existing `loadGame`
  (which owns its own scene transition); a confirm guards against accidental progress loss.
- **Size discipline:** the menu/panel lives in `FlightHud` (or a small `InFlightMenu` component); the
  scene only holds the two thin callbacks, keeping `SpaceFlightScene.ts` under the 1900-line guard.
- **Synergy:** with the take-off autosave (death+autosave plan), the recovered state is the last
  take-off; without it, it is whatever `"auto"` save exists. No dependency either way.

## Post-Completion
**Manual verification:** engineer the dead-end (take damage to <30% hull, spend credits to zero,
strand yourself between systems), open the in-flight menu, and confirm «Загрузить сохранение» recovers
you to your last save and «В главное меню» returns to the main menu.
