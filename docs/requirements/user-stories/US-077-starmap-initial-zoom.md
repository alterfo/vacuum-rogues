# US-077: Star Map — Zoom-to-Fit on Open

> Epic: [EPIC-010](../epics/EPIC-010-visual-controls-polish.md) · UX Review: C1  
> Status: **Planned**

## User Story

**As** a player  
**I want** the star map to show all explored systems legibly when I open it  
**so that** I don't need to manually zoom and pan to find the galaxy

## Problem

Current: on `initialize()` the map renders at `zoomLevel = 1` with all systems collapsed into a tiny ~80×60 px cluster on a 1280×720 black canvas. The map is technically functional but visually broken on first open.

## Acceptance Criteria

```gherkin
Scenario: Map opens at zoom-to-fit
  Given the player opens StarMapScene
  When the scene initializes
  Then all explored systems are visible and occupy 60-80% of the canvas
  And the player's current system is centred or near-centred

Scenario: Close button always visible
  Given StarMapScene is open
  Then a "[ Назад ]" button is visible in the fixed UI (top-left or bottom-left)
  And clicking it transitions to SceneType.SPACE_FLIGHT

Scenario: Fuel label consistent with SpaceFlightScene
  Then the fuel display label matches the format used in SpaceFlightScene HUD
```

## Implementation Notes

- `initialize()`: compute bounding box of `player.visitedSystemIds` coordinates → set `zoomLevel` and `viewportX/Y` to centre and fit ~70% of canvas
- Add `[ Назад ]` button to `fixedUIContainer` → `transitionTo(SceneType.SPACE_FLIGHT)`
- Fuel label: align with HUD format (same key, same font size 14px)

## Affected Files

- `src/presentation/StarMapScene.ts` — zoom-to-fit on init, add Back button, fix fuel label
