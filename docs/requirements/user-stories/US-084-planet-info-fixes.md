# US-084: Planet Info and Faction Display Fixes

> Epic: [EPIC-010](../epics/EPIC-010-visual-controls-polish.md) · UX Review: H4  
> Status: **Planned**

## User Story

**As** a player  
**I want** to see the correct faction for each planet and accurate repair/service status  
**so that** I can plan my interactions without being misled by wrong information

## Problem

`PlanetInfoPanel.ts` line 57 hardcodes `'Фракция: Окраинники'` for all habitable planets regardless of the actual faction owning the system. Every planet shows the same faction, making the faction system appear non-functional.

## Acceptance Criteria

```gherkin
Scenario: Planet shows actual owning faction
  Given a habitable planet owned by FactionType.BASTIONS
  When the player hovers over or clicks the planet
  Then PlanetInfoPanel shows "Фракция: Бастионы" (not "Окраинники")

Scenario: Each faction name displayed in Russian
  Then faction names in PlanetInfoPanel use the canonical Russian name:
    OUTLANDERS → "Окраинники"
    BASTIONS   → "Бастионы"
    SYNDICATE  → "Синдикат"
    PROGRESSORS → "Прогрессоры"
    PARADOXES  → "Парадоксы"
    INDEPENDENT → "Независимые"
    OVERMIND   → "Овермайнд"

Scenario: Uninhabitable planet shows drones, not faction
  Given an uninhabitable planet
  Then the panel shows "Дроны: N" (existing behaviour, keep)
```

## Affected Files

- `src/presentation/PlanetInfoPanel.ts` — line 57: look up `planet.factionId` from its parent `StarSystem`
- Add a `FACTION_LABEL: Record<FactionType, string>` constant (or reuse if exists)
