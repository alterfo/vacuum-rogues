# US-072: Кнопка «Вернуть камеру к кораблю» на миникарте

> Эпик: EPIC-010 (Visual & Controls Polish) · Канон: SOURCE-OF-TRUTH §3

## User Story
**Как** игрок  
**Хочу** нажать одну кнопку на радаре и камера вернётся к кораблю  
**Чтобы** после панорамирования не искать корабль вручную

## Статус: Planned

## Acceptance Criteria

```gherkin
Scenario: Кнопка видна когда камера не на корабле
  Given я панорамировал карту (корабль не в центре viewport)
  Then кнопка «⊙» видна в углу миникарты

Scenario: Возврат камеры
  Given кнопка «⊙» видна
  When я нажимаю «⊙»
  Then cameraPanX/cameraPanY плавно анимируются к позиции корабля (lerp, ~300 мс)
  And кнопка скрывается после завершения анимации

Scenario: Кнопка не мешает drag-to-pan
  Then кнопка 28×28 px находится в правом нижнем углу миникарты
  And не перекрывает область карты
  And имеет stopPropagation чтобы не передавать клик в gameLayer
```

## Затронутые файлы
- `src/presentation/SystemMiniMap.ts` — добавить `Graphics`-кнопку «⊙»;
  эмитировать событие `center-on-player`
- `src/presentation/SpaceFlightScene.ts` — подписаться на событие и запустить lerp-анимацию камеры
