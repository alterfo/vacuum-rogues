# Combat Feel Fixes

## Overview

Three player-visible combat/flight bugs reported during a playtest session:

1. **The player ship can fly off the visible system map during a fight.** `CombatPursuitController.steerCombatOrbit()` projects an orbit "carrot" 2000px ahead of the ship with no boundary check, unlike NPCs which are already clamped to the system's `boundary` radius. If the engaged target sits near the system edge, the orbit carries the player past it.
2. **The ship circles for several seconds before its first shot lands**, even once already in weapon range. Root cause (traced, not hypothesized): `CombatModule.addCombatant()` unconditionally zeroes every weapon's fire timer (`weaponFireTimers.clear()`) on engagement — so a weapon with `cooldownTurns: 3` (7.5s interval) always waits its **full** cold-start interval before its first shot, regardless of how long the ship spent closing distance beforehand. At `COMBAT_ORBIT_RANGE` (144px) and starter-engine orbit speed, one strafe revolution takes ~8s — so a fresh 7.5s wait reads as "circling for a while" before anything fires.
3. **No way to judge how far the ship can fly (and shoot back) in one day** when plotting an escape route. The planned-route overlay draws only the dashed line + an end marker; there's no indication of the one-day travel distance along it.

This plan fixes all three. It does **not** touch multi-weapon range-tiered firing — that already works as designed (`CombatModule.advancePlayerWeapons` fires every fitted weapon independently, gated on its own `weapon.range`).

## Context (from discovery)

- `src/presentation/flight/CombatPursuitController.ts` — `steerCombatOrbit()` (orbit carrot, no bounds), `COMBAT_ORBIT_RANGE`/`COMBAT_ORBIT_CARROT` constants.
- `src/presentation/NpcShipSprite.ts:51-56` — `SystemBounds` interface (`cx, cy, rInner, rOuter, boundary`), already used for NPC `beginDeparture()` clamping (`NpcShipSprite.ts:286-298`).
- `src/presentation/flight/NpcShipManager.ts:723-731` — `npcBounds()` builds `SystemBounds` from `SYSTEM_GEOMETRY` (`src/config/balance.ts:294-300`: `innerRadius:600, outerRadius:2500, boundaryRadius:2800`) + `deps.getStarCenter()`.
- `CombatPursuitController` already has `this.deps.flight.getStarCenter()` available (used elsewhere, e.g. line 608) — no new plumbing needed, just import `SYSTEM_GEOMETRY` and clamp the carrot.
- `src/presentation/flight/CombatModule.ts:354-398` — `addCombatant()`, `weaponFireTimers.clear()` at line 392, `npcFireTimers.set(npc, 0)` at line 387; `weaponFireIntervalMs()` (line 38) = `max(1, cooldownTurns) × GAME_BALANCE.combatFireIntervalMs (2500ms)`.
- `src/systems/combat/combatManeuver.ts` — confirms aggressor NPCs `CLOSE` (straight-line) until in weapon range, then switch to `ORBIT`; the "circling" the player observes is the **post-engagement** orbit (`steerCombatOrbit`), not a pre-engagement approach dance.
- `src/presentation/flight/RouteRenderer.ts` — `drawRoute(path)` (dashed line), `drawLandingMarker`/`drawNavigationMarker` (end-of-route markers) — the pattern to extend for a day-distance marker.
- `src/utils/flightGeometry.ts:414-449` — `pointAlongPath(points, dist): PathSample` already computes the point at a given cumulative distance along a polyline, including a `done` flag when the route is shorter than `dist`. **Reuse this directly** — no new geometry helper needed.
- `src/presentation/SpaceFlightScene.ts:1484-1508` — `plotRoute()` builds `points` and calls `drawRoute`/`drawLandingMarker`/`drawNavigationMarker`; this is where the day-marker call is added. `DISTANCE_PER_DAY` = `GAME_BALANCE.pixelsPerDay` (500).
- **Guard rail**: `src/tests/presentation/routeRenderer.test.ts` (`playtest4 B`) asserts the route overlay draws **only** the cyan dashed line — a prior "yellow per-day tick cross" feature was deliberately removed and is test-locked. The new marker must be a **single** mark at the one-day point (distinct shape/color from the removed tick pattern), not a repeating per-day grid, or this guard test will catch it.
- Relevant existing tests to extend: `src/tests/presentation/combatPursuitController.test.ts` (`describe("CombatPursuitController real-time combat orbit"`, line 289), `src/tests/combat/combatRounds.test.ts` / `src/tests/flight/combatEngagement.test.ts` (fire-timer/engagement timing), `src/tests/presentation/routeRenderer.test.ts`.

