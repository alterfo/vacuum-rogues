# US-078: UI Localisation Consistency — No English Strings in Russian UI

> Epic: [EPIC-010](../epics/EPIC-010-visual-controls-polish.md) · UX Review: C5  
> Status: **Planned**

## User Story

**As** a player  
**I want** all in-game text to be consistently in Russian  
**so that** the game reads as a coherent product and not a half-translated prototype

## Problem

UX review found the following English strings in Russian-language UI:

| File | String | Fix |
|------|--------|-----|
| `MainMenuScene.ts` | `"GALACTIC HORIZON\nНЕЙРОСЕТЕВОЕ ВТОРЖЕНИЕ"` | `"ВАКУУМНЫЕ ПРОЙДОХИ"` (single Russian line) |
| `StarMapScene.ts` | `"SECTOR MAP"` | `"КАРТА ГАЛАКТИКИ"` |
| `CombatScene.ts` | `"TACTICAL COMBAT"` | `"ТАКТИЧЕСКИЙ БОЙ"` |
| `QuestJournalUI.ts` | Raw enum `[DELIVERY]`, `[BOUNTY]` in type labels | Import `TYPE_LABEL` from `JobBoardPanel.ts` |
| `src/main.ts` | `'Galactic Horizon'` in SW notification | `'Вакуумные Пройдохи'` |
| `src/main.ts` | `logger.info('Galactic Horizon: Neural Onslaught initialized')` | Update log string |
| `src/domain/NPC.ts` | Comment referencing old brand | Update comment |

## Acceptance Criteria

```gherkin
Scenario: No English strings visible to player
  Given any scene in the game
  Then all player-visible text strings are in Russian
  And scene title Text nodes contain no English words

Scenario: Quest type labels use Russian
  Given the QuestJournalUI is open
  Then quest type labels show "Доставка", "Охота", etc. (not "[DELIVERY]", "[BOUNTY]")

Scenario: Game title is rebranded
  Given the main menu is open
  Then the title displays "ВАКУУМНЫЕ ПРОЙДОХИ"
  And no "GALACTIC HORIZON" or "Neural Onslaught" text is visible
```

## Affected Files

- `src/presentation/MainMenuScene.ts` — title string
- `src/presentation/StarMapScene.ts` — "SECTOR MAP"
- `src/presentation/CombatScene.ts` — "TACTICAL COMBAT"
- `src/presentation/QuestJournalUI.ts` — quest type labels
- `src/main.ts` — notification title, logger message
- `src/domain/NPC.ts` — comment only (no functional change)
