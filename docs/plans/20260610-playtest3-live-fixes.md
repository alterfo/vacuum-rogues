---
# Playtest 3 — Live Findings Fixes (Regression-First)

## Overview
Fix six findings from the user's 2026-06-10 live playtest
(`docs/playtests/20260610-playtest3-live-findings.md`): pause should finish the
current day before stopping (F1, reverses the sprint-3 immediate-pause per a
new user decision), a strange route curve (F2, regression candidate from the
playtest2 sun-route work), game-speed resetting x4→x1 (F3), ship spawning at the
system edge after the equipment shop (F4), the planet backdrop fish-eyeing like
a magnifying glass instead of the agreed light parallax (F5), and clicks inside
the quest window leaking through to route-building (F6). Two are regressions
from this codebase's own recent work and one contradicts a prior agreement, so
**every visual/interaction task ends with a letsplay screenshot OR real-pointer
check as a hard acceptance gate before commit** — not just green unit tests.

## Context
- Findings + per-item diagnosis: `docs/playtests/20260610-playtest3-live-findings.md`
- **Process lesson (why F2/F3/F5 reached the user):** unit/e2e* gates passed but the regressions were visual/stateful and only a real playthrough caught them. This plan bakes the letsplay harness in as an acceptance step per task.
- F1 pause: SpaceFlightScene day-advance (`waitDayAccum`, turn/day logic), `ShipPhysics.stop()`, FlightHud pause button. Decision: Pause lets the in-progress day segment finish (ship completes its day), then halts and ends the turn — NOT a mid-day cut. Keep any low-HP emergency hard-stop.
- F2 route curve: `src/utils/flightGeometry.ts` `avoidStarPath` early-outs to a straight path when the segment does not clip the star, so non-sun routes should stay straight. The 1.15R tangent-arc + continuous `dashedPolyline` may bow wider than expected on routes that only graze the ring. NEEDS runtime diagnosis (screenshot the offending route) before changing geometry — do not blindly retune.
- F3 speed reset: `FlightHud.cycleGameSpeed` tracks `speedIndex`, `ShipPhysics.timeScale` defaults 1.0. Likely every scene re-init builds a fresh ShipPhysics (timeScale=1) + FlightHud (speedIndex=0). Persist the chosen game-speed durably and re-apply on `SpaceFlightScene.initialize`.
- F4 re-entry: `EquipmentShopScene` returns to `PLANET` (`EquipmentShopScene.ts:685`); take-off PLANET→SPACE_FLIGHT must pass `fromPlanetId`. `applyReentrySpawn` (SpaceFlightScene) parks beside a marker only with `fromStationId`/`fromPlanetId`/one-shot `landedPlanetId`. The shop round-trip loses the marker.
- F5 panorama: PlanetScene uses `PanoramaViewer` (Task 8, `DEFAULT_FOV_DEGREES=100`, perspective `tan(uFovX*0.5)`) as primary; the agreed look is the Task 6 flat-sprite light parallax (`panoramaSprite` + `clampPanoramaX`). Make the light path primary (or drop FOV hard / disable the projection filter).
- F6 quest click leak: `QuestJournalUI` backdrop is `eventMode="static"` (`QuestJournalUI.ts:46`) with NO `pointerdown` handler — static does not stop bubbling, so clicks reach the stage route handler (CLAUDE.md Rule 2). Buttons already stopPropagation; backdrop does not.
- E2E env: `NO_PROXY=localhost,127.0.0.1`. Letsplay harness `e2e/letsplay-discovery.spec.ts` (project `letsplay`) regenerates `e2e/screenshots/letsplay/lp-*.png`. Interaction bugs need REAL pointer events (`page.mouse.*`) with coordinates from `getGlobalPosition()` — `e2e*` shortcuts bypass hit-testing (CLAUDE.md).

## Development Approach
- Regression-first (CLAUDE.md Bug Fixing Process): failing test first → fix → verify.
- **Acceptance gate per task:** in addition to lint + `npm test -- --run` + `NO_PROXY=localhost,127.0.0.1 npm run test:e2e:regression`, every task with a visual or interaction effect MUST regenerate the letsplay screenshots and INSPECT the relevant PNG (or assert via real `page.mouse` events). A green unit test alone does NOT close a visual/interaction finding.
- Interaction fixes verified with REAL pointer events, never `e2e*` shortcuts.
- Diagnosis-heavy tasks (F2) start by capturing a runtime screenshot/log of the actual broken behaviour before any code change.
- Keep flight logic in `src/presentation/flight/` modules; respect the SpaceFlightScene < 1900-line guard.

