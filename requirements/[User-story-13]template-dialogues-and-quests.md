# Story Decomposition: Template Dialogues with NPCs and Quest System

## INVEST Analysis

### Abstract Task

**"NPC Dialogue System with JSON Templates and Static Quest Management"**

**Analysis Dimensions**:
- **Core Responsibility**: Display dialogues with NPC portraits and text, offer response choices from JSON templates, manage quest lifecycle (accept, track, complete, reward).
- **Primary Operations**: Load dialogue templates, render NPC portrait and text, display response options, select response, issue quest, track quest progress, validate completion, distribute rewards.
- **Key Constraints**: Dialogues must be deterministic; quests must have clear objectives and rewards.
- **Technical Complexity**: Medium — JSON template parsing, quest state machine, UI layout.
- **Business Complexity**: Medium — branching dialogues and quest dependencies.

### INVEST Evaluation

- ✅ **Independent**: Can be developed with hard-coded JSON templates; does not require ONNX, combat, or save systems.
- ✅ **Negotiable**: Dialogue layout, quest reward values, and journal UI design are discussable.
- ✅ **Valuable**: Core RPG progression loop: talk → quest → reward.
- ✅ **Estimable**: 3–5 days for a developer familiar with dialogue systems.
- ✅ **Small**: Three core functional points (dialogue display, quest issuance, quest completion).
- ✅ **Testable**: Dialogue text, quest state, and inventory changes are verifiable.

**Conclusion**: Ready as-is.

### Split Strategy

Not needed — dialogue and quests form a single narrative progression loop.

---

## [STORY-001-013] Template Dialogues with NPCs and Quest System

### Background

The GDD describes a narrative layer where the player interacts with NPCs through dialogues and accepts quests. For MVP1, dialogues are template-based: each NPC has a JSON file with text, portrait, and response options. Quests are static with predefined objectives (e.g., "Deliver 10 ore"). This story delivers the dialogue UI, the quest journal, and the completion/reward flow.

Key points:
- This is the primary non-combat gameplay loop of MVP1.
- Template dialogues are a prerequisite for Phase 2 generative dialogues.
- The quest system will be expanded with dynamic objectives and procedural generation in Phase 2.

### Business Value

- Provide narrative depth and motivation beyond combat.
- Create a structured progression system with clear goals and rewards.
- Establish the dialogue and quest infrastructure for future AI-driven content.

### Dependencies and Assumptions

- **Prerequisites**: Story-1 (PixiJS renderer and scene system) is complete.
- **Data assumptions**: JSON dialogue templates and quest definitions exist; NPC portraits are available as image assets.
- **Integration points**: Inventory system (Story-13) for quest item checks and rewards; save system (Story-14) for quest persistence.
- **Business constraints**: Dialogue text must fit within the UI without scrolling; quest objectives must be clearly stated.

### Scope In

- Display a dialogue window with NPC portrait, name, and dialogue text.
- Load dialogue options from a JSON template based on NPC type and context.
- Allow the player to select a response; each response can lead to another dialogue node or close the dialogue.
- NPCs can offer quests through dialogue options (e.g., "Нужна ли помощь?" → quest offer).
- Quests have: title, description, objective (item delivery or location visit), reward (credits, experience, items).
- Active quests appear in the quest journal (accessible from the main UI).
- Track quest progress (e.g., "Руда: 5 / 10").
- Validate quest completion when the player meets the objective (e.g., arrives at station with 10 ore).
- On completion: mark quest as completed, remove objective items from inventory, add rewards.
- Display a completion notification.

### Scope Out

- Procedural or AI-generated dialogues — Phase 2.
- Branching quest trees with multiple outcomes.
- Reputation changes from quests — Phase 3.
- Voice acting or animated portraits.

### Acceptance Criteria (ACs)

#### AC1: Dialogue Window Display
**Given** the player initiates dialogue with a planet governor NPC
**When** the dialogue scene opens
**Then** the NPC portrait is visible, the NPC name is displayed, and the dialogue text reads: "Приветствую, рейнджер. Что привело тебя в нашу систему?"

#### AC2: Response Options
**Given** the dialogue window is open
**When** the current dialogue node has 3 responses
**Then** 3 clickable buttons are displayed with the response texts, and clicking a button advances the dialogue

#### AC3: Quest Offer
**Given** the player selects the response "Нужна ли помощь?"
**When** the NPC responds
**Then** a quest offer appears: "Доставить 10 единиц руды на станцию Омега. Награда: 100 кредитов, +50 опыта." with "Принять" and "Отказать" buttons

#### AC4: Quest Journal Update
**Given** the player accepts the delivery quest
**When** the quest is added
**Then** the quest appears in the quest journal with title "Доставка руды", objective "Руда: 0 / 10", and destination "Станция Омега"

#### AC5: Quest Completion
**Given** the player has 10 ore in inventory and arrives at the destination station
**When** the player interacts with the station
**Then** the quest is marked completed, 10 ore is removed from inventory, 100 credits and +50 experience are added, and a notification "Квест выполнен!" appears

#### AC6: Quest Journal Persistence
**Given** the player has 2 active quests and 1 completed quest
**When** the player opens the quest journal
**Then** active quests are shown in the "Активные" tab, completed quests in the "Завершённые" tab, and each entry displays title and progress

#### AC7: Dialogue Close
**Given** the player is in a dialogue
**When** the player selects the "Прощайте" response or clicks the close button
**Then** the dialogue window closes and the player returns to the previous scene

#### Non-Functional Expectations
- Dialogue window must open within 200 ms.
- Quest journal must display up to 20 quests without scrolling issues.
- Quest completion check must happen automatically on relevant player actions (arrival, inventory change).
