# US-033: Видимые NPC-корабли в системе игрока

> Эпик: [EPIC-003](../epics/EPIC-003-living-galaxy.md) · Канон: SOURCE-OF-TRUTH §3, §6

## User Story
**Как** игрок
**Хочу** видеть чужие корабли в своей системе
**Чтобы** ощущать населённость мира и взаимодействовать с ними

## Статус: Done

## Acceptance Criteria

```gherkin
Scenario: Отрисовка NPC в текущей системе
  Given я нахожусь в системе, где есть NPC (не в перелёте)
  Then я вижу их спрайты, дрейфующие по системе
  And цвет корпуса соответствует фракции
  And над кораблём есть индикатор намерения (по роли)
  And NPC отображаются точками на миникарте (цвет фракции)

Scenario: Пошаговое движение NPC
  Given корабль игрока не движется
  Then NPC-спрайты не двигаются (мир на паузе)
  When корабль начинает движение
  Then NPC-спрайты дрейфуют по системе

Scenario: Появление/уход NPC только через границу системы
  Given во время моего полёта проходит игровой день
  When NPC прибывает в систему
  Then его спрайт появляется на границе системы (рубеж гиперпрыжка) и летит внутрь
  When NPC улетает из системы (TRAVELING)
  Then его спрайт летит к границе и совершает гиперпрыжок там (исчезает на краю)
  And корабли НЕ возникают и НЕ пропадают в центре системы

Scenario: Видимая граница системы
  Given я нахожусь в системе
  Then я вижу кольцо границы системы (рубеж гиперпрыжка)
```

## Technical Context
- **Sprite**: `NpcShipSprite` — корпус (цвет фракции) + индикатор намерения,
  дрейф к случайным точкам системы; позиция презентационная (не персистится)
- **Filter**: `npcsPresentInSystem(galaxy, systemId)` — NPC в системе, не в
  перелёте и не уничтоженные
- **Scene**: `SpaceFlightScene.createNpcShips/refreshNpcShips/updateNpcShips`;
  движение только когда корабль летит (как планеты)
- **Minimap**: точки NPC по фракциям (`SystemMiniMap.updateWithSprites`)

## Затрагиваемые файлы
- `src/presentation/NpcShipSprite.ts`
- `src/presentation/SpaceFlightScene.ts`
- `src/presentation/SystemMiniMap.ts`
- `src/systems/npc/NpcSimulator.ts` (`npcsPresentInSystem`)
- `src/tests/npcSimulator.test.ts`

## Out of Scope
- Осмысленное поведение (квесты/торговля/бой) — US-035
- Граница системы и точная варп-точка появления — EPIC-004