## Implementation Steps

### Task 1: F6 — Quest window clicks must not build a route
**Files:**
- Modify: `src/presentation/QuestJournalUI.ts`
- Modify: `e2e/playtest-regression.spec.ts`

- [x] Write the RED test: open the quest journal, real-`page.mouse.click()` inside the window, assert it stays open and no route is planned (`plannedRoute` stays null). Confirmed it FAILS on current code (panel-centre click closed the journal via the stage modal-guard). Empirical probe showed the real leak is the *panel* hit, not just the dark backdrop — the existing `isBlockingModalOpen()` guard already swallowed route-building, so the actual F6 symptom is the click leaking to the stage at all
- [x] Fix: backdrop is now the single full-screen catch-all (`pointerdown`/`pointerup`/`pointertap` → `stopPropagation()`); all non-button content (panel bg, card backgrounds, every label) is `eventMode="none"` so clicks fall through to it (Rule 3) and the journal stays open. Audited the other in-flight-scene modal (OVERMIND core overlay, `NpcShipManager`) and gave its panel bg the same `stopPropagation`; the settings panel already stops propagation, and Dialogue/EquipmentShop/Inventory/Trade backdrops are scene-replacing (cannot leak to the flight route handler)
- [x] Verify the red test passes; added `src/tests/presentation/questJournalUI.test.ts` asserting the backdrop has a stopPropagation pointerdown handler AND the panel/labels are non-interactive
- [x] Run lint + unit + regression — green (lint 0 errors, 1028 unit tests, 13 regression tests in 59.4 s)

### Task 2: F4 — Take-off after the equipment shop parks beside the planet
**Files:**
- Modify: `src/presentation/PlanetScene.ts` (and/or `EquipmentShopScene.ts`, `StationScene.ts`)
- Modify: `src/presentation/SpaceFlightScene.ts` (only if `applyReentrySpawn` needs adjustment)
- Modify: `e2e/playtest-regression.spec.ts`

- [x] Wrote the E2E test (`playtest3 F4` in `e2e/playtest-regression.spec.ts`): real flow land → EQUIPMENT_SHOP → return to PLANET → real `takeOff()` (new `PlanetScene.e2eTakeOff` hook so the production `transitionTo(SPACE_FLIGHT,{fromPlanetId})` is exercised, not a raw transition); asserts the ship parks within `displayRadius + 220px` of the planet, not a system-radius away. **Empirical finding: it came up GREEN, not RED.** The fix this task prescribes — PLANET take-off always passing `fromPlanetId` — has been in `PlanetScene.takeOff()` since commit `40f52ea` (long before the playtest2 build the user played), so the planet equipment-shop round-trip never lost the marker. Audited the sibling take-off/undock paths: `StationScene.undock` passes `fromStationId`; the station "Магазин снаряжения" is an in-station sub-view (undock still uses `fromStationId`); `EquipmentShopScene.goBack` returns to PLANET with the planet, which re-arms `landedPlanetId` too. All re-entry markers are passed correctly — F4 as described does not reproduce on the planet path on current code
- [x] Fix already present (verified, predates this task): `takeOff()` passes `fromPlanetId: this.planet?.id` independent of the one-shot `landedPlanetId`; `SpaceFlightScene.initialize` (lines 476–508) parks the ship beside that planet via the take-off arc and clears `landedPlanetId`
- [x] Added the unit test for the take-off context payload (`src/tests/presentation/planetSceneTakeOff.test.ts`): `takeOff()` always passes `fromPlanetId` for the current planet, and blocks the transition (no take-off) when the loadout cannot take off. Plus the E2E above as the end-to-end guard
- [x] Run lint + unit + regression — green (lint 0 errors, 1030 unit tests, 14 regression tests)

### Task 3: F3 — Game speed (x1/x2/x4) persists across turns and re-entry
**Files:**
- Modify: `src/presentation/flight/FlightHud.ts`, `src/systems/ShipPhysics.ts`, and a durable store (`SpaceFlightScene`/GameEngine/flight-context)
- Modify: `src/tests/` (FlightHud + persistence tests)

- [ ] Diagnose the exact reset trigger at runtime (turn end vs. re-entry vs. HUD rebuild) — log `timeScale`/`speedIndex` across a turn and a land/take-off cycle
- [ ] Write the RED test reproducing the reset (set x4 → trigger the identified event → assert speed is still x4). Confirm it FAILS
- [ ] Fix: persist the chosen multiplier durably and re-apply to `ShipPhysics.timeScale` + the FlightHud label/`speedIndex` on `SpaceFlightScene.initialize`
- [ ] Verify; run lint + unit + regression — green

