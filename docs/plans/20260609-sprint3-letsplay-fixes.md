---
# Sprint 3: Letsplay Fixes

## Overview

Fixes from letsplay playtesting session. Ten distinct bugs ranging from critical (planets render as rectangles, buttons unresponsive) to visual (ugly solar flares, rectangular swarm particles, invisible ship). All bugs are in the space flight scene and related systems.

## Context

Key files:
- `src/presentation/SpaceFlightScene.ts` (5000+ lines) — ship, sun, planets, swarms, buttons, pause
- `src/presentation/PlanetSprite.ts` — planet sphere rendering and masking
- `src/presentation/NpcShipSprite.ts` — NPC ship interactivity
- `src/presentation/ui/UiButton.ts` — button cursor and eventMode
- `src/utils/flightGeometry.ts` — sun bypass arc (`avoidStarPath()` at line 120)
- `src/systems/ShipPhysics.ts` — ship speed computation
- `src/systems/EquipmentSystem.ts` — equipment stat application

Screenshots show:
- Image #2: Sun with ugly triangular solar prominences and thick yellow corona rings
- Image #3: Planets clipped as rectangles (masking broken)
- Image #4: Sun bypass route with visible kinks in arc

Additional reports from session:
- Undocking from shipyard throws player to edge of system
- Fast engine module has no effect on ship speed

## Development Approach

- **Testing approach**: Regular (code first, then tests)
- Fix bugs in order: critical visual first (planets), then UX (buttons), then polish (ship/sun/particles)
- Each task: implement → lint → test → next
- `npm run lint && npm test -- --run` must pass after each task

## Implementation Steps

### Task 1: Fix planet circular masking (planets render as rectangles)

**Files:**
- Modify: `src/presentation/PlanetSprite.ts`

Root cause: In PixiJS 8, a Graphics mask must be part of the display object tree to take effect. `maskA`/`maskB`/`maskC` are created and assigned to `.mask` but never added as children — so PixiJS 8 ignores them and falls back to the full bounding box.

