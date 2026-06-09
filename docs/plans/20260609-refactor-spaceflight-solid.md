---
# Refactor SpaceFlightScene — SOLID/GRASP Decomposition

## Overview

`SpaceFlightScene.ts` is a God Object at **5200+ lines** with 8 unrelated concerns crammed into one class. This plan decomposes it into focused modules following SOLID (especially SRP, OCP, DIP) and GRASP (High Cohesion, Low Coupling, Information Expert, Creator, Controller) principles.

**Target:** SpaceFlightScene becomes a ~600-line Controller that owns the game loop, input handling, scene transitions, and turn logic — everything else is delegated to specialist modules.

**IMPORTANT:** Run this plan ONLY after `20260609-sprint3-letsplay-fixes.md` completes. Sprint3 actively modifies SpaceFlightScene.ts. Running both in parallel will produce merge conflicts.

## Context

Current file: `src/presentation/SpaceFlightScene.ts` — 5200+ lines.

**8 responsibility clusters identified:**

| Module | Current methods | Est. lines |
|--------|----------------|------------|
| `BackgroundLayer` (extend existing) | createStarField/Nebulae/Swarms/Dust/Pillars/Vignette, updateNebulae/Swarms/Dust/TwinkleStars/StarField | ~900 |
| `StarRenderer` | createStar, buildStarHalo/LimbMask, createStarProminences, updateStar | ~450 |
| `AsteroidBelt` | createAsteroids, drawAsteroid, updateAsteroids | ~250 |
| `PlayerShipRenderer` | createShip, drawShip, createTargetIndicator, updateTargetIndicator, updateTakeoff | ~400 |
| `OrbitRenderer` | createOrbits, createSystemBoundary | ~100 |
| `PlanetManager` | createPlanets, createStations, updatePlanets | ~600 |
| `NpcShipManager` | createNpcShips, updateNpcShips, updateNpcDepth | ~450 |
| `RouteRenderer` | drawRouteLine, drawLandingMarker, drawNavigationMarker | ~200 |
| `FlightHud` | createUI, updatePlayPauseButton, updateDayCounter, updateMiniLog, showToast, tooltip methods | ~800 |
| `SpaceFlightScene` (remainder) | initialize, update, destroy, input handlers, turn logic, route planning, warp/landing | ~600 |

**Shared state problem:** Modules need `renderer`, `gameEngine`, `bgElapsed`, camera state. Solve via:
1. Constructor injection of `Renderer` + `GameEngine`
2. `update(dt, bgElapsed)` signature — pass the clock, don't share it
3. Camera state (`cameraZoom`, `panX`, `panY`) accessed via `PanZoomController` reference passed to modules that need it

## Development Approach

- **Testing approach**: Regular (code first, verify tests after each task)
- Extract ONE module per task. Tests must pass at end of every task.
- Never leave SpaceFlightScene in a broken intermediate state — always delegate before removing.
- Order: simple/stateless modules first (no inter-module dependencies), complex last.
- Run `npm run lint && npm test -- --run` after every task. Fail = stop and fix.
- Each task follows the same pattern:
  1. Create `src/presentation/flight/<ModuleName>.ts` with the class
  2. Move fields and methods verbatim (no logic changes during move)
  3. Add module instance to SpaceFlightScene, inject deps in constructor
  4. Replace each private call in SpaceFlightScene with `this.<module>.<method>()`
  5. Delete moved fields/methods from SpaceFlightScene
  6. Run tests

## Common Module Interface

All modules follow this contract (defined in `src/presentation/flight/FlightModule.ts`):

```typescript
export interface FlightModule {
  /** Called once when the scene is set up. */
  initialize(): void;
  /** Called every animation frame. bgElapsed is the scene's animation clock (ms). */
  update(dt: number, bgElapsed: number): void;
  /** Tear down all DisplayObjects and listeners. */
  destroy(): void;
}
```

## Implementation Steps

### Task 1: Create FlightModule interface and flight/ directory

**Files:**
- Create: `src/presentation/flight/FlightModule.ts`

