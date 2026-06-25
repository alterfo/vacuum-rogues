---
# Fix: Combat Circling + No Return-Fire + In-Flight State Lost on Reload

## Overview
A playtest caught a critical in-flight cluster:

1. **Ship circles in place during auto-combat and can't reach a planet.** `updateCombatPursuit`
   "holds station" inside weapon range by issuing **no steering** — but the arc-movement
   change makes the ship **always cruise forward and never stop**, so it overshoots the
   target, drops out of range, re-closes, and **orbits endlessly**, hijacking movement so
   the player can't fly to a planet.
2. **Player doesn't return fire.** Because the ship orbits at the range *boundary*, the
   target keeps dropping out of `pickTargetInRange`, so `advancePlayerWeapons` rarely has
   a target in range → no auto-fire.
3. **In-flight state is never saved on reload → respawn at the system edge.** Autosave
   fires on **scene transitions**; during free flight there's none, and `flightShipPos`
   isn't continuously updated — so a reload restores the system-entry (edge) position.

Fix: combat should **hold the target in range reliably** (a controlled orbit / strafe at
weapon range, working *with* arc-movement) so the player fires; the player must be able to
**break off** to a planet / flee; and the **live in-flight position must persist** so a
reload resumes where you were.

## Context (from discovery)
- **Pursuit (`src/presentation/flight/NpcShipManager.ts`):** `updateCombatPursuit` returns
  (no steer) when `dist² ≤ WEAPON_RANGE²`, else `steerTowardLead`. With arc-movement
  (`ShipPhysics` always cruises, min turn radius) "no steer" ⇒ fly straight through → orbit.
- **Player fire (`CombatModule.advancePlayerWeapons` / `pickTargetInRange`):** fires at the
  nearest combatant within `weapon.range`; an orbiting ship at the boundary intermittently
  has no in-range target.
- **Movement gate:** combat auto-pursuit drives the ship via `isInCombat()`; a player route
  to a planet doesn't currently override/disengage it.
- **Persistence (`GameEngine`):** `flightShipPos` (systemId/x/y) persists via
  `SaveState.flightShipPos`, restored only when `systemId === currentSystemId` (~L1210-1216);
  but it's set on limited events, and autosave is transition-driven (`transitionTo`) — no
  autosave during free flight. `applyReentrySpawn` edge-spawns when no valid `flightShipPos`.

## Development Approach
- **Testing approach: TDD (regression-first).** Reproduce each as a red test, then fix:
  (1) a pursuit unit test showing the in-range ship drifts out of range / never settles
  (orbit), then asserts it maintains range; (2) a fire test showing the player fires while
  engaged at range; (3) a persistence test showing a mid-flight save+reload restores the
  live position, not the edge. `impact` on `updateCombatPursuit`/`ShipPhysics`/`flightShipPos`.
- Keep the arc-movement model (no in-place pivot) — the combat hold becomes a **deliberate
  orbit/strafe at range**, not a stop. No schema change (flightShipPos already persists).

## Implementation Steps

### Task 1: Reproduce the cluster (red)
**Files:**
- Create: `src/tests/flight/combatOrbit.test.ts`, `src/tests/core/flightReloadPosition.test.ts`

- [ ] Pursuit test: an in-range arc-moving ship under `updateCombatPursuit` currently
      fails to maintain weapon range (overshoots / orbits unboundedly) → RED.
- [ ] Persistence test: enter a system, move the ship, save + reload mid-flight → currently
      restores the edge, not the live position → RED.
- [ ] run — confirm both RED.

### Task 2: Combat holds the target in range (controlled orbit/strafe)
**Files:**
- Modify: `src/presentation/flight/NpcShipManager.ts` (`updateCombatPursuit`), `ShipPhysics` if needed

- [ ] Replace the "no steer inside range" with a **range-keeping** maneuver compatible with
      arc-movement: steer **tangentially** to orbit at ≈weapon range (a circle-strafe), so
      the target stays inside `WEAPON_RANGE` and the ship never flies off — instead of
      overshoot→re-close. (Or allow a bounded combat slow-down if simpler; do NOT re-add
      free in-place pivot.)
- [ ] write tests: an engaged ship keeps the target within `WEAPON_RANGE` over N ticks (no
      unbounded orbit); the player's weapon now has a target in range each cadence → fires.
- [ ] run tests — Task-1 pursuit + fire repro now pass.

### Task 3: Break off — route/flee overrides auto-pursuit
**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts` / `NpcShipManager` engage gate

- [ ] Let a player route to a planet (or an explicit flee/disengage) **override** the combat
      auto-pursuit so the ship heads to the destination instead of being pinned in orbit;
      combat re-engages only if a hostile is back in range (and per the escape rules).
- [ ] write tests: setting a planet route during combat steers to the planet; disengage works.
- [ ] run tests — green.

### Task 4: Persist live in-flight position across reload
**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts` / `GameEngine` (autosave + `flightShipPos`)

- [ ] Continuously update `flightShipPos` to the live ship position during flight, and
      **autosave the in-flight position** periodically and on page-hide (`visibilitychange`/
      `beforeunload`) — so a reload restores the live position (its `systemId` already gates
      restore) instead of edge-spawning. Don't autosave terminal scenes.
- [ ] write tests: a mid-flight save captures the live position; reload restores it; a
      landed/edge case still behaves as before. Task-1 persistence repro now passes.
- [ ] run tests — green.

### Task 5: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [ ] `detect_changes` — NpcShipManager/SpaceFlightScene/ShipPhysics/GameEngine affected; no
      schema/migration.
- [ ] full unit suite green; `npm run test:playtest` green (a combat session: ship holds
      range, fires, can break off; reload mid-flight resumes position); lint/build ok.

### Task 6: Update documentation
**Files:**
- Modify: `src/presentation/flight/CLAUDE.md` / `playtest-traps.md`

- [ ] Document: combat hold = orbit/strafe at range (arc-movement-compatible), route/flee
      overrides pursuit, and the in-flight position autosave (reload resumes in-system).

## Post-Completion
**Manual:** in a fight, the ship strafes at range and fires back, and you can peel off to a
planet; reloading mid-flight drops you back where you were, not at the edge.
