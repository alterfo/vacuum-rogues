---
# Player Death: Game-Over Screen + Takeoff Autosave

## Overview
When the player's ship is destroyed there is no consequence screen — only the OVERMIND-wins path
leads to `WIN_SCREEN`. Add a proper **death flow**:
1. **Autosave on every planet takeoff.** Each time the player takes off from a planet, the game saves
   to the `"auto"` slot — this is the checkpoint a death rolls back to.
2. **Player-death detection.** When the player ship's hull reaches 0 in flight combat, trigger
   game-over.
3. **Game-over screen.** A new `GAME_OVER` scene offering **"Загрузить сохранение"** (load the last
   takeoff autosave) and **"Начать заново"** (start a new game). Death must **not** overwrite the
   takeoff autosave (so "load" returns the player to their last takeoff).

## Context
- **Save system:** `src/systems/GameEngine.ts` — `saveGame(slotId = "auto")` (~L884),
  `saveManager.hasSave()` (~L240), an `_emergency` save (~L1257), and a `loadGame` path the MainMenu
  "Continue" already uses. The `"auto"` slot is the natural takeoff checkpoint.
- **Takeoff:** `src/presentation/PlanetScene.ts` — `takeOff()` (~L1773) → `transitionTo(SPACE_FLIGHT,
  { fromPlanetId })`; `e2eTakeOff()` (~L1793) is the test entry. No save is taken here today.
- **Death detection:** `src/presentation/flight/CombatModule.ts` resolves combat; it already detects
  *NPC* death (`npc.hullHP <= 0`, ~L297) and reads the player ship via `getPlayerShip()`
  (`{hullHP, maxHull}`). Player hull ≤ 0 is the death signal to surface.
- **Game-over plumbing:** `GameEngine` has `_gameOverShown` (~L138) + a WIN_SCREEN transition for the
  OVERMIND-wins case (~L615–639); reuse the guard pattern for player death (a terminal transition,
  fired once).
- **Scene registration (5 files, per `.claude/docs/adding-features.md`):** new `SceneType.GAME_OVER`
  in `src/types/index.ts`; a case in `src/core/services/SceneFactory.ts`; the scene class in
  `src/presentation/`; an e2e page object in `e2e/page-objects/`. GAME_OVER needs no transient
  context, so it is **not** added to `contextDependentScenes`. Scaffold:
  `npx tsx tools/scaffold/new-scene.ts --name GameOver`.
- **No new domain/save fields** — this reuses the existing save/load API, so `schemas.ts` is untouched.

## Development Approach
- **TDD where logic is pure/dispatchable:** takeoff triggers exactly one `saveGame("auto")`; player
  hull ≤ 0 fires the game-over transition once (guarded, idempotent); the game-over actions call
  `loadGame("auto")` / new-game. **Visual-verify** the screen via screenshot/E2E.
- Run `impact` on `PlanetScene.takeOff`, `CombatModule` death path, and the `GameEngine` game-over
  surface before editing; warn on HIGH/CRITICAL. **Do not modify existing test assertions** (standing
  rule); add new tests. Reuse the existing save/load + WIN_SCREEN transition patterns — no parallel
  save path.
- One concern per task; full suite green between tasks.

## Testing Strategy
- Unit: `takeOff()` calls `saveGame("auto")` exactly once before the SPACE_FLIGHT transition; the
  player-death detector fires once when hull ≤ 0 and is idempotent (a stray later shot doesn't re-fire);
  the death transition does not call `saveGame` (the autosave is preserved).
- Integration: death → `GAME_OVER`; "Загрузить" restores the last takeoff autosave; "Начать заново"
  starts a fresh game.
- E2E/regression: kill the player in combat → game-over screen appears with both options; loading
  returns to the last takeoff state.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers. Keep in sync.

## Implementation Steps

### Task 1: Autosave on planet takeoff
**Files:**
- Modify: src/presentation/PlanetScene.ts (`takeOff()` → `await saveGame("auto")` before the
  SPACE_FLIGHT transition) or src/systems/GameEngine.ts (save on SPACE_FLIGHT entry from a planet)
- Create: src/tests/save/takeoffAutosave.test.ts

- [x] every planet takeoff writes the `"auto"` save before flight begins
- [x] write tests: `takeOff()` triggers exactly one `saveGame("auto")`; the e2e takeoff path too
- [x] run affected tests — must pass before next task

### Task 2: Player-death detection → game-over trigger
**Files:**
- Modify: src/presentation/flight/CombatModule.ts (detect player hull ≤ 0 → notify the host),
  src/systems/GameEngine.ts (a guarded `triggerPlayerDeath()` that fires the GAME_OVER transition once)
- Create: src/tests/combat/playerDeath.test.ts

- [x] player hull ≤ 0 in flight combat fires game-over exactly once (idempotent guard, like
      `_gameOverShown`); the death path does NOT overwrite the `"auto"` autosave
- [x] write tests: hull ≤ 0 → one trigger; repeated calls no-op; autosave untouched on death
- [x] run affected tests — must pass before next task

### Task 3: GAME_OVER scene (register + render)
**Files:**
- Create: src/presentation/GameOverScene.ts (+ scaffold the 5-file registration:
  `SceneType.GAME_OVER`, SceneFactory case, e2e page object)
- Modify: src/types/index.ts, src/core/services/SceneFactory.ts, e2e/page-objects/

- [x] scaffold + implement a GAME_OVER scene showing the death state with two actions:
      «Загрузить сохранение» and «Начать заново» (readable contrast, scaled fonts)
- [x] write tests: the scene constructs and exposes the two actions; page object can find them
- [x] run affected tests — must pass before next task

### Task 4: Wire actions — load autosave / start over
**Files:**
- Modify: src/presentation/GameOverScene.ts (Load → `loadGame("auto")`; Start over → new game),
  src/systems/GameEngine.ts (death → `transitionTo(SceneType.GAME_OVER)`)
- Create/Modify: e2e regression spec for the death flow

- [x] death transitions to GAME_OVER; «Загрузить» restores the last takeoff autosave; «Начать заново»
      starts a fresh game (reusing the existing load / new-game paths)
- [x] visually verify the game-over screen + both actions via screenshot
- [x] add e2e: kill the player → GAME_OVER appears; load returns to the takeoff state
- [x] run affected tests + regression — must pass before next task

### Task 5: Verify acceptance criteria
- [x] verify Overview: takeoff autosaves; death shows GAME_OVER; load/restart work; autosave preserved
- [x] run full unit suite — all green; `npm run test:e2e:regression`; `npm run lint` clean
- [x] confirm no existing save/scene test assertions changed

## Technical Details
- **Checkpoint model:** the `"auto"` slot is the single takeoff checkpoint; death is non-destructive to
  it, so «Загрузить» always returns the player to their most recent takeoff.
- **Idempotent death:** mirror `_gameOverShown` — a `_playerDeathShown` guard fires the GAME_OVER
  transition exactly once even if more damage lands the same frame.
- **Reuse, not fork:** «Загрузить» = existing `loadGame("auto")`; «Начать заново» = the existing
  new-game/race-selection path; the takeoff save = existing `saveGame("auto")`.

## Post-Completion
**Manual verification:** take off from a planet (autosave), get destroyed in combat, confirm the
game-over screen appears with «Загрузить сохранение» (returns to the takeoff) and «Начать заново»
(fresh game); confirm dying did not overwrite the takeoff save.
