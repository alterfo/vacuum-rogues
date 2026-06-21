---
# Game Difficulty Modes: God / Средний / Hard

## Overview
Let the player pick a **difficulty mode at the start of a new game**:
- **God** — the ship is never fully destroyed. When its hull would hit zero it is **floored** (kept
  alive) and goes **"downed"**: it loses the ability to **fire weapons** and **hyperjump** until
  repaired. Repairing the hull above the floor (at a planet/station) restores both abilities.
- **Средний (Normal)** — baseline, current behaviour.
- **Hard** — a bit more pirates and Overmind than usual (more hostile systems + larger garrisons).

The mode is chosen on the new-game setup screen, persisted with the save, and read by the combat,
jump, and hostile-spawn paths.

## Context
- **New-game flow:** MainMenu "Новая игра" → `SceneType.RACE_SELECTION`
  (`MainMenuScene.ts` ~L396-400). `src/presentation/RaceSelectionScene.ts` shows faction cards + a
  Start button — the natural home for a mode selector; Start creates the new-game player.
- **Persistence:** difficulty is **per-run**, so it lives on the save, not the global
  `PlayerSettings` (volume/graphics/keys in `schemas.ts` L18). Add a `gameMode` to `Player`
  (`src/domain/Player.ts`) → **schema lockstep** in `src/validation/schemas.ts` (`PlayerSchema`) +
  `src/data/MigrationPipeline.ts` default `NORMAL` for old saves (CLAUDE.md hard rule).
- **God-mode intercept:** `src/presentation/flight/CombatModule.ts` `fireNpcShot` (~L259) does
  `ship.hullHP = Math.max(0, ship.hullHP - dmg)`; god mode floors it **above 0** and marks downed.
  The death+autosave plan adds a player-death → GAME_OVER trigger; **god mode must pre-empt it** (no
  death in god mode). "Downed" is **derived** from hull (`gameMode==GOD && hull <= floor`) — no extra
  persisted flag.
- **Ability gates:** weapon fire = CombatModule player-fire path; hyperjump = `performWarp`
  (`SpaceFlightScene`) and `StarMapScene.performWarpJump` (the map double-click jump). Both check the
  downed predicate.
- **Hard scaling targets:** initial hostile seeding `GameEngine.ts` ~L588
  (`galaxy.overmindSystems/pirateSystems = result…`) and `NpcSimulator` `GARRISON_MIN=5 /
  GARRISON_MAX=10` (~L109-111). Scale by mode via config constants.
- **Decision (confirmed):** three modes; god-mode abilities restored by **repair**; Hard = modestly
  more hostiles.

## Development Approach
- **TDD, pure-first** for the testable logic: the downed predicate + hull floor, the Hard spawn-count
  scaling (pure functions of mode), and persistence round-trip. Write failing tests first. UI (mode
  selector) verified by screenshot.
- **Schema lockstep:** the `gameMode` field updates `schemas.ts` + `MigrationPipeline.ts` in the same
  task; old saves default to `NORMAL`. **Do not modify existing test assertions** (standing rule);
  add new tests. Run `impact` on `Player`, `CombatModule.fireNpcShot`, the warp paths, and the
  hostile-seeding before editing; warn on HIGH/CRITICAL.
- **Backward compatible:** Normal mode must reproduce today's behaviour exactly (existing combat /
  spawn tests stay green). One concern per task; full suite green between tasks.

## Testing Strategy
- Unit: `gameMode` persists + migrates (old save → NORMAL); god-mode hull floor keeps hull > 0 and
  marks downed; downed disables weapon fire + hyperjump; repair above the floor clears downed; Hard
  scaling yields more hostile systems + larger garrisons than Normal while Normal == today's counts.
- Integration: in god mode a lethal hit leaves the ship alive+downed (no GAME_OVER); in Normal the
  death path is unchanged.
- E2E/regression: the new-game screen offers God/Средний/Hard; starting a game in each applies it.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers (esp. any combat/spawn test that reds). Keep in sync.

## Implementation Steps

### Task 1: `gameMode` domain field + persistence
**Files:**
- Modify: src/types/index.ts (`GameMode = "GOD" | "NORMAL" | "HARD"`), src/domain/Player.ts
  (`gameMode` field, default NORMAL, explicit setter), src/validation/schemas.ts (`PlayerSchema`),
  src/data/MigrationPipeline.ts (default NORMAL for old saves)
- Create: src/tests/domain/gameMode.test.ts

- [x] run `impact` on `Player` + `PlayerSchema`; report blast radius before editing (Player upstream = HIGH, 53 impacted / 18 direct — but a class-body field with a default keeps the constructor signature unchanged, so the blast radius does not apply)
- [x] add `gameMode` (readonly + setter), schema in lockstep, migration default NORMAL (v26→27)
- [x] write tests: persists + round-trips; old save migrates to NORMAL
- [x] run affected tests — must pass before next task

### Task 2: Mode selector on the new-game screen
**Files:**
- Modify: src/presentation/RaceSelectionScene.ts (a God/Средний/Hard selector with short
  descriptions; Start passes the chosen mode into new-game player creation),
  src/systems/GameEngine.ts (new-game path sets `player.gameMode`)
