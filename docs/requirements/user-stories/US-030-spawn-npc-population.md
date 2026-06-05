# US-030: Спавн населения NPC при генерации галактики

> Эпик: [EPIC-003](../epics/EPIC-003-living-galaxy.md) · Канон: SOURCE-OF-TRUTH §6

## User Story
**Как** игрок
**Хочу** чтобы в галактике жили другие корабли
**Чтобы** мир ощущался населённым

## Статус: Done

## Acceptance Criteria

```gherkin
Scenario: Спавн начального населения
  Given генерируется новая галактика из N систем
  When завершается генерация
  Then создаётся пул NPC-кораблей (≈1.5 на систему)
  And у каждого NPC есть id, имя, раса, фракция, роль и боевые статы
  And каждый NPC размещён в существующей системе
  And роли распределены между RANGER, TRADER, PIRATE, PATROL

Scenario: Детерминированность от seed
  Given две галактики сгенерированы с одинаковым seed
  Then их пулы NPC идентичны (id, роль, раса, стартовая система)
```

## Technical Context
- **Domain**: `NpcShip` (чистый data-класс), `Galaxy.npcShips`
- **System**: `NpcSimulator.spawnInitial(galaxy, rng)`
- Спавн вызывается из `GalaxySimulator.generateGalaxy` на детерминированном rng

## Затрагиваемые файлы
- `src/domain/NpcShip.ts`
- `src/systems/npc/NpcSimulator.ts`
- `src/systems/GalaxySimulator.ts`
- `src/tests/npcSimulator.test.ts`

## Out of Scope
- Отрисовка NPC (US-033), поведение/квесты (US-035)
