# Flight Module — Historical Bugs & Detailed Conventions

Reference file. Not auto-loaded — read this when touching re-entry spawn, NPC behavior,
route rendering, sun clearance, pause logic, or font-scale flows. The slim `CLAUDE.md`
in this directory points here.

## Flight Module Architecture (detail)

Completed `20260609-refactor-spaceflight-solid`: SpaceFlightScene decomposed from ~5200-line god-class into ~1800-line Controller + focused modules in `src/presentation/flight/`.

- **`FlightModule` contract** (`flight/FlightModule.ts`): `initialize()` / `update(dt, bgElapsed)` / `destroy()`. Eight classes implement it (SpaceBackgroundLayer, StarRenderer, AsteroidBelt, OrbitRenderer, PlayerShipRenderer, NpcShipManager, PlanetManager, FlightHud). Four helpers are NOT FlightModules: RouteRenderer, WarpEffectRenderer, CameraController, QuestCompletion.
- A module **never imports another module** — the scene mediates via callbacks (`onPlanetLanding`, `onStationDock`, `onPlayPause`, …) and dependency-accessor bundles (`NpcShipManagerDeps`, `PlanetManagerDeps`, `CameraControllerDeps`).
- Each module's `destroy()` must leave `gameLayer.children.length === 0`; a `SpaceFlightScene.ts` line-count guard (`< 1900`) lives alongside the leak check in `src/tests/flight/moduleContracts.test.ts`. Keep new flight logic in modules, not the scene.
- Modules that mount filtered DisplayObjects must dispose their `BlurFilter`s in `destroy()` — `Container.destroy({children})` does not release filter GPU textures.
- Cursor ownership lives in the sprite-owning module (`PlanetManager.setCursors` / `NpcShipManager.setCursors`); the scene's `updateInteractiveCursors` only routes turn state (Information Expert).

## Re-entry Spawn Convention

Sprint 3 Task 9; updated playtest4 A: pass `fromStationId`/`fromPlanetId` in the context so the ship parks beside the marker instead of at the system edge. `Player.landedPlanetId` is the fallback for context-less re-entry (see Rule 9). Entry decision lives in `SpaceFlightScene.applyEntrySpawn(ctx)` with precedence `preserveShipPos` → `fromPlanetId` take-off arc → `applyReentrySpawn(fromStationId)`.

## Flight Traps (reintroduction-prone)

**Playtest2:**
- **NPC ships spawn `PATROLLING`, never `IDLE`** (`NpcSimulator`). An `IDLE` ship departs on the next day-tick → mass exodus on day 1; `beginDeparture()` then sets `eventMode='none'` on every sprite → system goes mouse-dead. Dwell states leave at `DEPART_CHANCE` (~15%/day). Guarded by `src/tests/npcSimulator.test.ts`.
- **Apply the last camera zoom to freshly-spawned NPC hit areas** (`NpcShipManager`). The 40-world-px hit circle is only ~10 screen px at `MIN_ZOOM`; the manager sizes new sprites to `lastCameraZoom` at spawn. Guarded by `src/tests/presentation/npcShipManager.test.ts`.
- **Dash a route as ONE continuous walk, not per-segment** (`dashedPolyline` in `src/utils/flightGeometry.ts`). Per-segment dashing produces ZERO dashes for sub-period segments — the sun-bypass spline's ~10px segments left the whole arc invisible. `dashedPolyline` carries the dash phase across vertices. Guarded by `src/tests/flight/routeRendererDashes.test.ts`.
- **Clamp navigation destinations outside the sun's exclusion ring** (`clampOutsideRadius` / `avoidStarPath` in `flightGeometry.ts`). Guarded by `src/tests/routeSunClearance.test.ts`.

