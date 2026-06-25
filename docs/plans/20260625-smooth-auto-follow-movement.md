---
# Smooth Auto-Follow / Combat-Pursuit Ship Movement

## Overview
When the ship auto-follows a target — a non-combat «Приблизиться» approach, the
pre-combat «Перехват» chase, or in-fight auto-pursuit — its motion is visibly
**jerky/twitchy** ("дёрганые"). The ship is steered by repeatedly **re-aiming at
the moving target's lead point** (`NpcShipManager.npcLeadPoint` → `aimRoute` /
`updateCombatPursuit`), and each re-aim re-plots the course. Two things make that
stutter: (1) the **lead point jumps** frame-to-frame from a noisy
target-velocity estimate, so the aim oscillates; and (2) re-aiming **re-plots a
curved route** (`executeRouteTo` → catmull-rom spline) instead of just nudging the
heading, so the ship keeps snapping onto a freshly-built path.

Fix: steer the ship **continuously** toward a **smoothed** intercept/lead point
using the existing `ShipPhysics` turn-rate limiter, and **reserve the
curved-spline re-plot for static destinations + star avoidance** — don't rebuild
the spline every chase frame. Add re-aim **hysteresis** so sub-threshold target
jitter doesn't re-plot at all.

## Context (from discovery)
- **Chase entry points** (`src/presentation/flight/NpcShipManager.ts`):
  - `onAttackNpc` → out of range → `followNpcId = npc.id`; `aimRoute(lead)` with
    `npcLeadPoint(sprite)` ("aim at a lead point so the intercept curves to where
    the target is heading").
  - `updateCombat(dt)` → `isInCombat()` → `updateCombatPursuit(physics)`
    (auto-track every frame); else the non-combat «Приблизиться» branch
    "continuously re-aim at the moving target's lead point while flying".
- **Re-plot path** (`src/presentation/SpaceFlightScene.ts`): `executeRouteTo(x,y)`
  builds the **full curved catmull-rom route** (around the star, drawn + fed to
  `ShipPhysics.setPath`). The planet chase re-aims via `updateRouteToTarget` →
  `shouldReaim` (threshold) → `executeRouteTo` (L1198); the arrival handler
  early-returns for `followNpcId` (L1215) so the NPC chase relies on the
  re-aim/re-course loop.
- **Steering primitives:** `ShipPhysics` already turn-rate-limits toward a target
  angle (`rotationSpeed`, `targetAngle`/`angleDiff`, L195-215). `src/utils/
  intercept.ts` `solveInterceptPoint` is the predicted-lead solver (already used
  for planets). `src/utils/flightGeometry.ts` `shouldReaim(endpoint, freshLead,
  threshold)`, `catmullRomSpline`, `avoidStarPath`.
- **Star avoidance must be preserved:** continuous steering must still not fly the
  ship through the sun — when the straight lead-line crosses the star radius, fall
  back to the curved `avoidStarPath` re-plot (the spline path is correct *there*).

## Development Approach
- **Testing approach: TDD** for the pure pieces — a **lead-point smoother**
  (EMA / clamped step on the target's estimated position+velocity) and a
  **re-aim hysteresis** decision are pure functions; the per-frame **heading-delta
  bound** is assertable on `ShipPhysics`. Visual smoothness is screenshot/playtest-
  verified.
- **Ordering / conflict note:** this edits `NpcShipManager` + `SpaceFlightScene` +
  combat timing — **the same files the `combat-multiweapon-starter-loadout-shared-
  hangar` plan touches**. Run this **after** that plan lands (or rebase onto it) to
  avoid clobbering. Re-run `impact` on `updateCombatPursuit`/`aimRoute`/
  `executeRouteTo` before editing.
- Smooth, focused change; no domain/schema/save impact (pure presentation steering).

## Testing Strategy
- **Unit:** lead-point smoother (a steadily-moving target yields a monotonically
  converging, non-oscillating aim point); re-aim hysteresis (no re-plot under
  threshold, re-plot above); `ShipPhysics` per-frame heading change stays
  `<= rotationSpeed*dt` while chasing a moving target (no snap).
- **Playtest (real-engine):** following an NPC keeps the turn running and the ship
  converges without start/stop stutter; combat pursuit holds `WEAPON_RANGE`.
- **E2E/manual:** visual smoothness on follow + pursuit (screenshot/GIF).

## Progress Tracking
- Mark `[x]` immediately; ➕ for discovered tasks; ⚠️ for blockers.

## What Goes Where
- **Implementation Steps** (`[ ]`): the smoother, the steering change, hysteresis,
  tests, docs.
- **Post-Completion** (no checkboxes): the manual visual smoothness check.

## Implementation Steps

### Task 1: Characterize the stutter (red signal)
**Files:**
- Create: `src/tests/flight/chaseSteering.characterize.test.ts`

- [x] Add a test that simulates a chase against a steadily-moving target and shows
      the current behaviour spikes — e.g. the aim point's per-frame jump exceeds a
      smoothness bound, and/or `executeRouteTo` is invoked more than once per
      second (route re-plot thrash). Capture the metric so Task 2/3 prove the fix.
      (`src/tests/flight/chaseSteering.characterize.test.ts`: baseline max aim jump
      ≈72px vs `SMOOTH_BOUND_PX`=8, ≈15 route re-plots/sec vs 1/sec.)
- [x] run tests — confirm the characterization fails the target smoothness bound.

### Task 2: Smoothed lead point + re-aim hysteresis (pure)
**Files:**
- Modify: `src/utils/flightGeometry.ts` (or new `chaseSteering.ts`)
- Create: `src/tests/flight/chaseSteering.test.ts`

- [x] Add a pure **lead-point smoother**: blend the raw `npcLeadPoint`/
      `solveInterceptPoint` toward its previous value (EMA or max-step clamp) so a
      noisy per-frame target velocity can't whip the aim around.
      (`flightGeometry.ts` `smoothLeadPoint(previous, raw, {alpha, maxStepPx})`:
      EMA step then hard max-step clamp; adopts raw verbatim on the first frame.)
- [x] Add a pure **re-aim gate** combining `shouldReaim`'s distance threshold with
      a minimum re-plot interval (hysteresis), so sub-threshold jitter never
      re-plots the route. (`flightGeometry.ts` `shouldReplotRoute(state, freshLead,
      thresholdPx, nowMs, minIntervalMs)` — requires BOTH the elapsed interval AND
      the `shouldReaim` distance drift.)
- [x] write tests: smoother converges monotonically + bounds per-frame aim delta
      for a steady target; hysteresis blocks under-threshold / allows over-threshold.
      (`src/tests/flight/chaseSteering.test.ts`, 8 tests: monotonic convergence,
      per-frame delta ≤ maxStepPx ≤ SMOOTH_BOUND_PX on the noisy steady chase,
      sub-threshold/time-window blocks, ≥-interval re-plot spacing.)
- [x] run tests — green.

### Task 3: Continuous turn-rate steering for moving targets
**Files:**
- Modify: `src/presentation/flight/NpcShipManager.ts`
- Modify: `src/presentation/SpaceFlightScene.ts` (and/or `src/systems/ShipPhysics.ts`)

- [ ] In `updateCombatPursuit` + the non-combat approach branch, steer the ship
      **continuously** toward the **smoothed** lead point via the existing
      `ShipPhysics` turn-rate limiter (heading nudge), instead of re-plotting a
      curved `executeRouteTo` spline every chase frame.
- [ ] Gate any curved re-plot behind the **re-aim hysteresis** AND **star
      avoidance**: only rebuild the spline path when the direct lead-line would
      cross the star radius (use `avoidStarPath`), otherwise keep the direct nudge.
- [ ] Keep the existing engage/in-range, lead-targeting and `followNpcId`
      lifecycle behaviour identical (no change to when a fight starts/ends).
- [ ] write/extend tests: the `ShipPhysics` heading change per frame stays
      turn-rate-bounded during a moving-target chase (no snap); pursuit still
      reaches + holds `WEAPON_RANGE`.
- [ ] run tests — the Task 1 characterization now passes the smoothness bound.

### Task 4: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [ ] `detect_changes({scope:"compare", base_ref:"master"})` — only the chase
      steering helpers + NpcShipManager/SpaceFlightScene affected.
- [ ] full unit suite green; `npm run test:playtest` green; `npm run lint` clean;
      `npm run build` ok.

### Task 5: Update documentation
**Files:**
- Modify: `src/presentation/flight/playtest-traps.md` (or `flight/CLAUDE.md`)

- [ ] Note the smoothed chase steering: continuous turn-rate steering toward a
      smoothed lead point, curved re-plot reserved for static destinations + star
      avoidance, re-aim hysteresis — so auto-follow/pursuit no longer stutters.

## Technical Details
- Pure-presentation change; `ShipPhysics` already turn-rate-limits, so the smooth
  motion falls out of feeding it a stable target heading rather than a freshly-
  rebuilt spline each frame. No data/schema/save change.

## Post-Completion
*Manual — no checkboxes.*

**Manual verification:**
- «Приблизиться» to a moving NPC, «Перехват»/«Атаковать» a fleeing ship, and an
  engaged dogfight all show smooth ship motion (no twitch/start-stop), while the
  ship still closes to and holds weapon range and never flies through the star.