- [x] Create `src/presentation/flight/` directory
- [x] Write `FlightModule` interface as shown in Technical Details — `initialize()`, `update(dt, bgElapsed)`, `destroy()`
- [x] Export it; no logic, just the contract
- [x] `npm run lint && npm test -- --run` — must pass (no changes to existing code yet)

### Task 2: Extract BackgroundLayer — nebulae, swarms, dust, twinkle stars, star field

**Files:**
- Modify: `src/presentation/SpaceBackgroundLayer.ts` (extend existing class)
- Modify: `src/presentation/SpaceFlightScene.ts`

The existing `SpaceBackgroundLayer` handles distant parallax. Extend it to absorb the nebula/swarm/dust/twinkle/vignette systems that currently live in SpaceFlightScene.

- [x] Move these fields from SpaceFlightScene into SpaceBackgroundLayer: `nebulaBackdropSprite`, `nebulaeContainer`, `nebulaLayers`, `twinkleStars`, `twinkleContainer`, `swarmLayers`, `dustContainer`, `dustMotes`, `pillarContainer` (if present), `vignette` container (also moved `starLayers` + `createStarField`, since `updateStarField` parallaxes them — per the Context overview table)
- [x] Move these methods verbatim: `createNebulae()`, `createSwarms()`, `createNebulaPillars()`, `createDust()`, `createVignette()`, `createTwinkleStars()`, `updateSwarms()`, `updateDust()`, `updateNebulae()`, `updateTwinkleStars()`, `updateStarField()` (plus `createStarField()` and the private `lightenColor()` helper they depend on; added a local `paddedBlur()` copy since the scene still needs its own)
- [x] SpaceBackgroundLayer constructor takes `(renderer: Renderer, skyContainer: Container, systemId, getCamera, getShipVelocity)`. Methods that previously accessed `this.renderer.app.screen` now use the injected renderer; parallax reads live camera state and ship velocity via the injected accessors (the FlightModule `update(dt, bgElapsed)` signature can't carry camera/velocity, so they are injected — matches the plan's "PanZoomController reference passed to modules that need it" guidance).
- [x] Implement `FlightModule` on SpaceBackgroundLayer: `initialize()` calls create* in order (sky → dust/vignette → mid-ground), `update(dt, bgElapsed)` calls all update*, `destroy()` clears all containers (mid-ground destroyed directly; dust/vignette detached for clearUILayer to destroy).
- [x] In SpaceFlightScene: replace `this.spaceBackgroundLayer = new SpaceBackgroundLayer(...)` with the updated call (field renamed `background`); delegate all background create/update calls to `this.background.initialize()` / `this.background.update(dt, bgElapsed)`.
- [x] Write unit test: construct SpaceBackgroundLayer with mock renderer; call `initialize()`; assert `twinkleStars.length > 0` and `swarmLayers.length > 0` (`src/tests/presentation/spaceBackgroundLayer.test.ts`; also updated `swarmGlow.test.ts` to target the extracted class).
- [x] `npm run lint && npm test -- --run` — must pass. (lint: 0 errors; tests: 845 passed; tsc --noEmit clean)

### Task 3: Extract StarRenderer — sun sphere, halo, prominences, surface rotation

**Files:**
- Create: `src/presentation/flight/StarRenderer.ts`
- Modify: `src/presentation/SpaceFlightScene.ts`