### Task 4: F1 — Pause finishes the current day, then stops
**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`, `src/systems/ShipPhysics.ts`, `src/presentation/flight/FlightHud.ts`
- Modify: `src/tests/` (turn/day + pause tests)

- [ ] Write the RED test: start a turn mid-day, press Pause; assert the ship continues to the day-segment boundary, the day counter lands on a whole day, THEN `isTurnRunning` becomes false (not an immediate mid-day halt). Confirm it FAILS against the current immediate-stop
- [ ] Fix: on Pause, stop accepting new movement but let the in-progress day-tick run to its segment boundary, then halt and end the turn. Preserve a low-HP emergency hard-stop path if one exists
- [ ] Update any sprint-3 immediate-pause test to the new contract (document the reversal in the test)
- [ ] Re-run letsplay; confirm pressing Pause mid-day reads naturally (ship completes its day)
- [ ] Run lint + unit + regression — green

### Task 5: F5 — Planet backdrop is a light parallax, not a magnifying lens
**Files:**
- Modify: `src/presentation/PlanetScene.ts` (and/or `PanoramaViewer.ts`)
- Modify: `src/tests/` (PlanetScene test)

- [ ] Capture the current distorted backdrop via letsplay (`lp-10-planet-scene.png`) as the "before"
- [ ] Fix: make the Task 6 flat-sprite light parallax (`panoramaSprite` + `clampPanoramaX`, gentle mouse-X drift) the primary backdrop; drop the heavy `PanoramaViewer` projection (or, if kept as fallback, lower FOV drastically so there is no fish-eye)
- [ ] Unit test: PlanetScene mounts the flat-sprite parallax path as primary; clean destroy (`gameLayer.children.length === 0`, filters disposed)
- [ ] Re-run letsplay; INSPECT `lp-10-planet-scene.png` — backdrop reads as a subtle parallax, edges undistorted; compare to "before"
- [ ] Run lint + unit + regression — green

### Task 6: F2 — Route curve is sane (diagnose first, then fix)
**Files:**
- Modify: `src/utils/flightGeometry.ts` and/or `src/presentation/flight/RouteRenderer.ts` per diagnosis
- Modify: `src/tests/` (route geometry/renderer tests)

- [ ] Diagnose at runtime FIRST: plan several routes (near-but-not-through the sun, and clear of it), screenshot each, and log the path points. Determine whether the "strange curve" is an over-wide 1.15R bow on grazing routes, a `dashedPolyline` artifact, or routes curving when they should be straight. Record the finding in the playtest doc
- [ ] Write the RED test capturing the specific defect found (e.g. a route whose straight segment clears the ring must stay straight; or a grazing route's max deviation must be within an expected bound)
- [ ] Fix per diagnosis (tighten the arc trigger / clearance, or correct the renderer) — keep the sun-clearance guarantee from playtest2 intact (do not reintroduce fly-through)
- [ ] Re-run letsplay; INSPECT the route screenshots — straight where expected, a clean (not exaggerated) arc only when actually rounding the sun
- [ ] Run lint + unit + regression — green

### Task 7: Verify acceptance criteria
**Files:** none

- [ ] `npm run lint` — 0 errors
- [ ] `npm test -- --run` — all unit tests pass
- [ ] `NO_PROXY=localhost,127.0.0.1 npm run test:e2e:regression` — green, < 60 s
- [ ] `NO_PROXY=localhost,127.0.0.1 npx playwright test e2e/letsplay-discovery.spec.ts --project=letsplay` — all steps ok, 0 JS errors
- [ ] Inspect regenerated screenshots for F2 (route), F5 (planet backdrop); confirm F1/F3/F4/F6 via their tests
- [ ] Append a "Playtest 3 — fixed" status table to `docs/playtests/20260610-playtest3-live-findings.md` mapping each finding to its verifying test/screenshot

## Post-Completion
**Manual verification:**
- Real-mouse session: press Pause mid-day (ship finishes the day), set x4 and confirm it sticks across a turn and a land/take-off, buy gear then take off (parks beside the planet), open the quest journal and click empty area (no route), look around the planet backdrop (light parallax), plan routes near the sun (sane curve)
- If route/backdrop changes shift visual baselines, regenerate `space-flight.spec.ts` snapshots intentionally (`--update-snapshots`) and review diffs
