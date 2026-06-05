# US-041: Маршрут на миникарте-радаре

> Эпик: [EPIC-004](../epics/EPIC-004-grand-system-radar-background.md) · Канон: SOURCE-OF-TRUTH §3

## User Story
**Как** игрок
**Хочу** видеть проложенный маршрут на радаре
**Чтобы** ориентироваться, куда летит корабль, относительно всей системы

## Статус: Done

## Acceptance Criteria
```gherkin
Scenario: Маршрут отображается на радаре
  Given проложен маршрут (планирование или полёт)
  Then на миникарте от корабля к цели идёт пунктирная линия
  And цвет градиентом: зелёный у корабля → оранжевый у цели
  And в точке цели — маркер назначения
```

## Реализация
`SystemMiniMap.updateWithSprites` принимает опциональный `route {x,y}` и рисует
градиентный пунктир + маркер. `SpaceFlightScene` передаёт `plannedRoute` (или
текущую цель `ShipPhysics`) при отрисовке радара.

## Затронутые файлы
- `src/presentation/SystemMiniMap.ts`
- `src/presentation/SpaceFlightScene.ts`

## Расширено (US-048, Done)
- Зелёное кольцо **границы системы** и белая **рамка текущего обзора** на радаре
  (`updateWithSprites` принимает `boundaryRadius` и `viewport`).

## На будущее
- Авто-масштаб радара под размер системы.
