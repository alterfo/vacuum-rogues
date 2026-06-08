# US-079: Fix Navigation Dead-Ends

> Epic: [EPIC-010](../epics/EPIC-010-visual-controls-polish.md) · UX Review: C4, H9, H11  
> Status: **Planned**

## User Story

**As** a player  
**I want** every scene to have a visible exit  
**so that** I am never trapped in a dead-end screen with no way back

## Problems Found (UX Review)

1. **C4 — RaceSelectionScene**: no "Назад" button and no Esc handler → player cannot return to main menu after accidentally clicking "Новая игра"
2. **H9 — StarMapScene**: no "Назад" button in fixed UI → exit only via hidden keyboard shortcut or a click on current system
3. **H11 — DialogueScene**: non-governor NPCs get a `null` dialogue tree → black screen with no exit
4. **InfoCenterScene.goBack()**: if both `station` and `planet` are null → silently returns with no transition, leaving the player stuck

## Acceptance Criteria

```gherkin
Scenario: Back navigation from RaceSelection
  Given RaceSelectionScene is open
  When the player presses Escape or clicks the "Назад" button
  Then the game transitions to MainMenuScene

Scenario: Back navigation from StarMap
  Given StarMapScene is open
  Then a "[ Назад ]" button is visible in the fixed UI
  When the player clicks it
  Then the game transitions to SpaceFlightScene

Scenario: Dialogue fallback for non-governor NPCs
  Given an NPC with no dialogue tree reaches DialogueScene
  Then a generic one-node dialogue is shown (e.g. "Нет слов для разговора.")
  And a "Завершить" button returns to the previous scene

Scenario: InfoCenter goBack never silently fails
  Given InfoCenterScene is reached from SpaceFlightScene (no station/planet)
  When the player clicks "Назад" or presses Esc
  Then the game transitions to SpaceFlightScene
  And no silent no-op occurs
```

## Affected Files

- `src/presentation/RaceSelectionScene.ts` — add "Назад" button + Esc handler
- `src/presentation/StarMapScene.ts` — add "[ Назад ]" to `fixedUIContainer` (overlaps with US-077)
- `src/presentation/DialogueScene.ts` — add fallback null-tree handling
- `src/presentation/InfoCenterScene.ts` — fix `goBack()` to always transition