- [x] Create `StarRenderer` implementing `FlightModule`. Constructor: `(renderer: Renderer, gameEngine: GameEngine | null, gameLayer: Container)` (renderer used only for `app.screen` → centre; the injected `gameLayer` owns the display objects, so no `renderer` field is kept).
- [x] Move fields: `starCenterX`/`starCenterY` (→ public readonly `centerX`/`centerY`, computed from the screen centre in the constructor), `starTiling`, `sunSphere`, `starHaloContainer`, `starSurface`, `starElapsed`, `STAR_RADIUS` (→ public readonly `radius`), `STAR_AVOID_RADIUS` (→ public readonly `avoidRadius`), `starTouchActive`, `sunContactDamageTimer`. (`starProminenceData` no longer exists — the corona/prominence decoration was already replaced by the halo limb-ring, see the buildStarHalo doc comment.)
- [x] Move methods verbatim: `createStar()`, `buildStarLimbMask()`, `buildStarHalo()`, `updateStar()`, `scheduleStarMapUpgrade()`, `mountStarMapSurface()`, `starMapPrefix()` — plus the helpers they depend on: `pickStarTexture()`, `starTint()`, and a local `paddedBlur()` copy (the scene keeps its own). (`createStarProminences()`/`drawProminence()` no longer exist — removed with the corona.)
- [x] Expose as public readonly: `centerX`, `centerY`, `radius`, `avoidRadius` — SpaceFlightScene reads these for collision, orbit/planet/station layout, camera bounds, and star-avoidance path calculation (all `this.starCenterX/Y`, `this.STAR_RADIUS`, `this.STAR_AVOID_RADIUS` references rewired).
- [x] Expose `updateSunContactDamage(dt, playerX, playerY, turnRunning, timeScale): boolean` — called by SpaceFlightScene's ship update loop; burns the hull in discrete chunks and returns `true` on the frame a fresh contact episode starts so the scene fires its "Корпус горит!" toast (keeps the HUD dependency in the scene).
- [x] In SpaceFlightScene: replace `this.createStar()` / `this.updateStar()` with `this.starRenderer.initialize()` / `this.starRenderer.update(dt, bgElapsed)`; construct `starRenderer` before `createOrbits/createPlanets` so they can read its centre; call `this.starRenderer.destroy()` in `destroy()` (removes + disposes its own gameLayer objects). Removed now-unused imports (`TilingSprite`, `Texture`, `buildSphereMesh`/`SphereMesh`, `StarType`, `SeededRNG`, `pickVariantKey`/`loadTextureAsync`, `SUN_*` constants) and the dead `sceneDestroyed` field.
- [x] Write unit test (`src/tests/presentation/starRenderer.test.ts`): construct StarRenderer with mock renderer; assert `centerX`/`centerY`/`radius`/`avoidRadius`; `initialize()` mounts the sun into the game layer; `update()` + `destroy()` leak no children; `updateSunContactDamage()` burns only inside the radius and latches the toast. Also retargeted `starHalo.test.ts` to the extracted class and updated `spaceFlightSpawn.test.ts` to stub `starRenderer.centerX/Y`.
- [x] `npm run lint && npm test -- --run` — must pass. (tsc --noEmit clean; lint: 0 errors; tests: 849 passed; StarRenderer 510 lines, SpaceFlightScene 4550 → 4181.)

### Task 4: Extract AsteroidBelt — asteroid creation, animation, drawing

**Files:**
- Create: `src/presentation/flight/AsteroidBelt.ts`
- Modify: `src/presentation/SpaceFlightScene.ts`

