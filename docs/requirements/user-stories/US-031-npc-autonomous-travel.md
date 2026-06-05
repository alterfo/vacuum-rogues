# US-031: Автономные перелёты NPC по игровым дням

> Эпик: [EPIC-003](../epics/EPIC-003-living-galaxy.md) · Канон: SOURCE-OF-TRUTH §6

## User Story
**Как** игрок
**Хочу** чтобы NPC сами перемещались по галактике
**Чтобы** состав систем менялся со временем

## Статус: Done

## Acceptance Criteria

```gherkin
Scenario: NPC выбирает цель и летит
  Given NPC в состоянии IDLE в системе
  When наступает игровой день (advanceGalaxyDay)
  Then стейт-машина (NpcBrain) выбирает целевую систему по роли
  And NPC переходит в TRAVELING с destinationSystemId
  And перелёт занимает дни пропорционально варп-пути (иначе — расстоянию)

Scenario: Прибытие в целевую систему
  Given NPC в состоянии TRAVELING
  When дни в пути истекают (daysToArrival <= 0)
  Then currentSystemId становится целевой системой
  And NPC переходит в состояние по цели (TRADING/QUESTING/PATROLLING/IDLE)
```

## Technical Context
- **System**: `NpcSimulator.tick(galaxy, rng)` — продвигает перелёты и цели
- **Brain**: `RuleBasedNpcBrain` (правила), хук `OnnxNpcBrain` под ONNX
- **Engine**: `GameEngine.advanceGalaxyDay()` тикает NPC при каждом игровом дне
  (вызывается из `SpaceFlightScene` вместо прямого `galaxy.simulateDay()`)
- Детерминизм тика: rng от `galaxy.id` + `gameDays` (без состояния в сейве)

## Затрагиваемые файлы
- `src/systems/npc/NpcSimulator.ts`, `src/systems/npc/NpcBrain.ts`
- `src/systems/GameEngine.ts`
- `src/presentation/SpaceFlightScene.ts`
- `src/tests/npcSimulator.test.ts`

## Out of Scope
- Видимое движение спрайтов NPC (US-033)
- Офф-скрин бой и торговля (US-035)
