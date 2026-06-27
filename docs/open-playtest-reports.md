# Open playtest reports (2026-06-27)

Live-build reports from 2026-06-27 testing of the flight/camera/combat code. The
recovery-plan ralphex (`bis8fl9zu`) has since completed (master @ `745f25d`), so
these were picked up in a fresh session.

**Status (2026-06-27): all four addressed — see per-item resolution below.**
Changes are in the working tree (not yet committed); regression tests added for
each code change, full unit + playtest gates green.

## Camera / control UX (shared root: camera auto-follow is too aggressive)
1. **Ship spins on its own axis + camera circles when attacked at game start.**
   ✅ **FIXED.** Root cause: at a too-close (spawn) attack the combat strafe orbit
   (`steerCombatOrbit`, `NpcShipManager`) collapsed to tight, fast revolutions —
   the ship wound round and round in place and the auto-follow camera circled with
   it (a target nearly on top → unstable, radial-degenerate steering).
   - **Anti-spin orbit guard:** well inside the orbit radius the tangential
     (circling) steering component now fades out (`COMBAT_ORBIT_MIN_RANGE`), so the
     ship backs **straight out** to range instead of spiralling; plus an exact
     near-overlap fallback (steer along current facing) so the direction never
     collapses to zero. The steady orbit at `COMBAT_ORBIT_RANGE` is unchanged.
     Regression: `src/tests/flight/combatOrbitAntiSpin.test.ts`.
   - **Pause-freeze:** `SpaceFlightScene.update` now gates the player-ship sprite
     sync **and** `camera.update()` on `combatPause.paused`, so the view is
     rock-steady under the active-pause overlay (no residual ease/FX motion).
   - **Spawn grace** (3rd report suggestion) deliberately NOT done: the starting
     system is safe (no garrison/Overmind aggro at game start) and the orbit guard
     neutralises a close engagement *wherever* it happens; a spawn-position change
     carries high blast radius into deterministic placement + save round-trip for
     no added benefit here.

2. **Minimap/manual pan unusable while moving — view snaps back to the ship.**
   ✅ **FIXED.** `CameraController.focusOnWorld` (the radar drag-to-pan) did not
   suspend the motion-follow the way a manual `pan()` does, so it re-centred on the
   ship every frame while moving. It now sets `followSuspended = true` like a
   manual pan — the minimap-look survives until the next fresh flight leg or an
   explicit ⊙ return-to-ship. Regression: `src/tests/presentation/cameraFreeLook.test.ts`.

## InfoCenter shows unexplored systems (design refinement)
4. **InfoCenter still lists systems the player hasn't scouted.** ✅ **FIXED.**
   The prior `infocenter-margin-known-systems-only` work only *masked the margin
   number*; unexplored systems are now **hidden entirely** from the feed.
   - `buildRumorPanel(..., hideUnknown=true)` drops a rumor touching an
     undiscovered system (empty-state → new `rumor.panelNoIntel` "scout new
     systems"). The legacy default-`false` masking path is untouched (its locked
     tests stay green).
   - Pure `feedEventVisible(event, galaxy, player)` gates `galaxy.newsFeed` events
     (trade routes need both endpoints known; others need their `systemId` known),
     and the registry-derived rows (pirate/market/trader/patrol) skip unknown
     systems. Presentation-only, no schema/save change.
   - Regression: `src/tests/presentation/infoCenterHideUnknown.test.ts`.

## Faction relations
6. **Pirates and Dominators (Overmind) appear allied — in a captured system they
   attack the player TOGETHER.** ✅ **FIXED.** The hostility *matrix* was already
   correct (pirate↔Overmind mutual enemies, in-flight + off-screen, tested). The
   real bug was the in-flight garrison aggro: `isHostileSystem()` is true for both
   Overmind- and pirate-held systems, and `checkGarrisonAggro` aggroed **any**
   interceptor-class ship (Overmind **or** pirate) in **any** hostile system. So a
   wandering pirate caught in an Overmind-captured system turned on the player
   alongside the Overmind → they looked allied. (The garrison itself is faction-pure
   — an Overmind system spawns only Overmind craft; the pirate was just passing
   through.)
   - **Fix** (`NpcShipManager.checkGarrisonAggro`): faction-MATCH the garrison to
     the system's controller. Overmind craft defend any hostile (captured/besieged)
     system; pirates aggro the player **only in a pirate-controlled system**. A
     pirate in an Overmind system is now an intruder the Overmind fights
     (cross-faction combat already exists), never an ally ganging up on the player.
   - Locked test `garrisonCombat.test.ts` updated (with approval) to assert the new
     behaviour: a stray pirate in an Overmind system is NOT aggroed; a pirate in a
     pirate-held system IS. The cruise-speed/aggro coupling comment in
     `npcCruiseSpeed.ts` was de-coupled accordingly.
   - **Still open (separate, not done):** even when hostile, wandering NPCs don't
     steer *toward* each other, so two enemies can drift past without a visible
     fight unless they're already within weapon range. Active enemy-seeking is a
     larger behavioural change, left for a live-verified follow-up.

## Resolved — was the stale bundle
- **Гравитяга (grav tractor) "doesn't work"** — ✅ **WORKS on fresh code (Incognito, 2026-06-27).**
  Was the stale bundle. No fix needed (recovery plan Task 5–6 still adds proximity pickup on top).

## Confirmed STALE-SW false alarms this session (already fixed in master — do NOT re-fix)
- Warp from sun / wrong warp direction — stale bundle.
- Spurious Victory on game start — fixed (`overmindSpread.ts` engaged-gate, `23f374d`); stale bundle.
- NPC circling during pause — fixed (`dfe60e1`, gates + 4 regression tests); stale bundle.
- Root cause of all the above re-appearances: the old broken Service Worker (frozen `'dev'`
  cache) keeps serving pre-fix code until unregistered ONCE. Test in Incognito to bypass.
  (Recorded in memory `browser-debugging-spacerangers`.)
