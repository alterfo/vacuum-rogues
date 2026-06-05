# US-042: Красивый фон (параллакс, туманности, виньетка)

> Эпик: [EPIC-004](../epics/EPIC-004-grand-system-radar-background.md) · Канон: SOURCE-OF-TRUTH §3

## User Story
**Как** игрок
**Хочу** атмосферный, живой космос вокруг корабля
**Чтобы** полёт в системе выглядел завораживающе, как в оригинале

## Статус: Done

## Acceptance Criteria
```gherkin
Scenario: Многослойный параллакс
  Given я в полёте в системе
  Then фон состоит из нескольких слоёв звёзд разной яркости и скорости
  And звёзды движутся с параллаксом относительно корабля

Scenario: Анимированные туманности
  Given система сгенерирована
  Then в системе есть большие органические туманности (палитра из seed системы)
  And они медленно дрейфуют и «дышат» (пульс альфы/масштаба)

Scenario: Виньетка
  Then края экрана слегка затемнены, действие читается в центре
```

## Реализация
`SpaceFlightScene`: `createNebulae` (кластеры мягких блобов в одном blurred
Graphics, палитра/раскладка из `SeededRNG("nebula_"+systemId)`),
`createStarField` (3 слоя, плотнее/ярче), `createTwinkleStars` (яркие звёзды с
4-лучевым бликом и пульсом), `createVignette` (затемнение краёв на uiLayer).
Анимация — `updateNebulae`/`updateTwinkleStars` по `bgElapsed`.

## Затронутые файлы
- `src/presentation/SpaceFlightScene.ts`

## Out of Scope
- Текстурные ассеты туманностей (сейчас процедурно через Graphics+Blur).