- [x] In `buildSphere()` (~line 172): after creating `maskA` and before or after `surface.mask = maskA`, add `surface.addChild(maskA)` so it's in the scene graph. Do the same for `maskB` (shading layer, ~line 202): `shade.addChild(maskB)`. (Masks now parented under `surface`/`shade`; removed from the loose `bodyContainer.addChild(maskA, surface, maskB, shade)` so they are not double-parented.)
- [x] In the TilingSprite fallback (~line 287): after `tiling.mask = maskC`, add `this.graphics.addChild(maskC)` (or wherever maskC's container is) so the tiling is visually clipped to a circle. (Parented `maskC` under `tiling`; the sprite is offset by `(-radius,-radius)`, so the mask circle is centred at the tiling-local planet centre `(radius, radius)`.)
- [x] Check `PlanetRotationFilter.ts` GLSL `discard` path (line 67-69): confirm `r > 1.0` discard is still present and that the filter container has `cullMode` or bounds set to a circle. If the filter renders a rectangular quad, wrap the mesh in a Graphics circle mask as above. (Confirmed: `if (r > 1.0) { discard; }` at lines 67-69, plus an anti-aliased premultiplied circular edge at lines 92-93 — the filter renders a disc, not a rectangular quad. No wrap needed.)
- [x] Write unit test `src/tests/presentation/planetSpriteMask.test.ts`: construct a `PlanetSprite`, call `render()`, assert that every Graphics child used as a mask is also a child of the masked DisplayObject (so PixiJS 8 will respect it).
- [x] `npm run lint && npm test -- --run` — must pass.

### Task 2: Fix Ход / Pause button responsiveness

**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`

Root cause: `onPlayPause()` (line 4375) sets `pauseRequested = true` when the ship is moving, meaning pause only activates at the END of the current movement segment. Player can't stop an unwanted route mid-flight.

- [x] In `onPlayPause()` (line ~4375), when `this.isTurnRunning && this.shipPhysics?.isMoving`: instead of just setting `pauseRequested = true`, immediately call `this.shipPhysics.stop()` then `this.endTurn()`. Remove the `pauseRequested` flag entirely if no other caller uses it. (Added `ShipPhysics.stop()` that clears the path, parks the target at the current pos, and zeroes speed. `onPlayPause` now calls `stop()` + `endTurn()` for ANY running turn — flying, holding station, or waiting. Removed the `pauseRequested` field and its deferred day-boundary checks in the flight loop and `advanceWaitTime`.)
- [x] Verify the Ход button's container has `eventMode = "static"` and is **above** any fullscreen transparent overlay that might intercept clicks. Check the z-order: uiLayer must be on top of gameLayer; the button's `stopPropagation()` must be present in UiButton. (Confirmed: `UiButton` sets `container.eventMode = "static"` and calls `event.stopPropagation()` in its pointerdown handler; the play button is added to `uiContainer` → `uiLayer`, above `gameLayer`. The onClick wrapper also calls `stopPropagation()`.)
- [x] Ensure `updateInteractiveCursors()` (line ~4417) does NOT set `cursor = "default"` on the Ход/Pause button — only planet and NPC cursors should change during turns. (Confirmed: the function only iterates `planetSprites` and `npcSprites`; it never touches `playPauseButton`.)
- [x] Write unit test: mock `shipPhysics.stop` and `endTurn`, call `onPlayPause()` while `isTurnRunning=true` and `shipPhysics.isMoving=true`, assert `stop()` and `endTurn()` were both called. (`src/tests/playPauseImmediate.test.ts` — 3 cases: flying, holding station, and paused-no-op. Also added a `stop()` test to `shipPhysics.test.ts`.)
- [x] `npm run lint && npm test -- --run` — must pass. (0 lint errors; 809 unit tests pass.)

### Task 3: Pointer cursor on all interactive elements

**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`
- Modify: `src/presentation/ui/UiButton.ts` (verify)

- [x] In `updateInteractiveCursors()` (line ~4399), confirm the function only touches planet sprites and NPC ships — not the HUD buttons (Ход, back, quest). If HUD buttons are being reset to `"default"`, stop touching them. (Confirmed: the function iterates only `planetSprites` and `npcSprites`; it never references `playPauseButton`, `backButton`, or the quest text button.)
- [x] On the stage-level pointerover/pointerout handler (if any): do not override cursor when the pointer is over a Container with `cursor` already set. PixiJS should propagate the innermost `cursor` automatically — check if the global stage `cursor` property is overriding children. (Confirmed: the only stage handler is `onPointerMove`, which handles panning only; cursor is never written on the stage. PixiJS resolves the hovered display object's `cursor` via `events.cursorStyles` set in `installGameCursors`. The only direct canvas-cursor writes are `setCanvasCursor("grab"/"default")` during pan, which release back to default — no children overridden.)
- [x] Add `cursor = "pointer"` explicitly in `createHUD()` for the Ход button container after it is created, so it cannot be overridden by scene-level cursor updates. (`playBtn.container.cursor = "pointer"` set right after the button is built — belt-and-suspenders over the UiButton constructor's own `container.cursor = "pointer"`.)
- [x] Verify `NpcShipSprite.setClickHandler()` (line 140): `cursor = "pointer"` (or `"target"`) is already set — confirm it's not cleared by `updateInteractiveCursors()` when `isTurnRunning = false`. (Confirmed: `setClickHandler` sets `"target"` for pirates and `"pointer"` otherwise; `updateInteractiveCursors(false)` re-applies the same mapping, so the intent cursor is restored, not cleared.)
- [x] `npm run lint && npm test -- --run` — must pass. (0 lint errors; 811 unit tests pass, incl. new `src/tests/hudCursors.test.ts`.)

### Task 4: Replace solar corona and flares with quality glow

**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`

Current state: `createStarProminences()` (line 2041) draws 3 corona rings + 4–6 triangular bezier spikes that look cheap. The halo (line 1989) already applies blur correctly but is buried under the ugly rings.

- [x] Remove the call to `createStarProminences()` from wherever it is called in `initialize()` / star setup. Remove the `updateProminences()` call from `update()`. Remove the `this.prominences` field and `drawProminence()` method entirely. (Removed the `createStarProminences(R, rng)` call in `createStar`, the prominence-animation loop in `updateStar`, the `starProminenceData` field + its `destroy()` reset, and both `createStarProminences()` and `drawProminence()` methods.)
- [x] In `buildStarHalo()` (line ~1989), replace the 5 concentric circles with a 3-layer radial glow stack. Layer sizes relative to star radius R: outer `4.5R` (very faint, alpha 0.08), mid `2.5R` (alpha 0.18), inner `1.5R` (alpha 0.30). Apply a single `BlurFilter(80)` with `blendMode = "screen"`. Use warm star color (yellow/white) for all layers. (3 layers at 4.5R/2.5R/1.5R, alpha 0.08/0.18/0.30, single warm `glowC` per star type, `blendMode = "screen"`, `paddedBlur(80)` — strength 80 with padding so the falloff never shows a rectangular band at camera zoom, the codebase's BlurFilter wrapper.)
- [x] Add a thin bright limb ring at exactly `1.0R` using `Graphics.circle(0,0,R).stroke({color: 0xffffff, alpha:0.6, width:2})` to give the sun a defined edge without a harsh clip. (Added as a separate `limb` Graphics child of the halo.)
- [x] Remove the 3 corona ring Graphics inside `createStarProminences()` — they are now replaced by the halo layers above. (Whole method removed.)
- [x] Preserve the `buildStarLimbMask()` and rotating surface — only the corona decoration changes. (Both untouched; `updateStar` still rolls the sphere/tiling/procedural surface.)
- [x] Write unit test: after star setup, assert `this.prominences` is empty (or undefined), and `this.starHalo` exists. (`src/tests/presentation/starHalo.test.ts` — asserts `starHaloContainer` exists, `starProminenceData` is undefined, halo is screen-blend with one filter, and `updateStar` advances without prominence animation.)
- [x] `npm run lint && npm test -- --run` — must pass. (0 lint errors; 815 unit tests pass, incl. 4 new.)

### Task 5: Add ship outline and volumetric glow

**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`

Ship is too flat/invisible. Need a rim highlight to give it 3D presence.

- [x] In `drawShip()` (line ~2285), after drawing the hull polygon, add a matching hull outline stroke: `this.shipGraphics.poly(hullPoints).stroke({color: 0x44ccff, alpha: 0.9, width: 1.5})`. This gives a crisp cyan edge. (Hull points hoisted into a `hull` const, filled `0x4488cc` then re-stroked `0x44ccff` alpha 0.9 width 1.5.)
- [x] Add a soft glow blob BEHIND the ship (drawn first, before hull): a blurred `Graphics.circle(0, 0, 18)` filled `0x2244aa` alpha 0.35, with `BlurFilter(8)` applied. This creates volumetric depth. (New `shipGlow` Graphics added to `shipContainer` first — before `shipGraphics`/sprite — drawn once with a filled circle, `paddedBlur(8)` so the falloff never shows a rectangular band under camera zoom. Nulled in `destroy()`.)
- [x] For the sprite-based ship (line ~2212, when `shipTex` is found): add `OutlineFilter` from `@pixi/filter-outline` if available, OR draw the same glow circle behind the sprite container. Check if `@pixi/filter-outline` is in package.json; if not, use the manual glow Graphics. (`@pixi/filter-outline` is NOT a dependency → used the manual glow path. The same `shipGlow` sits behind the sprite; its radius widens to `SHIP_SIZE * 1.6` for the sprite — which is ~2.6× larger — so the halo peeks out past the artwork edges; the procedural triangle keeps radius 18.)
- [x] Engine glow (line ~2322): increase pulse amplitude — `alpha: 0.55 + 0.45 * Math.sin(bgElapsed * 3)` instead of current value, and increase the glow radius slightly. (Engine flame alpha now swings 0.10–1.0 (`0.55 + 0.45 * sin`), flame reaches `0.7×` size (was 0.5×) and its base widened to `±size*0.4` (was ±0.3). `bgElapsed` is in ms so the `/80` time-base is kept — `* 3` would flicker every ~2 ms; `/80` gives a ~0.5 s pulse.)
- [x] `npm run lint && npm test -- --run` — must pass. (0 lint errors; 819 unit tests pass, incl. 4 new in `src/tests/presentation/shipGlow.test.ts`.)

### Task 6: Fix NPC ship clickability

**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`
- Modify: `src/presentation/NpcShipSprite.ts`

- [x] Find all places where `NpcShipSprite` containers have their `eventMode` changed during a turn (search for `eventMode` writes on npcShip containers in SpaceFlightScene). If any code sets `eventMode = "none"` on ships during the turn for reasons other than departure, change it to keep `"static"`. (Audited: the only `eventMode = "none"` write on an NPC container is in `NpcShipSprite.beginDeparture()` — the legitimate hyperjump-out case. `setClickHandler()` sets `"static"`. No turn-time code clobbers ship interactivity, so nothing to change.)
- [x] In `NpcShipSprite.setClickHandler()` (line ~140): verify `hitArea = new Circle(0, 0, 40)` is set. Confirm `updateHitArea()` is called when camera zoom changes so the hit circle stays ~40 screen-px regardless of zoom level. (Confirmed: `setClickHandler` sets `hitArea = new Circle(0, 0, 40)` and `eventMode = "static"`; `applyCameraTransform()` (line ~3245) calls `s.updateHitArea(this.cameraZoom)` for every NPC on each zoom/pan, keeping the hit circle ~40 screen-px — `worldR = max(28, 40 / zoom)`.)
- [x] In `updateInteractiveCursors()`: when `isTurnRunning = false`, re-apply `eventMode = "static"` on ALL NPC ships that are not departing (not just their cursor). This ensures any ship that lost interactivity during the turn is restored. (Added `NpcShipSprite.restoreInteractivity()` — sets `eventMode = "static"` unless `departing`/`gone`. `updateInteractiveCursors(false)` now calls it for every NPC, so any ship that lost its hit-area mid-turn becomes clickable again.)
- [x] Write unit test: construct a mock NpcShipSprite; call `setClickHandler()`; assert `container.eventMode === "static"` and `container.hitArea` is a Circle instance. (`src/tests/presentation/npcShipClickable.test.ts` — 3 cases: setClickHandler → static + Circle hit-area; restoreInteractivity revives a non-departing ship; departing ship stays `"none"`.)
- [x] `npm run lint && npm test -- --run` — must pass. (0 lint errors; 822 unit tests pass, incl. 3 new. Updated the `hudCursors.test.ts` NPC stubs with a `restoreInteractivity` no-op.)

### Task 7: Replace rectangular swarm/asteroid particles with glowing cosmic swarms

**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`

Current issue: some particles appear as grey rectangles. This is likely the asteroid `Sprite` objects using a rock texture that appears as a grey rectangle. Need to check what "flying rectangular things" are and replace with glowing point swarms.

- [x] Search SpaceFlightScene for `Sprite` objects added to sky/background layers that use rock/asteroid textures (search `pickVariant("asteroids"`, `"rocks"`, or any texture with `asteroid`). If found, replace each with a procedural glowing mote: a small Graphics `circle(0,0, r)` (r = 2–5px) filled bright white/blue with a `BlurFilter(3)` — these read as tiny light orbs. (Audited: there are NO `Sprite` objects using rock/asteroid textures — no `pickVariant("asteroids"`/`"rocks"` anywhere. The only `new Sprite()` calls are the nebula backdrop, star limb mask, and player ship. Asteroids are already procedural `Graphics` polygons (`drawAsteroid`), not flat grey-rectangle texture sprites — nothing to replace.)
- [x] Enhance `createSwarms()` (line ~1250): add a subtle per-mote `BlurFilter(2)` to individual mote Graphics (not the container — container-level blur was removed, per comment at line 1291, because it caused cartoon blobs). Per-mote blur on small circles creates a natural soft glow without the blob artifact. (Set `g.filters = [this.paddedBlur(2)]` on the per-swarm mote `Graphics` — the low strength-2 blur softens each tiny circle into a light orb; the container stays blur-free so the old high-strength-container-blur blob artifact can't return. `paddedBlur` keeps the falloff inside the filter texture so no rectangular band appears.)
- [x] Add a slow rotation to each SwarmLayer container (`container.rotation += drift.rotSpeed * dt`), adding `rotSpeed: number` field to `SwarmLayer` interface (line ~123). Random value `±0.0002` rad/frame. This makes swarms feel organic and alive. (Added `rotSpeed: rng.nextFloat(-0.0002, 0.0002)` to each layer and `s.container.rotation += s.rotSpeed` in `updateSwarms()`. Applied per-frame — same convention as the existing `driftX`/`driftY`, which the "rad/frame" unit matches — rather than scaled by dt, so the codebase's drift handling stays consistent.)
- [x] `npm run lint && npm test -- --run` — must pass. (0 lint errors; 826 unit tests pass, incl. 4 new in `src/tests/presentation/swarmGlow.test.ts`.)

### Task 8: Fix sun bypass arc smoothness

**Files:**
- Modify: `src/utils/flightGeometry.ts`

Current `avoidStarPath()` (line 120) generates 4–8 sparse control points on the arc then Catmull-Rom smooths them. Screenshot shows kinks — meaning either too few control points or the Catmull-Rom tension is wrong.

- [ ] In `avoidStarPath()` (line ~149), increase the arc radius clearance from `R * 1.08` to `R * 1.15` — gives a more visually natural wide arc around the star's glow.
- [ ] Increase base control point count from the current `4–8` range to `10–14` (per semicircle). More control points → smoother chord segments before spline interpolation.
- [ ] Increase Catmull-Rom interpolation subdivisions from 4 to 8 per gap (line ~157). This directly reduces kink size between control points.
- [ ] After the radius-clamp pass (line ~162), add one final smoothing pass: for every intermediate point (not start/end), nudge it to the average of its two neighbors — a single iteration of Laplacian smoothing that eliminates residual kinks without changing the overall arc shape.
- [ ] Write/update unit test in `src/tests/flightCurves.test.ts`: assert `avoidStarPath()` output has ≥ 20 points and no two consecutive points form an angle < 160° (i.e., no kinks > 20°).
- [ ] `npm run lint && npm test -- --run` — must pass.

### Task 9: Fix undocking from shipyard — player spawns at edge of system

**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts` or `src/systems/GameEngine.ts`

- [ ] Find where player world position is set when entering SPACE_FLIGHT from a STATION/EQUIPMENT_SHOP context. Search for `player.x`, `player.y`, `shipX`, `shipY` writes during `initialize()` or `transitionTo(SPACE_FLIGHT)`.
- [ ] When entering from a station, the player should spawn at the planet's orbital position (the planet they landed on), not at (0,0) or the system edge. Get the current planet position from `galaxy.systems[currentSystemId].planets.find(p => p.id === player.landedPlanetId)` and set ship position to that planet's orbital coords.
- [ ] If `player.landedPlanetId` is not tracked, add it: set it when landing (`transitionTo(PLANET)`) and clear it on takeoff. Store as an optional field on `Player` domain object; update `src/validation/schemas.ts` accordingly.
- [ ] Write unit test: simulate a STATION → SPACE_FLIGHT transition with a known `landedPlanetId`; assert ship initial position is within 200px of the planet's orbital position.
- [ ] `npm run lint && npm test -- --run` — must pass.

### Task 10: Fix fast engine equipment affecting ship speed

**Files:**
- Modify: `src/systems/ShipPhysics.ts`
- Modify: `src/systems/EquipmentSystem.ts` or `src/presentation/SpaceFlightScene.ts`

- [ ] Find where `ShipPhysics.maxSpeed` (or equivalent) is set. Search for `maxSpeed`, `shipSpeed`, `BASE_SHIP_SPEED` in ShipPhysics.ts and balance.ts.
- [ ] Find where equipped engine module stats are applied to the ship. Search for `EngineModule`, `speed` stat type, `playerLoadout.getEquipped`. If the engine's `{ type: "speed", value: 0.2 }` stat is never read by ShipPhysics, wire it in: `maxSpeed = BASE_SPEED * (1 + engineSpeedBonus)`.
- [ ] The `EngineModule` with `value: 0.2` at `GameEngine.ts:~279` has stat type `"speed"` — confirm `ShipPhysics` reads this stat from the loadout. If `ShipPhysics` takes a flat `speed` constant, change it to accept `baseSpeed` and multiply by `(1 + sum of engine speed bonuses)`.
- [ ] Write unit test: create a `ShipPhysics` with a `0.2` speed bonus engine module; assert `maxSpeed > BASE_SPEED`.
- [ ] `npm run lint && npm test -- --run` — must pass.

### Task 11: Logical planet placement by orbital distance

**Files:**
- Modify: `src/systems/galaxy/SystemGenerator.ts` (or wherever planets are generated)
- Modify: `src/config/balance.ts` if planet-type weights live there

Real solar systems follow the frost line: hot/rocky planets close to the star, gas giants and ice worlds far out. Currently a player can see an ice planet orbiting at the same radius as a volcanic world.

- [ ] Find planet type assignment in the galaxy/system generator. Search for `PlanetType`, `ice`, `volcanic`, `gas`, `habitat`, `terrestrial` assignment logic.
- [ ] Define orbital zones by radius relative to `SYSTEM_GEOMETRY.orbitRadii` (5 orbits at ~750–2750px). Map each zone to allowed types:
  - Orbit 0 (closest, ~750px): `volcanic`, `barren` only
  - Orbit 1 (~1250px): `volcanic`, `barren`, `terrestrial`
  - Orbit 2 (~1750px): `terrestrial`, `habitat`, `barren`
  - Orbit 3 (~2250px): `habitat`, `terrestrial`, `gas`
  - Orbit 4 (outer, ~2750px): `gas`, `ice` only
- [ ] Replace the current random planet type selection with a zone-constrained selection that picks only from the allowed set for each orbit index.
- [ ] Write unit test `src/tests/galaxy/planetZones.test.ts`: generate 50 random systems; for each planet, assert its type is in the allowed set for its orbit index.
- [ ] `npm run lint && npm test -- --run` — must pass.

### Task 12: Verify acceptance criteria

- [ ] `npm test -- --run` — all tests pass
- [ ] `npm run lint` — 0 errors
- [ ] `npm run test:e2e:regression` — passes

## Technical Details

**Planet mask fix (Task 1)** — PixiJS 8 requirement: a Graphics used as `.mask` must be in the scene graph. Pattern:
```typescript
const maskA = new Graphics().circle(0, 0, radius).fill({color: 0xffffff});
surface.addChild(maskA);   // ← must be in tree
surface.mask = maskA;
```

**Immediate pause (Task 2)** — replace deferred pauseRequested with immediate stop:
```typescript
if (this.isTurnRunning) {
  this.shipPhysics?.stop();
  this.endTurn();
  return;
}
```

**Quality sun glow (Task 4)** — 3-layer radial glow, no spikes:
```typescript
[[4.5, 0.08], [2.5, 0.18], [1.5, 0.30]].forEach(([scale, alpha]) => {
  const ring = new Graphics().circle(0, 0, R * scale).fill({color: 0xffcc55, alpha});
  halo.addChild(ring);
});
halo.filters = [new BlurFilter(80)];
halo.blendMode = "screen";
// thin limb ring
halo.addChild(new Graphics().circle(0,0,R).stroke({color:0xffffff,alpha:0.6,width:2}));
```

**Engine speed wiring (Task 10)** — stat application:
```typescript
const engineBonus = loadout.getEquipped("engine")
  ?.stats.filter(s => s.type === "speed")
  .reduce((sum, s) => sum + s.value, 0) ?? 0;
this.maxSpeed = BASE_SHIP_SPEED * (1 + engineBonus);
```

## Post-Completion

**Manual verification:**
- Generate several systems: inner orbits have rocky/volcanic planets, outer orbits have gas/ice
- Fly around system: planets render as circles, not rectangles
- Click Ход → ship flies → click again → ship stops immediately
- Hover all buttons: cursor shows hand/pointer
- Sun looks like a glowing star, no triangular spike artifacts
- Ship visible with cyan rim light against dark backgrounds
- Click NPC ships: tooltip or interaction menu appears
- Set a route around the sun: arc looks smooth, no visible kinks
- Undock from station: spawn near the planet, not at system edge
- Equip fast engine, compare speed vs no engine: noticeable difference
