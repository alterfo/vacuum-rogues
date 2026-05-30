# Story Decomposition: Zod Save Game Validation

## INVEST Analysis

### Abstract Task

**"Save Game Data Validation Using Zod Schemas"**

**Analysis Dimensions**:
- **Core Responsibility**: Protect player progress by strictly validating the structure and types of save-game data using Zod schemas before loading.
- **Primary Operations**: Define schemas for all save domains, validate on load, report field-level errors, degrade gracefully on validation failure.
- **Key Constraints**: Schemas must reflect the current game state structure (player position, ship, inventory, galaxy, settings); invalid saves must never crash the game.
- **Technical Complexity**: Medium — Zod is straightforward, but mapping the full game state to schemas requires domain knowledge.
- **Business Complexity**: Low — clear correctness requirement; no ambiguous business rules.

### INVEST Evaluation

- ✅ **Independent**: Can be implemented and tested without rendering, AI, or PWA features.
- ✅ **Negotiable**: Exact schema strictness (strip vs. reject unknown keys), error message wording, and fallback behavior are discussable.
- ✅ **Valuable**: Prevents corrupted or incompatible saves from destroying player progress; provides clear diagnostics.
- ✅ **Estimable**: 2–4 days for a developer familiar with Zod and the game's data model.
- ✅ **Small**: Three core functional points (schema definitions, load-time validation, user-facing error handling).
- ✅ **Testable**: Valid and invalid save payloads can be programmatically constructed and fed through the validator.

**Conclusion**: Ready as-is.

### Split Strategy

Not needed — validation is a cross-cutting concern best delivered as a single coherent story.

---

## [STORY-001-003] Zod Save Game Validation

### Background

Player progress in the game includes star map position, ship loadout, inventory contents, galaxy state, and user settings. Currently, saves are stored and retrieved without structural validation. If a save file is manually edited, browser storage is corrupted, or the game schema evolves between versions, loading an invalid save can cause runtime exceptions or silent data corruption. This story introduces Zod as the validation layer: every save domain gets a strict schema, and every load operation is guarded by that schema. When validation fails, the player receives a clear explanation and a path forward (start a new game), rather than a broken screen or a silent crash.

Key points:
- Save data integrity is critical for player retention; losing hours of progress is a high-severity defect.
- Zod schemas double as TypeScript types, improving developer experience and reducing drift between runtime and compile-time models.
- This story covers validation only; automatic migration between save versions is explicitly out of scope.

### Business Value

- Protect players from progress loss caused by corrupted, tampered, or version-mismatched save files.
- Provide clear, actionable error messages when a save cannot be loaded.
- Establish a typed data contract that simplifies future feature development and refactoring.

### Dependencies and Assumptions

- **Prerequisites**: Zod library is installed; the project uses TypeScript.
- **Data assumptions**: The current save data structure (even if unvalidated) is known and documented or discoverable in code.
- **Integration points**: Save/load manager in the game engine; UI layer for displaying validation errors.
- **Business constraints**: Invalid saves must never crash the game loop; fallback to a new-game state must be safe.

### Scope In

- Define Zod schemas for all save domains: `GameState`, `ShipState`, `Inventory`, `PlayerSettings`, and `GalaxyState`.
- Validate save data during the load operation (both automatic load on boot and manual "Continue" action).
- Return field-level error messages when validation fails (e.g., "Missing required field: ship.hull" or "Expected number, received string at: credits").
- Implement graceful degradation: if validation fails, offer the player a clear choice to start a new game.
- Validate `PlayerSettings` independently on application of settings (e.g., volume bounds).

### Scope Out

- Automatic migration of old save formats to new schemas.
- Encryption or obfuscation of save data.
- Cloud save synchronization.
- UI for managing multiple save slots (save/load screens are assumed to exist; this story only adds validation logic behind them).

### Acceptance Criteria (ACs)

#### AC1: Successful Load of Valid Save
**Given** a save file in localStorage/IndexedDB that matches the current Zod schemas exactly
**When** the player selects "Continue" or the game auto-loads on startup
**Then** the save passes validation, the game state is restored, and the player lands on the Star Map within 1 second

#### AC2: Rejection of Corrupted Save — Missing Field
**Given** a save file that is missing a required field (e.g., `ship.hull`)
**When** the player attempts to load the game
**Then** the system displays the message: "Сохранение повреждено: отсутствует поле ship.hull" and presents a "Start New Game" button

#### AC3: Rejection of Corrupted Save — Type Mismatch
**Given** a save file where the `credits` field contains the string `"9999"` instead of a number
**When** the player attempts to load the game
**Then** the system displays the message: "Сохранение повреждено: ожидалось число в поле credits" and does not attempt to auto-correct the value

#### AC4: Settings Validation
**Given** the settings file contains an invalid volume value of `150`
**When** the settings are applied
**Then** the system rejects the out-of-bounds value, falls back to the default `100`, and logs a warning: "Недопустимое значение громкости, использовано значение по умолчанию"

#### AC5: Graceful New Game Fallback
**Given** the player's only save file fails validation
**When** the player dismisses the error dialog
**Then** the system initializes a clean `GameState` from defaults and places the player at the starting star system without requiring a page reload

#### Non-Functional Expectations
- Validation of a 1 MB save file must complete in under 50 ms.
- Schema definitions must compile to TypeScript types with zero manual type duplication.
