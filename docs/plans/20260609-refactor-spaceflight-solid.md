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

- [ ] Create `src/presentation/flight/` directory
- [ ] Write `FlightModule` interface as shown in Technical Details — `initialize()`, `update(dt, bgElapsed)`, `destroy()`
- [ ] Export it; no logic, just the contract
- [ ] `npm run lint && npm test -- --run` — must pass (no changes to existing code yet)

### Task 2: Extract BackgroundLayer — nebulae, swarms, dust, twinkle stars, star field

**Files:**
- Modify: `src/presentation/SpaceBackgroundLayer.ts` (extend existing class)
- Modify: `src/presentation/SpaceFlightScene.ts`

The existing `SpaceBackgroundLayer` handles distant parallax. Extend it to absorb the nebula/swarm/dust/twinkle/vignette systems that currently live in SpaceFlightScene.

- [ ] Move these fields from SpaceFlightScene into SpaceBackgroundLayer: `nebulaBackdropSprite`, `nebulaeContainer`, `nebulaLayers`, `twinkleStars`, `twinkleContainer`, `swarmLayers`, `dustContainer`, `dustMotes`, `pillarContainer` (if present), `vignette` container
- [ ] Move these methods verbatim: `createNebulae()`, `createSwarms()`, `createNebulaPillars()`, `createDust()`, `createVignette()`, `createTwinkleStars()`, `updateSwarms()`, `updateDust()`, `updateNebulae()`, `updateTwinkleStars()`, `updateStarField()`
- [ ] SpaceBackgroundLayer constructor takes `(renderer: Renderer, skyContainer: Container)`. Methods that previously accessed `this.renderer.app.screen` now use the injected renderer.
- [ ] Implement `FlightModule` on SpaceBackgroundLayer: `initialize()` calls create* in order, `update(dt, bgElapsed)` calls all update*, `destroy()` clears all containers.
- [ ] In SpaceFlightScene: replace `this.spaceBackgroundLayer = new SpaceBackgroundLayer(...)` with the updated call; delegate all background create/update calls to `this.background.initialize()` / `this.background.update(dt, bgElapsed)`.
- [ ] Write unit test: construct SpaceBackgroundLayer with mock renderer; call `initialize()`; assert `twinkleStars.length > 0` and `swarmLayers.length > 0`.
- [ ] `npm run lint && npm test -- --run` — must pass.

### Task 3: Extract StarRenderer — sun sphere, halo, prominences, surface rotation

**Files:**
- Create: `src/presentation/flight/StarRenderer.ts`
- Modify: `src/presentation/SpaceFlightScene.ts`

- [ ] Create `StarRenderer` implementing `FlightModule`. Constructor: `(renderer: Renderer, gameEngine: GameEngine, gameLayer: Container)`
- [ ] Move fields: `starCenterX`, `starCenterY`, `starTiling`, `sunSphere`, `starHaloContainer`, `starSurface`, `starProminenceData`, `starElapsed`, `STAR_RADIUS`, `STAR_AVOID_RADIUS`, `starTouchActive`, `sunContactDamageTimer`
- [ ] Move methods verbatim: `createStar()`, `buildStarLimbMask()`, `buildStarHalo()`, `createStarProminences()`, `drawProminence()`, `updateStar()`, `scheduleStarMapUpgrade()` (if present), `mountStarMapSurface()`, `starMapPrefix()`
- [ ] Expose as public readonly: `centerX`, `centerY`, `radius` — SpaceFlightScene reads these for collision and avoidance path calculation.
- [ ] Expose `updateSunContactDamage(dt, playerX, playerY)` — called by SpaceFlightScene's ship update loop to apply hull damage.
- [ ] In SpaceFlightScene: replace all `this.createStar()` / `this.updateStar()` with `this.starRenderer.initialize()` / `this.starRenderer.update(dt, bgElapsed)`.
- [ ] Write unit test: construct StarRenderer with mock renderer; call `initialize()`; assert `starRenderer.centerX` is a number and `starRenderer.radius > 0`.
- [ ] `npm run lint && npm test -- --run` — must pass.

### Task 4: Extract AsteroidBelt — asteroid creation, animation, drawing

**Files:**
- Create: `src/presentation/flight/AsteroidBelt.ts`
- Modify: `src/presentation/SpaceFlightScene.ts`

- [ ] Create `AsteroidBelt` implementing `FlightModule`. Constructor: `(renderer: Renderer, gameLayer: Container)`
- [ ] Move `AsteroidMote` interface, `asteroidContainer`, `asteroids` fields
- [ ] Move methods verbatim: `createAsteroids()`, `drawAsteroid()`, `updateAsteroids()`
- [ ] `initialize()` calls `createAsteroids()`; `update(dt, bgElapsed)` calls `updateAsteroids(dt)`; `destroy()` clears container
- [ ] In SpaceFlightScene: replace all references with `this.asteroidBelt.*`
- [ ] Write unit test: construct AsteroidBelt; call `initialize()`; assert `asteroidBelt` has > 0 asteroids after init.
- [ ] `npm run lint && npm test -- --run` — must pass.

### Task 5: Extract OrbitRenderer — orbit circles, system boundary

**Files:**
- Create: `src/presentation/flight/OrbitRenderer.ts`
- Modify: `src/presentation/SpaceFlightScene.ts`

- [ ] Create `OrbitRenderer` implementing `FlightModule`. Constructor: `(renderer: Renderer, gameLayer: Container, galaxy: Galaxy, currentSystemId: string)`
- [ ] Move fields: `orbitGraphics`
- [ ] Move methods: `createOrbits()`, `createSystemBoundary()`
- [ ] `initialize()` calls both; `update()` is a no-op (orbits are static); `destroy()` removes graphics
- [ ] In SpaceFlightScene: replace references
- [ ] `npm run lint && npm test -- --run` — must pass.

### Task 6: Extract RouteRenderer — route line, landing/nav markers

**Files:**
- Create: `src/presentation/flight/RouteRenderer.ts`
- Modify: `src/presentation/SpaceFlightScene.ts`

RouteRenderer is stateless with respect to game logic — it only draws what it's given. Information Expert: route data stays in SpaceFlightScene (it owns route planning logic), RouteRenderer only renders it.

- [ ] Create `RouteRenderer`. Constructor: `(gameLayer: Container)`
- [ ] Move `routeLineGraphics` field
- [ ] Move methods: `drawRouteLine()`, `drawLandingMarker()`, `drawNavigationMarker()`
- [ ] Change signatures to accept data as parameters (no reading SpaceFlightScene state directly):
  - `drawRoute(path: {x:number, y:number}[], targetX: number, targetY: number): void`
  - `drawLandingMarker(x: number, y: number): void`
  - `drawNavigationMarker(x: number, y: number): void`
  - `clearRoute(): void`
- [ ] Update SpaceFlightScene callers to pass route state explicitly
- [ ] Write unit test: `drawRoute()` with 3 points — assert `routeLineGraphics` is non-null and added to container.
- [ ] `npm run lint && npm test -- --run` — must pass.

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
