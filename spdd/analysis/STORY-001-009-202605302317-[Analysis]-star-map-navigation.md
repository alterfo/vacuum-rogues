# SPDD Analysis: Star Map Generation and Navigation

## Original Business Requirement

# Story Decomposition: Star Map Generation and Navigation

## INVEST Analysis

### Abstract Task

**"Procedural Galaxy Generation and Interstellar Travel System"**

**Analysis Dimensions**:
- **Core Responsibility**: Generate a galaxy of 10 star systems with random names and coordinates, display warp lines between them, and allow the player to travel between connected systems.
- **Primary Operations**: Generate systems with seeded RNG, assign coordinates, create warp connections, render star map, handle player travel selection, update fog of war.
- **Key Constraints**: Generation must be deterministic for a given seed; warp lines must connect logically; travel must be confirmed by the player.
- **Technical Complexity**: Medium — seeded RNG, graph generation, coordinate layout.
- **Business Complexity**: Medium — fog of war and travel confirmation are player-facing mechanics.

### Scope In

- Generate exactly 10 star systems with random names and 2D coordinates using a seeded RNG.
- Create warp connections between systems (each system has 1–3 connections).
- Render the star map: systems as clickable nodes, warp lines as connecting edges.
- Display system names on hover or click.
- Allow the player to select a connected system and confirm a warp jump.
- Move the player ship to the selected system upon confirmation.
- Implement fog of war: only the current system and its direct warp neighbors are visible initially.
- Reveal connected systems when the player enters a new system.

### Scope Out

- System contents (planets, stations, NPCs) — systems are empty nodes for now.
- Animated warp jump sequences (a simple fade or instant transition is sufficient).
- Galaxy-wide events or dynamic system state changes.
- Multiple galaxy seeds or galaxy regeneration.

### Acceptance Criteria (ACs)

#### AC1: Galaxy Generation
**Given** a player starts a new game with seed "ranger-42"
**When** the galaxy initializes
**Then** exactly 10 star systems are generated with unique names and 2D coordinates, and the layout is identical every time seed "ranger-42" is used

#### AC2: Warp Connections
**Given** the galaxy has been generated
**When** the star map is displayed
**Then** each system has at least 1 and at most 3 warp connections to other systems, and the entire graph is connected (no isolated systems)

#### AC3: Fog of War — Initial State
**Given** the player has just started the game
**When** the star map is displayed
**Then** only the starting system and its directly connected neighbors are visible; all other systems are hidden under fog

#### AC4: Fog of War — Reveal on Travel
**Given** the player is in system "Alpha" which is connected to "Beta" and "Gamma"
**When** the player warps to "Beta"
**Then** "Beta" and its directly connected neighbors (excluding already revealed systems) become visible

#### AC5: Warp Jump Confirmation
**Given** the player is in system "Solaris" and "Centauri" is a connected neighbor
**When** the player clicks on "Centauri"
**Then** a confirmation dialog appears: "Прыгнуть в систему Центавра?" with "Да" and "Нет" buttons

#### AC6: Successful Warp Jump
**Given** the player confirms a warp jump to "Centauri"
**When** the jump completes
**Then** the player's current system is updated to "Centauri", the ship icon moves to "Centauri", and the fog of war updates accordingly

#### AC7: Warp to Unconnected System Prevented
**Given** the player is in system "Solaris"
**When** the player attempts to select a system that is not directly connected
**Then** the system is not clickable (or shows "Нет варп-связи"), and no jump is initiated

#### Non-Functional Expectations
- Galaxy generation must complete in under 1 second.
- Star map rendering must maintain 60 FPS with 10 systems and up to 15 warp lines.
- System names must be readable at 1024×768 resolution.

---

## Domain Concept Identification

### Existing Concepts (from codebase)

- **Galaxy** (`src/domain/Galaxy.ts:6-24`): Container for star systems, overmind, events. Has `systems: StarSystem[]`, `gameDays`, `simulateDay()`.

- **StarSystem** (`src/domain/StarSystem.ts:6-24`): Represents a star system with `id`, `name`, `coordinates: AxialCoord`, `starType`, `planets`, `ownerFaction`, `connections: WarpPath[]`. Has `explored` and `fogOfWar` flags. Method `enter()` sets both flags.

- **WarpPath** (`src/domain/WarpPath.ts:1-7`): Connection between systems with `fromSystemId`, `toSystemId`, `fuelCost`.

- **Player** (`src/domain/Player.ts:7-23`): Has `currentSystemId: string` to track location.

- **GalaxySimulator** (`src/systems/GalaxySimulator.ts:10-130`): Generates galaxy with seeded RNG. Creates systems with coordinates, calculates warp connections based on distance.

- **SeededRNG** (`src/utils/seededRNG.ts:1-38`): Mulberry32 algorithm for deterministic random generation.

- **StarMapScene** (`src/presentation/StarMapScene.ts:13-360`): Renders star map, handles system clicks, shows info panel, performs warp jumps.

### New Concepts Required

- **System Name Generator**: Currently systems are named "System 1", "System 2", etc. Need proper unique names (sci-fi themed).

