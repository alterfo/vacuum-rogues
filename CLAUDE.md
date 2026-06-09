# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Galactic Horizon: Neural Onslaught** — browser-based space RPG/strategy game with local ONNX models for dialogue generation and tactical AI. Built with TypeScript, PixiJS 8, and onnxruntime-web.

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server (http://localhost:5173)
npm run build        # TypeScript compile + Vite production build
npm run preview      # Preview production build locally
npm run lint         # ESLint check on src/**/*.ts
npm test             # Run Vitest unit tests (watch mode)
npm test -- --run    # Run unit tests once (CI mode)
npm run test:e2e            # Run Playwright E2E tests (starts dev server on port 5175 automatically)
npm run test:e2e:headed     # E2E with visible browser
npm run test:e2e:debug      # E2E in debug mode
npm run test:e2e:regression # Run regression playtest suite only (fast gate, < 60 s, for CI)
```

**Run single test file:** `npm test -- --run src/tests/pathfinding.test.ts`

**E2E note:** E2E tests start their own dev server on port 5175 (`playwright.config.ts`). Do not rely on a running `npm run dev` instance for E2E.

## Architecture

### Layer Structure (strict dependency direction: top → bottom only)

| Layer | Directory | Responsibility |
|-------|-----------|----------------|
| Presentation | `src/presentation/` | PixiJS scenes, sprites, rendering, player input |
| Systems | `src/systems/` | GameEngine, AudioManager, trade, dialogue, galaxy generation; sub-modules: `equipment/`, `npc/`, `quests/`, `info/`, `combat/`, `galaxy/` |
| Domain | `src/domain/` | Pure entities (Player, Galaxy, StarSystem) — no PixiJS/ONNX/DOM deps |
| AI/Infrastructure | `src/ai/`, `src/data/` | ONNX inference, Web Workers, IndexedDB, save management |
| Types/Config | `src/types/`, `src/config/` | Shared types, enums, balance constants; `FactionType` replaces old `RaceType` |

### Key Entry Points

- `src/main.ts` — App entry: Service Worker registration, GameEngine initialization
- `src/systems/GameEngine.ts` — Central engine: scene transitions, game loop, save coordination
- `src/presentation/GameScene.ts` — Base scene class: `initialize()`, `update(dt)`, `destroy()`

### ONNX/AI Pipeline

Models load lazily → cached in IndexedDB → inference runs in Web Workers only. Never call `ort.InferenceSession.run()` on main thread — use `ONNXModelRegistry.infer()`.

### Texture Loading

`src/presentation/textures.ts` — `LAZY_PREFIXES` excludes heavy categories from eager boot preload. Current lazy categories: `panoramas/`, `planet_maps/`, `star_maps/`, `stars/`, `nebula/`.

**Pattern for lazy categories** (must NOT use synchronous `pickVariant`):
```typescript
const key = pickVariantKey("nebula", prefix, seed);
if (key) {
  const cached = tex(key);
  if (cached) mount(cached);
  else void loadTextureAsync(key).then((t) => { if (t && !this.sceneDestroyed) mount(t); });
}
```
Any new art category with >10 MB total must be added to `LAZY_PREFIXES`.

## Critical Coding Rules

### Input Handling (PixiJS)
- **No hardcoded pixel coordinates** for click detection. Use `eventMode = 'static'` + event handlers on interactive objects.
- Position UI in world/relative coordinates, not screen pixels.

#### PixiJS Event Handling Rules (CRITICAL)

**Rule 1: Never Set `eventMode='none'` on Containers with Interactive Children**

`eventMode='none'` on a Container **blocks ALL events** for children, even if children have `eventMode='static'`.

```typescript
// ❌ WRONG - breaks all child buttons
const uiContainer = new Container();
uiContainer.eventMode = 'none'; // Children won't receive events!

const button = new Text({ text: '[CLICK ME]' });
button.eventMode = 'static';
button.on('pointerdown', handleClick); // Never fires!
uiContainer.addChild(button);

// ✅ CORRECT - use default 'auto' or omit eventMode
const uiContainer = new Container();
// eventMode defaults to 'auto' - children can receive events

const button = new Text({ text: '[CLICK ME]' });
button.eventMode = 'static';
button.on('pointerdown', handleClick); // Works!
uiContainer.addChild(button);
```

**Use `eventMode='none'` ONLY for**:
- Non-interactive leaf elements (instruction text, labels)
- Elements that should explicitly ignore all events

**Never use on**:
- Containers with buttons/interactive children
- Layouts with nested UI

**Rule 2: Always Use `event.stopPropagation()` in UI Click Handlers**

If UI elements are above layers with global event handlers (stage, gameLayer), prevent event bubbling:

```typescript
// ❌ WRONG - event bubbles to stage
button.on('pointerdown', () => {
  this.openMenu();
  // Event continues bubbling → stage.on('pointerdown') also fires!
});

// ✅ CORRECT - stop propagation
button.on('pointerdown', (event) => {
  event.stopPropagation(); // CRITICAL!
  this.openMenu();
});
```

**Required for**:
- All UI buttons over gameLayer/stage with global handlers
- Planet/entity click handlers
- Modal dialogs and panels
- Any interactive element in a layered UI

**Rule 3: Set `eventMode='none'` on Text Elements Over Clickable Areas**

PixiJS Text elements default to `eventMode='auto'`, making them clickable and blocking clicks underneath.

```typescript
// ❌ PROBLEM - text blocks clicks on card background
const cardBg = new Graphics();
cardBg.eventMode = 'static';
cardBg.on('pointerdown', () => selectCard());

const label = new Text({ text: 'Card Title' });
// Text blocks clicks - they don't reach cardBg!
cardContainer.addChild(label);

// ✅ SOLUTION - make text transparent to clicks
const label = new Text({ text: 'Card Title' });
label.eventMode = 'none'; // Clicks pass through
cardContainer.addChild(label);
```

**Apply to**:
- All Text elements overlaying clickable Graphics/Sprites
- Labels on buttons, cards, panels
- Non-interactive UI text

**Rule 4: Distinguish Mouse Buttons in Event Handlers**

Use `event.button` to handle different mouse buttons separately:

```typescript
private onPointerDown(event: FederatedPointerEvent): void {
  // button === 0: left button (primary action)
  // button === 1: middle button (wheel click)
  // button === 2: right button (context menu)

  if (event.button === 1 || event.button === 2) {
    // Camera pan
    this.isPanning = true;
    this.lastPanX = event.global.x;
    this.lastPanY = event.global.y;
    return;
  }

  if (event.button === 0) {
    // Primary action (select, navigate)
    this.handlePrimaryClick(event);
  }
}
```

**Rule 5 (PixiJS 8): Graphics Mask Must Be addChild()'d to the Masked Object**

In PixiJS 8, a `Graphics` used as `.mask` **must** be in the scene graph as a child of the masked object. Without `addChild()`, the mask is silently ignored and the object renders with its full bounding box (rectangles instead of circles).

```typescript
// ❌ WRONG — mask ignored, planets render as rectangles
surface.mask = maskGraphics;

// ✅ CORRECT — addChild BEFORE assigning mask
surface.addChild(maskGraphics);
surface.mask = maskGraphics;
```

This applies to ALL masked containers: planet surface, atmosphere shade, tiling sprite.

**Rule 6: Update Scale-Dependent UI When Changing World Scale**

When changing world coordinates or zoom levels, update ALL dependent UI elements:

**Checklist**:
- [ ] Update world/game coordinates
- [ ] Update minimap/radar scale (proportionally)
- [ ] Update camera zoom bounds (MIN_ZOOM, MAX_ZOOM)
- [ ] Verify absolute-positioned UI elements
- [ ] Test edge cases (max zoom, edge of map)

**Example**: Increasing orbital radii 5x (150-550px → 750-2750px)
```typescript
// src/config/balance.ts  ← geometry constants live here (SYSTEM_GEOMETRY.orbitRadii)
ORBITAL_RADII = [750, 1250, 1750, 2250, 2750]; // 5x scale

// src/presentation/SystemMiniMap.ts
mapScale = 0.05; // Was 0.25, now divided by 5

// Math: 2750px * 0.05 = 137.5px (fits in 180px minimap) ✓
```

**Rule 7: Apply Camera Transforms to Single Parent Container**

For zoom/pan, transform one parent container (gameLayer), not individual objects:

```typescript
// ✅ CORRECT - single transform point
private applyCameraTransform(): void {
  this.renderer.gameLayer.scale.set(this.cameraZoom);
  this.renderer.gameLayer.x = this.cameraPanX;
  this.renderer.gameLayer.y = this.cameraPanY;
}

// ❌ WRONG - transforming individual objects
for (const planet of planets) {
  planet.sprite.scale.set(this.cameraZoom); // Performance killer!
  planet.sprite.x += this.cameraPanX;
}
```

**Benefits**:
- Single matrix transform (fast)
- UI layer unaffected
- Consistent behavior
- Easy debugging

**Rule 8: If a Fix Creates New Bugs, Revisit the Root Cause**

**Anti-pattern "Ping-Pong Fix"**:
```
Bug A → Fix 1 → Bug B → Fix 2 → Bug C → ...
```

If your fix breaks adjacent functionality, you're treating **symptoms**, not the **cause**.

**Example from commits**:
1. UI blocks space clicks → Add `eventMode='none'` to container
2. Buttons stop working → Add `stopPropagation()` to buttons
3. Realize: Step 1 was wrong → Remove `eventMode='none'`

**Correct approach**:
1. **Diagnose**: Why does UI block clicks? (Events bubble to stage)
2. **Root cause**: Need to stop bubbling, not block events
3. **Solution**: `stopPropagation()` only (no eventMode change)

**Rule 9: Pass Scene Context Explicitly, Not via Global Flags**

When transitioning scenes with different behaviors, pass context through parameters:

```typescript
// ❌ WRONG - global flag
this.isReentryWithoutJump = true;
await gameEngine.transitionTo(SceneType.SPACE_FLIGHT);

// ✅ CORRECT - explicit state changes + context
private async enterCurrentSystem(): Promise<void> {
  // No state change needed - just transition
  await this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, {
    gameEngine: this.gameEngine,
  });
}

