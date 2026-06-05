# US-070: Space-flight playability — rules sweep (bug fixes)

> Cross-cutting story. Canon: SOURCE-OF-TRUTH §3 (in-system flight), §6 (NPCs),
> §11 (planet services). Related to CLAUDE.md → PixiJS Event Handling Rules 1–8,
> and to [[US-024]] (modal clicks), [[US-041]] (route on radar), [[US-046]]
> (sun/planets), [[US-047]] (route around the star), [[US-061]] (take-off).

## User Story
**As** a player in flight mode (`SpaceFlightScene`)
**I want** predictable controls, tidy modals, and honest navigation
**So that** flying around the system is playable and doesn't break on details

## Context
A sweep of defects and new requirements collected from a review of flight mode.
Some are fixed in this iteration (`Done`); others need a live run or a separate
feature (`Planned`). Statuses reflect the **actual state of the code**.

## Item summary

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Sun/planet sprites are distinct; background is crisp and "mesmerizing" | Planned (needs live run) |
| 2 | Dragging on the minimap pans the main view (does not plan a route) | Done |
| 3 | After a warp the ship does not spawn on the sun | Done |
| 4 | NPC ships are visible at any zoom level | Done |
| 5 | Panning with the wheel/middle button does not zoom | Done |
| 6 | Route bows around the sun (outside the corona) | Done |
| 7 | Route shows per-day division marks | Done |
| 8 | Take-off spawns the ship next to the planet, not at the map edge | Done |
| 9 | The player ship has a sprite (not just a triangle) | Planned |
| 10 | No rectangular artifacts on zoom (BlurFilter) | Planned (needs live run) |
| 11 | Route end-point marker is compact | Done |
| 12 | Uninhabited planets show only "Взлёт" (+ "leave a drone" later) | Done |
| 13 | "Атаковать" routes to the ship (with auto-follow) | Done |
| 14 | Play/Pause turn, auto-attack/auto-follow, auto-stop at HP<30% | Partial |
| 15 | The panel close affordance does not overflow the frame | Done |
| 16 | Связаться/Торговать/Атаковать buttons give a visible effect | Done |
| 17 | Any pop-up panel behaves like a modal | Done |

## New rules (generalized, for future code)

1. **Pop-up panels are modal.** Any pop-up panel in `SpaceFlightScene` behaves
   like a modal: clicks inside are handled by it (`eventMode='static'` +
   `stopPropagation`), and a click outside **closes** it and is **not** allowed
   to fall through to the global `onPointerDown` (no route is planned). Done by
   having the global handler check `isBlockingModalOpen()` first and swallow the
   click while a modal is open. Extends [[US-024]] and CLAUDE.md Rule 1–2.
2. **Closing a modal.** A corner "✕" plus close-on-outside-click is enough.
   Full-width "close" buttons inside the frame are forbidden (they overflow).
3. **Action buttons never stay silent.** An action button always gives a visible
   response (toast / transition / route), not just a log line.
4. **Ship always spawns clear of the star.** No system-entry path (warp,
   take-off, transition) may place the ship within `STAR_AVOID_RADIUS` of the
   centre. Take-off spawns the ship next to its planet (`fromPlanetId`).
5. **Star-avoidance radius > visible corona.** Keep `STAR_AVOID_RADIUS` larger
   than the sun's visual size (corona ≈ `STAR_RADIUS*2`); otherwise the route
   clips the glow. See [[US-047]].
6. **Minimap is an interactive radar.** The radar captures the pointer itself
   (drag-to-pan) and does not pass clicks through to the stage. Screen→world
   conversion uses the stored system centre and `mapScale`. See [[US-041]].
7. **Middle mouse button.** Suppress Chrome's auto-scroll
   (`mousedown` + `button===1` → `preventDefault`); otherwise middle-button
   panning emits wheel events and zooms.
8. **Turn safety by HP.** When hull HP < 30% during flight, movement stops (with
   a warning) so the player can reach a planet and repair. Latched: the warning
   fires once per descent below the threshold.

## Acceptance Criteria

