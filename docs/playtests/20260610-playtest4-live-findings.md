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

## Playtest 4 — fixed (2026-06-10)

| Finding | Fix | Regression guard |
|---------|-----|------------------|
| A — font size flings ship to edge | Font button fires `FlightHud.onFontScaleChange` callback (no direct `transitionTo`); scene captures `shipX/shipY` and re-inits with `preserveShipPos`, honored ahead of `applyReentrySpawn` in `applyEntrySpawn(ctx)`; persisted game speed re-applied via `FlightHud.restoreGameSpeed()` | `playtest-regression.spec.ts` #15 (REAL-mouse gear→S, ship stays put); `flightHud.test.ts`, `spaceFlightSpawn.test.ts` |
| B — per-day route tick crosses | Removed the day-tick draw loop + `distancePerDay` param from `RouteRenderer.drawRoute`; deleted the dead `dayTickMarks` util and its test; only the cyan dashed line remains | `routeRenderer.test.ts` (no yellow `0xffee66` stroke); visual: `lp-07-route.png`, `lp-06b-sun-route.png` (clean dashes, no crosses) |
| C — approach/attack course must lead a moving target | New tested `src/utils/intercept.ts#solveInterceptPoint` (time-to-intercept quadratic, falls back to current pos when no real-positive solution); wired into NPC "Приблизиться", orbiting-planet re-chase, and the attack-follow chase; sun-clearance bypass kept on the result | `intercept.test.ts`, `npcShipManager.test.ts` (chase leads ahead of heading), `planetSpriteVelocity.test.ts` |

**Acceptance (all green):** `npm run lint` 0 errors · `npm test -- --run` 1038 passed · `npm run test:e2e:regression` 16 passed · letsplay 21/21 steps, 0 JS errors.
