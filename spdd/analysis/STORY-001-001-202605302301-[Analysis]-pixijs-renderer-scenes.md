# SPDD Analysis: PixiJS Renderer and Scene Management

## Original Business Requirement

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

- Independent: Can be developed and tested without ONNX, PWA, or save systems.
- Negotiable: Scene transition effects, exact resolution handling, and PixiJS version can be discussed.
- Valuable: Without a renderer, the game has no visual output; this unlocks all UI and gameplay visuals.
- Estimable: Standard PixiJS setup; 3–5 days for a senior frontend developer.
- Small: Three core functional points (initialization, scene base class, concrete scenes).
- Testable: Scenes can be mounted/unmounted in test environment; FPS and presence of canvas are verifiable.

**Conclusion**: Ready as-is.

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

---

## Domain Concept Identification

### Existing Concepts (from codebase)

- **GameScene**: Abstract base class (`src/presentation/GameScene.ts:3-13`) — defines scene lifecycle with `initialize(context?)`, `update(deltaTime)`, `destroy()` methods. Holds reference to `Renderer`.

- **Renderer**: PixiJS wrapper (`src/presentation/Renderer.ts:4-66`) — encapsulates `Application`, `stage`, `uiLayer`, `gameLayer`. Provides `initialize()`, `resize()`, `clearGameLayer()`, `clearUILayer()`, `destroy()`.

- **GameEngine**: Central orchestrator (`src/systems/GameEngine.ts:28-368`) — manages scene lifecycle via `transitionTo(sceneType, context)`, runs `gameLoop()` with `requestAnimationFrame`, handles error recovery.

- **SceneType**: Enum (`src/types/index.ts:82-89`) — defines scene identifiers: `MAIN_MENU`, `STAR_MAP`, `COMBAT`, `DIALOGUE`, `INVENTORY`, `SPACE_FLIGHT`.

- **MainMenuScene**: Concrete scene (`src/presentation/MainMenuScene.ts`) — implements main menu with buttons for New Game, Continue, Flight demo, ONNX demo.

- **StarMapScene**: Concrete scene (`src/presentation/StarMapScene.ts`) — implements galaxy navigation with interactive star systems.

- **CombatScene**: Concrete scene (`src/presentation/CombatScene.ts`) — placeholder for tactical combat grid.

- **DialogueScene**: Concrete scene (`src/presentation/DialogueScene.ts`) — placeholder for NPC dialogues.

- **SpaceFlightScene**: Concrete scene (`src/presentation/SpaceFlightScene.ts`) — implements real-time spaceship control demo.

- **InventoryScene**: Concrete scene (`src/presentation/InventoryScene.ts`) — placeholder for inventory management.

### New Concepts Required

**None** — All concepts described in User-story-1 are already implemented in the codebase.

### Key Business Rules

- **Scene lifecycle integrity**: Every scene must implement `initialize()`, `update()`, `destroy()` — enforced by abstract `GameScene` class
- **Clean teardown**: `destroy()` must clear all DisplayObjects, intervals, and null references to prevent memory leaks
- **Single active scene**: Only one scene can be active at a time — GameEngine nulls `currentScene` before creating new one
- **Renderer dependency**: Scenes cannot function without initialized Renderer — GameEngine throws `RENDERER_NOT_READY` if not available
- **Layer separation**: Game objects go to `gameLayer`, UI elements go to `uiLayer` — maintains z-ordering and separation of concerns

---

## Strategic Approach

### Solution Direction

The implementation follows a **Renderer + Scene Manager + Game Loop** architecture where:
- `Renderer` wraps PixiJS Application and provides layered container hierarchy
- `GameEngine.transitionTo()` acts as the scene manager, handling teardown and instantiation
- Game loop runs via `requestAnimationFrame` and delegates to `currentScene.update()`

### Key Design Decisions

- **Scene lifecycle as abstract class (vs interface)**: Chose abstract class to hold common `renderer` reference and enforce constructor signature — trade-off is less flexibility but stronger contract enforcement.

