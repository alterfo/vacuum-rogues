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

- [x] Pursuit test: an in-range arc-moving ship under `updateCombatPursuit` currently
      fails to maintain weapon range (overshoots / orbits unboundedly) → RED.
      (`src/tests/flight/combatOrbit.test.ts`: post-entry maxDist ≈1043px vs WEAPON_RANGE 240,
      in-range fraction ≈0.17 — confirmed RED, wrapped in `it.fails` so it's committable past
      the pre-commit test gate and turns red the moment Task 2's fix lands.)
- [x] Persistence test: enter a system, move the ship, save + reload mid-flight → currently
      restores the edge, not the live position → RED.
      (`src/tests/core/flightReloadPosition.test.ts`: probes the Task-4 seams
      `recordLiveFlightPos`/`flushFlightAutosave` via casts — undefined today, so the live
      position never persists; `it.fails` for the same commit-gate reason.)
- [x] run — confirm both RED. (Plain `it` run: 4 assertions failed as expected; positive
      controls — "first closes to weapon range" + "inert outside flight" — pass.)

### Task 2: Combat holds the target in range (controlled orbit/strafe)
**Files:**
- Modify: `src/presentation/flight/NpcShipManager.ts` (`updateCombatPursuit`), `ShipPhysics` if needed

- [x] Replace the "no steer inside range" with a **range-keeping** maneuver compatible with
      arc-movement: steer **tangentially** to orbit at ≈weapon range (a circle-strafe), so
      the target stays inside `WEAPON_RANGE` and the ship never flies off — instead of
      overshoot→re-close. (Or allow a bounded combat slow-down if simpler; do NOT re-add
      free in-place pivot.)
      (`NpcShipManager.steerCombatOrbit`: inside weapon range, steer toward a carrot
      projected `COMBAT_ORBIT_CARROT`=2000px along a tangent+radial heading — radial pulls
      back onto `COMBAT_ORBIT_RANGE`=0.6×240. The far carrot keeps ShipPhysics in cruise
      (no decel/stop) so only the accurate, per-frame heading is consumed; plotted via
      `setPath` to stay a non-final leg and hide the heading crosshair. The heading is NOT
      smoothed — a turn-rate-limited smoother lags the live geometry and the ship
      slingshots out; ShipPhysics still turn-rate-limits the hull rotation, so motion stays
      smooth. Verified across stationary/drifting/fleeing/closing targets: maxDist ≤232px,
      in-range 1.00.)
- [x] write tests: an engaged ship keeps the target within `WEAPON_RANGE` over N ticks (no
      unbounded orbit); the player's weapon now has a target in range each cadence → fires.
      (`combatOrbit.test.ts` flipped from `it.fails` to `it`: post-entry maxDist ≤ WR×1.05
      and in-range fraction ≥ 0.85 over 240 ticks — both green, so auto-fire's
      `pickTargetInRange` has a target nearly every cadence.)
- [x] run tests — Task-1 pursuit + fire repro now pass. (combatOrbit + chaseSteering +
      combatPursuit all green; full flight/combat/presentation suite 514 green, lint+tsc
      clean, real-engine playtest 67 green. `chaseSteering.steering.test.ts`: the
      approach-smoothness aim-jump metric is now scoped to the pre-WR *approach* phase via a
      pre-steer-distance guard — matching that test's own documented intent to exclude the
      in-range hold — since the new in-range range-keeping deliberately snaps the steering
      carrot; no assertion bound changed.)

### Task 3: Break off — route/flee overrides auto-pursuit
**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts` / `NpcShipManager` engage gate

- [x] Let a player route to a planet (or an explicit flee/disengage) **override** the combat
      auto-pursuit so the ship heads to the destination instead of being pinned in orbit;
      combat re-engages only if a hostile is back in range (and per the escape rules).
      (`NpcShipManager.breakOffCombatPursuit()` sets `pursuitSuspended`; while set,
      `updateCombatPursuit` yields navigation — returns without steering — so the player's
      plotted course flies. The override self-clears the instant the route completes
      (`physics.isMoving` false) so pursuit re-engages only if a hostile is still in range,
      and is re-armed on a fresh engagement / explicit retarget — `launchCombatWithNpc`,
      `onNpcClick`'s retarget branch — and reset in `destroy`. The scene's `executeRouteTo`
      calls `breakOffCombatPursuit()` when `combatModule.isActive`, gated by a `pursuitReplot`
      flag so the pursuit's own star-avoidance re-plots — which route through the same
      `executeRouteTo` dep — don't self-suspend.)
- [x] write tests: setting a planet route during combat steers to the planet; disengage works.
      (`src/tests/flight/combatBreakoff.test.ts`: control shows the auto-pursuit overrides a
      player route target; break-off shows the route target is preserved, the ship actually
      flies toward the planet — away from the orbited enemy — instead of staying pinned, and
      the override self-clears on arrival so combat re-engages. 4 green.)
- [x] run tests — green. (combatBreakoff 4 green; full flight/combat/npc 701 green,
      presentation 435 green, real-engine playtest 67 green; lint 0 errors, tsc clean;
      `SpaceFlightScene.ts` kept under the 1900-line module guard via comment-trim reclaim.)

### Task 4: Persist live in-flight position across reload
**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts` / `GameEngine` (autosave + `flightShipPos`)

- [x] Continuously update `flightShipPos` to the live ship position during flight, and
      **autosave the in-flight position** periodically and on page-hide (`visibilitychange`/
      `beforeunload`) — so a reload restores the live position (its `systemId` already gates
      restore) instead of edge-spawning. Don't autosave terminal scenes.
      (`GameEngine.recordLiveFlightPos(x,y)` sets `liveFlightShipPos` — which `saveGame`
      already folds into the system-tagged `flightShipPos` while SPACE_FLIGHT is active;
      `flushFlightAutosave()` awaits a save **only** while in flight, wired to
      `beforeunload` + `visibilitychange`→hidden via `registerFlightHideAutosave()` in
      `initialize` and detached in `stop()`. The flight scene calls the pure helper
      `recordAndMaybeAutosaveFlight` (in `flight/flightTurnEnd.ts`) every frame — continuous
      capture + a ~5 s throttled periodic autosave that only fires when the ship moved.
      Terminal scenes are unaffected: `flushFlightAutosave` no-ops outside SPACE_FLIGHT.)
- [x] write tests: a mid-flight save captures the live position; reload restores it; a
      landed/edge case still behaves as before. Task-1 persistence repro now passes.
      (`flightReloadPosition.test.ts` flipped both `it.fails` → `it`: continuous-capture +
      page-hide-flush now persist the live position, and the page-hide flush stays inert
      outside flight. Reload-restore + landed/edge cases remain covered by the untouched
      `GameEngine.flight-position.test.ts` round-trip suite.)
- [x] run tests — green. (flightReloadPosition + GameEngine.flight-position + flightTurnEnd
      16 green; flight/presentation/core 838 green; real-engine playtest 67 green;
      save-compat 22 green; lint 0 errors, tsc clean. `SpaceFlightScene.ts` kept ≤1899 lines
      via comment-trim reclaim + extracting the per-frame logic into `flightTurnEnd.ts`.)

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
