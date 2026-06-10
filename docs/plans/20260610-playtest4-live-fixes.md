---
# Playtest 4 — Live Findings Fixes (Regression-First)

## Overview
Three findings from the user's 2026-06-10 live playtest after playtest3 landed:
(A) changing the **font size** (S/M/L in the gear ⚙ panel) flings the ship to
the system edge; (B) per-day route "tick" marks read as little crosses on the
route line and annoy the player — remove them entirely (user decision); and
(C) the approach/attack course must **lead a moving target** (NPC ships and
orbiting planets), aiming where the target will be, not where it is. Root
causes for A and B are already pinpointed below. Every visual/interaction fix
is gated on a letsplay screenshot or real-pointer check before commit, not just
green unit tests.

## Context
- Findings log: `docs/playtests/20260610-playtest4-live-findings.md`
- **A — font change resets ship position (root cause found):** the font-size button handler `FlightHud.ts:581-593` calls `setFontScale(key)` then `this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, { gameEngine })` to re-apply the scale — but passes NO context, so `SpaceFlightScene.initialize` runs `applyReentrySpawn()` with no marker and edge-spawns the ship. This full re-init is also the likely trigger for the earlier "speed resets x4→x1" feel; verify the persisted game-speed (playtest3 F3) is re-applied on this path too. Layering smell: the HUD calls `transitionTo` directly — route it through a scene callback instead (DIP, like `onStarMap`/`onSpeedCycle` at `SpaceFlightScene.ts:202-207`).
- **B — route day-tick crosses (root cause found):** `RouteRenderer.drawRoute` (`RouteRenderer.ts:74-82`) draws a yellow perpendicular dash every `distancePerDay` px via `dayTickMarks`; crossing the cyan line they look like little crosses. User decision: **remove entirely.** `dayTickMarks` is used only here (+ its own unit test) — remove the draw loop, the `distancePerDay` param, the import, and the now-dead `dayTickMarks` util + test. Callers: `SpaceFlightScene.ts:1416`, `routeRenderer.test.ts:26/45`, `routeRendererDashes.test.ts:116`.
- **C — intercept lead:** `ShipPhysics.getMaxSpeed()` exists "to solve intercept lead against a target" but the approach/attack course currently aims at the target's CURRENT position. Targets move: NPC ships drift (NpcShipManager) and planets orbit (PlanetManager `setOrbitForDay`). Compute a predicted intercept point (solve time-to-intercept against the target's velocity, classic quadratic; fall back to current position when no real-positive solution) and plot the course there. Applies to both the attack-follow path (`updateCombat` / `followNpcId`, `SpaceFlightScene.ts:~1213`) and a course set to a moving NPC/planet.
- E2E env: `NO_PROXY=localhost,127.0.0.1`. Letsplay harness `e2e/letsplay-discovery.spec.ts` (project `letsplay`) regenerates `e2e/screenshots/letsplay/lp-*.png`. Interaction checks use REAL `page.mouse.*` with coords from `getGlobalPosition()`.
- Keep flight logic in `src/presentation/flight/` modules; respect the SpaceFlightScene < 1900-line guard.

## Development Approach
- Regression-first: failing test first → fix → verify.
- **Acceptance gate per task:** lint + `npm test -- --run` + `NO_PROXY=localhost,127.0.0.1 npm run test:e2e:regression`, PLUS a letsplay screenshot (visual) or real-`page.mouse` assertion (interaction) before commit.
- Pure intercept math goes in a tested helper (e.g. `src/utils/intercept.ts`), not inline in the scene.

## Implementation Steps

### Task 1: B — Remove the per-day route tick marks (crosses)
**Files:**
- Modify: `src/presentation/flight/RouteRenderer.ts`, `src/presentation/SpaceFlightScene.ts`
- Modify: `src/utils/flightGeometry.ts`, `src/tests/flightGeometry.test.ts`, `src/tests/presentation/routeRenderer.test.ts`, `src/tests/flight/routeRendererDashes.test.ts`

