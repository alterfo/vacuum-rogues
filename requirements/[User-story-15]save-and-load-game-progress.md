# Story Decomposition: Save and Load Game Progress

## INVEST Analysis

### Abstract Task

**"Automatic Save on Exit and Progress Restoration on Return"**

**Analysis Dimensions**:
- **Core Responsibility**: Persist player progress (position, inventory, quests) to localStorage on tab close and restore it on next visit.
- **Primary Operations**: Serialize game state, store in localStorage, detect existing save on boot, deserialize and restore, handle missing or corrupted saves.
- **Key Constraints**: Save must complete before tab closes; restore must be seamless.
- **Technical Complexity**: Low-Medium — `beforeunload` handling, serialization, localStorage limits.
- **Business Complexity**: Low — clear save/load requirements.

### INVEST Evaluation

- ✅ **Independent**: Can be developed alongside other features; only requires a game state object.
- ✅ **Negotiable**: Save frequency, storage mechanism (localStorage vs. IndexedDB), and slot count are discussable.
- ✅ **Valuable**: Prevents progress loss — critical for player retention.
- ✅ **Estimable**: 2–3 days for a developer familiar with browser storage.
- ✅ **Small**: Two core functional points (save on exit, restore on return).
- ✅ **Testable**: Save data presence, state restoration, and fallback behavior are verifiable.

**Conclusion**: Ready as-is.

### Split Strategy

Not needed — save and load are two sides of the same persistence mechanism.

---

## [STORY-001-015] Save and Load Game Progress

### Background

The GDD requires that player progress persists between browser sessions. This story implements automatic saving when the player closes the game tab and automatic restoration when they return. The save includes: current star system, ship position, inventory contents, equipped modules, active and completed quests, and player stats (credits, experience). If a save exists, the player resumes exactly where they left off.

Key points:
- This is a foundational quality-of-life feature for MVP1.
- Save data validation is covered in Story-3 (Zod schemas); this story focuses on the persistence mechanism.
- The save system will be expanded with multiple slots and cloud sync in later phases.

### Business Value

- Prevent player frustration from lost progress.
- Enable short play sessions without requiring manual saves.
- Provide a seamless return experience that encourages repeat play.

### Dependencies and Assumptions

- **Prerequisites**: Story-3 (Zod validation) is complete; game state structure is stable.
- **Data assumptions**: Game state can be fully serialized to JSON; total save size is under 5 MB.
- **Integration points**: All gameplay systems (star map, combat, inventory, quests) must notify the save manager of state changes.
- **Business constraints**: Save must complete within 1 second of tab close; restore must complete within 2 seconds of game launch.

### Scope In

- Serialize the complete game state to JSON on `beforeunload` event.
- Store the serialized state in `localStorage` under key `space_rangers_save`.
- On game launch, check for existing save in `localStorage`.
- If save exists: validate with Zod (Story-3), deserialize, and restore game state.
- Restore: current system, ship position, inventory, equipped modules, quests, credits, experience.
- Display a "Добро пожаловать обратно" message when restoring.
- If no save exists: start a new game with default state.
- Handle save corruption gracefully: if validation fails, offer "Start New Game" (leveraging Story-3).

### Scope Out

- Multiple save slots — single autosave only.
- Manual save/load UI — automatic only.
- Cloud save synchronization.
- Save migration between game versions — covered in Story-3 fallback.

### Acceptance Criteria (ACs)

#### AC1: Automatic Save on Close
**Given** the player has explored 3 systems, has 500 credits, and an active quest
**When** the player closes the browser tab
**Then** the complete game state is saved to localStorage within 1 second

#### AC2: Restore on Return
**Given** a valid save exists in localStorage
**When** the player reopens the game
**Then** the game restores the saved state within 2 seconds, the player appears in the last visited system, and the active quest is still tracked

#### AC3: Inventory Persistence
**Given** the player has 3 items in inventory and a "Гамма-3" laser equipped
**When** the game is closed and reopened
**Then** the inventory contains the same 3 items and the ship still has "Гамма-3" equipped

#### AC4: Quest Progress Persistence
**Given** the player has a delivery quest with progress "Руда: 7 / 10"
**When** the game is closed and reopened
**Then** the quest journal shows the same quest with progress "Руда: 7 / 10"

#### AC5: New Game Without Save
**Given** no save exists in localStorage
**When** the player opens the game
**Then** a new galaxy is generated, the player starts in the default system with default ship and inventory

#### AC6: Corrupted Save Handling
**Given** localStorage contains corrupted save data
**When** the player opens the game
**Then** the Zod validator rejects the save, the player sees "Сохранение повреждено", and can start a new game

#### Non-Functional Expectations
- Save serialization must complete in under 1 second for a 5 MB state.
- Restore must complete in under 2 seconds.
- Save data must not exceed 5 MB to stay within localStorage limits.