- **Warp Confirmation Dialog**: Modal dialog with "Да"/"Нет" buttons before warp jump.

- **Fog of War Reveal Logic**: Function to reveal system AND its neighbors when entering.

### Key Business Rules

- **Deterministic Generation**: Same seed must produce identical galaxy layout every time.
- **Graph Connectivity**: All systems must be reachable — no isolated nodes.
- **Connection Limits**: Each system has 1-3 warp connections.
- **Fog of War**: Unexplored systems are hidden; reveal on proximity (direct connection).
- **Warp Restrictions**: Can only warp to directly connected systems.

---

## Strategic Approach

### Solution Direction

Partial implementation exists. The approach should:
1. **Fix fog of war initialization** — reveal starting system + neighbors on game start
2. **Fix fog of war propagation** — reveal destination + neighbors on warp
3. **Add confirmation dialog** — modal before warp execution
4. **Add name generator** — replace "System N" with unique sci-fi names
5. **Ensure system count** — configure for 10 systems (currently 30)

### Key Design Decisions

- **Fog of war as system property (vs separate data structure)**: Current approach uses `fogOfWar` flag on StarSystem — simple and works, but slightly violates domain purity. Trade-off accepted for simplicity.

- **Warp connections as array on each system**: Bidirectional paths stored on each system. Could be centralized in Galaxy, but current approach is workable.

- **Info panel for system interaction**: Good UX pattern — click system, see info, click warp. Confirmation dialog should be a modal overlay, not replace the panel.

### Alternatives Considered

- **Centralized fog-of-war manager**: Would add complexity, current flag-based approach is sufficient for MVP.
- **Hover for system names**: Spec mentions "on hover or click" — current click-based approach is fine for touch compatibility.

---

## Risk & Gap Analysis

### Requirement Ambiguities

- **"Unique names"**: Does "unique" mean procedurally generated or from a predefined list? Predefined list is simpler and more thematic.

- **"Ship icon moves"**: AC6 mentions "ship icon moves" — current implementation just updates `playerSystemId` and re-renders with green highlight. No actual ship sprite. Clarify if ship sprite is needed.

### Edge Cases

- **Warp during confirmation dialog**: If another click happens while dialog is open, what happens? Need to disable background interactions.

- **All neighbors already revealed**: When warping to a system where all neighbors are already visible, fog reveal is a no-op — should work correctly but verify.

- **Starting system has 0 connections**: Graph generation should guarantee at least 1 connection, but verify edge case handling.

### Technical Risks

- **Fog of war not revealing neighbors**: Current implementation only reveals the destination system, not its neighbors. This is a **bug** that needs fixing.

- **Initial fog state incorrect**: On game start, only starting system is revealed — neighbors should also be visible per AC3.

- **No confirmation dialog**: AC5 requires a dialog with "Да"/"Нет" buttons — currently missing, direct warp via "[ПРЫЖОК]" button.

### Acceptance Criteria Coverage

| AC# | Description | Addressable? | Gaps/Notes |
|-----|-------------|--------------|------------|
| AC1 | Galaxy Generation (10 systems, unique names, deterministic) | Partial | System count is 30 (configurable). Names are "System N" not unique. Deterministic ✓ |
| AC2 | Warp Connections (1-3 per system, connected graph) | Yes | Implementation uses 3 nearest neighbors. Connectivity not guaranteed but likely. |
| AC3 | Fog of War Initial State | **NO** | Only starting system revealed, not neighbors. **BUG** |
| AC4 | Fog of War Reveal on Travel | **NO** | Only destination revealed, not its neighbors. **BUG** |
| AC5 | Warp Jump Confirmation Dialog | **NO** | **MISSING** — no dialog, direct warp button |
| AC6 | Successful Warp Jump | Partial | Warp works, but no "ship icon" movement animation |
| AC7 | Unconnected System Prevention | Yes | Shows "Нет пути" for unconnected systems |

### Implementation Status

**PARTIALLY IMPLEMENTED** with critical gaps:

| Feature | Status |
|---------|--------|
| Galaxy generation with seeded RNG | ✓ Implemented |
| StarSystem with coordinates, connections | ✓ Implemented |
| Star map rendering with warp lines | ✓ Implemented |
| System click and info panel | ✓ Implemented |
| Warp jump execution | ✓ Implemented |
| Fog of war flags on systems | ✓ Implemented |
| **Fog of war initial reveal (neighbors)** | **NOT IMPLEMENTED** |
| **Fog of war propagation (neighbors)** | **NOT IMPLEMENTED** |
| **Warp confirmation dialog** | **NOT IMPLEMENTED** |
| **Unique system names** | **NOT IMPLEMENTED** |
| System count = 10 | Configurable (currently 30) |

### Recommendations

1. **HIGH PRIORITY**: Fix fog of war to reveal neighbors on game start (AC3)
2. **HIGH PRIORITY**: Fix fog of war to reveal neighbors on warp (AC4)
3. **HIGH PRIORITY**: Add warp confirmation dialog (AC5)
4. **MEDIUM**: Add system name generator with sci-fi names
5. **LOW**: Consider ship sprite for visual feedback on warp
