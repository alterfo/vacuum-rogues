# US-043: Эффект выхода из варпа

> Эпик: [EPIC-004](../epics/EPIC-004-grand-system-radar-background.md) · Канон: SOURCE-OF-TRUTH §3

## User Story
**Как** игрок
**Хочу** видеть зрелищное появление корабля при выходе из гиперпрыжка
**Чтобы** прибытие в систему ощущалось событием

## Статус: Done

## Acceptance Criteria
```gherkin
Scenario: Вспышка и кольца при выходе из варпа
  Given я выполнил гиперпрыжок и появляюсь в новой системе
  Then в точке появления проигрывается короткий эффект:
    вспышка, расходящиеся кольца и затухающее свечение
  And эффект длится ~1.1с и сам убирается
```

## Реализация
`SpaceFlightScene.performWarp` передаёт `warpArrival: true` в контекст новой
сцены; `initialize` вызывает `playWarpArrivalEffect(shipX, shipY)`.
`updateWarpEffect` анимирует вспышку/кольца/свечение и удаляет контейнер.

## Затронутые файлы
- `src/presentation/SpaceFlightScene.ts`

## Зависимости
- US-023 (прыжок с края) — источник события `warpArrival`.