```gherkin
Scenario: Clicking the minimap pans the view, does not plan a route   # 2
  Given I am in flight mode
  When I press the left button on the minimap and drag
  Then the main view moves to the corresponding world point
  And no route is planned

Scenario: After a hyperjump the ship is not on the sun                # 3
  Given I jump into a system
  When the scene has loaded
  Then the ship is farther than STAR_AVOID_RADIUS from the star centre
  And it flies toward the system boundary

Scenario: Middle-button panning does not zoom                         # 5
  Given I hold the middle mouse button and move the map
  Then the view pans
  And the zoom does NOT change

Scenario: Route bows around the star                                  # 6,47
  Given the straight path to the target passes through the sun's corona
  When I plan a route
  Then the route bows around the star, outside the visible corona

Scenario: Route shows per-day marks                                   # 7
  Given a route several days of travel long is planned
  Then the route line has perpendicular ticks every DISTANCE_PER_DAY

Scenario: Take-off spawns the ship next to the planet                 # 8
  Given I press "Взлёт" on a planet
  When flight mode opens
  Then the ship appears next to that planet, not at the map edge

Scenario: Uninhabited planet shows only take-off                      # 12
  Given a planet is not habitable
  When the planet screen is open
  Then only "Взлёт" is available (Garage/Market/Research/Governor hidden)

Scenario: Attack plans a route and follows the target                 # 13
  Given the NPC contact panel is open
  When I press "Атаковать"
  Then the panel closes
  And a route to the ship is planned, and the ship auto-follows until close

Scenario: Auto-stop at low HP                                         # 14
  Given hull HP < 30% during flight
  Then the engines stop and a warning is shown

Scenario: Close affordance in-frame + outside click                   # 15,17
  Given the NPC contact panel is open
  When I click "✕" or outside the panel
  Then the panel closes
  And no route is planned behind the modal

Scenario: Action buttons give feedback                                # 16
  When I press Связаться / Торговать / Атаковать
  Then a visible effect appears (a line / a notification / a route)
```

