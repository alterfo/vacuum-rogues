# US-071: Свободное панорамирование во время хода

> Эпик: EPIC-010 (Visual & Controls Polish) · Канон: SOURCE-OF-TRUTH §3

## User Story
**Как** игрок в полёте  
**Хочу** двигать карту в любой момент, включая время движения корабля  
**Чтобы** разведывать местность не дожидаясь паузы

## Статус: Planned

## Acceptance Criteria

```gherkin
Scenario: Панорамирование во время движения
  Given корабль летит к цели (isTurnRunning = true)
  When я зажимаю ПКМ и тащу мышь на 10+ px
  Then карта панорамируется
  And маршрут не сбрасывается
  And движение корабля не прерывается

Scenario: Клик после drag не ставит маршрут
  Given isPanning = true
  When я отпускаю ПКМ после drag > DRAG_THRESHOLD
  Then маршрут не ставится (drag swallowed)
  And isPanning сбрасывается в false

Scenario: Быстрый клик (не drag) ставит маршрут
  Given isPanning = false
  When я нажимаю и сразу отпускаю ПКМ (dragDistance < DRAG_THRESHOLD)
  Then ничего не происходит (ПКМ без drag = нет действия)
```

## Затронутые файлы
- `src/presentation/SpaceFlightScene.ts` — `onPointerDown`/`onPointerUp`:
  добавить `dragDistance` guard; убедиться что pan работает при `isTurnRunning`
