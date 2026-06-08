# US-080: Combat Scene — Ships, HP Bars, and Combat Log

> Epic: [EPIC-011](../epics/EPIC-011-player-loop.md) · UX Review: C3, H6  
> Status: **Planned**

## User Story

**As** a player  
**I want** to see both ships on the battlefield with health bars and a combat log  
**so that** I understand what is happening during combat and can make informed decisions

## Problem

Current state: `CombatScene` renders an empty hex grid with three action buttons. No ships, no HP bars, no enemy portrait, no turn indicator, no log. Action buttons are at hardcoded pixel positions (y=430, x=50/230/370) which clip on smaller viewports.

## Acceptance Criteria

```gherkin
Scenario: Ships visible on combat grid
  Given CombatScene is entered with player and enemy NpcShip
  Then the player ship token is rendered on the grid at its start position
  And the enemy ship token is rendered at its start position
  And each token shows the ship class icon or silhouette

Scenario: HP bars visible
  Then the player HP bar is visible (e.g. above player token or in HUD strip)
  And the enemy HP bar is visible
  And HP bar colour changes: green > 60%, yellow 30-60%, red < 30%

Scenario: Combat log
  Then a scrollable text area shows the last 5 combat events
  And after "Атаковать" the log shows damage dealt and received
  And "Отступление" result message is in Russian

Scenario: Buttons are responsive to viewport
  Given the canvas has been resized
  Then action buttons remain visible and clickable
  And no button is clipped or positioned off-screen
  (buttons positioned relative to app.screen.height / app.screen.width)
```

## Affected Files

- `src/presentation/CombatScene.ts` — ship tokens, HP bars, combat log, responsive button positions
