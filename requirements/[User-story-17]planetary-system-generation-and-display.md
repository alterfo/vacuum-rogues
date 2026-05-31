# Story Decomposition: Planetary System Generation and Display

## INVEST Analysis

### Abstract Task

**"Procedural Planet Generation and In-System Orbital Display"**

**Analysis Dimensions**:
- **Core Responsibility**: Generate 1-5 planets per star system with unique properties and display them as orbital objects in the SpaceFlightScene.
- **Primary Operations**: Generate planets with seeded RNG, assign orbital positions, determine planet types and properties, render planets in flight scene, handle planet click interactions.
- **Key Constraints**: Planets must persist for each system (deterministic generation); orbital layout must be visually clear; planets must be clickable.
- **Technical Complexity**: Medium — procedural generation, orbital positioning, PixiJS sprite management.
- **Business Complexity**: Medium — planet types and properties affect future gameplay (trade, landing, quests).

### INVEST Evaluation

- ✅ **Independent**: Builds on Story-9 (Galaxy generation) and Story-7 (SpaceFlightScene) but can be developed separately; uses existing Planet domain entity.
- ✅ **Negotiable**: Number of planets per system, orbital distances, planet type distribution, and visual representation are discussable.
- ✅ **Valuable**: Essential for gameplay progression — planets are locations for trading, landing, quests, and resource gathering.
- ✅ **Estimable**: 2–3 days for a developer familiar with procedural generation and PixiJS.
- ✅ **Small**: Three core functional points (generation, orbital layout, rendering/interaction).
- ✅ **Testable**: Planet count, types, positions, and clickability are verifiable.

**Conclusion**: Ready as-is.

### Split Strategy

Not needed — planet generation, orbital positioning, and rendering form a single coherent in-system exploration feature.

---

## [STORY-001-017] Planetary System Generation and Display

### Background

The GDD describes star systems as containing multiple planets where players can land, trade, take quests, and gather resources. This story delivers the foundational in-system exploration: each star system contains 1-5 procedurally generated planets with unique names, types, and orbital positions. Planets are displayed in the SpaceFlightScene as clickable orbital objects. When clicked, planets show basic information (name, type, size). This creates the foundation for future planet-based gameplay (landing, trading, quests).

Key points:
- This is the first step toward in-system content and planet-based gameplay.
- Deterministic generation ensures each system always has the same planets for a given galaxy seed.
- The planet interaction system will be expanded in later stories to support landing and trade.

### Business Value

- Enable in-system exploration and discovery.
- Create varied star systems with unique planetary compositions.
- Provide visual and gameplay differentiation between systems.
- Establish the foundation for trade, landing, and quest systems.

### Dependencies and Assumptions

- **Prerequisites**: Story-9 (Galaxy generation with StarSystem) is complete; Story-7 (SpaceFlightScene) is complete.
- **Data assumptions**: Planet domain entity exists; planet type definitions (rocky, gas giant, ice, desert) are available.
- **Integration points**: Planet display integrates with SpaceFlightScene; planet generation integrates with GalaxySimulator.
- **Business constraints**: Planet generation must complete in under 100ms per system; planets must be visually distinguishable.

### Scope In

- Generate 1-5 planets per star system using seeded RNG (based on galaxy seed + system ID).
- Assign each planet a unique name (procedurally generated or from a name list).
- Assign each planet a type (ROCKY, GAS_GIANT, ICE, DESERT, OCEAN) with appropriate distribution.
- Assign each planet an orbital radius (distance from star) to create visual separation.
- Create a basic Market entity for each planet (empty/stub for now).
- Store planets in StarSystem.planets array during galaxy generation.
- Render planets in SpaceFlightScene as clickable circles at their orbital positions.
- Display planet info panel on click (name, type, orbital radius).
- Highlight hovered planet with glow effect.
- Support ship navigation toward clicked planets (ship moves to planet position).

### Scope Out

- Planet landing mechanics (separate story).
- Actual market trading functionality (separate story).
- Planetary resources, population, or faction ownership (future phases).
- Planetary orbits animation (planets are static for now).
- Planet textures or detailed sprites (simple colored circles are sufficient).
- Moons or asteroid belts.

### Acceptance Criteria (ACs)

#### AC1: Planet Generation
**Given** a star system is generated with seed "ranger-42" and system ID "sys_0"
**When** the galaxy initializes
**Then** the system contains 1-5 planets, the exact count and properties are deterministic for that seed/ID combination

#### AC2: Planet Type Distribution
**Given** 10 star systems are generated
**When** analyzing all planets across all systems
**Then** at least 3 different planet types are represented, and gas giants are less common than rocky planets

#### AC3: Planet Display in Flight Scene
**Given** the player enters a star system with 3 planets
**When** the SpaceFlightScene renders
**Then** 3 planet circles are visible at different orbital distances from the center, each with a distinct color based on type

#### AC4: Planet Click Interaction
**Given** the player is in the flight scene with visible planets
**When** the player clicks on a planet
**Then** an info panel appears showing the planet's name, type, and orbital distance

#### AC5: Ship Navigation to Planet
**Given** the player clicks on a planet
**When** the ship is not at the planet's position
**Then** the ship moves toward the planet using the existing movement physics from Story-7

#### AC6: Planet Names
**Given** planets are generated
**When** inspecting planet names
**Then** each planet has a unique name within its system (e.g., "Solaris I", "Solaris II" or procedurally generated names)

#### Non-Functional Expectations
- Planet generation for a system must complete in under 100ms.
- Planets must be clickable with a hit area of at least 20 pixels radius.
- Planet colors must be visually distinct (not all similar shades).
- Planet info panel must not block the view of other planets.
