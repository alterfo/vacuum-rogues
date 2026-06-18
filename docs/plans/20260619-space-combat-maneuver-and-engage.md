---
# Space Combat: Aggressive NPCs Actually Fight (Maneuver + Fire Per Turn)

## Overview
Aggressive NPCs don't fight — they just tail the player. The aggressor loop sets its
pursuit target to the ship's *current* position every frame, so it follows behind at
matched speed and (if it can't out-accelerate the ship) **never closes to
`WEAPON_RANGE`, so `startInFlightCombat` never fires** — no attack, no maneuvering. This
plan turns the existing real-time `CombatModule` into the SR-style **real-time-with-turns**
fight the user wants: ships move continuously, but weapons fire **once per "ход"** (the
fire cadence); an aggressor **closes to weapon range and then orbits/strafes around the
player** (ships circle each other) firing each turn; the player **re-plans their route
every turn to evade**, and a **faster engine breaks pursuit and escapes**. It runs in
**auto mode** — ships auto-fire and the AI maneuvers while the player steers/flees.

This is real-time maneuvering with a turn rhythm, NOT the legacy hex `CombatScene`
(kept for scripted/boss fights only). Reference: SR HD space combat is real-time-with-
pause, tactical positioning + per-turn weapon fire (Steam combat guides).

## Context
- **The bug:** `src/presentation/flight/NpcShipManager.ts` (~L209–215) — for an
  `aggressive` sprite: `setPursuitTarget(ship.x, ship.y)` then, only if within
  `WEAPON_RANGE`, `startInFlightCombat(sprite)`. Pure tail-chase; no orbit; never
  engages a faster/equal-speed ship.
- **Real-time combat (keep + extend):** `src/presentation/flight/CombatModule.ts` —
  `addCombatant`, fires every `GAME_BALANCE.combatFireIntervalMs` (= one "ход"), prunes
  combatants that drift beyond scanner range; `src/systems/FlightCombatResolver.ts`
  resolves shots/damage. `NpcShipSprite` has `setPursuitTarget` + orbit/anchor + speed.
- **Movement/escape:** `src/systems/ShipPhysics.ts` — route waypoints + ship speed;
  re-routing is how the player evades; engine speed (`ShipLoadout.derivedStats().speed`)
  determines who out-runs whom.
- **Balance:** `GAME_BALANCE.weaponRange`, `combatFireIntervalMs`, `scannerRange`.
- **Not this:** `src/systems/combat/CombatAI.ts` (hex/turn-based, boss-only) — left alone.

## Development Approach
- **Testing approach: TDD / regression-first.** The maneuver-decision and
  engage/disengage logic are pure and unit-testable; the visible dogfight (circling +
  fire) is screenshot/e2e-verified (green text tests are not sufficient for visual).
- Keep the real-time `CombatModule` model; do NOT route general combat into the hex
  `CombatScene`. Reuse `GAME_BALANCE` constants; add new ones rather than magic numbers.
- Do not modify existing test assertions; add new tests. One concern per task.

## Testing Strategy
- Unit: maneuver state machine (close → orbit → break-off) from range+speed; engagement
  triggers when in range; disengage when the player opens beyond escape range; a faster
  ship escapes a slower pursuer, an equal/slower ship does not.
- E2E/regression (`playtest-regression.spec.ts`): spawn a hostile NPC, confirm it closes,
  orbits, and both ships fire (hull drops on both); confirm fleeing on a fast engine ends
  the fight. Screenshot the dogfight.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers. Keep this file in sync.

## Implementation Steps

### Task 1: Combat maneuver AI — close, then orbit/strafe at weapon range
**Files:**
- Modify: src/presentation/flight/NpcShipManager.ts (replace tail-chase with a maneuver
  state machine), src/presentation/NpcShipSprite.ts (orbit-the-target / strafe motion)
- Create: src/systems/combat/combatManeuver.ts (pure `decideManeuver({range, weaponRange,
  selfSpeed, targetSpeed})` → CLOSE | ORBIT | BREAK_OFF + a heading)
- Create: src/tests/combat/combatManeuver.test.ts

- [x] aggressor CLOSES until ~weapon range, then ORBITs (circles the player at range)
      instead of overlapping/tailing; pure decision function drives it
- [x] write tests: far→CLOSE, at-range→ORBIT, low-hull/over-matched→BREAK_OFF; heading math
- [x] run affected tests — must pass before next task

### Task 2: Reliable engagement + fire once per "ход"
**Files:**
- Modify: src/presentation/flight/NpcShipManager.ts (start combat once in range; keep it
  while maneuvering at range), src/presentation/flight/CombatModule.ts (one shot per
  combatFireIntervalMs per ship; both sides)
- Create/Modify: src/tests/flight/combatEngagement.test.ts

- [x] an in-range aggressor reliably enters combat and STAYS engaged while orbiting;
      both ships fire exactly once per `combatFireIntervalMs` (the turn)
- [x] write tests: engage on range; N turns → N shots each; hull decreases on both sides
- [x] run affected tests — must pass before next task

### Task 3: Evasion — re-route each turn, escape on a faster engine
**Files:**
- Modify: src/presentation/flight/CombatModule.ts / NpcShipManager.ts (disengage when the
  player opens beyond an escape range), src/systems/ShipPhysics.ts (speed-based pursuit)
- Modify: src/config/balance.ts (`combatEscapeRange` / pursuit speed factors)
- Create: src/tests/combat/combatEscape.test.ts

- [ ] re-planning the route mid-fight works (ship keeps moving); opening distance beyond
      the escape range ends the fight; a faster player out-runs a slower pursuer, a
      slower/equal one cannot
- [ ] write tests: faster→escapes, slower→stays engaged; disengage at escape range
- [ ] run affected tests — must pass before next task

### Task 4: Auto-mode combat feedback (who fires whom, range, hull)
**Files:**
- Modify: src/presentation/flight/CombatModule.ts / flight HUD (engaged-enemy markers,
  current target, range ring at `weaponRange`, per-turn fire flashes, both hull bars)
- Modify/Create: e2e regression spec for the dogfight

- [ ] auto-mode reads clearly: engaged enemies highlighted, fire flashes each turn,
      weapon-range ring shown, player + enemy hull visible; clicking an enemy retargets
- [ ] add e2e assertion that a hostile NPC engages, orbits, and fires; screenshot it
- [ ] run affected tests + regression — must pass before next task

### Task 5: Verify acceptance criteria
- [ ] verify Overview: aggressors close, circle the player, and trade fire each turn;
      fast engines escape; combat is automatic and readable
- [ ] run full unit suite — all green
- [ ] run `npm run test:e2e:regression`
- [ ] run `npm run lint` — clean
- [ ] confirm no existing test assertions changed

## Technical Details
- **"Ход" = fire cadence:** `combatFireIntervalMs` is one turn — each ship fires one shot
  per turn (matching SR's "fire once per turn"). Movement stays continuous (real-time)
  so ships visibly orbit between shots.
- **Orbit:** at ~`weaponRange`, the aggressor targets a point tangential to the player
  (perpendicular to the range vector) so it circles rather than rams; direction seeded so
  not all enemies orbit the same way.
- **Escape:** pursuit closes only if `targetSpeed ≤ selfSpeed`; the player breaking past
  `combatEscapeRange` (≈ scanner range) drops the aggressor from the combat set.

## Post-Completion
**Manual verification:** provoke a hostile NPC; confirm it closes, circles you, and you
trade fire each turn (both hulls drop); then flee on a fast engine and confirm you break
off and the fight ends.
