---
# Realtime In-Flight Combat

## Overview
Replace the current hybrid combat system (freeze + click-to-fire panel for garrison aggressors;
hex CombatScene transition for player-initiated attacks) with a single real-time in-flight model:
hostile NPCs fire at the player automatically every 2.5 s while in weapon range; the player
targets an enemy by clicking it and their weapon auto-fires at the same cadence; ships keep
moving throughout; no screen transition and no ship freeze.

## Context
- `src/presentation/flight/CombatModule.ts` — skeleton (Tasks 11–14 from galaxy-map plan):
  turn-based freeze model, one active target, "Атаковать"/"Отступить" HUD panel.
- `src/presentation/flight/NpcShipManager.ts` — two combat paths:
  1. Garrison aggressor closes to range → `deps.startInFlightCombat?(sprite)` → freeze model.
  2. Player clicks "Атаковать" in contact panel → `launchCombatWithNpc()` → `SceneType.COMBAT`.
- `src/presentation/flight/CombatHud.ts` — weapon-selection panel + action buttons (to be simplified).
- `src/presentation/flight/DamageNumbers.ts` — already real-time, keep as-is.
- `src/presentation/SpaceFlightScene.ts` — wires CombatModule + handles `combatResult` on re-entry.
- Hex `CombatScene` (`src/presentation/CombatScene.ts`) — keep for TEXT_QUEST scripted encounters only.
- `GAME_BALANCE.weaponRange` — shared weapon range constant, keep.

## Development Approach
TDD where the logic is pure (timer math, multi-combatant round resolution).
For rendering changes (HUD rebuild) use the letsplay harness for visual verification.
Do not touch `CombatScene` — it must remain functional for text-quest encounters.
Standing rule: do not modify existing test assertions; only add new tests.
**Exception for this plan**: `src/tests/flight/combatModule.test.ts` and
`src/tests/flight/damageResolution.test.ts` document the OLD turn-based freeze model
that this plan intentionally replaces. Task 1 is explicitly authorized to delete and
rewrite those two test files in full — they are not "known-good tests for a surviving
feature", they are tests for the feature being removed. No other existing test files
may be modified.
**Task 2 addendum (2026-06-16):** `src/tests/flight/combatHud.test.ts` was found to test
the SAME removed modal weapon-panel feature (weapon cards + Атаковать/Отступить buttons +
`onWeaponSelected`/`onAttack`/`onRetreat`). It is the same category the exception describes
(tests for the feature being removed), so Task 2 rewrote it in full for the new compact
target/HP overlay. No tests for surviving features were touched.

## Implementation Steps

### Task 1: Replace obsolete freeze-model tests, then redesign CombatModule
**Files:**
- Delete+rewrite: `src/tests/flight/combatModule.test.ts`
- Delete+rewrite: `src/tests/flight/damageResolution.test.ts` (if it exists)
- Modify: `src/presentation/flight/CombatModule.ts`
- Modify: `src/systems/GameBalance.ts` (add `combatFireIntervalMs` constant)
**Files:**
- Modify: `src/presentation/flight/CombatModule.ts`
- Modify: `src/systems/GameBalance.ts` (add `combatFireIntervalMs` constant)

- [x] Delete `src/tests/flight/combatModule.test.ts` and `src/tests/flight/damageResolution.test.ts` (they test the removed freeze model — authorized replacement per Development Approach above)
- [x] Add `combatFireIntervalMs: 2500` to `GAME_BALANCE` in `GameBalance.ts` (actual file: `src/config/balance.ts`)
- [x] Replace single `activeTarget` with `combatants: Set<NpcShipSprite>` (all currently hostile NPCs in range)
- [x] Add per-NPC fire timer: `npcFireTimers: Map<NpcShipSprite, number>` (ms since last shot)
- [x] Add player fire timer: `playerFireTimer: number`; player fires at `selectedTarget` when timer elapses
- [x] Remove `physics.isMoving = false` and `physics.setTarget` freeze in `startCombat` — ship stays free
- [x] Rename `startCombat(npc)` → `addCombatant(npc)`: idempotent add to the set, sets `isActive = true` (also updated the one `SpaceFlightScene` call site so the build stays green)
- [x] `update(deltaTime)`: advance all timers, fire NPC shots and player shot when timer fires, remove dead/out-of-range combatants from the set, set `isActive = combatants.size > 0`
- [x] `endCombat()`: clear the set and timers (keep for retreat/player-forced exit)
- [x] Export pure `resolveMultiRound(playerDmg, npcs: {id, damage, hullHP}[], playerHP)` for testing
- [x] Write unit tests for timer advancement, multi-NPC fire, player death threshold, NPC death removal

