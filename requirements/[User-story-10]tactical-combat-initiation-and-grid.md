# Story Decomposition: Tactical Combat Initiation and Hexagonal Grid

## INVEST Analysis

### Abstract Task

**"Tactical Combat Scene with Hexagonal Grid and Encounter Setup"**

**Analysis Dimensions**:
- **Core Responsibility**: Transition from the star map to a tactical combat scene, render a hexagonal grid, and place player and enemy ships on opposite sides.
- **Primary Operations**: Trigger combat from star map, generate hex grid, place ships, render grid and units, handle basic camera.
- **Key Constraints**: Grid must be visually clear; ship placement must be balanced; transition must be smooth.
- **Technical Complexity**: Medium — hexagonal coordinate math, grid rendering, scene transition.
- **Business Complexity**: Low — clear encounter setup rules.

### INVEST Evaluation

- ✅ **Independent**: Can be developed with mock enemy data; does not require combat actions or AI.
- ✅ **Negotiable**: Grid size, hex dimensions, and ship placement rules are discussable.
- ✅ **Valuable**: First combat encounter experience; validates the tactical combat concept.
- ✅ **Estimable**: 2–3 days for a developer familiar with hex grids.
- ✅ **Small**: Two core functional points (hex grid rendering, encounter setup).
- ✅ **Testable**: Grid dimensions, ship positions, and transition correctness are verifiable.

**Conclusion**: Ready as-is.

### Split Strategy

Not needed — grid rendering and encounter setup are tightly coupled in the combat initiation flow.

---

## [STORY-001-010] Tactical Combat Initiation and Hexagonal Grid

### Background

The GDD describes tactical combat as a core gameplay pillar: when the player encounters an enemy in a star system, the game transitions to a hexagonal battlefield. This story delivers the combat initiation experience: triggering the encounter from the star map, generating and rendering a hex grid, and placing the player and enemy ships on opposite sides. The grid is the foundation for all movement, attack, and ability mechanics in combat.

Key points:
- This is the entry point for all combat gameplay.
- The hex grid system will be reused and expanded with obstacles, terrain, and larger maps.
- Ship placement rules ensure fair starting positions.

### Business Value

- Deliver the first combat encounter, proving the tactical battle concept.
- Create a clear, readable battlefield for strategic decision-making.
- Establish the hex grid foundation for all future combat mechanics.

### Dependencies and Assumptions

- **Prerequisites**: Story-1 (PixiJS renderer and scene system) and Story-9 (star map with enemy encounters) are complete.
- **Data assumptions**: Player ship and at least one enemy ship type have defined stats (even if mock).
- **Integration points**: The combat scene will integrate with the Combat System (Story-11) for turn logic and actions.
- **Business constraints**: Grid must be readable at 1024×768; hex size must accommodate ship sprites.

### Scope In

- Trigger combat when the player selects "Attack" on an enemy ship in a star system.
- Transition from Star Map scene to Combat scene (fade or immediate swap).
- Generate a hexagonal grid (e.g., 8×8 axial coordinates) with visually distinct hexes.
- Render the grid with coordinates visible (for debugging and clarity).
- Place the player ship on one side of the grid (e.g., leftmost column, center rows).
- Place the enemy ship on the opposite side (e.g., rightmost column, center rows).
- Display ship sprites on their respective hexes.
- Display basic ship info (name, hull integrity) near each ship.
- Allow the player to exit combat (retreat) and return to the star map.

### Scope Out

- Turn-based action mechanics (movement, attack) — covered in Story-11.
- Enemy AI behavior — covered in Story-12.
- Obstacles, terrain effects, or multiple enemies.
- Victory/defeat conditions and rewards — covered in Story-12.
- Combat animations (shooting, explosions) — basic sprite placement only.

### Acceptance Criteria (ACs)

#### AC1: Combat Trigger from Star Map
**Given** the player is on the star map and encounters an enemy ship
**When** the player selects "Атаковать"
**Then** the game transitions to the Combat scene within 500 ms

#### AC2: Hex Grid Rendering
**Given** the Combat scene is active
**When** the grid is rendered
**Then** a hexagonal grid of at least 8×8 is visible, each hex is clearly outlined, and coordinates are readable

#### AC3: Player Ship Placement
**Given** the Combat scene has loaded
**When** the grid is displayed
**Then** the player ship is placed on the left side of the grid (e.g., column 0–1, center rows)

#### AC4: Enemy Ship Placement
**Given** the Combat scene has loaded
**When** the grid is displayed
**Then** the enemy ship is placed on the right side of the grid (e.g., column 6–7, center rows), opposite the player

#### AC5: Ship Info Display
**Given** ships are placed on the grid
**When** the combat scene is rendered
**Then** each ship displays its name and current hull integrity (e.g., "Корвет / 100 HP") near the sprite

#### AC6: Retreat to Star Map
**Given** the player is in combat
**When** the player selects "Отступить"
**Then** the combat scene unmounts, the star map scene remounts, and the player returns to the previous system

#### Non-Functional Expectations
- Grid rendering must maintain 60 FPS.
- Scene transition must complete in under 500 ms.
- Hex size must be at least 64×64 pixels to accommodate ship sprites.