private async performWarpJump(target: StarSystem): Promise<void> {
  // Modify state BEFORE transition
  this.player.currentSystemId = target.id;
  this.player.fuel -= fuelCost;

  await this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, {
    gameEngine: this.gameEngine,
  });
}
```

**Benefits**:
- Explicit vs implicit behavior
- No race conditions
- Logic visible at call site
- Easier testing

### Scene Lifecycle
- `destroy()` must clean up ALL DisplayObjects, intervals, and null out references. Partial cleanup causes memory leaks.
- Scenes cannot access IndexedDB or ONNX directly — route through GameEngine → SaveManager / ONNXModelRegistry.

### Domain & Types
- Domain fields should be `readonly`. Mutation via explicit methods only.
- **Any change to `src/types/index.ts` or `src/domain/*.ts` requires updating `src/validation/schemas.ts`** — otherwise save games break.

### Errors & Logging
- Throw only `GameBusinessException`, `GameSystemException`, `GameValidationException`, or `InferenceException` (from `src/exceptions/`).
- Use `src/utils/logger.ts` instead of `console.log`.

### E2E Testing (Playwright)
- Tests live in `e2e/`, Page Objects in `e2e/page-objects/`.
- **No `canvas.click({ position: {x, y} })`** — use `page.evaluate(() => window.__gameEngine.currentScene.handler())` or accessibility attributes.
- No `waitForTimeout()` — use explicit waits (`waitForFunction`, `waitForSelector`).
- In dev/test mode, `window.__gameEngine` is exposed for test access.
- Reusable helpers in `e2e/helpers/`: `GameDriver` (typed `__gameEngine` wrapper), `ErrorCollector` (JS error listener — always call `assertAndDetach()` at test end), `MonkeyTester` (seeded random input generator).
- Shared fixtures in `e2e/fixtures/mockHeavySystems.ts` — call `applyMockHeavySystems(page)` before `page.goto()` to stub ONNX, audio, and animations in every E2E test.
- The `regression` Playwright project (`npm run test:e2e:regression`) targets only `playtest-regression.spec.ts` — a fast gate for CI on every PR.
- Scenes may expose `e2e*` methods (e.g. `e2eSelectFaction`, `e2eLandOnPlanet`) to allow test drivers to bypass UI interactions. Guard with `if (__DEBUG__)` to strip from production builds.

## Adding New Features

### New Scene
1. Create class extending `GameScene` in `src/presentation/`
2. Add `SceneType.MY_SCENE` to `src/types/index.ts`
3. Add a `case SceneType.MY_SCENE:` to `src/core/services/SceneFactory.ts`
4. If the scene requires transient context (planet, NPC, station), add it to `contextDependentScenes` in `GameEngine.loadGame()` so "Continue" falls back to SPACE_FLIGHT instead of a blank screen (currently: `PLANET`, `TRADE`, `DIALOGUE`, `COMBAT`, `INVENTORY`, `STATION`, `EQUIPMENT_SHOP`, `GOVERNMENT`, `TEXT_QUEST`, `WIN_SCREEN`, `INFO_CENTER`)
5. Add Page Object in `e2e/page-objects/` for E2E tests

### New Audio Track or SFX
- Music files: `public/audio/mus_<key>.ogg` — add a `TrackKey` entry in `src/systems/AudioManager.ts`
- SFX files: `public/audio/sfx_<key>.ogg` — add a `SfxKey` entry in `src/systems/AudioManager.ts`
- Play from any scene via `this.gameEngine.audio.playTrack(key)` / `this.gameEngine.audio.playSfx(key)`

### New Art Asset
- Drop the file into `src/assets/<category>/` (e.g. `src/assets/planets/`). The Vite glob manifest (`src/assets/manifest.ts`) picks it up automatically — no code change needed.
- Naming convention: `<type>_<NN>` (e.g. `habitat_07.png`).
- Access via `texture(key)` / `texUrl(key)` from `src/presentation/textures.ts`.

### New ONNX Model
1. Add config to `src/ai/ModelManifest.ts`
2. Create adapter in `src/ai/adapters/` with `preprocessInput()`, `postprocessOutput()`, `infer()`
3. Implement fallback in `src/ai/FallbackEngine.ts`
4. Add test in `src/tests/`

### New Domain Field
1. Update type in `src/types/index.ts` or `src/domain/*.ts`
2. Update Zod schema in `src/validation/schemas.ts`
3. Add migration in `src/data/MigrationPipeline.ts` if needed

## TypeScript Configuration

- Strict mode enabled (`strict: true`, `noImplicitAny`, `noUnusedLocals`)
- Path alias: `@/*` → `src/*`
- Target: ES2022, module: ESNext
- `__DEBUG__` global available (true in development)

## Plan Format (Ralphex)

All implementation plans in `docs/plans/` **must** use ralphex-compatible format — the plan runner rejects files that deviate.

**Required top-level structure (in order):**

```markdown
---
# Plan Title

## Overview
One-paragraph summary.

## Context
Key files, related US/EPICs, current state.

## Development Approach
TDD order, ordering constraints, applicable rules.

## Implementation Steps

### Task 1: Short Title
**Files:**
- Modify: path/to/file.ts
- Create: path/to/new.ts

- [ ] acceptance criterion or implementation step
- [ ] acceptance criterion or implementation step

### Task 2: Short Title
...
```

**Validation rules (enforced by ralphex):**

| Rule | Detail |
|------|--------|
| File starts with `---` | YAML front-matter separator — line 1 |
| `## Overview` present | Required section |
| `## Context` present | Required section |
| `## Development Approach` present | Required section |
| `## Implementation Steps` present | Required section |
| Tasks use `### Task N:` | Colon required; ralphex matches this exact pattern |
| Each task has `- [ ]` checkboxes | At least one per task — tracked as progress |
| `**Files:**` block per task | Recommended for traceability; not validated |

Do **not** use `## 1.` / `## 0.` section numbering — ralphex ignores those.  
Use `### Iteration N:` only for time-boxed sprint iterations, not regular tasks.

## Project Status

Phase 2 (Вакуумные Пройдохи) — core gameplay loops: economy, equipment/hull, NPC living galaxy, quest generator, text quests (QuestVM + 6 scripts), government dialogue, station services, info center, combat AI, fog-of-war star map, audio.

**Completed plans** (see `docs/plans/completed/`): Sprint 1 (rename, pan, minimap), Sprint 2 (ShipPhysics, PanZoomController, sun arc, AudioManager, FlightCombatResolver, UiButton, panorama parallax, SpaceBackgroundLayer), art-assets (ComfyUI workflows, PlanetRotationFilter, PanoramaViewer), planet-parallax-and-click-audit (central layer clear in transitionTo(), teardown audit), Sprint 3 (planet circular masking, immediate pause, HUD cursor pinning, 3-layer star glow, ship outline/glow, NPC clickability, glowing swarm particles, smooth sun arc, undock-beside-station spawn, engine-speed wiring, frost-line planet placement).

**Active plan**: `docs/plans/20260609-refactor-spaceflight-solid.md` — SOLID/GRASP decomposition of SpaceFlightScene (5200 lines → ~600 line coordinator + 9 modules in `src/presentation/flight/`).

**Known caveat (Sprint 3, Task 10)**: the "fast engine affects speed" wiring reads the legacy `Player.ship.modules` (`EngineModule`) via `engineSpeedBonus()`, but `EquipmentSystem` has no production callers, so `ship.modules` is never populated in normal play — the bonus is `0` and cruise speed still comes solely from the GearCatalog `ShipLoadout.derivedStats().speed`. Engine upgrades bought in the shop already affect speed through that path; the legacy bonus is currently inert. Decide which engine system is canonical before relying on it.

**Re-entry spawn convention (Sprint 3, Task 9)**: when transitioning back to `SPACE_FLIGHT` from a docked scene, pass `fromStationId`/`fromPlanetId` in the context so `applyReentrySpawn()` parks the ship beside the marker instead of at the system edge. `Player.landedPlanetId` (set in `GameEngine.transitionTo` on landing, consumed/cleared on take-off) is the fallback for context-less re-entry — see Rule 9.

**Known unresolved bug**: `DialogueSystem` session key mismatch — sessions stored under `dlg_<npcId>_<timestamp>` but history-restore lookup uses `npc.id`; keys never match, session map grows unbounded (memory leak).
