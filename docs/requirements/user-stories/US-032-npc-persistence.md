# US-032: Сохранение и миграция состояния NPC

> Эпик: [EPIC-003](../epics/EPIC-003-living-galaxy.md) · Канон: SOURCE-OF-TRUTH §6

## User Story
**Как** игрок
**Хочу** чтобы жизнь галактики сохранялась
**Чтобы** загрузка возвращала тот же мир

## Статус: Done

## Acceptance Criteria

```gherkin
Scenario: Сохранение и загрузка NPC
  Given в галактике живут NPC в разных состояниях
  When я сохраняю и загружаю игру
  Then все NPC восстановлены (позиция, состояние, цель, статы)
  And Zod-схема валидирует поле galaxy.npcShips

Scenario: Миграция старого сейва
  Given сейв версии 1 без поля npcShips
  When он загружается
  Then миграция 1→2 добавляет пустой массив npcShips
  And галактика не ломается, население восстанавливается со временем
```

## Technical Context
- **Schema**: `NpcShipSchema` + `galaxy.npcShips` в `GalaxySchema` (default `[]`)
- **Migration**: `MigrationPipeline.CURRENT_VERSION = 2`, миграция `1 → 2`
- `NpcShip` — чистый data-класс, поэтому загруженные плоские объекты валидны без
  ре-инстанцирования (как `EnemyShip`/`NPC`)

## Затрагиваемые файлы
- `src/validation/schemas.ts`
- `src/data/MigrationPipeline.ts`
- `src/tests/npcSimulator.test.ts`

## Out of Scope
- Любое визуальное представление NPC