## Development Approach

- **Testing approach**: Regression-first (project standard, CLAUDE.md) — each task starts with a failing test reproducing the bug, then implements until green.
- Complete each task fully before moving to the next.
- Make small, focused changes — no bundled refactors.
- Every task includes new/updated tests; all tests must pass before starting the next task.
- Update this plan file if scope changes during implementation.

## Testing Strategy

- **Unit tests**: `combatPursuitController.test.ts` (orbit boundary clamp), `combatRounds.test.ts`/`combatEngagement.test.ts` (first-shot timing), `routeRenderer.test.ts` (day marker) — all mocked-logic tier, no PixiJS rendering needed for the geometry/timing assertions.
- **Real-engine playtest**: if the boundary-clamp or timer-seed fix touches wiring between `SpaceFlightScene`/`CombatModule`/`CombatPursuitController`, add/extend a case in `src/tests/playtest/**` per CLAUDE.md's tier guidance (integration bugs go in the real-engine harness, not a mocked unit test that re-creates the false green).
- Run `npm test -- --run` (affected files) after each task; run `npm run test:playtest` before the final verification task.

## Implementation Steps

### Task 1: Bound the combat-orbit carrot to the system boundary

- [x] write a failing test in `combatPursuitController.test.ts` (extend the `"CombatPursuitController real-time combat orbit"` describe block): position the ship/target near `SYSTEM_GEOMETRY.boundaryRadius` from `getStarCenter()` such that the current 2000px carrot projection would land outside the boundary; assert the resulting `physics.setPath` points are clamped to `boundaryRadius` of the star center. Confirm it fails against current code.
- [x] in `CombatPursuitController.steerCombatOrbit()` (`src/presentation/flight/CombatPursuitController.ts`), import `SYSTEM_GEOMETRY` from `src/config/balance.ts` and clamp both `carrot` and the far (`×2`) point to `SYSTEM_GEOMETRY.boundaryRadius` from `this.deps.flight.getStarCenter()` before calling `physics.setPath`. Implemented as a heading-preserving ray/circle shrink (`clampOrbitPoint`) rather than a literal radial reprojection from center — a naive radial clamp (mirroring `NpcShipSprite.beginDeparture()` verbatim) broke the existing `combatOrbit.test.ts` orbit-hold assertions by snapping the carrot onto an unrelated bearing whenever the ship neared the boundary; shrinking along the same heading keeps the tangent/radial strafe mix continuous and passes both the new boundary test and the pre-existing orbit-hold suite unmodified.
- [x] write a test for the unaffected case: orbit well inside the boundary is unchanged (no regression to the existing circle-strafe/anti-spin tests already in that describe block).
- [x] run `npx vitest run src/tests/presentation/combatPursuitController.test.ts` — must pass before Task 2.
- [x] **Scope change (2nd review):** the plain heading-preserving truncation exposed an edge-parking freeze — a clamped leg `tExit ≤` ShipPhysics' `STOP_THRESHOLD` (8px) puts both `setPath` waypoints inside the arrival window and the strafe parked dead at the wall (sim: 0px travelled for 38s against an edge target). Fix: `ORBIT_PARK_EPS` (= imported `SHIP_STOP_THRESHOLD`, lockstepped) — only in that park window the leftover distance slides along the boundary arc in the heading's tangential sense; every non-parked frame keeps the truncation behavior the range-hold is locked to. A ship at/past the boundary deliberately keeps the raw point (caging it at current radius reds `combatOrbit.test.ts`). Locked by the new edge3–edge5 tests in `combatPursuitController.test.ts`.

### Task 2: Reduce first-shot latency after engagement

