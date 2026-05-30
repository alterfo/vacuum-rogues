# Story Decomposition: Tactical Combat Player Turn — Movement and Attack

## INVEST Analysis

### Abstract Task

**"Player Turn Mechanics in Tactical Combat: Movement and Attack Actions"**

**Analysis Dimensions**:
- **Core Responsibility**: Allow the player to move their ship within movement range and attack enemies within weapon range during their turn.
- **Primary Operations**: Calculate movement range, highlight reachable hexes, select destination hex, move ship, calculate attack range, select target, apply damage.
- **Key Constraints**: Movement must respect grid boundaries and obstacles; attack must respect range and line of sight.
- **Technical Complexity**: Medium — hex range calculation, path validation, damage application.
- **Business Complexity**: Medium — turn flow and action sequencing.

### INVEST Evaluation

- ✅ **Independent**: Builds on Story-10 (combat grid) but can be developed in parallel; requires only the hex grid and ship placement.
- ✅ **Negotiable**: Movement speed values, weapon ranges, and action order are discussable.
- ✅ **Valuable**: Core tactical combat interaction — without it, combat is non-interactive.
- ✅ **Estimable**: 3–4 days for a developer familiar with turn-based mechanics.
- ✅ **Small**: Two core functional points (movement, attack).
- ✅ **Testable**: Ship positions, HP changes, and range validations are verifiable.

**Conclusion**: Ready as-is.

### Split Strategy

Not needed — movement and attack are the two fundamental actions of a player turn.

---

## [STORY-001-011] Tactical Combat Player Turn — Movement and Attack

### Background

The GDD describes tactical combat as a turn-based system where the player and enemies alternate actions. This story implements the player's turn: selecting a movement destination within range, moving the ship, and then selecting an attack target within weapon range. The system must clearly communicate valid options (highlighted hexes, target indicators) and enforce game rules (cannot move beyond range, cannot attack out of range).

Key points:
- This is the primary player interaction during combat.
- Movement range and weapon range are derived from ship stats.
- The turn ends after the player completes both movement and attack (or passes).

### Business Value

- Deliver the core tactical decision-making loop: position → attack.
- Create clear visual feedback for valid actions, reducing player confusion.
- Establish the rules foundation for all future combat abilities and modifiers.

### Dependencies and Assumptions

- **Prerequisites**: Story-10 (hex grid and encounter setup) is complete.
- **Data assumptions**: Player ship has defined movement speed (e.g., 3 hexes) and weapon range (e.g., 4 hexes); enemy ship has HP and defense stats.
- **Integration points**: The turn system will integrate with Enemy AI (Story-12) for turn handoff.
- **Business constraints**: A turn must not take more than 30 seconds to complete; UI feedback must be immediate.

### Scope In

- Calculate and highlight all hexes reachable by the player ship within its movement range.
- Allow the player to click a highlighted hex to move the ship there.
- Animate ship movement across hexes (smooth interpolation, ≤500 ms).
- After movement, calculate and highlight all enemy ships within weapon range.
- Allow the player to click a highlighted enemy to attack.
- Apply damage to the target enemy (base damage minus defense, minimum 1).
- Display damage numbers as floating text above the target.
- Update target HP display; if HP reaches 0, mark the ship as destroyed.
- Provide a "End Turn" button to skip remaining actions.
- Enforce rules: cannot move to unhighlighted hexes, cannot attack out of range, cannot attack through obstacles.

### Scope Out

- Enemy turn behavior — covered in Story-12.
- Victory/defeat screens and rewards — covered in Story-12.
- Special abilities, shields, or buffs — basic movement and attack only.
- Obstacle destruction or terrain interaction.

### Acceptance Criteria (ACs)

#### AC1: Movement Range Highlight
**Given** it is the player's turn and the ship has a movement range of 3
**When** the player clicks on their ship
**Then** all hexes within 3 hexes of the ship are highlighted in blue, and unreachable hexes are not highlighted

#### AC2: Ship Movement
**Given** the player has selected a highlighted hex 2 hexes away
**When** the player confirms the move
**Then** the ship moves to the target hex within 500 ms, and the movement highlights disappear

#### AC3: Attack Range Highlight
**Given** the player has completed movement and the weapon range is 4
**When** the attack phase begins
**Then** all enemy ships within 4 hexes are highlighted in red as valid targets

#### AC4: Attack Execution
**Given** an enemy ship is within attack range and has 50 HP
**When** the player clicks the enemy to attack
**Then** the enemy loses HP equal to (player attack - enemy defense, minimum 1), and a floating damage number appears

#### AC5: Target Destruction
**Given** an enemy ship has 5 HP remaining
**When** the player attacks for 10 damage
**Then** the enemy HP reaches 0, the ship sprite is marked as destroyed (e.g., grayed out or removed), and the ship is no longer a valid target

#### AC6: End Turn
**Given** it is the player's turn
**When** the player clicks "Завершить ход"
**Then** the player's turn ends, action highlights disappear, and control passes to the enemy

#### AC7: Invalid Action Prevention
**Given** an enemy is 6 hexes away and weapon range is 4
**When** the player attempts to click the enemy
**Then** the enemy is not highlighted as a target, and clicking it does nothing

#### Non-Functional Expectations
- Movement animation must complete in under 500 ms.
- Action highlights must appear within 100 ms of selection.
- Damage calculation must be instantaneous.
