# Story Decomposition: Vitest Unit Tests for Core Game Systems

## INVEST Analysis

### Abstract Task

**"Unit Test Coverage for ECS, Pricing, and Hexagonal Pathfinding Using Vitest"**

**Analysis Dimensions**:
- **Core Responsibility**: Establish automated unit-test coverage for the three most critical logic subsystems — Entity Component System (ECS), economic pricing, and hexagonal pathfinding — to prevent regressions and enable confident refactoring.
- **Primary Operations**: Write and organize test suites for ECS lifecycle, pricing formulas with supply/demand modifiers, and A* pathfinding on a hex grid with obstacles.
- **Key Constraints**: Tests must run in Vitest; must be deterministic; must not depend on browser APIs (canvas, WebGL, Workers).
- **Technical Complexity**: Medium — requires understanding of ECS architecture, economic formulas, and hex coordinate systems, but no external dependencies.
- **Business Complexity**: Low — clear correctness criteria; no ambiguous business rules.

### INVEST Evaluation

- ✅ **Independent**: Can be written and executed without rendering, AI, PWA, or save systems.
- ✅ **Negotiable**: Test organization (co-located vs. `__tests__`), naming conventions, and coverage thresholds are discussable.
- ✅ **Valuable**: Reduces defect escape rate, accelerates refactoring, and documents expected behavior of core algorithms.
- ✅ **Estimable**: 3–5 days for a developer familiar with Vitest and the existing code.
- ✅ **Small**: Three core functional points (ECS tests, pricing tests, pathfinding tests).
- ✅ **Testable**: The story itself is about tests; success is measured by passing test suites and coverage metrics.

**Conclusion**: Ready as-is.

### Split Strategy

Not needed — the three test domains are logically grouped under "core game logic verification" and fit within the 1–5 day boundary.

---

## [STORY-001-005] Vitest Unit Tests for ECS, Pricing, and Pathfinding

### Background

The game is built on three algorithmically dense subsystems that are prone to subtle regressions: a custom Entity Component System (ECS) that drives all game logic, a dynamic pricing engine that calculates resource costs based on supply and demand, and a pathfinding module that navigates a hexagonal tactical grid. Currently, these systems lack automated unit tests, meaning bugs are often discovered late — during integration or manual playtesting. This story establishes a comprehensive Vitest-based test suite that exercises the happy paths, edge cases, and error conditions of each subsystem. The goal is to reach ≥80% code coverage on these modules and integrate the test run into CI so that every push is validated.

Key points:
- ECS bugs can manifest as invisible logic errors (entities not updating, components leaking, queries returning wrong results).
- Pricing bugs directly impact game balance and player economy; an incorrect formula can make the game trivial or impossible.
- Pathfinding bugs in tactical combat can block player movement or allow illegal traversal, breaking combat fairness.
- Vitest is chosen for native TypeScript support, speed, and compatibility with the project's Vite toolchain.

### Business Value

- Reduce the number of regressions reaching manual QA or production by catching logic errors automatically.
- Enable fearless refactoring of core systems, which accelerates future feature development.
- Provide executable documentation that clarifies the intended behavior of ECS queries, pricing formulas, and hex grid navigation.

### Dependencies and Assumptions

- **Prerequisites**: Vitest is installed and configured; the project uses TypeScript.
- **Data assumptions**: Implementations of ECS, pricing, and pathfinding exist (even if stubbed); their public APIs are stable enough to test.
- **Integration points**: CI/CD pipeline (GitHub Actions) must be configured to run `vitest` on every push.
- **Business constraints**: Tests must be deterministic (no randomness without fixed seeds); must run in a Node.js environment without browser APIs.

### Scope In

- **ECS Tests**: Entity creation and destruction, adding/removing components, system execution order, query filtering by component presence/absence, and world cleanup.
- **Pricing Tests**: Base price calculation, supply/demand multiplier application, faction modifiers, negative/edge input validation, and rounding behavior.
- **Pathfinding Tests**: Shortest path on an empty hex grid, path around obstacles, unreachable destination handling, movement cost weighting, and coordinate conversion correctness (axial ↔ cube ↔ offset).
- **CI Integration**: Add a `test` script to package.json and ensure the CI pipeline fails on test failure.

### Scope Out

- End-to-end browser tests (Playwright/Cypress) — out of scope; this is unit-test only.
- Rendering tests (PixiJS canvas output verification).
- ONNX inference tests (those require Worker and WASM runtime).
- Performance or load testing (benchmarking pathfinding on 100×100 grids is acceptable but not required).

### Acceptance Criteria (ACs)

#### AC1: ECS Entity Lifecycle
**Given** an empty ECS world
**When** a developer creates an entity with `Position({x: 0, y: 0})` and `Health({current: 100, max: 100})` components
**Then** a query for entities containing both `Position` and `Health` returns exactly one entity with the correct values

#### AC2: ECS Component Removal
**Given** an entity that has both `Position` and `Velocity` components
**When** the `Velocity` component is removed from that entity
**Then** a query for entities with `Velocity` returns an empty array, while a query for entities with `Position` still includes the entity

#### AC3: Pricing Base Calculation
**Given** a base commodity price of 100 credits, a demand factor of 1.5, and a supply factor of 0.8
**When** the pricing system calculates the final price
**Then** the result is exactly 187 credits (100 × 1.5 / 0.8, rounded to the nearest integer)

#### AC4: Pricing Input Validation
**Given** a developer attempts to calculate price with a base value of -50
**When** the pricing function is invoked
**Then** the system throws a validation error with the message: "Base price must be non-negative"

#### AC5: Pathfinding Direct Path
**Given** a 5×5 hexagonal grid with no obstacles
**When** the pathfinder searches for a route from axial coordinate `(0, 0)` to `(2, 2)`
**Then** the returned path is a sequence of 4 valid hex steps connecting start to goal without leaving the grid

#### AC6: Pathfinding Obstacle Avoidance
**Given** a 5×5 hexagonal grid with an impassable obstacle at axial coordinate `(1, 1)`
**When** the pathfinder searches for a route from `(0, 0)` to `(2, 2)`
**Then** the returned path has a length of 5 steps and does not pass through `(1, 1)`

#### AC7: Pathfinding Unreachable Destination
**Given** a 3×3 hexagonal grid where the goal `(2, 2)` is completely surrounded by obstacles
**When** the pathfinder searches for a route from `(0, 0)` to `(2, 2)`
**Then** the pathfinder returns `null` (or an equivalent "no path" indicator) within 10 ms

#### Non-Functional Expectations
- The entire Vitest suite for these three modules must execute in under 10 seconds in CI.
- Code coverage for ECS, pricing, and pathfinding modules must be at least 80% (branches, functions, lines).
- All tests must pass in a headless Node.js environment without requiring browser globals.
