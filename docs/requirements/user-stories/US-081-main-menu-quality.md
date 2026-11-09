# US-081: Main Menu Quality Fixes

> Epic: [EPIC-010](../epics/EPIC-010-visual-controls-polish.md) · UX Review: H1  
> Status: **Implemented**

## User Story

**As** a player  
**I want** the main menu to behave predictably — "Продолжить" only enabled when a save exists, error messages to appear and disappear correctly  
**so that** I'm not misled by phantom buttons or accumulating error toasts

## Acceptance Criteria

```gherkin
Scenario: "Продолжить" disabled with no save
  Given no save game exists in IndexedDB
  When MainMenuScene initialises
  Then the "Продолжить" button is visually dimmed (colour 0x556677, raised from
  0x445566 to clear the AA contrast floor)
  And clicking it has no effect (no error toast shown for unavailable action)

Scenario: "Продолжить" enabled when save exists
  Given a save game exists
  Then the button is lit (colour 0xffaa00)
  And clicking it initiates loading

Scenario: Error message replaces itself
  Given MainMenuScene is showing an error message
  When a second error occurs
  Then the previous message is removed before the new one appears
  And messages never accumulate as stacked Text nodes

Scenario: Error message disappears after 5 seconds
  When an error message is shown
  Then it is removed after 5000 ms automatically
```

## Affected Files

- `src/presentation/MainMenuScene.ts`:
  - `initialize()`: async-check save existence → set button colour/interactive state
  - `showMessage()`: remove previous `msgText` before adding new one; set 5s auto-remove timer