- [x] write a failing test in `combatRounds.test.ts` (or `combatEngagement.test.ts`, whichever already drives `CombatModule.addCombatant` + `update`) asserting that after engaging with a `cooldownTurns: 3` weapon, the first shot fires in materially less than the full `weaponFireIntervalMs` (7500ms) — pick and document a concrete target budget (e.g. no more than half the cold-start interval). Confirm it fails against current code (`weaponFireTimers.clear()` zeroes every timer on engage). Implemented in `weaponCadence.test.ts` (already the file exercising `CombatModule.addCombatant` + per-weapon cadence) rather than `combatRounds.test.ts` (pure round-budget arithmetic, no `CombatModule` at all) — budget = half of `weaponFireIntervalMs(wpn_beam)` = 3750ms, confirmed failing against the pre-fix `weaponFireTimers.clear()` (would have forced the full 7500ms).
- [x] in `CombatModule.addCombatant()` (`src/presentation/flight/CombatModule.ts:386-396`), seed newly-added weapon timers to a partial pre-charge instead of a hard `clear()` (e.g. each weapon starts at `weaponFireIntervalMs(weapon) / 2` elapsed) — add a named constant in `src/config/balance.ts` (near `combatFireIntervalMs`) rather than a magic number at the call site. Apply the same treatment to `npcFireTimers.set(npc, 0)` if the NPC side shows the same cold-start wait in the test. Implemented as `primeWeaponFireTimers()` + `GAME_BALANCE.combatEngagePrechargeFraction` (0.5), applied **only** to weapons with `cooldownTurns > 1` — a `cooldownTurns:1` weapon's interval already equals one turn, so any nonzero precharge there would misfire the existing locked `weaponCadence.test.ts` assertion ("keeps the original flat cadence… just shy of the interval — no shot yet"); gating on `cooldownTurns > 1` reduces the cold-start wait for slow weapons only, without touching that test. `npcFireTimers` is untouched: NPC return fire already runs on the flat `combatFireIntervalMs` (2500ms) regardless of weapon, so it has no variable-cooldown cold-start symptom to fix.
- [x] verify sustained fire cadence (second shot onward) is unchanged — add/confirm a test asserting steady-state interval still equals `weaponFireIntervalMs(weapon)`. Added "engage pre-charge does not change steady-state cadence" in `weaponCadence.test.ts`.
- [x] run the affected combat test files — must pass before Task 3. `weaponCadence.test.ts` + `multiWeaponFire.test.ts` + `realtimeFire.test.ts` + `combatEngagement.test.ts` + `combatModule.test.ts` (53+ tests) all green; full unit suite (5242 tests) green; `npx tsc --noEmit` clean; `npm run lint` 0 errors (pre-existing `any` warnings only); `gitnexus detect_changes` — low risk, 0 affected processes, changes confined to `CombatModule.ts`/`balance.ts`.

### Task 3: Add a one-day-travel marker to the planned route

