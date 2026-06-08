# US-076: Loading State During Scene Transitions

> Epic: [EPIC-010](../epics/EPIC-010-visual-controls-polish.md) · UX Review: H2  
> Status: **Planned**

## User Story

**As** a player  
**I want** to see a loading indicator whenever the game is waiting for async work  
**so that** I know the game is working and don't double-click or think it froze

## Acceptance Criteria

```gherkin
Scenario: Loading overlay during Continue
  Given the player clicks "Продолжить" on the main menu
  When loadGame() is awaiting IndexedDB
  Then a "Загрузка..." overlay is visible on MainMenuScene
  And the "Продолжить" and "Новая игра" buttons are non-interactive during the wait

Scenario: Loading overlay during warp jump
  Given the player confirms a warp jump in StarMapScene
  When transitionTo() is awaiting scene construction
  Then a "Переход..." overlay is visible over the current scene
  And the warp button is non-interactive during the wait

Scenario: Overlay disappears on completion
  When the new scene has initialized
  Then the loading overlay is removed
  And the new scene is interactive
```

## Implementation Notes

- Overlay: full-screen semi-transparent black (alpha 0.7) + centred "Загрузка…" Text (18px, cyan)
- Disable all interactive buttons before `await`; re-enable on error/completion
- Overlay lives on a dedicated top-level `uiLayer` above `gameLayer`
- Works for: `MainMenuScene.handleContinue()`, `StarMapScene.performWarpJump()`, any new async `transitionTo` path

## Affected Files

- `src/presentation/GameEngine.ts` — add `showLoadingOverlay()` / `hideLoadingOverlay()`
- `src/presentation/MainMenuScene.ts` — wrap `loadGame` with overlay
- `src/presentation/StarMapScene.ts` — wrap `performWarpJump` with overlay