### Task 2: Simplify CombatHud — target indicator + HP bar, remove modal panel
**Files:**
- Modify: `src/presentation/flight/CombatHud.ts`

- [x] Remove weapon-selection card list and "Атаковать"/"Отступить" buttons
- [x] Replace panel with a compact top-right overlay (240×60 px): selected target name + HP bar (red fill)
- [x] Add player HP bar below the target bar (green fill)
- [x] `open(target: NpcShipSprite | null)` — show overlay, set target name; `close()` — hide (added `setTarget` for mid-fight target switches)
- [x] `updateTargetHP(current, max)` and `updatePlayerHP(current, max)` — called from CombatModule.update (via new `syncHud()`)
- [x] Keep range circle on game layer (dashed circle around player ship while combat active; `syncRangeCircle()` follows the moving ship each frame)
- [x] Remove `onAttack` and `onRetreat` callbacks; `onWeaponSelected` also removed (dropped `UiButton`/`WeaponCard`; CombatModule no longer wires `onRetreat`)
- [x] `selectedWeapon` getter: always return the first equipped weapon from loadout (auto-selected) — sourced via new `getPlayerLoadout` HUD dep
- [x] `rangeRadius` getter: unchanged
- [x] Write unit test: HUD shows after open(), hides after close(), container in correct layer (rewrote `combatHud.test.ts` — see Task 2 addendum above)

### Task 3: Redirect NpcShipManager — kill CombatScene transition
**Files:**
- Modify: `src/presentation/flight/NpcShipManager.ts`

- [ ] Replace `launchCombatWithNpc(npc)` body: call `deps.startInFlightCombat?.(sprite)` instead of `transitionTo(SceneType.COMBAT, ...)`; remove `rememberFlightPos()` call (no longer needed for combat)
- [ ] `onAttackNpc`: already calls `launchCombatWithNpc` → now routes to in-flight, no behaviour change at call site
- [ ] `deps.startInFlightCombat` now calls `CombatModule.addCombatant` — rename callback in SpaceFlightScene wiring too
- [ ] Remove `combatTransitionPending` guard (no longer relevant) and its usages
- [ ] Aggressive NPC update path (line ~219): already calls `deps.startInFlightCombat?.(sprite)` → now correctly calls `addCombatant`
- [ ] Write test: when `launchCombatWithNpc` is called, `startInFlightCombat` fires and no scene transition happens

### Task 4: Clean up SpaceFlightScene wiring
**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`

- [ ] Rename `startInFlightCombat` dep callback to call `combatModule.addCombatant(sprite)` instead of `combatModule.startCombat(sprite)`
- [ ] Remove `combatResult === "victory"` branch in constructor (hex return no longer happens for combat)
- [ ] Remove `ctx?.combatResult` and `ctx?.npcId` fields from the context type (keep other fields)
- [ ] `CombatModule.update` now needs to call `deps.onNpcDestroyed` + `questCompletion.bountyByNpcKill` for each NPC killed by timer — verify the existing `onNpcDestroyed` callback chain still fires
- [ ] Write regression test: NpcShipManager constructed with `startInFlightCombat` dep, no `SceneType.COMBAT` import needed

### Task 5: Verify and integration tests
**Files:**
- Modify: `src/tests/flight/combatModule.test.ts` (or create if missing)

- [ ] Test: `addCombatant` with two NPCs → both timers advance in `update()`, both fire when elapsed
- [ ] Test: NPC killed → removed from combatants set, `onNpcDestroyed` called once
- [ ] Test: `isActive` false when combatants set empties (last NPC killed or fled)
- [ ] Test: player HP below `LOW_HULL_FRACTION` → `showMessage` called with retreat warning, but ship not frozen
- [ ] Run `npm test -- --run` — all 1494 tests green
- [ ] Run `npm run lint` — no new errors
- [ ] Visual check via letsplay: load a hostile system, confirm NPCs fire and player can fire back without freeze
