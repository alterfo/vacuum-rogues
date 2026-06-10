# Playtest 3 — Live Findings (2026-06-10, during playtest2 ralphex run)

User played a build carrying playtest2 Tasks 1–3 (NPC dwell fix, sun-route
integrity, minimap anchor). Five new findings. Two are likely **regressions**
from this session's own work; one contradicts a prior agreement. Code untouched
while ralphex holds the flight files (file-conflict rule).

## Findings

### F1 — Pause should finish the current day, then stop (DECIDED 2026-06-10)
"пауза не ждёт конца дня". **Decision (user): pressing Pause completes the
current day segment — the ship finishes travelling its day — then stops; it
must NOT cut the day off mid-segment.** This deliberately reverses the sprint-3
"immediate stop" behaviour. Fix direction: on Pause, stop accepting new
movement but let the in-progress day-tick run to its segment boundary
(`waitDayAccum`/day-advance in SpaceFlightScene + ShipPhysics), then halt and
end the turn. Keep an emergency hard-stop only if one is needed for low-HP
auto-stop. Regression test: press Pause mid-day → ship continues to the day
boundary, day counter lands on a whole day, then `isTurnRunning` goes false.

### F2 — Route builds along a strange curve (REGRESSION CANDIDATE — playtest2 Task 2)
"маршрут строится по какой-то кривой слишком странной". `avoidStarPath`
(`src/utils/flightGeometry.ts`) early-outs to a straight path when the segment
does NOT clip the star, so non-sun routes should stay straight. Suspects, need
runtime screenshot of the offending route: (a) the 1.15R tangent-arc bows much
wider than the user expects when a route only grazes the exclusion ring;
(b) `dashedPolyline` now renders the whole route as one continuous curve,
making the spline shape visible where before it was hidden. Confirm with a
real route screenshot (the letsplay 06b sun-crossing arc verified clean, so
this is about *near-but-not-through* routes).

**Diagnosis + fix (2026-06-10, playtest3 Task 6).** Numerically logged
`avoidStarPath` over six route types (star at origin, exclusion ring `R = 390`,
visual sun `170`). Findings: routes clear of the ring stay straight (0 bow) and
clearance is always held — so it is NOT a "straight routes curving" bug nor a
`dashedPolyline` artifact. The culprit is suspect (a), the **over-wide arc
clearance**: the bypass rode `1.15R = 448px`, i.e. *15% PAST the exclusion
ring*. Because the ring (390) is already 2.3× the visual sun (170), this had two
visible effects — (1) a **boundary discontinuity/inversion**: a route grazing
the ring at 389px (just inside) bowed out to 448px — **58px FARTHER from the
star than the straight line it replaced** — while a route at 391px (just
outside) stayed dead-straight, so crossing the ring by 2px snapped the line from
straight to a wide bow; (2) routes whose straight shot visually cleared the sun
and its bright glow (closest ~300px) still bowed conspicuously to 448px, reading
as a curve around empty space. **Fix:** ride the ring — `arcR = R * 1.01`
(a hair of margin so the Catmull samples stay outside `R` and the numerical
safety net stays a true fallback). The boundary bow collapses from 59px → 5px,
the path closest-to-star holds at 394px (≥ R, clearance guarantee intact, no
fly-through), and through-the-sun routes still produce a clean arc. Regression:
`src/tests/flightCurves.test.ts` ("rides just outside the ring…", "does not snap
from straight to a wide bow at the ring boundary"). Verified visually in the
regenerated `lp-06b-sun-route.png` (arc hugs the ring) and `lp-07-route.png`.

### F3 — Game speed resets x4 → x1 (REGRESSION CANDIDATE)
"постоянно сбрасывается скорость (x4 → x1)". `FlightHud.cycleGameSpeed` tracks
`speedIndex` and calls `onSpeedCycle(scale)` → `shipPhysics.setTimeScale`.
`ShipPhysics.timeScale` defaults to 1.0. Likely cause: every scene re-init
builds a fresh ShipPhysics (timeScale=1) and a fresh FlightHud (speedIndex=0),
so any re-entry / turn boundary that re-inits the flight scene drops the chosen
speed. Fix direction: persist the chosen game-speed in a durable place
(GameEngine/player/flight-context) and re-apply on `SpaceFlightScene.initialize`.
Confirm the exact reset trigger at runtime (turn end vs. re-entry).

### F4 — Re-entry to system edge after installing equipment (REGRESSION)
"после установки снаряжения корабль сбрасывается на край системы".
`EquipmentShopScene` returns to `PLANET` (`EquipmentShopScene.ts:685`), then
take-off PLANET → SPACE_FLIGHT. `applyReentrySpawn` parks beside a marker only
when given `fromStationId`/`fromPlanetId` or a one-shot `player.landedPlanetId`.
The shop round-trip likely consumes/loses `landedPlanetId`, so take-off has no
marker → system-edge spawn (re-entry convention, CLAUDE.md). Fix: PLANET
take-off must always pass `fromPlanetId` for the current planet, independent of
the one-shot field.

### F5 — Planet background distorts like a magnifying glass (REGRESSION vs. agreement)
"фон планеты искажается черезчур как лупой, мы договаривались о лёгком
параллаксе". PlanetScene uses **`PanoramaViewer` (Task 8) as primary** — a GLSL
perspective projection at `DEFAULT_FOV_DEGREES = 100` (`tan(uFovX*0.5)`), which
fisheyes the equirect map hard at the edges. The user agreed on the **Task 6
light flat-sprite parallax** (`panoramaSprite` + `clampPanoramaX`, gentle
horizontal drift on mouse X). Fix: make the light flat-sprite parallax primary
(or drastically lower the FOV / drop the projection filter) so the planet
backdrop reads as a subtle parallax, not a lens.

### F6 — Clicking inside the quest window builds a route (CLEAR BUG — Rule 2)
"при клике в окне квеста идёт клик на построение маршрута". QuestJournalUI's
backdrop is `eventMode="static"` (`QuestJournalUI.ts:46`, comment "Block clicks
behind") but has NO `pointerdown` handler — static makes it a hit target but
does NOT stop bubbling, so the click bubbles up to the stage route-planning
handler (CLAUDE.md Rule 2). Buttons inside (lines 233, 318) correctly
stopPropagation; the backdrop does not. Fix: add a `pointerdown` handler on the
backdrop that calls `event.stopPropagation()` (swallow clicks on empty journal
area). Same audit for other full-screen modal overlays.

## Sequencing
These are NOT in the active playtest2 plan (Tasks 4–6: glow, planet click
verification, final gates). Compile a "playtest3" regression-first plan and run
it AFTER playtest2 finishes — same files (SpaceFlightScene, ShipPhysics,
PlanetScene), so no concurrent ralphex.