- **Scene manager in GameEngine (vs separate class)**: Scene management is embedded in GameEngine rather than extracted to separate SceneManager — trade-off is simpler architecture but tighter coupling. Acceptable given current scope.

- **Layered container hierarchy (gameLayer + uiLayer)**: Separates game world from UI — enables independent clearing and z-ordering without complex depth management.

- **Immediate scene swap (no transitions)**: Current implementation does immediate swap without fade/wipe transitions — matches "Scope Out" and can be enhanced later.

- **Canvas2D fallback via PixiJS auto-detection**: Relies on PixiJS 8 built-in fallback rather than manual detection — simplifies code but depends on library behavior.

### Alternatives Considered

- **Separate SceneManager class**: Rejected — would add indirection without clear benefit at current scale
- **Scene stack (push/pop)**: Rejected — current game flow is linear, not nested; stack adds complexity
- **Custom renderer abstraction over PixiJS**: Rejected — over-engineering given PixiJS 8 stability

---

## Risk & Gap Analysis

### Requirement Ambiguities

- **"60 FPS target"**: Requirement states target but doesn't specify measurement method or acceptable variance — current implementation relies on PixiJS ticker but doesn't actively monitor FPS.

- **"Responsive resizing"**: Requirement mentions "adapt to screen sizes from 1024px" but doesn't specify behavior below 1024px or aspect ratio handling.

### Edge Cases

- **Multiple rapid scene transitions**: If user triggers transitions faster than scene initialization completes, race conditions could occur — current implementation doesn't queue or debounce transitions.

- **Browser tab backgrounding**: When tab loses focus, `requestAnimationFrame` pauses — scene state remains intact but time-sensitive game logic might drift.

- **WebGL context loss**: If GPU resets or browser reclaims WebGL context, renderer becomes invalid — no explicit recovery handling exists.

### Technical Risks

- **Memory leaks from improper cleanup**: If scene `destroy()` doesn't clear all children and event listeners, memory accumulates — mitigated by `clearGameLayer()`/`clearUILayer()` helpers but requires discipline.

- **PixiJS 8 breaking changes**: Project uses PixiJS v8 which has API changes from v7 — some type assertions are needed (e.g., `renderer.type` access).

### Acceptance Criteria Coverage

| AC# | Description | Addressable? | Gaps/Notes |
|-----|-------------|--------------|------------|
| AC1 | Renderer Initialization | Yes (Implemented) | `Renderer.initialize()` creates canvas, checks fallback. No explicit 2-second timeout enforcement. |
| AC2 | Scene Switching to Star Map | Yes (Implemented) | `MainMenuScene.handleNewGame()` → `transitionTo(STAR_MAP)` with proper cleanup. |
| AC3 | Scene Switching to Tactical Combat | Yes (Implemented) | `transitionTo(COMBAT)` supported. CombatScene exists as placeholder. |
| AC4 | Return from Combat to Star Map | Yes (Implemented) | `transitionTo(STAR_MAP)` can remount scene. State restoration depends on GameEngine.galaxy/player. |
| AC5 | Canvas2D Fallback | Yes (Implemented) | `Renderer.initialize()` checks renderer type and logs warning for canvas fallback. |

### Implementation Status

**This story is FULLY IMPLEMENTED.** The codebase at `src/presentation/` and `src/systems/GameEngine.ts` contains all required functionality:
- PixiJS 8 Application with WebGL/Canvas2D fallback
- Abstract GameScene with lifecycle methods
- 6 concrete scene implementations (exceeds requirement of 4)
- Scene management via GameEngine.transitionTo()
- Game loop integration via requestAnimationFrame

### Recommendations

1. **Add FPS monitoring**: Implement optional FPS counter in debug mode to verify 60 FPS target
2. **Add transition debouncing**: Prevent rapid-fire scene transitions that could cause race conditions
3. **Add WebGL context loss recovery**: Listen for `webglcontextlost` event and attempt recovery
4. **Document responsive breakpoints**: Clarify behavior for screens < 1024px