- [x] write a failing test in `routeRenderer.test.ts`: a new `RouteRenderer.drawDayMarker(x, y)` method draws a single, visually distinct mark (not the removed per-day tick pattern — different color/shape, single call) onto the route overlay; assert it does nothing when no route line has been drawn yet (mirrors `drawLandingMarker`'s guard).
- [x] implement `drawDayMarker(x, y)` in `src/presentation/flight/RouteRenderer.ts`, alongside `drawLandingMarker`/`drawNavigationMarker`. Implemented as a magenta (`0xff00ff`) diamond outline — distinct from the cyan course line/nav marker, the orange landing marker, and the removed yellow (`0xffee66`) per-day tick.
- [x] in `SpaceFlightScene.plotRoute()` (`src/presentation/SpaceFlightScene.ts:1484-1508`), after `drawRoute(points)`, call `pointAlongPath(points, this.DISTANCE_PER_DAY)` (`src/utils/flightGeometry.ts`) and, when `!result.done`, call `this.routeRenderer.drawDayMarker(result.x, result.y)`. Line-guard fallout: this pushed `SpaceFlightScene.ts` from 1898 to 1907 lines (over the ≤1898 guard), so the private `computeFlightPath` method (pure, only 2 call sites) was extracted verbatim to `src/utils/flightGeometry.ts` as an exported function taking explicit `(fx, fy, tx, ty, star, landingApproachOffset, landing?)` params — a mechanical move, no logic change — landing the file at 1886 lines.
- [x] write a test confirming `src/tests/presentation/routeRenderer.test.ts`'s existing `"draws only the cyan course line — no yellow per-day tick crosses (playtest4 B)"` test still passes unmodified (guard rail, do not weaken it) alongside the new marker test. Added a second variant of that guard test with `drawDayMarker` also called, proving the marker doesn't reintroduce the removed yellow tick stroke.
- [x] write a unit test (wherever `plotRoute`/route-planning logic is already covered for `SpaceFlightScene`) for the two cases: route longer than one day → marker drawn once at the correct point; route shorter than one day → no marker. Added `describe("Task 3: one-day-travel marker on the planned route")` in `routeMatchesPath.test.ts` (reuses its existing `makeHarness`). Decided rule: no marker when the route doesn't exceed one day's travel (`pointAlongPath`'s `done` flag), since it would coincide with the end marker. Existing mocked `routeRenderer` stubs in `routeMatchesPath.test.ts`/`routeHideWhileMoving.test.ts` gained a `drawDayMarker: vi.fn()` entry (mock-completeness fix, no assertion changed) so `plotRoute()`'s new unconditional call doesn't throw on routes >500px.
- [x] run the affected test files — must pass before Task 4. `routeRenderer.test.ts` + `routeMatchesPath.test.ts` + `routeHideWhileMoving.test.ts` green; full unit suite (5246 tests) green; `npx tsc --noEmit` clean; `npm run lint` 0 errors; `wc -l SpaceFlightScene.ts` = 1886 (guard ≤1898; later branch fixes — orbit-visual floor + review hygiene — raised it to 1897, still under the guard); `gitnexus detect_changes` — only route-planning/execution symbols touched, matches intent.

### Task 4: Verify acceptance criteria

- [x] verify all three bugs are independently reproducible-as-fixed: orbit never runs away past the system boundary (precisely: the carrot is clamped to the boundary; a ship already at/past the edge keeps a bounded excursion of up to `COMBAT_ORBIT_RANGE` + momentum and self-corrects — see the ship-outside exemption in `flight/CLAUDE.md`, pinned by edge5), first shot lands well before the cold-start interval, the route overlay shows exactly one day-marker (or none, per the decided rule) and never a repeating tick pattern. Targeted files re-run green: `combatPursuitController.test.ts` (27), `weaponCadence.test.ts`, `routeRenderer.test.ts` (incl. the unmodified playtest4 B guard), `routeMatchesPath.test.ts` (52 tests total).
- [x] run full unit test suite (`npm test -- --run`) — 5246 passed, 12 skipped, 0 failures.
- [x] run `npm run test:playtest` (real-engine gate) — 693 passed, 9 skipped, 0 failures.
- [x] run `npm run lint` — 0 errors (46 pre-existing `any` warnings); `npx tsc --noEmit` clean.
- [x] `gitnexus detect_changes` — confirm only the expected symbols/flows are affected before committing. Compare-vs-master shows the whole branch (16 files incl. the prior HUD-corner + orbit-visual-floor commits); the Task 1–3 footprint is exactly `steerCombatOrbit`/`CombatModule` timers/`RouteRenderer`/`plotRoute`/`pointAlongPath` — all affected flows covered by the green unit + playtest gates.

## Technical Details

- **Boundary clamp**: reuse `SystemBounds`/`SYSTEM_GEOMETRY.boundaryRadius` (2800px) — no new constant needed, just apply the existing radius to the player's orbit carrot the same way NPCs already clamp their departure heading.
- **First-shot pre-charge**: new balance constant (name TBD during implementation, e.g. `COMBAT_ENGAGE_PRECHARGE_FRACTION = 0.5`) in `src/config/balance.ts`, consumed by `CombatModule.addCombatant()`.
- **Day marker**: no new geometry math — `pointAlongPath` already exists and is unit-tested elsewhere; this task is purely a new `RouteRenderer` draw method + one call site in `SpaceFlightScene.plotRoute()`.
- No domain/schema/save changes in any of the three tasks (presentation + balance-constant only).

## Post-Completion

**Manual verification**:
- Engage a fight near a system edge (e.g. warp to a system, immediately provoke a PATROL) and confirm the ship never visibly leaves the star system's rendered bounds while orbiting.
- Fit a slow weapon (`cooldownTurns: 3`) and time the first shot after engaging from a cold start — should feel noticeably faster than before.
- Plot a long route (>1 day of travel) and confirm a single, legible marker appears at the one-day point; plot a short route and confirm no stray marker.
