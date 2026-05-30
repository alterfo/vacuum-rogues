# Story Decomposition: PixiJS Renderer and Scene Management

## INVEST Analysis

### Abstract Task

**"PixiJS Rendering Engine and Scene System"**

**Analysis Dimensions**:
- **Core Responsibility**: Provide the visual foundation for the game by replacing rendering stubs with a production-ready PixiJS-based engine and a manageable scene lifecycle system.
- **Primary Operations**: Initialize PixiJS Application, create/mount/unmount scenes, switch between game screens, integrate with the game loop.
- **Key Constraints**: Must support WebGL with Canvas2D fallback, target 60 FPS, adapt to screen sizes from 1024px, must not block the main thread during initialization.
- **Technical Complexity**: Medium — PixiJS integration is well-documented, but scene lifecycle and game-loop coupling require careful design.
- **Business Complexity**: Low — clear visual requirements from GDD, no ambiguous business rules.

### INVEST Evaluation

- ✅ **Independent**: Can be developed and tested without ONNX, PWA, or save systems.
- ✅ **Negotiable**: Scene transition effects, exact resolution handling, and PixiJS version can be discussed.
- ✅ **Valuable**: Without a renderer, the game has no visual output; this unlocks all UI and gameplay visuals.
- ✅ **Estimable**: Standard PixiJS setup; 3–5 days for a senior frontend developer.
- ✅ **Small**: Three core functional points (initialization, scene base class, concrete scenes).
- ✅ **Testable**: Scenes can be mounted/unmounted in test environment; FPS and presence of canvas are verifiable.

**Conclusion**: Ready as-is.

### Split Strategy

Not needed — the task naturally forms a single cohesive story with ≤3 functional points.

---

## [STORY-001-001] PixiJS Renderer and Scene Management

### Background

The game currently relies on rendering stubs (empty divs or raw canvas without a rendering framework). To deliver the sci-fi visual experience described in the GDD — dynamic starfields, hexagonal tactical grids, holographic UI panels — we need a robust 2D/WebGL rendering foundation. PixiJS was selected as the rendering engine. This story establishes that foundation and introduces a scene-management system so the player can seamlessly move between the main menu, star map, tactical combat, and dialog screens without page reloads.

Key points:
- All future visual features (sprites, shaders, particle effects) depend on this renderer.
- Scene management is required for the Phase 1 MVP loop: menu → star map → combat → dialog → back to map.
- The GDD specifies a target of 60 FPS on mid-tier devices and graceful fallback for older hardware.

### Business Value

- Provide a visible game world for the player, replacing non-functional stubs.
- Support seamless switching between game screens (menu, star map, combat, dialog) without disrupting immersion.
- Lay the technical foundation for all upcoming visual and interactive features.

### Dependencies and Assumptions

- **Prerequisites**: Basic HTML5 shell page and build toolchain (Vite/Webpack) are operational.
- **Data assumptions**: No persisted game state is required for this story; scenes can use hard-coded mock data.
- **Integration points**: The game loop (requestAnimationFrame tick) must integrate with PixiJS's Ticker or a custom loop.
- **Business constraints**: Must run in modern browsers (Chrome, Firefox, Safari, Edge) with WebGL 1.0+ support; Canvas2D fallback must be available.

### Scope In

- Initialize PixiJS `Application` with responsive resizing, WebGL/Canvas fallback, and 60 FPS target.
- Create an abstract `Scene` base class/interface with `mount()`, `unmount()`, and `update(delta)` lifecycle methods.
- Implement four concrete scenes: `MainMenuScene`, `StarMapScene`, `TacticalCombatScene`, `DialogScene` (minimal content — colored background or placeholder sprite is sufficient).
- Implement a `SceneManager` that handles transitions between scenes (immediate swap; fade transition is optional if time permits).
- Integrate scene updates with the central game loop.

### Scope Out

- Complex animated transitions (wipes, 3D flips) between scenes.
- Sound effects or music triggers on scene change.
- Fully implemented UI widgets inside scenes (buttons, panels, HUD) — those are separate UI stories.
- Custom GLSL shaders, particle effects, and advanced visual polish.

### Acceptance Criteria (ACs)

#### AC1: Renderer Initialization
**Given** the player opens the game in a WebGL-capable browser
**When** the application boot sequence completes
**Then** a PixiJS canvas is injected into the DOM, the renderer initializes within 2 seconds, and the ticker runs at 60 FPS

#### AC2: Scene Switching to Star Map
**Given** the player is on the Main Menu scene
**When** the player selects "New Game" or "Continue"
**Then** the Main Menu scene is cleanly unmounted, the Star Map scene is mounted, and the canvas displays the star map placeholder without memory leaks or console errors

#### AC3: Scene Switching to Tactical Combat
**Given** the player is on the Star Map scene
**When** an encounter with an enemy ship is triggered
**Then** the Star Map scene is unmounted, the Tactical Combat scene is mounted, and a hexagonal grid placeholder is visible

#### AC4: Return from Combat to Star Map
**Given** the player has completed a combat encounter (victory or retreat)
**When** the player presses "Continue"
**Then** the Tactical Combat scene is unmounted, the Star Map scene is remounted, and the previously viewed sector is restored from mock state

#### AC5: Canvas2D Fallback
**Given** the player's browser does not support WebGL
**When** the game initializes
**Then** PixiJS automatically falls back to Canvas2D rendering, the game remains playable, and a one-time console warning is emitted

#### Non-Functional Expectations
- Renderer initialization must complete in under 2 seconds on a mid-tier device (Intel Core i5 8th gen equivalent).
- Scene switching latency must remain below 100 ms to avoid perceptible stutter.