- [x] Write/adjust the RED test: `drawRoute` produces ONLY the cyan dashed line — no yellow (0xffee66) tick stroke. Introspect the route Graphics stroke styles (the dashes test already reads Graphics instructions). Confirm it FAILS on current code
- [x] Remove the day-tick loop + its stroke from `RouteRenderer.drawRoute`; drop the `distancePerDay` param, the `dayTickMarks` import, and update the JSDoc
- [x] Remove the now-dead `dayTickMarks` export from `flightGeometry.ts` and its `describe` block from `flightGeometry.test.ts`; update the three `drawRoute(...)` call sites to the new signature
- [x] Re-run letsplay; INSPECT `lp-07-route.png` and `lp-06b-sun-route.png` — clean dashed line, no crosses
- [x] Run lint + unit + regression — green

### Task 2: A — Font-size change preserves ship position (and game speed)
**Files:**
- Modify: `src/presentation/flight/FlightHud.ts`, `src/presentation/SpaceFlightScene.ts`
- Modify: `src/tests/` (FlightHud + scene re-init tests)

- [ ] Write the RED test: with the ship parked away from the system edge, trigger a font-scale change; assert the ship's world position is unchanged after the re-init (not edge-spawned) and the game-speed multiplier is preserved. Confirm it FAILS
- [ ] Add `onFontScaleChange: (() => void) | null` to FlightHud; the font button calls `setFontScale(key)` + closes the panel + fires the callback (no direct `transitionTo` in the HUD)
- [ ] Scene wires it (`SpaceFlightScene.ts:~202`): capture `shipPhysics.shipX/shipY` and `transitionTo(SPACE_FLIGHT, { gameEngine, preserveShipPos: { x, y } })`. Add `preserveShipPos?: { x: number; y: number }` to the scene context type; `initialize()` honors it (teleport there, takes precedence over `applyReentrySpawn`) and re-applies the persisted game speed
- [ ] Re-run letsplay/real check: change font mid-system → ship stays put, HUD font scales
- [ ] Run lint + unit + regression — green

### Task 3: C — Approach/attack course leads a moving target
**Files:**
- Create: `src/utils/intercept.ts`; Create: `src/tests/intercept.test.ts`
- Modify: `src/presentation/SpaceFlightScene.ts` (and NpcShipManager/PlanetManager accessors if velocity is needed)

- [ ] Write the RED test for the intercept helper: given shooter pos + max speed and a target pos + velocity, return the predicted intercept point; for a moving target it must lead ahead of the current position; degenerate/no-solution falls back to the current target pos. Confirm it FAILS (no helper yet)
- [ ] Implement `solveInterceptPoint(...)` (time-to-intercept quadratic) in `src/utils/intercept.ts`
- [ ] Wire it into the approach/attack course: when plotting a course to a moving NPC or an orbiting planet (and in the attack-follow chase), aim at the predicted point using the target's current velocity (NPC drift vector; planet orbital tangent). Keep the sun-clearance bypass on the resulting course
- [ ] Write a scene/unit test that a course to a moving NPC targets ahead of its current position
- [ ] Re-run letsplay; confirm a course to a moving target aims ahead, not behind
- [ ] Run lint + unit + regression — green

### Task 4: Verify acceptance criteria
**Files:** none

- [ ] `npm run lint` — 0 errors
- [ ] `npm test -- --run` — all unit tests pass
- [ ] `NO_PROXY=localhost,127.0.0.1 npm run test:e2e:regression` — green, < 60 s
- [ ] `NO_PROXY=localhost,127.0.0.1 npx playwright test e2e/letsplay-discovery.spec.ts --project=letsplay` — all steps ok, 0 JS errors
- [ ] Inspect regenerated screenshots: route has no crosses; font change keeps the ship in place
- [ ] Append a "Playtest 4 — fixed" status table to `docs/playtests/20260610-playtest4-live-findings.md`

## Post-Completion
**Manual verification:**
- Change font S→L mid-flight (ship stays put, speed sticks), plan routes (no crosses), set an attack course on a moving NPC and an orbiting planet (course leads ahead).