- Create: src/tests/presentation/modeSelector.test.ts

- [x] the new-game screen offers the three modes (default Средний) and Start applies the selection (Бог/Средний/Сложный chips fill the empty bottom-right grid slot; Start passes `selectedGameMode`, GameEngine new-game path calls `player.setGameMode`)
- [x] visually verify the selector via screenshot (Playwright capture of RaceSelectionScene — default Средний highlighted + HARD-selected state both correct, no overlap with cards/Start button)
- [x] write tests: selecting a mode + Start creates a player with that `gameMode` (src/tests/presentation/modeSelector.test.ts — default NORMAL, GOD, HARD, unknown→NORMAL, faction+mode independence)
- [x] run affected tests — must pass before next task (presentation + GameEngine.di + gameMode suites: 388 passed; lint clean)

### Task 3: God-mode hull floor + downed predicate (pure)
**Files:**
- Create: src/systems/combat/godMode.ts (`hullFloorFor(mode,maxHull)`, `applyDamageWithMode(...)`,
  `isDowned(player)` — pure)
- Create: src/tests/combat/godMode.test.ts

- [x] pure helpers: in GOD, damage floors hull above 0 (never 0) and `isDowned` is true at/below the
      floor; NORMAL/HARD damage is unchanged (can reach 0) (`src/systems/combat/godMode.ts`: `hullFloorFor` = `ceil(maxHull × GOD_MODE_HULL_FLOOR_FRACTION)` ≥ 1 in GOD / 0 otherwise; `applyDamageWithMode` floors GOD above 0 + marks downed, NORMAL/HARD clamp to 0; `isDowned` derived from gameMode + hull)
- [x] write tests: god floor keeps hull > 0 + downed; normal reaches 0; recovery above floor clears downed (`src/tests/combat/godMode.test.ts` — 15 tests incl. repair-above-floor clears downed)
- [x] run affected tests — must pass before next task (godMode + gameMode suites: 23 passed; lint clean)

### Task 4: Wire god mode into combat, weapons, and jump
**Files:**
- Modify: src/presentation/flight/CombatModule.ts (route player-hull damage through
  `applyDamageWithMode`; pre-empt the death/GAME_OVER trigger in GOD; block player weapon fire while
  downed), src/presentation/SpaceFlightScene.ts + src/presentation/StarMapScene.ts (block hyperjump
  while downed, with a clear hint)
- Create: src/tests/combat/godModeIntegration.test.ts

- [ ] in GOD a lethal hit leaves the ship alive+downed (no death/GAME_OVER); weapons + hyperjump are
      blocked while downed; repairing above the floor re-enables them
- [ ] ⚠️ NORMAL behaviour unchanged — existing combat/death tests stay green; if any reds, STOP
- [ ] write tests: lethal hit in GOD → alive+downed+no death; fire/jump blocked while downed; repair restores
- [ ] run affected tests — must pass before next task

### Task 5: Hard-mode hostile scaling
**Files:**
- Modify: src/config/balance.ts (per-mode multipliers for hostile-system count + garrison size),
  src/systems/GameEngine.ts (scale initial overmind/pirate seeding by mode),
  src/systems/npc/NpcSimulator.ts (scale `GARRISON_MIN/MAX` by mode)
- Create: src/tests/difficulty/hardScaling.test.ts

- [ ] HARD seeds modestly more overmind+pirate systems and larger garrisons than NORMAL; NORMAL/GOD
      keep today's counts exactly
- [ ] write tests: HARD hostile count + garrison > NORMAL; NORMAL == current baseline
- [ ] run affected tests — must pass before next task

### Task 6: Verify acceptance criteria
- [ ] verify Overview: mode chosen at new game + persisted; God floors + downs + repair-restores;
      Hard adds hostiles; Normal unchanged
- [ ] run full unit suite — all green; `npm run test:e2e:regression`; `npm run lint` clean
- [ ] confirm no existing combat/spawn/save test assertions changed

## Technical Details
- **Downed is derived, not stored:** `isDowned = gameMode===GOD && hull <= hullFloor` — no extra
  persisted state; saving/loading while downed just re-derives it from hull. Repair (existing
  planet/station repair) raising hull above the floor clears it.
- **God floor value:** a small positive fraction of `maxHull` (config constant, e.g. ~5% or a flat
  small HP) so the ship survives but is clearly crippled.
- **Hard magnitude ("чуть больше"):** modest config multipliers (e.g. ~1.3–1.5× hostile systems,
  garrison +1–2) — tune in `balance.ts`, not hard-coded at call sites.
- **Ordering with death plan:** the GOD floor runs before any death/GAME_OVER trigger, so god mode
  never reaches the death screen; NORMAL/HARD fall through to it unchanged.

## Post-Completion
**Manual verification:** start a new game in each mode. God: take lethal fire, confirm the ship
survives but can't shoot or jump, then repair at a planet and confirm both return. Hard: confirm
visibly more pirate/Overmind systems and tougher garrisons. Средний: confirm unchanged play.
