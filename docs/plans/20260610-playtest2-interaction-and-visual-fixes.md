---
# Playtest 2 Fixes — Interaction & Visual (Regression-First)

## Overview
Fix the remaining findings from the user's 2026-06-10 manual playtest. The
biggest one — every `UiButton` mouse-dead (missing `hitArea`) — was already
fixed inline (commit pending in working tree: `src/presentation/ui/UiButton.ts`
+ real-mouse smoke in `playtest-regression.spec.ts` + `uiButtonHitArea.test.ts`).
This plan covers the rest: NPC hover cursor, sun route integrity (gaps +
fly-through), minimap/hint-text overlap, ship glow polish, and a real-pointer
verification pass over PlanetScene. Every bug: red test → fix → screenshot.

## Context
- User findings (2026-06-10, manual play): ① Ход/пауза, speed, gear buttons unclickable — FIXED (UiButton hitArea); ② cursor does not change over NPC ships; ③ route around the sun has gaps, dashes stop and resume, and the ship can fly INTO the sun; ④ minimap covers the camera hint text («Камера: Zoom …»); ⑤ player-ship glow looks ugly (flat smear); ⑥ PlanetScene: background pans with "move" cursor everywhere, no button clickable — root cause was UiButton (PlanetScene menu uses UiButton, `PlanetScene.ts:1024`), needs real-click verification
- **Key lesson already codified in CLAUDE.md**: `e2e*` driver methods bypass PixiJS hit-testing; interaction bugs are only caught by REAL pointer events (`page.mouse.*`) with coordinates derived from `getGlobalPosition()`. PixiJS sets `rootBoundary.rootTarget` lazily — fire one `page.mouse.move()` before direct `hitTest()` calls
- NPC cursor wiring looks correct statically (`NpcShipSprite.setClickHandler`: hitArea Circle, cursor "target"/"pointer"; `cursor.ts` registers "target"→crosshair via `cursorStyles`) — the bug is likely hit-radius vs zoom, install timing, or hover during a running turn; needs runtime diagnosis
- Sun bypass waypoints exist for planet routes (`ShipPhysics` waypoint queue, sprint3 Task 8 smoothing) — free-flight click-to-point routes may skip the bypass; RouteRenderer draws dashed lines
- FlightHud: `cameraDebugText` (`FlightHud.ts:323`) and `SystemMiniMap` both sit bottom-right and overlap (user screenshot)
- PlayerShipRenderer owns ship glow/outline (`src/presentation/flight/PlayerShipRenderer.ts`)
- E2E env: `NO_PROXY=localhost,127.0.0.1` required; letsplay harness `e2e/letsplay-discovery.spec.ts` regenerates `e2e/screenshots/letsplay/lp-*.png`

## Development Approach
- Regression-first (CLAUDE.md Bug Fixing Process): failing test first, fix second, screenshot verification third
- Interaction fixes are verified with REAL pointer events (`page.mouse.move/click`), never `e2e*` shortcuts — coordinates from scene introspection
- Each task: `npm run lint`, `npm test -- --run`, `NO_PROXY=localhost,127.0.0.1 npm run test:e2e:regression` green before moving on
- Visual fixes re-verified by re-running the letsplay spec and INSPECTING the regenerated PNG

## Implementation Steps

### Task 1: NPC hover cursor — diagnose with real mousemove, then fix
**Files:**
- Modify: `e2e/playtest-regression.spec.ts`
- Modify: `src/presentation/NpcShipSprite.ts` (and/or `src/presentation/flight/NpcShipManager.ts`, `src/presentation/cursor.ts` per diagnosis)
- Modify: `src/tests/hudCursors.test.ts`

- [x] Write the RED E2E test: focus camera on an on-screen NPC (`e2eSetCameraZoom`/`e2eSetCameraPan` from its world position), `page.mouse.move()` to its global position, then assert `canvas.style.cursor` is the crosshair/pointer style (read the actual computed value). Confirm it FAILS as the user reported — NOTE: hover at rest passed; the red condition is "after one turn", so the committed test runs a wait turn (1 game day) first; proven RED against the pre-fix simulator via stash
- [x] Diagnose: log `rootBoundary.hitTest()` at the NPC point — probe found `hitTest()` returning null/foreign container because EVERY sprite had `eventMode='none'`: all NPCs spawned `IDLE`, the first day-tick sent 100% of them `TRAVELING`, and `refresh()` ran `beginDeparture()` on all sprites (mass exodus); secondary: hit radii stay 40 world px at spawn until the next camera transform
- [x] Fix per root cause: NpcSimulator spawn sites now create ships dwelling (`PATROLLING`, never `IDLE` — matches the documented arrivalState dwell design), so departures happen at DEPART_CHANCE 15%/day instead of 100% on day 1; NpcShipManager applies the last camera zoom to newly spawned sprites' hit areas; click seam untouched
- [x] Verify the red test passes; run unit cursor tests (`hudCursors.test.ts`) — contract unchanged, green; new unit regressions in `npcSimulator.test.ts` (no first-tick mass-departure; spawn state PATROLLING) and `npcShipManager.test.ts` (spawn-time hit-area zoom)
- [x] Run lint + unit + regression — green (0 lint errors, 996 unit tests, 11 regression E2E in 49 s)

