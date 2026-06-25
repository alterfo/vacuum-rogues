---
# Planets Keep Orbiting During Combat

## Overview
During a fight the ship sits still and the **planets stop orbiting the sun** — they
keep their axial spin (real-time) but freeze on their orbital path, which looks
broken. The orbital **position** is a function of `SpaceFlightScene.currentDay`,
which only advances when the ship **moves** or runs a **wait-turn**; combat
deliberately freezes the calendar, so `currentDay` (and thus orbits) stalls. Let
the orbital day **advance during real-time combat** (a stationary fight still passes
time) so planets keep orbiting — while keeping the world frozen during the **active
pause** (pause = everything stops, correct).

## Context (from discovery)
- **Orbit time source (`src/presentation/SpaceFlightScene.ts`):**
  `get currentDay = gameDays + distanceTraveled/DISTANCE_PER_DAY + waitDayAccum`
  (~L111); planets read it via `getOrbitalDay: () => this.currentDay` (~L368).
- **Why it freezes in combat:** `distanceTraveled` doesn't grow (ship stationary)
  and `advanceWaitTime` (which grows `waitDayAccum`) is gated off during combat
  (the wait guard excludes `followNpcId`/`combatModule.isActive`). Fire is already
  **decoupled** from the route-turn (`CombatModule` uses `isPaused`), but orbit time
  is not — so a real-time fight advances bullets but not the calendar/orbits.
- **Determinism constraint:** orbital position must stay `position = f(orbitalDay)`
  (chase/intercept lead relies on it). The fix advances the *day accumulator*, not a
  separate per-planet motion — so position stays a pure function of the day.
- **Pause must still freeze:** the active pause (`combatPause.paused`) freezes
  movement, NPC AI, fire and the calendar — orbits should be frozen **only then**,
  not during the real-time portion of the fight.

## Development Approach
- **Testing approach: TDD.** The day-advance decision is pure: given
  `{inCombat, paused, dt}` it returns the orbital-day increment (advance during
  real-time combat, hold while paused, unchanged for the existing move/wait paths).
  Test that, then wire it into `currentDay`/the update loop.
- Keep position deterministic in `orbitalDay`; preserve the existing move-distance
  and wait-turn day sources. `impact` on `currentDay`/`advanceWaitTime` first. No
  domain/schema/save change (presentation timing only).

## Testing Strategy
- **Unit:** the pure day-advance helper advances the orbital day while
  `inCombat && !paused`, holds while `paused`, and is unchanged for normal
  move/wait turns; `currentDay` reflects it.
- **Real-engine playtest:** with a fight engaged (not paused), `getOrbitalDay`
  increases over ticks and a planet's orbital position changes; while the active
  pause is up, it holds.

## Implementation Steps

### Task 1: Reproduce — orbits frozen in real-time combat (red)
**Files:**
- Create: `src/tests/flight/orbitsDuringCombat.test.ts`

- [x] Drive the scene/update with a combat engaged and **not** paused over several
      ticks; assert `getOrbitalDay`/`currentDay` currently does NOT advance (frozen)
      → RED.

### Task 2: Advance the orbital day during real-time combat
**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`

- [x] Add a pure helper deciding the per-frame orbital-day increment from
      `{inCombat, paused, dt, timeScale}` — advance during real-time combat (reuse
      the wait-turn day rate), hold while paused, leave the move/wait paths intact.
      (`src/presentation/flight/combatOrbitClock.ts` — `combatOrbitalDayIncrement`
      + shared `MS_PER_ORBITAL_DAY`.)
- [x] Feed it into `currentDay`/`waitDayAccum` (or a dedicated combat-day
      accumulator) so `getOrbitalDay` advances during a stationary fight; keep
      orbital position a pure function of the day. (Accrued into the existing
      `waitDayAccum` — free during combat since the wait path is gated off there — so
      `currentDay = gameDays + distance + waitDayAccum` rises with the calendar frozen.
      Gated to the *stationary* branch so a moving combat pursuit, which already advances
      orbits via the distance path, doesn't double-count.)
- [x] write tests: orbital day advances in real-time combat, holds while paused,
      and normal move/wait turns are unchanged; the Task 1 repro now passes.
      (`combatOrbitClock.test.ts` pure-helper unit + `orbitsDuringCombat.test.ts`
      flipped to a green `it` with paused-holds / calendar-frozen / wait-unchanged cases.)
- [x] run tests — green (existing planet-orbit + pause tests stay green — all 273
      flight tests pass; line-count guard `< 1900` held at 1898).

### Task 3: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [x] `detect_changes({scope:"compare", base_ref:"master"})` — only SpaceFlightScene
      (+ the helper + tests) affected; no schema/migration. (Confirmed: changed
      symbols = SpaceFlightScene.currentDay/updateShip/advanceWaitTime/endTurn + the
      new `flight/combatOrbitClock.ts` helper + the two flight tests; no schema/
      migration/domain symbol in the diff.)
- [x] full unit suite green; `npm run test:playtest` green; lint clean; build ok.
      (Unit: 334 files, 2805 passed / 1 skipped. Playtest: 8 files, 63 passed / 1
      skipped. Lint: 0 errors. Build: ✓ in ~3.9s.)

### Task 4: Update documentation
**Files:**
- Modify: `src/presentation/flight/CLAUDE.md` (the single sub-day clock section)

- [x] Note that the orbital day advances during real-time combat (planets keep
      orbiting) but freezes during the active pause, alongside the existing
      move-distance + wait-turn day sources. (`src/presentation/flight/CLAUDE.md`
      "Single sub-day clock" section now spells out the three sub-day sources —
      move-distance + wait-turn + the real-time-combat path via
      `combatOrbitalDayIncrement` — accrued into `waitDayAccum` from the stationary
      branch, held at 0 by the active pause, position pure in `orbitalDay`.)

## Technical Details
- Reuse the wait-turn day rate (`MS_PER_WAIT_DAY`) for the combat-time increment so
  pacing matches a wait-turn. Position stays `f(orbitalDay)`; only the day source
  gains a combat path. No data/schema/save impact.

## Post-Completion
**Manual verification:** start a fight and watch the planets — they keep orbiting
the sun in real time; raising the active pause freezes them; resuming continues.
