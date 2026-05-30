# Story Decomposition: Tactical Combat Enemy AI and Battle Resolution

## INVEST Analysis

### Abstract Task

**"Enemy Turn Behavior and Combat Victory/Defeat Resolution"**

**Analysis Dimensions**:
- **Core Responsibility**: Implement basic enemy AI (move toward player, attack when in range) and handle combat end states (victory with rewards, defeat with save load prompt).
- **Primary Operations**: Evaluate distance to player, move toward player if out of range, attack if in range, check win/lose conditions, display result screens, return to star map or prompt for reload.
- **Key Constraints**: Enemy AI must be deterministic and fair; victory/defeat must be clearly communicated.
- **Technical Complexity**: Medium — simple pathfinding, state transitions, reward distribution.
- **Business Complexity**: Medium — multiple end states and UI flows.

### INVEST Evaluation

- ✅ **Independent**: Builds on Stories 10–11 but can be developed in parallel by a different developer; requires only the combat grid and turn system.
- ✅ **Negotiable**: Enemy aggressiveness, reward values, and defeat handling are discussable.
- ✅ **Valuable**: Completes the combat loop; without resolution, battles have no purpose.
- ✅ **Estimable**: 3–4 days for a developer familiar with game AI basics.
- ✅ **Small**: Three core functional points (enemy AI, victory, defeat).
- ✅ **Testable**: Enemy positions, HP values, and screen transitions are verifiable.

**Conclusion**: Ready as-is.

### Split Strategy

Not needed — enemy AI and combat resolution complete a single gameplay loop.

---

## [STORY-001-012] Tactical Combat Enemy AI and Battle Resolution

### Background

The GDD describes tactical combat as a turn-based system with clear win/lose conditions. This story implements the enemy's turn behavior and the combat resolution flow. The enemy evaluates its distance to the player: if out of attack range, it moves closer; if in range, it attacks. When the player's HP reaches 0, combat ends in defeat. When all enemies are destroyed, combat ends in victory with experience and loot rewards.

Key points:
- This completes the MVP1 combat feature set.
- Enemy AI is intentionally simple for MVP1; advanced RL-based AI is Phase 2.
- Victory/defeat screens provide narrative closure and progression feedback.

### Business Value

- Complete the combat gameplay loop with meaningful outcomes.
- Provide progression rewards (experience, loot) that motivate further play.
- Handle player death gracefully with a clear path forward.

### Dependencies and Assumptions

- **Prerequisites**: Stories 10–11 (hex grid and player turn) are complete.
- **Data assumptions**: Enemy ship has defined movement speed, attack, and defense stats; player ship has HP and experience tracking.
- **Integration points**: Save system (Story-14) for loading after defeat; inventory system (Story-13) for loot rewards.
- **Business constraints**: Enemy turn must complete within 2 seconds; victory/defeat screens must be skippable.

### Scope In

- Enemy AI: evaluate distance to player ship.
- If distance > attack range: move toward player (shortest path, up to movement range).
- If distance ≤ attack range: attack player ship.
- Animate enemy movement and attack (basic sprite shifts, damage numbers).
- Check victory condition: all enemy ships destroyed → display victory screen.
- Victory screen shows: experience gained, loot obtained (credits, items).
- Add loot to player inventory; add experience to player stats.
- Return to star map after victory.
- Check defeat condition: player HP reaches 0 → display defeat screen.
- Defeat screen shows: "Ваш корабль уничтожен" with "Загрузить последнее сохранение" button.
- On "Load Save", restore the last save and return to star map.
- If no save exists, offer "Начать новую игру".

### Scope Out

- Advanced enemy tactics (flanking, cover, focus fire) — Phase 2 RL AI.
- Multiple enemy types or formations.
- Complex loot tables or rarity systems.
- Animated cutscenes for victory/defeat.

### Acceptance Criteria (ACs)

#### AC1: Enemy Moves Toward Player
**Given** the enemy is 5 hexes away and has movement range 3 and attack range 2
**When** it is the enemy's turn
**Then** the enemy moves 3 hexes toward the player, stopping 2 hexes away

#### AC2: Enemy Attacks When in Range
**Given** the enemy is 2 hexes away and has attack range 3
**When** it is the enemy's turn
**Then** the enemy attacks the player, dealing damage, and floating damage numbers appear

#### AC3: Victory Screen
**Given** the player destroys the last enemy ship
**When** combat ends
**Then** a victory screen appears displaying "Победа!", experience gained (+50 XP), and loot (e.g., "100 кредитов, Лазер Мк.II")

#### AC4: Loot and Experience Awarded
**Given** the player wins a combat encounter
**When** the victory screen is dismissed
**Then** the player's experience increases by 50, credits increase by 100, and "Лазер Мк.II" appears in the inventory

#### AC5: Return to Star Map After Victory
**Given** the player has dismissed the victory screen
**When** the transition completes
**Then** the star map scene is displayed, and the player is in the same system where combat occurred

#### AC6: Defeat Screen
**Given** the player ship's HP reaches 0
**When** combat ends
**Then** a defeat screen appears with the message "Ваш корабль уничтожен" and a "Загрузить последнее сохранение" button

#### AC7: Load Save After Defeat
**Given** the player clicks "Загрузить последнее сохранение"
**When** the save loads
**Then** the player is returned to the star map in the last saved system, with HP, inventory, and quests restored

#### AC8: New Game After Defeat (No Save)
**Given** the player has no saved game and clicks "Загрузить последнее сохранение"
**When** the action completes
**Then** the game offers "Начать новую игру", and starting a new game generates a fresh galaxy

#### Non-Functional Expectations
- Enemy turn must complete within 2 seconds.
- Victory/defeat screen transitions must complete within 500 ms.
- Damage numbers must be readable and fade out within 1 second.
