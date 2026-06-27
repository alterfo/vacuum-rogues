# Open playtest reports (to fold into a plan AFTER ralphex `bis8fl9zu` completes)

These are live-build reports from 2026-06-27 testing. They touch the flight/camera/combat
code that the running recovery-plan ralphex is editing, so they must wait until it finishes
(no concurrent edits to the same files). Ideally pick these up in a **fresh session** —
context in the originating session had grown very large.

## Camera / control UX (shared root: camera auto-follow is too aggressive)
1. **Ship spins on its own axis + camera circles when attacked at game start.**
   ✅ **CONFIRMED REAL on fresh code (Incognito, 2026-06-27)** — "крутится на паузе". Not the
   stale bundle. The bug-pass-2 pause-freeze (gates `updateShip:1157`, `updateCombatPursuit`)
   does NOT cover it.
   Candidate causes (need LIVE debugging — autopilot/console — to pin):
   - `SpaceFlightScene.update()` calls `playerShip.update(dt, bgElapsed)` and `camera.update()`
     **unconditionally** (NOT behind the `combatPause.paused` gate), and `bgElapsed` keeps
     advancing during pause. (`PlayerShipRenderer.update:92` sets `shipContainer.rotation =
     shipPhysics.shipAngle`; `CameraController.updateFollow` re-centres on the ship.)
   - At a too-close spawn attack, the real-time combat orbit (`steerCombatOrbit`,
     `NpcShipManager:1905`) collapses to tight min-radius loops; the camera follows → "circle".
   Likely fix: freeze `playerShip.update`/`camera.update` (or `bgElapsed`) during the active
   pause; add a min effective orbit radius / anti-degenerate guard; don't spawn an aggressive
   NPC on top of the player at game start (spawn-distance / grace).
   ⚠️ `steerCombatOrbit` lives in `NpcShipManager` (ralphex is editing it) — fix AFTER the run.

2. **Minimap/manual pan unusable while moving — view snaps back to the ship.**
   The camera re-centers on the ship every frame (`camera.update()` / `centerOnShip` in
   `SpaceFlightScene.update`), overriding any manual pan, so the player can't look around via
   the minimap during movement. Real regardless of cache.
   Fix: let manual pan / minimap-look temporarily suspend the auto-follow (re-engage on a
   key/after idle), like the combat break-off pattern.

## InfoCenter shows unexplored systems (design refinement)
4. **InfoCenter still lists systems the player hasn't scouted.** The earlier
   `infocenter-margin-known-systems-only` work masked the **margin number** for routes touching
   unknown systems (`isSystemKnown` in `rumorPanel.ts`) but still **renders the route/system
   text**. The player now wants unexplored systems **hidden entirely** from the rumor/news feed
   (not just margin-masked). Fix: filter out rumors/news whose endpoints aren't
   `isSystemKnown(player, galaxy, id)`, with a "no intel yet" empty-state — presentation-only,
   no schema/save change. (Confirm it's not just the stale bundle first.)

## Faction relations
6. **Pirates and Dominators (Overmind/Доминаторы) appear friendly — they should be hostile.**
   The faction-hostility matrix (`isHostile` / faction-hostility seam, the single source of truth
   referenced in `NpcShipManager` combat) treats pirates and the Overmind as non-hostile to each
   other, so they don't fight and effectively act allied. Canon (original Space Rangers): the
   Dominators are hostile to *everyone*, pirates included. Fix: make pirate↔Overmind mutually
   hostile in the hostility matrix so they engage each other (and so the player sees them fight,
   not co-exist). Pure rules change — verify it doesn't break the player-facing hostility gates
   (good-pirate-rep peace, overmind landing denial). Confirm on FRESH code first.

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
