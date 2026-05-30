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

### INVEST Evaluation

- ✅ **Independent**: Can be developed with mock data and a simple canvas renderer; does not require combat, dialogue, or save systems.
- ✅ **Negotiable**: Number of systems, layout algorithm, and fog-of-war radius are discussable.
- ✅ **Valuable**: Core exploration loop of the game; without it, the galaxy feels static.
- ✅ **Estimable**: 3–4 days for a developer familiar with procedural generation.
- ✅ **Small**: Three core functional points (generation, rendering, travel).
- ✅ **Testable**: System count, connectivity, and fog-of-war state are verifiable.

**Conclusion**: Ready as-is.

### Split Strategy

Not needed — generation, rendering, and travel form a single coherent exploration loop.

---

## [STORY-001-009] Star Map Generation and Navigation

### Background

The GDD describes a "living galaxy" where the player explores star systems, discovers warp routes, and uncovers hidden sectors. This story delivers the foundational exploration loop: a procedurally generated galaxy of 10 systems, each with a unique name and coordinates, connected by warp lines. The player can select a neighboring system and confirm a warp jump. A fog-of-war system hides unexplored systems, revealing only the starting system and its immediate neighbors, creating a sense of discovery.

Key points:
- This is the core navigation feature of Phase 1 (MVP1).
- Deterministic generation ensures reproducible galaxies for a given seed.
- The fog-of-war system will be expanded in later phases with more complex visibility rules.

### Business Value

- Enable the core exploration loop: discover → travel → discover.
- Create a sense of a living, discoverable galaxy.
- Provide the navigation foundation for all future location-based gameplay (combat, trade, quests).

### Dependencies and Assumptions

- **Prerequisites**: Story-1 (PixiJS renderer) is complete; a scene can display interactive graphics.
- **Data assumptions**: A name generator or name list for star systems is available.
- **Integration points**: The Star Map scene will later integrate with the Combat System (Story-11) and Quest System (Story-13).
- **Business constraints**: Galaxy generation must complete in under 1 second; warp jumps must have a brief animation or transition.

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
