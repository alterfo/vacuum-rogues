# SPDD Analysis: Planetary System Generation and Display

## Original Business Requirement

[Full text from User-story-17 included verbatim - see requirements/[User-story-17]planetary-system-generation-and-display.md]

Key points:
- Generate 1-5 planets per star system using seeded RNG
- Assign planet types (TERRESTRIAL, GAS_GIANT, ICE, VOLCANIC, INDUSTRIAL, HABITAT)
- Display planets as orbital objects in SpaceFlightScene
- Support planet click interaction and ship navigation to planets
- Foundation for future trading, landing, and quest systems

## Domain Concept Identification

### Existing Concepts (from codebase)

- **Planet**: Domain entity with id, name, type, market, inhabitants, availableQuests — already defined but never instantiated
- **StarSystem**: Domain entity with planets array (currently empty) — line 44 of GalaxySimulator creates systems with `[]` for planets
- **Market**: Domain entity for trade with circular reference to Planet — requires planet in constructor
- **PlanetType**: Enum with 6 types (TERRESTRIAL, GAS_GIANT, ICE, VOLCANIC, INDUSTRIAL, HABITAT) — defined in types/index.ts
- **SeededRNG**: Utility for deterministic random generation with nextInt() and nextFloat() methods
- **GalaxySimulator**: System component that generates galaxy structure — currently creates systems but no planets
- **SpaceFlightScene**: Presentation component showing ship in space — currently only has parallax background and ship, no planets

### New Concepts Required

- **PlanetGenerator**: Service to generate planets for a given system using seed+systemId
- **OrbitalLayout**: Algorithm to position planets at visually distinct orbital radii
- **PlanetSprite**: Visual representation of planet in SpaceFlightScene with click handling
- **PlanetInfoPanel**: UI component showing planet details on click

### Key Business Rules

- **Determinism Rule**: Same galaxy seed + system ID always produces same planets — governs PlanetGenerator
- **Orbital Spacing Rule**: Planets must have minimum visual separation (no overlapping orbits) — governs OrbitalLayout
- **Type Distribution Rule**: Gas giants rarer than terrestrial planets — governs PlanetGenerator type selection
- **Market Initialization Rule**: Every planet gets a Market, even if empty (no available resources) — governs Planet creation
- **Clickability Rule**: Planets must be clickable from any ship position — governs PlanetSprite hit area

## Strategic Approach

### Solution Direction

Extend existing GalaxySimulator to generate planets during galaxy initialization. Each StarSystem gets 1-5 planets created via new PlanetGenerator class that uses SeededRNG(galaxySeed + systemId) for determinism. Planets are stored in StarSystem.planets array.

In SpaceFlightScene, read current system's planets from gameEngine.player.currentSystemId, create PlanetSprite instances positioned in orbital layout around screen center (star position), and handle click events to show info panel and set ship target.

The approach follows existing patterns:
- Domain entities created by simulator during initialization (like StarSystem)
- Presentation layer reads from domain via gameEngine reference (like StarMapScene)
- Click interactions use PixiJS FederatedPointerEvent (like ship control in Story-7)

### Key Design Decisions

- **Market circular reference resolution**: Create Market with stub planet reference, then assign actual planet after both are constructed
  - Trade-offs: Violates clean initialization but Market constructor signature requires Planet
  - Recommendation: Pass null/undefined for planet in Market constructor, make field optional, or refactor Market to not require Planet reference

- **Orbital positioning algorithm**: Use fixed orbital radii (100px, 180px, 260px, 340px, 420px) evenly spaced
  - Trade-offs: Simple but not realistic orbital mechanics vs. complex Kepler orbits
  - Recommendation: Fixed radii for MVP, can be enhanced with actual orbits later

- **Planet naming strategy**: Use system name + Roman numeral (e.g., "Солярис I", "Солярис II")
  - Trade-offs: Simple and clear vs. unique procedural names per planet
  - Recommendation: Roman numerals for clarity and consistency

- **Planet sprite representation**: Colored circles with radius based on planet type (gas giants bigger)
  - Trade-offs: Minimal visual detail vs. textured sprites or complex rendering
  - Recommendation: Simple circles for MVP (matches star map aesthetic)

### Alternatives Considered

- **Generate planets on-demand when entering system**: Would reduce memory but break determinism (current RNG state matters)
  - Rejected: Determinism is critical for save/load consistency

- **Store planets in separate PlanetRegistry**: Would decouple from StarSystem
  - Rejected: StarSystem.planets array already exists in domain model

## Risk & Gap Analysis

### Requirement Ambiguities

- **Planet count distribution**: Story says "1-5 planets" but doesn't specify distribution (uniform? weighted toward 3?)
- **Orbital radius scale**: Story mentions "orbital radius" but doesn't specify units or scale relative to screen size
- **Planet size variation**: Should all planets be same visual size, or should gas giants be larger?
- **Star position**: Where is the star rendered? Screen center? If so, planets orbit around center?

### Edge Cases

- **System with 1 planet**: Orbital layout algorithm must handle single planet gracefully
- **Player ship spawns inside planet orbit**: Ship might collide visually with planet sprite on entry
- **Planet click while ship moving**: Should clicking planet cancel current ship movement or queue it?
- **Planet info panel overlaps planet**: Panel positioning must avoid covering the clicked planet
- **Multiple planets at similar angles**: If 2+ planets have similar angular positions, labels might overlap

### Technical Risks

- **Market constructor circular reference**: Planet requires Market, Market constructor requires Planet
  - Mitigation: Make Market.planet optional or refactor to pass planet ID string instead

- **Performance with many planets**: 5 systems × 5 planets × complex sprites could impact render performance
  - Mitigation: Use simple Graphics (circles) not Sprite textures; PixiJS handles 25-50 objects easily

- **Determinism with Market vectors**: Story-9 shows market demand/supply vectors change over time (line 114-119 of GalaxySimulator.simulateDay)
  - Mitigation: Initial market generation is deterministic, but market state evolves (expected behavior)

### Acceptance Criteria Coverage

| AC# | Description | Addressable? | Gaps/Notes |
|-----|-------------|--------------|------------|
| AC1 | Planet Generation | Yes | PlanetGenerator with SeededRNG(seed + systemId) |
| AC2 | Planet Type Distribution | Yes | Weighted random selection in PlanetGenerator |
| AC3 | Planet Display in Flight Scene | Yes | PlanetSprite creation in SpaceFlightScene.initialize() |
| AC4 | Planet Click Interaction | Yes | FederatedPointerEvent on PlanetSprite + info panel |
| AC5 | Ship Navigation to Planet | Yes | Reuse ShipPhysics.setTarget from Story-7 |
| AC6 | Planet Names | Yes | `${systemName} ${toRomanNumeral(index + 1)}` |

**Summary**: All ACs addressable. Primary gap is Market circular reference (design issue, not AC gap).