**Playtest3:**
- **Pause finishes the current day, then stops** — deliberately REVERSES Sprint-3 "immediate pause" (2026-06-10 user decision). `onPlayPause()` latches `pauseAtDayBoundary = true`; the day boundary in `updateShip()` / `advanceWaitTime()` calls `endTurn()` at day completion. Hard-stop exceptions: `<30%` hull emergency auto-stop, and a combat auto-follow. Guarded by `src/tests/pauseFinishesDay.test.ts`.
- **Sun-bypass arc rides JUST outside the exclusion ring (`arcR = R * 1.01`), NOT 15% past it** (`avoidStarPath`). `R` (≈390px) is already ~2.3× the visual sun. Do not widen the arc "for glow clearance". Guarded by `src/tests/flightCurves.test.ts`.
- **Transient cross-scene state that survives `transitionTo` but must NOT persist to disk is a plain `GameEngine` field** (`lastFlightShipPos`, `gameSpeedMultiplier`), not a `SaveState`/`schemas.ts` entry. `gameSpeedMultiplier` is re-applied by `FlightHud.restoreGameSpeed()` on every HUD rebuild.

**Playtest4:**
- **Font-scale change restyles the text-bearing flight modules IN PLACE — NEVER re-inits SPACE_FLIGHT** (playtest4 A + `20260618-font-scale-restyle-and-readable-panels`, DIP). The `⚙` button only persists the size and fires `onFontScaleChange` (the HUD never transitions the scene itself). The scene's `onFontScaleChanged()` calls `hud/planetManager/npcManager.refreshFontScale()`, which destroy+recreate (or re-style) only their text nodes — they read `scaledFont` at creation, so a cheap text rebuild picks up the new size. World geometry (planets, ships, asteroids, NPCs, nebula backdrop) **and the ship position** are left untouched, so no `lastFlightShipPos` pin is needed for this path. **Do NOT re-add the old `transitionTo(SPACE_FLIGHT)` + `lastFlightShipPos` pin "to re-apply the scale"** — that was the slow full-redraw (and one-frame ship jump) this replaced. A flight module owning persistent `scaledFont` text must expose `refreshFontScale()` (restyles only its text, never its world sprites); the scene fans the change out to each. Transient overlays/tooltips/toasts that are rebuilt on open need no hook — they re-read `scaledFont` on their next open. Guarded by `src/tests/flight/fontScaleRestyle.test.ts`, `src/tests/presentation/fontScaleShipPos.test.ts`, `src/tests/presentation/flightHud.test.ts`, `src/tests/presentation/spaceFlightSpawn.test.ts`, and real-mouse `playtest-regression.spec.ts` (test 17). (`preserveShipPos` still guards the *other* re-entry paths — docking/landing/star-map — so that mechanism stays.)
- **The route overlay draws ONLY the cyan dashed line — no per-day "tick" cross marks** (playtest4 B, user decision). `RouteRenderer.drawRoute(path)` is single-arg. Do not reintroduce per-day route divisions. Guarded by `src/tests/presentation/routeRenderer.test.ts`.
- **The pulsing heading crosshair is hidden during auto-route flight** (`PlayerShipRenderer.updateTargetIndicator` gates `targetIndicator.visible` on `!shipPhysics.isFollowingRoute()`). `isFollowingRoute()` differs from `hasPath()`: it is set by `setPath` and stays true through the final leg until arrival/`stop`/`setTarget`/`teleport`, so the whole route counts as "on a route" — the dashed line + destination marker already show the destination, making the crosshair redundant. Guarded by `src/tests/flight/routeCrosshair.test.ts`.
- **Lead a moving target through the single solver `src/utils/intercept.ts#solveInterceptPoint`** (playtest4 C) — ONLY intercept solver (no dup). **Units trap:** solver wants px/ms; `PlanetSprite.orbitalVelocityPerDay()` returns px/**game-day**, so `planetLeadPoint` converts via `vel · getMaxSpeed() / GAME_BALANCE.pixelsPerDay`. Guarded by `src/tests/intercept.test.ts`, `src/tests/presentation/npcShipManager.test.ts`, `src/tests/presentation/planetManager.test.ts`, `src/tests/presentation/planetSpriteVelocity.test.ts`.

## Ship Movement Model — Momentum / Arc-Only (no rotate-in-place)

Completed `20260625-arc-movement-and-combat-fixes` (Task 1). `ShipPhysics.update`
(`src/systems/ShipPhysics.ts`) is a **momentum / arc** model — the ship **always cruises
forward** along `shipAngle` and steers toward the target by **turning at a bounded rate**;
it does **NOT** slow or stop because the target is off-axis. A target behind is reached by
**looping around**, never by pivoting on the spot.

- **Speed is updated FIRST, heading only changes while moving** (`currentSpeed > 0`), so a
  parked ship never spins in place. Accelerate to `maxSpeed` while far / on intermediate
  legs; **only the final leg** (`path.length === 0`) decelerates to a stop within
  `stoppingDistance` — the "last mile" eases over ≈a day. Intermediate waypoints are flown
  **through** at speed (switched at `WAYPOINT_SWITCH`).
- **Heading turns at `rotationSpeed*dt` max per frame** toward `atan2(dy,dx)`; forward
  travel is `currentSpeed*dt`, so the path curves with a **minimum turn radius of
  `currentSpeed / rotationSpeed` (≈19px at cruise)** — an arc, never a pivot.
- **Do NOT reintroduce the old alignment-gated speed logic** (the deleted model dropped
  `currentSpeed` toward 0 when `|angleDiff| ≥ π/3` and scaled position by
  `cos(angleDiff)`, so an off-axis target made the ship stop and pivot). That read as
  twitchy/unnatural and is exactly what this replaced.
- **Off-axis arrival cap (anti-orbit soft-lock) — keep it.** The cruise turn radius (≈19px)
  is larger than `STOP_THRESHOLD` (8px), so a **close, off-axis** final destination sits
  inside the turn circle and would be **orbited forever** — `isMoving` never clears, the
  route-turn never completes (a soft-lock that stalls the calendar/combat/NPC AI gated on it).
  On the final leg, when the heading error to the target exceeds `ARC_CAP_HEADING` (≈30°),
  speed is capped to `rotationSpeed*distance*ARC_CAPTURE` (0.8) so `turnRadius ≤ 0.8·distance`
  and the ship spirals in. The cap is **gated on the heading error** so an aligned straight-in
  approach is left at full speed (precise arrival unchanged — do not drop the gate, or the
  `maxSpeed:1.0` waypoint test that lands exactly on target regresses). Guarded by the
  shipPhysics "close, off-axis destination is reached — never orbited forever" regression.
- Preserved: final-leg deceleration (stop AT the destination), waypoint fly-through,
  sun-avoidance pathing, straight-line travel timing. Pure-physics change — no domain /
  schema / save impact. Guarded by `src/tests/shipPhysics.test.ts` (off-axis/behind target
  keeps speed > 0 with turn-rate-bounded heading changes; min turn radius bounded; final
  approach still stops; straight-line timing unchanged).

## NPC Clickability Invariant (`assertClickable`)

Completed `20260625-arc-movement-and-combat-fixes` (Task 2). The "NPC ships stop responding
to clicks mid-fight" report had two root causes in `NpcShipSprite`: a non-finite/≤0
`cameraZoom` made `Math.max(28, 40/NaN) → NaN` (a hit circle that `Circle.contains` always
rejects — permanently mouse-dead), and `updateHitArea`/`restoreInteractivity` never
re-asserted `eventMode="static"` on a live ship, so a combat/cursor clobber was never healed.

- **`assertClickable()` is the single clickability invariant for a live ship**
  (not departing/gone): it re-asserts `eventMode="static"` **and** a finite circular
  `hitArea` of `Math.max(MIN_HIT_RADIUS_PX, HIT_RADIUS_PX / lastHitZoom)`
  (`MIN_HIT_RADIUS_PX = 28`, `HIT_RADIUS_PX = 40` world px). **Both** `setClickHandler`,
  `updateHitArea`, and `restoreInteractivity` route through it — do not re-set `eventMode`
  / `hitArea` inline at a call site.
- **The finite-zoom guard never collapses the circle:** `updateHitArea(cameraZoom)` only
  overwrites `lastHitZoom` when the zoom is **finite and positive**; a transient NaN/0
  transform is ignored and the last good zoom is kept, so the hit-area can never shrink to
  "never hits". `lastHitZoom` seeds to 1.
- The radius floor (28 world px) keeps the ship clickable at high zoom; re-asserting
  `eventMode` on every camera transform / turn-end heals any combat or cursor-switch
  clobber. Per the repo rule, hit geometry is verified by a **real-pointer E2E**
  (`rootBoundary.hitTest` over an engaged aggressor at three zoom levels returns the NPC
  container — `playtest-regression.spec.ts`), not just unit assertions; the unit invariants
  live in `src/tests/presentation/npcShipClickable.test.ts` (two proven red-on-legacy).

## NPC Purposeful Behavior Conventions

Completed `20260612-npc-purposeful-behavior`:
- **`pickNpcDestination` in `npcBehavior.ts` is the ONLY source of NPC waypoints** — never add `Math.random()` ring-point logic back to `NpcShipSprite.pickNewTarget()`. Pure and deterministic (same role + shipId + seq → same point). Guarded by `src/tests/presentation/npcBehavior.test.ts`.
- **Destination injected via `sprite.setTargetProvider(fn)` (dependency inversion)** — the sprite never imports `NpcShipManager` or `npcBehavior.ts`. `setTargetProvider()` immediately calls `pickNewTarget()` so the very first waypoint is purposeful. Do NOT add a `pickNewTarget()` call to the sprite constructor.
- **Re-anchor on every planet arrival via `sprite.setArrivalCallback(fn)`** — when the sprite arrives (`dist < 6`), `arrivalCallback` fires and `NpcShipManager` calls `sprite.setAnchor()` + updates `npcAnchorPlanet`. Without this, subsequent visits are fly-throughs (no orbit). Guarded by `src/tests/presentation/npcShipDwell.test.ts`.
- **Bounded dwell: deterministic `dwellDurationMs` (8–20 s game time, seeded by ship id)** so ships desynchronize departures. Dwell does NOT accumulate while departing (`!this.departing` gate).
- **`hashStr` in `src/utils/hashStr.ts` is the single FNV-1a implementation** — do not add copies in NpcShipSprite, NpcShipManager, or npcBehavior.
- **`setAnchor()` orbit params are deterministic per ship id** — `orbitRadius` and `orbitDir` use `hashStr(this.npc.id)`, not `Math.random()`.

## NPC Persistence & Placement Conventions

Completed `20260619-npc-ship-persistence-consistency` (NPC ships keep their spots across scene transitions / save load — no per-entry re-scatter):
- **NPC interior spawn position is persisted, never random** (`NpcShipManager.addNpcSprite`). An interior spawn (`!entry`) reuses `npc.worldX/worldY` if set, else seed-derives one via `deterministicNpcOffset(galaxyId, npcId)` and persists it with `setWorldPosition` — **never `Math.random()`** (random placement re-scattered every ship on each re-entry and on a star-map round-trip). Do NOT reintroduce random angle/radius placement here. Guarded by `src/tests/npc/deterministicPlacement.test.ts`.
- **`destroy()` flushes live positions back via `persistLivePositions()`** — it mirrors each live sprite offset into its domain ship so the scene-transition autosave (which fires after `destroy()`) captures where ships actually are. This is a **load-bearing side effect**: do not fast-path or reorder the manager's teardown past it. **Known gap:** in-flight saves that fire *before* teardown (hyperjump autosave in `SpaceFlightScene.doHyperjump`, emergency autosave in `GameEngine.handleCriticalError`) bypass the flush and persist start-of-session positions; call `persistLivePositions()` before those saves if you wire it. Guarded by `src/tests/npc/trackedMovement.test.ts` (write-back + re-entry respawn).
- **Boundary entries (`entry=true`, just hyperjumped in) are NOT persisted at spawn** — they fly inward from the system edge, and the next fresh entry re-derives an interior spot. Note the teardown write-back above still captures wherever a boundary ship has settled if the player lingers.
- **The simulation owns subsequent movement, not the sprite** (`NpcSimulator.advanceTrackedPositions`): a deterministic orbit step per tick (radius-preserving, no main-RNG). For the *active* system the live sprite drift is what gets persisted (write-back wins); for off-screen systems the tracked orbit is the sole driver. Don't expect the orbit step to visibly move ships in the system the player is currently flying in.

## Combat Maneuver Conventions

Completed `20260619-space-combat-maneuver-and-engage` (real-time-with-turns in-flight combat; superseded by `20260623-space-combat-realtime-fix-remove-hex` — the hex `CombatScene` was **deleted**, so all combat (regular NPCs, the OVERMIND-core boss, former text-quest fights) is real-time in-flight):
- **`decideManeuver` in `src/systems/combat/combatManeuver.ts` is the ONLY source of an aggressor's mode + heading** (`CLOSE` → `ORBIT` → `BREAK_OFF`). Pure, no PixiJS. `NpcShipSprite.update()` calls it each frame; never re-add tail-chase (`heading = atan2(dy, dx)`) or orbit math to the sprite. Orbit holds `ORBIT_RANGE_FRACTION` (0.8 × weapon range) so the ship keeps firing while circling; break-off triggers below `BREAK_OFF_HULL_RATIO` (0.3) hull OR when the target is strictly faster **and** still beyond weapon range. Both thresholds are strict (`<` / `>`) — equality keeps fighting. Orbit direction is seeded per ship id (`aggressorOrbitDir`) so foes don't all circle the same way. Guarded by `src/tests/combat/combatManeuver.test.ts`.
- **Escape is range-gated in the fight, speed-gated in the pursuit.** `CombatModule.pruneDisengaged` drops a combatant the player opens beyond `GAME_BALANCE.combatEscapeRange` (1200 px, ≈ scanner range) — that ends the fight. `NpcShipManager` separately clears the sprite's `aggressive` flag only when distance > escape range **and** `ShipPhysics.canOutrun(npcSpeed)` (live `currentSpeed`, so a *parked* player at range is not "fleeing"). These two predicates are intentionally not identical; a wounded `BREAK_OFF` aggressor that opens the gap while the player is slower/parked stays flagged aggressive (it just keeps fleeing). Guarded by `src/tests/combat/combatEscape.test.ts`. **Note:** with stock gear the top engine (`eq_engine_iii`, 0.20 px/ms) only *ties* `npcSpeed` (0.2), so `canOutrun` (strict `>`) requires a speed micromodule/artifact upgrade — escape is upgrade-gated by design.
- **Fire cadence = one shot per `GAME_BALANCE.combatFireIntervalMs` per ship** (both sides), driven by accumulator timers in `CombatModule.update`. Combat advances on the raw RAF delta (not time-scaled), and the timer resets to 0 on fire, so a multi-interval lag spike fires at most once that frame — acceptable at real frame rates. Guarded by `src/tests/flight/combatEngagement.test.ts`.
- **Active pause overlays the real-time loop (`20260619-inflight-active-pause-combat`).** The fight is real-time *until* a shot lands on the player: `CombatModule.fireNpcShot` raises `onPlayerUnderAttack`, which the `CombatPauseController` debounces to the **first** hit per engagement and freezes the turn (`SpaceFlightScene.updateShip` early-returns and the `CombatModule`/`NpcShipManager` `isTurnRunning` deps fold in `!combatPause.paused`, so movement, the calendar, NPC AI and fire timers halt — planet/sun/comet cosmetic spin deliberately does NOT, see `20260620-planets-moons-rotate-during-pause`). It **re-pauses on selected-target-lost-with-survivors** (`removeCombatant` → `onTargetLost` → `loseTarget`). Because a pause can be raised mid-frame, `CombatModule.update` re-checks the freeze gate **before** `advancePlayerTimer` and `advanceNpcTimers` (and `advanceNpcTimers` re-checks per iteration) so no survivor fires on the pausing frame; `confirm()` leaves the pause *before* firing so a confirmed kill's target-lost re-pause isn't swallowed. The full controller/overlay/keybinding contract lives in `flight/CLAUDE.md` (active-pause section); guarded by `src/tests/combat/{combatPause,pauseFreezesTime,confirmAttack,pauseHooks,targetLostRepause}.test.ts` + `playtest-regression.spec.ts` #8.
- **Deterministic combat E2E uses the `__DEBUG__`-guarded `NpcShipManager.e2eForceAggressorInRange(weaponRange)` seam** (returns null in production): it teleports NPC[0] just inside weapon range, sets fixed hull/damage so the staged fight reliably trades hull, and flags it hostile + aggressive. Reuse this seam for new combat E2E rather than poking RNG'd live NPCs. Used by `playtest-regression.spec.ts` dogfight #7.

## Smoothed Auto-Follow / Chase Steering

Completed `20260625-smooth-auto-follow-movement`. Auto-follow (the «Приблизиться»
approach + in-fight auto-pursuit) used to look **jerky/twitchy**: every frame the ship
**re-plotted a curved catmull-rom route** (`executeRouteTo`/`aimRoute`) at the moving
target's lead point, and that lead point itself **jumped** frame-to-frame because the
target's velocity is estimated from its wobbling rendered heading (`cos/sin(rotation) ×
npcSpeed`), which `solveInterceptPoint` amplifies by the time-to-intercept. So the aim
oscillated AND the ship kept snapping onto a freshly-built spline. The fix steers
**continuously** toward a **smoothed** lead point via `ShipPhysics`' existing turn-rate
limiter, and **reserves the curved re-plot for static destinations + star avoidance**.

- **`smoothLeadPoint(previous, raw, {alpha, maxStepPx})` in `src/utils/flightGeometry.ts`
  is the lead-point smoother** — an EMA step of `alpha` toward `raw`, then a hard
  `maxStepPx` clamp on the per-frame move; adopts `raw` verbatim on the first frame (no
  previous). Because `alpha ≤ 1` and the clamp only ever *shortens* the step, the smoothed
  point **converges monotonically** toward a steadily-moving target (never overshoots).
  `NpcShipManager` tunes `LEAD_SMOOTHER = { alpha: 0.25, maxStepPx: 6 }` — `maxStepPx` is
  kept **≤ the 8px smoothness bound** (`SMOOTH_BOUND_PX`) the Task 1 characterization fails
  on the raw lead (≈72px/frame).
- **`shouldReplotRoute(state, freshLead, thresholdPx, nowMs, minIntervalMs)` is the re-aim
  hysteresis** — it re-plots the curved route only when **BOTH** at least `minIntervalMs`
  has elapsed since the last re-plot **AND** the fresh lead has drifted past `thresholdPx`
  (the existing `shouldReaim` distance gate). Sub-threshold jitter therefore never re-plots;
  a fast-manoeuvring target re-plots at most once per interval
  (`REPLOT_MIN_INTERVAL_MS = 500`).
- **`NpcShipManager.steerTowardLead` is the single chase-steering decision** (called from
  `updateCombatPursuit` + the non-combat «Приблизиться» approach): smooth the lead, then —
  (1) **fresh leg** (`!physics.isMoving`, stopped) → curved `replotChase` to re-arm the turn
  and establish a star-avoiding path; (2) **direct lead-line crosses the star**
  (`leadLineCrossesStar` → `avoidStarPath(...).length > 1`, using the new
  `getStarAvoidRadius` dep) → throttled curved `replotChase` (hysteresis-gated so it doesn't
  thrash); (3) **clear shot** → a direct `physics.setTarget(lead.x, lead.y)` heading nudge —
  `ShipPhysics` turn-rate-limits it, so the motion stays smooth (no snap). The smoother
  resets (`smoothedLead = null`) only on a **fresh chase leg** (target id change), so a new
  chase never lags toward the previous target's last lead.
- **Do NOT re-plot the spline every chase frame** "to keep aiming" — that is exactly the
  stutter this replaced. The pre-combat «Перехват» switch case + the engage/in-range and
  `followNpcId`/`approachNpcId` lifecycle are unchanged (when a fight starts/ends is
  identical). Guarded by `src/tests/flight/chaseSteering*.test.ts` (smoother monotonic
  convergence + per-frame aim ≤ `SMOOTH_BOUND_PX`, hysteresis blocks under-threshold, and
  the real `updateCombatPursuit` keeps |Δheading| ≤ `rotationSpeed·dt` while closing to and
  holding `WEAPON_RANGE`).