- [x] Create `AsteroidBelt` implementing `FlightModule`. Constructor: `(renderer: Renderer, gameLayer: Container)` — `renderer` supplies `app.screen` for the field centre (the star centre, identical to StarRenderer's), `gameLayer` mounts the container. No coupling to StarRenderer.
- [x] Move `AsteroidMote` interface, `asteroidContainer`, `asteroids` fields (plus the `asteroidFieldRadius()`/`respawnAsteroid()` helpers the methods depend on; `asteroidFieldRadius()` now reads `SYSTEM_GEOMETRY.boundaryRadius` directly instead of the scene's `SYSTEM_BOUNDARY_RADIUS`).
- [x] Move methods verbatim: `createAsteroids()`, `drawAsteroid()`, `updateAsteroids()`
- [x] `initialize()` calls `createAsteroids()`; `update(dt, bgElapsed)` calls `updateAsteroids(dt)`; `destroy()` removes + destroys the container and clears the field. Exposed `count` getter for tests.
- [x] In SpaceFlightScene: construct `asteroidBelt` alongside `starRenderer`; replace `this.createAsteroids()`/`this.updateAsteroids()` with `this.asteroidBelt.initialize()`/`.update()`; added `this.asteroidBelt.destroy()` to `destroy()` and removed the old `asteroids`/`asteroidContainer` cleanup lines.
- [x] Write unit test (`src/tests/presentation/asteroidBelt.test.ts`): construct AsteroidBelt; `initialize()`; assert `count > 0` and one child mounted on the game layer; `update()` + `destroy()` leak no children.
- [x] `npm run lint && npm test -- --run` — must pass. (tsc --noEmit clean; lint: 0 errors; tests: 851 passed.)

### Task 5: Extract OrbitRenderer — orbit circles, system boundary

**Files:**
- Create: `src/presentation/flight/OrbitRenderer.ts`
- Modify: `src/presentation/SpaceFlightScene.ts`

- [x] Create `OrbitRenderer` implementing `FlightModule`. Constructor: `(renderer: Renderer, gameLayer: Container, galaxy: Galaxy | null, currentSystemId: string)` — `renderer` supplies `app.screen` for the star centre (identical to StarRenderer's/AsteroidBelt's, so no coupling to the star module); `galaxy` is nullable so the scene can pass `gameEngine?.galaxy ?? null`.
- [x] Move fields: `orbitGraphics` → folded into a single owned `container` that holds both the orbit-graphics and the boundary ring (matches AsteroidBelt's container pattern, so `destroy()` tears down one node and works against the partial PixiJS mock whose `Graphics` has no `destroy()`).
- [x] Move methods verbatim: `createOrbits()`, `createSystemBoundary()` — `createSystemBoundary()` now reads `SYSTEM_GEOMETRY.boundaryRadius` directly (instead of the scene's `SYSTEM_BOUNDARY_RADIUS`), and both add their graphics to the module's `container` instead of the game layer.
- [x] `initialize()` builds the container, calls both create methods, mounts the container (above star, below planets); `update()` is a no-op (orbits/boundary are static); `destroy()` removes + destroys the container.
- [x] In SpaceFlightScene: construct `orbitRenderer` alongside `asteroidBelt`; replace `this.createOrbits()`/`this.createSystemBoundary()` with `this.orbitRenderer.initialize()`; added `this.orbitRenderer.destroy()` to `destroy()` and removed the old `this.orbitGraphics = null` line and the `orbitGraphics` field.
- [x] Write unit test (`src/tests/presentation/orbitRenderer.test.ts`): construct OrbitRenderer; `initialize()` mounts one container holding orbit-graphics + boundary; no-planet system draws only the boundary; null galaxy draws only the boundary; `update()` is a no-op and `destroy()` leaks no children.
- [x] `npm run lint && npm test -- --run` — must pass. (tsc --noEmit clean; lint: 0 errors; tests: 855 passed; OrbitRenderer 128 lines, SpaceFlightScene 3947 → 3897.)

### Task 6: Extract RouteRenderer — route line, landing/nav markers

**Files:**
- Create: `src/presentation/flight/RouteRenderer.ts`
- Modify: `src/presentation/SpaceFlightScene.ts`

RouteRenderer is stateless with respect to game logic — it only draws what it's given. Information Expert: route data stays in SpaceFlightScene (it owns route planning logic), RouteRenderer only renders it.

- [x] Create `RouteRenderer`. Constructor: `(gameLayer: Container)`. Intentionally NOT a `FlightModule` — the overlay is redrawn on demand when the route changes, so there is no per-frame `update()`; it just draws and clears.
- [x] Move `routeLineGraphics` field (private; exposed via a `get graphics()` getter for tests).
- [x] Move methods: `drawRouteLine()` (split — the renderer keeps the line+ticks draw as `drawRoute()`; the orchestration stays in the scene), `drawLandingMarker()`, `drawNavigationMarker()`, plus the `dayTickMarks` import they depend on.
- [x] Change signatures to accept data as parameters (no reading SpaceFlightScene state directly):
  - `drawRoute(path: {x:number, y:number}[], distancePerDay: number): void` — `path` is the finished ship→waypoints→destination polyline (built by the scene); `distancePerDay` replaces the planned `targetX/targetY` (the end marker is drawn separately by the scene's landing-vs-nav decision, so the renderer never needs the target coords, and `distancePerDay` is what the tick-mark spacing actually needs — passed as a param since the constructor is `(gameLayer)`).
  - `drawLandingMarker(x: number, y: number): void`
  - `drawNavigationMarker(x: number, y: number): void`
  - `clearRoute(): void`
- [x] Update SpaceFlightScene callers to pass route state explicitly: `drawRouteLine()` now builds the polyline + landing-vs-nav decision (Information Expert — it owns route data + planet sprites) and delegates drawing to `this.routeRenderer`; `clearPlannedRoute()` clears scene state then calls `this.routeRenderer?.clearRoute()` (?.: runs from `destroy()`, which may fire before init). Removed the `routeLineGraphics` field and the `dayTickMarks` import from the scene.
- [x] Write unit test (`src/tests/presentation/routeRenderer.test.ts`): `drawRoute()` with 3 points — assert the overlay is non-null, a `Graphics`, added to the container, and non-interactive; redraw replaces+disposes the old overlay; markers append to the existing overlay (no-op before one exists); `clearRoute()` disposes and leaks no children.
- [x] `npm run lint && npm test -- --run` — must pass. (tsc --noEmit clean; lint: 0 errors; tests: 859 passed; RouteRenderer 158 lines, SpaceFlightScene 3897 → 3806.)

### Task 7: Extract PlayerShipRenderer — ship sprite, drawing, target indicator, takeoff arc

**Files:**
- Create: `src/presentation/flight/PlayerShipRenderer.ts`
- Modify: `src/presentation/SpaceFlightScene.ts`

- [ ] Create `PlayerShipRenderer` implementing `FlightModule`. Constructor: `(renderer: Renderer, gameLayer: Container, shipPhysics: ShipPhysics)`
- [ ] Move fields: `shipContainer`, `shipGraphics`, `shipSprite`, `SHIP_SIZE`, `SHIP_SPRITE_ROTATION`, `takeoffArc`, `takeoffArcDist`, `targetIndicator`
- [ ] Move methods: `createShip()`, `drawShip()`, `createTargetIndicator()`, `updateTargetIndicator()`, `updateTakeoff()`
- [ ] Expose as public: `container` (so SpaceFlightScene can read ship world position), `isArcActive(): boolean`
- [ ] `update(dt, bgElapsed)` calls `drawShip()`, `updateTargetIndicator()`, `updateTakeoff(dt)`
- [ ] In SpaceFlightScene: `this.playerShip.initialize()` / `this.playerShip.update(dt, bgElapsed)`; read `this.playerShip.container.x/y` for physics
- [ ] Write unit test: construct PlayerShipRenderer; `initialize()`; assert `container.children.length > 0`
- [ ] `npm run lint && npm test -- --run` — must pass.

### Task 8: Extract NpcShipManager — NPC ship creation, updates, interactions

**Files:**
- Create: `src/presentation/flight/NpcShipManager.ts`
- Modify: `src/presentation/SpaceFlightScene.ts`

High cohesion: all NPC ship state lives here. Information Expert: NPC logic belongs with NPC data.

- [ ] Create `NpcShipManager` implementing `FlightModule`. Constructor: `(renderer: Renderer, gameEngine: GameEngine, gameLayer: Container, uiLayer: Container, panZoom: PanZoomController)`
- [ ] Move fields: `npcSprites`, `npcAnchorPlanet`, `npcContactPanel`, `contactNpcId`, `followNpcId`, `overmindOverlay`, `_combatTransitionPending`, `_npcSimulator`
- [ ] Move methods: `createNpcShips()`, `updateNpcShips()`, `updateNpcDepth()`, `onNpcClick()` (if present), `updateInteractiveCursors()` NPC-specific portion
- [ ] Expose events via callbacks set by SpaceFlightScene: `onCombatTriggered: (npcId: string) => void`, `onContactOpened: (npcId: string) => void` — avoids coupling NpcShipManager to SpaceFlightScene
- [ ] In SpaceFlightScene: wire callbacks in `initialize()`:
  ```typescript
  this.npcManager.onCombatTriggered = (id) => this.startCombat(id);
  ```
- [ ] Write unit test: construct NpcShipManager; verify `npcSprites` is empty before `initialize()` and populated after (mock galaxy with NPC ships).
- [ ] `npm run lint && npm test -- --run` — must pass.

### Task 9: Extract PlanetManager — planet sprites, stations, interaction, update

**Files:**
- Create: `src/presentation/flight/PlanetManager.ts`
- Modify: `src/presentation/SpaceFlightScene.ts`

Largest domain module — owns all planet/station visual state and interaction.

- [ ] Create `PlanetManager` implementing `FlightModule`. Constructor: `(renderer: Renderer, gameEngine: GameEngine, gameLayer: Container, uiLayer: Container, panZoom: PanZoomController)`
- [ ] Move fields: `planetSprites`, `stationMarkers`, `planetInfoPanel`, `routeTargetPlanetId`, `routeTargetStationId`
- [ ] Move methods: `createPlanets()`, `createStations()`, `updatePlanets()`
- [ ] Expose events via callbacks: `onPlanetRouteRequested: (planetId: string, x: number, y: number) => void`, `onPlanetLanding: (planetId: string) => void`, `onStationDock: (stationId: string) => void`
- [ ] Expose query methods for SpaceFlightScene: `getPlanetAt(x, y): PlanetSprite | null`, `getStationAt(x, y): StationMarker | null`
- [ ] In SpaceFlightScene: wire callbacks in `initialize()`; replace all `this.planetSprites` references with `this.planetManager.*`
- [ ] Write unit test: construct PlanetManager with mock galaxy (2 planets); `initialize()`; assert `planetManager.planetSprites.length === 2`.
- [ ] `npm run lint && npm test -- --run` — must pass.

### Task 10: Extract FlightHud — UI buttons, day counter, minilog, tooltips, toast

**Files:**
- Create: `src/presentation/flight/FlightHud.ts`
- Modify: `src/presentation/SpaceFlightScene.ts`

- [ ] Create `FlightHud` implementing `FlightModule`. Constructor: `(renderer: Renderer, gameEngine: GameEngine, uiLayer: Container)`
- [ ] Move fields: `uiContainer`, `playPauseButton`, `speedButton`, `gearButton`, `settingsPanel`, `dayCounterText`, `questJournalUI`, `systemMiniMap`, `toast`, `toastTimer`, `miniLogContainer`, `miniLogEntries`, `tooltipText`, `tooltipContainer`, `tooltipTimer`, `turnHintShown`
- [ ] Move methods: `createUI()`, `updatePlayPauseButton()`, `updateDayCounter()`, `updateMiniLog()`, `updateInteractiveCursors()` HUD portion, `showToast()`, `showTooltip()`, `hideTooltip()`, `appendMiniLog()`
- [ ] Expose callbacks: `onPlayPause: () => void`, `onSpeedCycle: () => void`, `onGearOpen: () => void` — SpaceFlightScene wires these to its own handlers in `initialize()`
- [ ] Expose setters for state SpaceFlightScene pushes: `setTurnRunning(running: boolean)`, `setDayCount(day: number)`, `setGameSpeed(speed: number)`
- [ ] `update(dt, bgElapsed)` calls `updatePlayPauseButton()`, `updateDayCounter()`, `updateMiniLog(dt)`, `updateInteractiveCursors()`
- [ ] Write unit test: construct FlightHud; `initialize()`; assert `playPauseButton` exists and `uiContainer.children.length > 0`.
- [ ] `npm run lint && npm test -- --run` — must pass.

### Task 11: Clean up SpaceFlightScene — make it a true Controller

**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`

After all extractions, SpaceFlightScene should only contain:
- Field declarations for the 9 modules above
- `initialize()`: create all modules, wire callbacks, set up input handlers
- `update(dt)`: compute `bgElapsed`, call each module's `update(dt, bgElapsed)`, handle turn tick, warp, sun contact
- `destroy()`: call each module's `destroy()`, remove stage listeners
- Input handlers: `onPointerDown/Move/Up`, `onKeyDown`
- Turn logic: `onPlayPause()`, `endTurn()`, `startTurn()`, `updateShip()`
- Route planning: `calculateRoute()`, `onPlanetRouteRequested()`, `performWarp()`
- Scene transitions: `warpToSystem()`, landing, combat

- [ ] Delete any remaining private methods that were moved to modules; confirm no orphan references remain
- [ ] Run `grep -n "private create\|private build\|private draw\|private render" src/presentation/SpaceFlightScene.ts` — assert 0 results (all moved out)
- [ ] Measure final line count — target < 800 lines
- [ ] `npm run lint && npm test -- --run` — all pass
- [ ] `npm run test:e2e:regression` — all pass

### Task 12: Add integration tests for module contracts

**Files:**
- Create: `src/tests/flight/moduleContracts.test.ts`

- [ ] Write a parameterised test for each FlightModule: construct it, call `initialize()`, call `update(1/60, 100)`, call `destroy()` — assert no errors thrown and no PixiJS objects leak (check `renderer.gameLayer.children.length === 0` after destroy)
- [ ] Assert SpaceFlightScene.ts line count < 900 (fail the test if the god object grows back): read the file in the test, count lines, assert
- [ ] `npm run lint && npm test -- --run` — must pass

## Technical Details

**FlightModule interface** (`src/presentation/flight/FlightModule.ts`):
```typescript
export interface FlightModule {
  initialize(): void;
  update(dt: number, bgElapsed: number): void;
  destroy(): void;
}
```

**SpaceFlightScene field block after refactor:**
```typescript
private background!: SpaceBackgroundLayer;
private starRenderer!: StarRenderer;
private asteroidBelt!: AsteroidBelt;
private orbitRenderer!: OrbitRenderer;
private routeRenderer!: RouteRenderer;
private playerShip!: PlayerShipRenderer;
private npcManager!: NpcShipManager;
private planetManager!: PlanetManager;
private hud!: FlightHud;
```

**Callback wiring pattern (DIP — depend on abstraction, not concrete scene):**
```typescript
// In SpaceFlightScene.initialize():
this.npcManager.onCombatTriggered = (id) => this.startCombat(id);
this.planetManager.onPlanetLanding = (id) => this.landOnPlanet(id);
this.hud.onPlayPause = () => this.onPlayPause();
```

**GRASP principles applied:**
- **Information Expert**: Each module holds the data it needs (NpcShipManager owns npcSprites, PlanetManager owns planetSprites)
- **High Cohesion**: Each module changes for one reason (e.g., StarRenderer only changes when star visuals change)
- **Low Coupling**: Modules don't call each other — SpaceFlightScene mediates via callbacks
- **Creator**: SpaceFlightScene creates all modules (it "contains" them and has init data)
- **Controller**: SpaceFlightScene is the scene controller — it receives input events and delegates to the right module

**SOLID principles applied:**
- **S** (SRP): Each class has one reason to change
- **O** (OCP): New visual systems (e.g., WeatherSystem) can be added as new FlightModules without touching SpaceFlightScene
- **D** (DIP): Modules depend on `Renderer`, `GameEngine`, `PanZoomController` interfaces, not on SpaceFlightScene

## Post-Completion

**Manual verification:**
- Full game loop: start new game → fly around → land → trade → fly back — no regressions
- NPC ships appear and are clickable
- Planets render and are interactive
- Sun bypass arc works
- Turn button and speed controls respond
- Regression suite green

**Metrics to verify after refactor:**
- `SpaceFlightScene.ts` < 900 lines (from 5200+)
- Each extracted module < 600 lines
- No module imports another module (coupling check: `grep "from './NpcShipManager'" src/presentation/flight/PlanetManager.ts` → 0 results)