### Task 2: Sun route — no fly-through, no broken dashes
**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts` (route planning) or `src/systems/ShipPhysics.ts` per diagnosis
- Modify: `src/presentation/flight/RouteRenderer.ts`
- Modify: `src/tests/` (route tests — extend `routePlanet.test.ts` or add `routeSunClearance.test.ts`)

- [x] Write RED unit test (`routeSunClearance.test.ts`): every produced path point — final point INCLUDED — keeps ≥ clearance from the star center, property-tested over 5000 seeded start/end pairs with destinations sampled ANYWHERE (incl. inside the ring). NOTE: diagnosis revised the plan's hypothesis — free-flight clicks already went through `avoidStarPath`; the hole was IN-RING DESTINATIONS: a click on/behind the sun became a path endpoint inside the star (the sprint3 property test sampled endpoints only outside the ring and excluded the final point). Proven RED: path ended 0px from the star center
- [x] Fix: `clampOutsideRadius()` in flightGeometry; `avoidStarPath` clamps an in-ring destination to the ring edge (single route-building entry point — every caller covered: clicks, combat chase, planet drift chase); the scene click handler also clamps the click so plannedRoute, marker, and the 50px second-click-execute check agree on the reachable point
- [x] Write RED test for dash continuity (`routeRendererDashes.test.ts`, real Pixi Graphics instruction introspection): diagnosis — the RENDERER dashed each segment independently with `floor(segLen/period)` dashes, so the bypass spline's ~10px segments drew ZERO dashes (whole arc invisible; 546px gap proven RED — worse than a phase reset). Fix: `dashedPolyline()` walks the whole polyline with the dash phase carried across vertices; RouteRenderer draws its runs
- [x] Re-run letsplay spec with new `06b-sun-route` step (`lp-06b-sun-route.png`): bypass 82 points, min distance 448 world px = 1.15R; pixel-verified on the PNG — closest route pixel 245.7px from the sun on screen (predicted 246.4px, sun disc 93.5px), max angular dash gap along the arc = one 10px gap period (continuous dashes)
- [x] Run lint + unit + regression — green (0 lint errors, 1007 unit tests, 11/11 regression E2E in 54.5s)

### Task 3: Minimap must not cover the camera hint text
**Files:**
- Modify: `src/presentation/flight/FlightHud.ts`
- Modify: `src/tests/presentation/flightHud.test.ts`

- [ ] Write RED unit test: bounding boxes of `cameraDebugText` and the `SystemMiniMap` container do not intersect for representative screen sizes (1280×720, 1920×1080, narrow 1024×768)
- [ ] Fix: derive the hint-text position from the minimap's actual bounds (place it above/left of the minimap), not from independent absolute offsets
- [ ] Re-run letsplay spec; inspect the bottom-right corner in `lp-03`/`lp-07` — text fully readable beside/above the minimap
- [ ] Run lint + unit + regression — green

### Task 4: Player-ship glow polish
**Files:**
- Modify: `src/presentation/flight/PlayerShipRenderer.ts`
- Modify: `src/tests/flight/` (matching renderer test)

- [ ] Capture the current glow close-up via the letsplay/exploration spec (baseline "before")
- [ ] Rework the glow: tight radial falloff hugging the hull silhouette (small radius, 2–3 layered circles with decreasing alpha or a small blur), no flat rectangular/oval smear; engine glow stays at the nozzle only; respect BlurFilter disposal rule if filters are used
- [ ] Unit test: glow objects mounted/destroyed cleanly (`gameLayer.children.length === 0` after destroy; filters disposed)
- [ ] Re-run letsplay spec; inspect `lp-06-ship.png` — glow reads as a subtle halo, not a smear; compare against the "before" capture
- [ ] Run lint + unit + regression — green

### Task 5: PlanetScene real-pointer verification (post-UiButton fix)
**Files:**
- Modify: `e2e/playtest-regression.spec.ts` (or planet smoke spec)
- Modify: `src/presentation/PlanetScene.ts` (only if diagnosis finds residual blockers)

- [ ] Write E2E smoke: land on a planet, `page.mouse.move()` over each menu button (coordinates from introspection) → cursor becomes pointer (not "move"/"grab"); `page.mouse.click()` the Trade button → TradeScene opens. Should pass already thanks to the UiButton hitArea fix — if it fails, diagnose with `rootBoundary.hitTest()` and fix the blocker (e.g. panorama mesh z-order)
- [ ] Verify the back/Esc path works with a real click too (return to PlanetScene)
- [ ] Run lint + unit + regression — green (< 60 s gate)

### Task 6: Verify acceptance criteria
**Files:** none

- [ ] `npm run lint` — 0 errors
- [ ] `npm test -- --run` — all unit tests pass
- [ ] `NO_PROXY=localhost,127.0.0.1 npm run test:e2e:regression` — green, < 60 s
- [ ] `NO_PROXY=localhost,127.0.0.1 npx playwright test e2e/letsplay-discovery.spec.ts --project=letsplay` — 22/22 steps (06b-sun-route added in Task 2), 0 JS errors
- [ ] Inspect regenerated screenshots: sun-route arc continuous, minimap/hint separated, ship glow clean
- [ ] Append a "Playtest 2" status table to `docs/playtests/20260610-letsplay-discovery.md` mapping each finding ①–⑥ to its verifying test/screenshot

## Post-Completion
**Manual verification:**
- Real-mouse play session: hover NPCs (cursor changes), click every HUD button, fly a route across the sun (ship arcs around, dashes continuous), land and use every planet menu button
- If glow/route changes shift visual baselines: regenerate `space-flight.spec.ts` snapshots intentionally (`npx playwright test --update-snapshots`) and review diffs
