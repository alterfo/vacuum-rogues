# US-083: Station Scene Quality Fixes

> Epic: [EPIC-010](../epics/EPIC-010-visual-controls-polish.md) · UX Review: C2, H12  
> Status: **Planned**

## User Story

**As** a player  
**I want** the station scene to always show service buttons and readable micromodule names  
**so that** I can use station services and understand what micromodules I have installed

## Problems

1. **C2 (Critical)**: `StationScene` rendered without a `Station` context shows an empty dead-end. No service buttons, just a header. Player is stuck.
2. **H12**: Applied micromodule shown as raw ID `[мм: mm_shield_boost_t1]` instead of a human-readable name.

## Acceptance Criteria

```gherkin
Scenario: Null station context shows error, not dead-end
  Given StationScene is reached without a Station domain object in context
  Then an error message "Станция недоступна" is displayed
  And a "[ Назад ]" button is shown that transitions to SpaceFlightScene
  And no empty panel with missing buttons is shown

Scenario: Station context is always validated on entry
  Given GameEngine contextDependentScenes includes StationScene
  Then "Continue" (loadGame) never navigates to StationScene without a station object
  And any code path reaching StationScene with null context is caught and redirected

Scenario: Micromodule name is human-readable
  Given a micromodule with id "mm_shield_boost_t1" is installed
  When the player views the ship fitting panel
  Then the label shows a human-readable name (e.g. "Усиление щита I") not the raw ID

Scenario: Disabled service buttons are legible
  Given hull and fuel are at 100%
  Then "Корпус в норме" and "Баки полны" labels have contrast ratio ≥ 4.5:1
  (foreground: 0x6688aa minimum on 0x080818 background)
```

## Affected Files

- `src/presentation/StationScene.ts` — null-context guard in `renderMain()`, micromodule name lookup
- `src/systems/GameEngine.ts` — add `StationScene` to `contextDependentScenes`
- `src/data/GearCatalog.ts` or `src/data/MicroModuleCatalog.ts` — provide human-readable names
