# US-047: Маршрут огибает звезду

> Эпик: [EPIC-004](../epics/EPIC-004-grand-system-radar-background.md) · Канон: SOURCE-OF-TRUTH §3

## User Story
**Как** игрок
**Хочу** чтобы корабль не летел сквозь звезду, а обходил её
**Чтобы** маршрут был безопасным и выглядел как в оригинале (дуга вокруг солнца)

## Статус: Done

## Acceptance Criteria
```gherkin
Scenario: Прямой путь свободен
  Given отрезок корабль→цель не задевает зону звезды
  Then корабль летит по прямой

Scenario: Путь пересекает звезду
  Given отрезок корабль→цель проходит ближе STAR_AVOID_RADIUS к звезде
  Then строится путь из waypoint'ов по дуге вокруг звезды
  And корабль проходит их по очереди до цели
  And линия маршрута (в мире) рисуется ломаной по дуге
```

## Реализация
`SpaceFlightScene.computeAvoidancePath` (ближайшая точка отрезка к звезде; если
ближе `STAR_AVOID_RADIUS` — дуга из 3 waypoint'ов на радиусе вокруг звезды + цель).
`executeRouteTo` ставит waypoints; в `updateShip` при прибытии берётся следующий
waypoint, затем — финальная логика (посадка/варп). `drawRouteLine` рисует ломаную
по `routePath`.

## Затронутые файлы
- `src/presentation/SpaceFlightScene.ts`

## На будущее
- Обход планет/станций как препятствий; сглаживание дуги (Catmull-Rom).
