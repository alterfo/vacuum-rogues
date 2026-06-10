# Playtest 4 — Live Findings (2026-06-10, after playtest3)

Three findings from the user's live playtest of the post-playtest3 build.
Code untouched pending the playtest4 plan (`docs/plans/20260610-playtest4-live-fixes.md`).

## Findings

### A — Changing font size flings the ship to the system edge (ROOT CAUSE FOUND)
"при смене шрифта положение корабля сбрасывается на край системы". This is the
**font-size setting** (S/M/L) in the gear ⚙ panel — NOT equipment (my earlier
playtest-2 reading of "снаряжения" was wrong; the user meant шрифт = font both
times). The font button handler `FlightHud.ts:581-593` does
`setFontScale(key)` then `gameEngine.transitionTo(SPACE_FLIGHT, { gameEngine })`
to re-apply the scale — with NO context, so `applyReentrySpawn()` edge-spawns
the ship. Same full re-init likely also drops the chosen game speed (the
earlier x4→x1 feel). Fix: route through a scene callback and re-init with the
current ship position + persisted speed preserved.

### B — Route per-day tick marks look like annoying crosses (ROOT CAUSE FOUND)
"по ходу маршрута рисуется какой-то крестик, раздражает". `RouteRenderer`
(`RouteRenderer.ts:74-82`) draws a yellow perpendicular dash every
`distancePerDay` px (trip-length-in-days indicator, like the original game);
crossing the cyan route line they read as little crosses. **User decision:
remove entirely.**

### C — Approach/attack course must lead a moving target
"курс на сближение и атаку должен учитывать движение корабля/планеты". The
course aims at the target's CURRENT position; NPC ships drift and planets orbit,
so by arrival the target has moved. `ShipPhysics.getMaxSpeed()` already exists
"to solve intercept lead". Fix: predicted intercept point (time-to-intercept
quadratic) against the target's velocity, for both the attack-follow chase and
a course set to a moving NPC/planet; keep the sun-clearance bypass.

## Sequencing
All three folded into `docs/plans/20260610-playtest4-live-fixes.md` (B's
remove-entirely decision locked in). Run via ralphex regression-first with
letsplay gates after this build — same flight files, so no concurrent run.
