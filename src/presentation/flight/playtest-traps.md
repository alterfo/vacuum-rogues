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
- **Font-scale change re-inits SPACE_FLIGHT via scene callback, NEVER from the HUD** (playtest4 A, DIP). The `⚙` button must only persist the size and fire `onFontScaleChange`. The scene's `onFontScaleChanged()` pins `gameEngine.lastFlightShipPos` to the live ship pos **before** `transitionTo` (so the new `initialize()` seeds `entryX/Y` from the saved spot, not the system edge), and also passes `preserveShipPos: { x, y }` as a belt-and-suspenders teleport-after path. **The `lastFlightShipPos` pin is the load-bearing one** — do not drop it assuming `preserveShipPos` alone suffices; that reintroduces the one-frame ship jump (playtest6). Guarded by `src/tests/presentation/fontScaleShipPos.test.ts`, `src/tests/presentation/flightHud.test.ts`, `src/tests/presentation/spaceFlightSpawn.test.ts`, and real-mouse `playtest-regression.spec.ts`.
- **The route overlay draws ONLY the cyan dashed line — no per-day "tick" cross marks** (playtest4 B, user decision). `RouteRenderer.drawRoute(path)` is single-arg. Do not reintroduce per-day route divisions. Guarded by `src/tests/presentation/routeRenderer.test.ts`.
- **The pulsing heading crosshair is hidden during auto-route flight** (`PlayerShipRenderer.updateTargetIndicator` gates `targetIndicator.visible` on `!shipPhysics.isFollowingRoute()`). `isFollowingRoute()` differs from `hasPath()`: it is set by `setPath` and stays true through the final leg until arrival/`stop`/`setTarget`/`teleport`, so the whole route counts as "on a route" — the dashed line + destination marker already show the destination, making the crosshair redundant. Guarded by `src/tests/flight/routeCrosshair.test.ts`.
- **Lead a moving target through the single solver `src/utils/intercept.ts#solveInterceptPoint`** (playtest4 C) — ONLY intercept solver (no dup). **Units trap:** solver wants px/ms; `PlanetSprite.orbitalVelocityPerDay()` returns px/**game-day**, so `planetLeadPoint` converts via `vel · getMaxSpeed() / GAME_BALANCE.pixelsPerDay`. Guarded by `src/tests/intercept.test.ts`, `src/tests/presentation/npcShipManager.test.ts`, `src/tests/presentation/planetManager.test.ts`, `src/tests/presentation/planetSpriteVelocity.test.ts`.

## NPC Purposeful Behavior Conventions

Completed `20260612-npc-purposeful-behavior`:
- **`pickNpcDestination` in `npcBehavior.ts` is the ONLY source of NPC waypoints** — never add `Math.random()` ring-point logic back to `NpcShipSprite.pickNewTarget()`. Pure and deterministic (same role + shipId + seq → same point). Guarded by `src/tests/presentation/npcBehavior.test.ts`.
- **Destination injected via `sprite.setTargetProvider(fn)` (dependency inversion)** — the sprite never imports `NpcShipManager` or `npcBehavior.ts`. `setTargetProvider()` immediately calls `pickNewTarget()` so the very first waypoint is purposeful. Do NOT add a `pickNewTarget()` call to the sprite constructor.
- **Re-anchor on every planet arrival via `sprite.setArrivalCallback(fn)`** — when the sprite arrives (`dist < 6`), `arrivalCallback` fires and `NpcShipManager` calls `sprite.setAnchor()` + updates `npcAnchorPlanet`. Without this, subsequent visits are fly-throughs (no orbit). Guarded by `src/tests/presentation/npcShipDwell.test.ts`.
- **Bounded dwell: deterministic `dwellDurationMs` (8–20 s game time, seeded by ship id)** so ships desynchronize departures. Dwell does NOT accumulate while departing (`!this.departing` gate).
- **`hashStr` in `src/utils/hashStr.ts` is the single FNV-1a implementation** — do not add copies in NpcShipSprite, NpcShipManager, or npcBehavior.
- **`setAnchor()` orbit params are deterministic per ship id** — `orbitRadius` and `orbitDir` use `hashStr(this.npc.id)`, not `Math.random()`.