## Affected files (implemented)
- `src/presentation/SpaceFlightScene.ts` — spawn (#3,#8), star-avoidance (#6),
  route day marks (#7), markers (#11), modals/toast (#16,#17), attack+follow
  (#13), low-HP auto-stop (#14), auto-scroll suppression (#5), drag-to-pan hook
  (#2).
- `src/presentation/SystemMiniMap.ts` — drag-to-pan, click capture (#2).
- `src/presentation/NpcContactPanel.ts` — "✕" instead of a wide button (#15).
- `src/presentation/NpcShipSprite.ts` — NPC visibility (#4).
- `src/presentation/PlanetScene.ts` — uninhabited-planet services (#12),
  `fromPlanetId` on take-off (#8).

## Planned (needs a live run or a separate feature)
- **#1 / #9 / #10 — visual.** Sun/planet/ship sprites and rectangular zoom
  artifacts. Hypotheses: texture-load failure at runtime; `BlurFilter` region
  clipping under layer scale (the rectangles); the player ship has no sprite
  code (it is drawn as a procedural triangle — would need the art's orientation).
  Diagnose on `npm run dev` (screenshots are unreliable — render loop).
- **#14 (remainder) — Play/Pause turn and auto-attack.** A Play button (→ ⏸
  while moving; "pause at end of the day segment") and actual weapons fire /
  tactical combat. Depends on EPIC-002 (combat); `CombatScene` is currently a
  stub. Auto-follow and low-HP auto-stop are already implemented.

## Round 2 — regressions found during play-testing + follow-ups

Fixed after the first round:
- **R1. Canvas overflowed the window; right/bottom HUD hidden** (minimap half
  off, star-map button gone). Cause: HUD placed once at init using
  `screen.width/height`; nothing repositioned on resize. Fix: `handleResize()`
  re-anchors the back button, debug text, toast and minimap, and re-frames the
  ship, on the `window` resize event. (`SpaceFlightScene`, `SystemMiniMap.reposition`)
- **R2. After take-off the ship flew off to the map edge by itself.** Cause:
  the relocation moved the ship position but not the physics *target*, and
  `ShipPhysics.update()` always eases toward the target when far. Fix: added
  `ShipPhysics.teleport()` which also resets the target. (#8 regression)
- **R3. After contacting/attacking one NPC, other ships became unclickable.**
  Cause: the new close-on-outside-click and the working ✕/Attack buttons all
  called `.destroy()` on the panel **synchronously inside the pointer-event
  handler**; destroying the object the PixiJS event boundary is mid-dispatch on
  corrupts hit-testing. Fix: defer panel teardown via `queueMicrotask`, and make
  `NpcContactPanel.destroy()` idempotent. **Needs live verification.**
- **R4. Pan still occasionally zoomed.** Hardened: `onWheel` now ignores wheel
  events while a pan drag is active (in addition to suppressing middle-button
  auto-scroll). (#5)
- **R5. Too few NPCs.** Raised `NPCS_PER_SYSTEM` 1.5 → 4.
- **R6. Route bowing around the star** — raised `STAR_AVOID_RADIUS` 300 → 390
  (outside the corona). (#6)

Tests added (locking in the fixed items):
- `src/tests/flightGeometry.test.ts` — `dayTickMarks` (#7 per-day route marks)
  and `radarToWorld` (#2 minimap drag→world mapping); pure helpers extracted to
  `src/utils/flightGeometry.ts`.
- `src/tests/presentation/PlanetScene.services.test.ts` — `visiblePlanetServices`
  (#12 uninhabited planets show only take-off).
- Updated `npcSimulator.test.ts` counts for the new NPC density.

Still open (need a live run; browser diagnosis was declined this session):
- Background not crisp/contrasty enough; too few stars / "mysterious floating
  things" (#2 visual).
- "Strange streaks/bands over the background" — appear on zoom, sometimes near
  the star, sometimes across the whole canvas. Strong suspicion: `BlurFilter`
  region clipping under camera scale (star corona / nebulae / vignette). Try
  `filter.padding`/`resolution` or reworking those filters.
- Sun looks the same everywhere; planets without sprites/rotation (#1); player
  ship has no sprite (#9). Verify texture loads at runtime first.
- Route should account for planets drifting along their orbit while travelling
  (re-routing exists; wants a smoother/"prettier" path).
- Play/Pause turn button + real auto-attack/combat (#14 remainder).

## Round 3 — stale-cache discovery + more fixes (verified live)

**Root cause of "nothing got fixed":** a dev service worker (cache
`space-rangers-vdev`) was serving stale JS modules, so earlier fixes never
reached the browser. `registerServiceWorker()` now early-returns when
`import.meta.env.DEV`, so dev never caches. (An already-installed SW must be
unregistered once.)

Fixed and verified via `window.__gameEngine` on the live page:
- **Stars stuck during pan/zoom ("dust on glass").** The screen-fixed starfield
  only drifted with ship velocity. `updateStarField` now parallaxes every depth
  layer (and the twinkle "hero" stars) against the camera pan, seamlessly tiled.
- **Route drawn straight through the sun on the first click.** Avoidance was
  only applied on execute. New `planRouteTo()` computes the bowed path at plan
  time, so the preview clears the star. Logic extracted to
  `avoidStarPath()` (`src/utils/flightGeometry.ts`, unit-tested).
- **Bands near the star / across the canvas (#10).** Replaced the corona and the
  vignette `BlurFilter`s with filter-free gradients (concentric rings / stacked
  edge strokes); blurred objects inside the zoomed gameLayer were the source.
- **Wheel-button pan removed** — only right-button (and Shift+Left) pan now; this
  also removes the middle-button auto-scroll/zoom conflict.
- **#9 Player ship sprite** — uses the `ranger` art (verified loaded & visible).
- **Window grow-back** — `handleResize()` now forces `renderer.resize()` first so
  the HUD re-anchors to the new (larger) size, not the old one.
- **NPC contact ✕** — given its own dark backing; long ship names truncated so
  the ✕ stays legible.
- Background density raised (stars, twinkle, swarms, dust); planet contrast ring.

Tests added: `avoidStarPath` cases in `flightGeometry.test.ts` (110 total green).

Still open (features / need design):
- **Warp should start from the ship's actual position** when the star map was
  opened (currently spawns near the sun). Needs plumbing the in-system position
  through StarMapScene → pendingWarp.
- **Attack has no real combat** — closing in works, but no damage/result.
  Belongs with **Play/Pause turn control + auto-attack** (#14) and EPIC-002.
- Background crispness/contrast is subjective — may need further nebula-alpha
  tuning vs. star brightness.

## Round 4 — Play/Pause turn, auto-attack combat, warp-from-position

- **Ship sprite flipped** — `SHIP_SPRITE_ROTATION` is now `-π/2` (the ranger art
  faces "down"); verified live the sprite rotation is `-1.57`.
- **Warp starts from the ship's actual position (#1).** `returnToStarMap()`
  stashes the ship's world position on `GameEngine.lastFlightShipPos`; the
  pending-warp spawn uses it (falling back to the inner side, never on the sun).
- **Play/Pause turn control (#14).** New bottom-centre button: "▶ ХОД" runs the
  planned turn; while moving it shows "⏸ ПАУЗА" and ends the turn at the next day
  segment. The world (NPCs, planets, combat) is gated on `isTurnRunning`, so it
  freezes when paused and resumes on Play.
- **Auto-follow + auto-attack combat.** `updateCombat()`: with a target set the
  ship closes to `WEAPON_RANGE`, holds station and exchanges fire (shields then
  hull). Verified live: target 55→0 hull, +200 cr loot, sprite removed, turn
  ended. Auto-breaks off and ends the turn at <30% hull (both moving and while
  holding station).

Still open / next:
- Tactical (separate-scene) combat in `CombatScene` remains a stub; the in-flight
  combat above is the lightweight version (EPIC-002 for the full system).
- Background crispness/contrast remains a matter of taste — tune if needed.

## Out of Scope
- Combat-system redesign (see EPIC-002).
- Drone mechanic ("leave a drone") — there is no drone-inventory model (TODO).
