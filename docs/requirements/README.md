# Требования — Вакуумные Пройдохи

Требования живут **рядом с кодом** и должны оставаться **актуальными**: меняешь
поведение игры — обновляешь соответствующий документ здесь.

## Источник истины

**[`reference/SOURCE-OF-TRUTH.md`](reference/SOURCE-OF-TRUTH.md)** — каноническое
описание механик игры (по открытым источникам, без проприетарных имён). Это
**первоисточник** всех требований. Если требование или код противоречат канону —
прав канон; расхождение либо фиксируется в разделе «Осознанные отличия», либо
считается дефектом.

Оригинальные руководства (только механики, не тексты/изображения):
[`reference/help/`](reference/help/) — справка оригинала как reference.

## Структура

```
docs/requirements/
├── reference/
│   ├── SOURCE-OF-TRUTH.md   ← канон механик (первоисточник)
│   └── help/                ← оригинальные руководства (только reference)
├── epics/                   ← крупные функциональные блоки (EPIC-XXX)
│   └── archived/            ← выполненные эпики (исторически)
└── user-stories/            ← отдельные истории с Gherkin-критериями (US-XXX)
```

## Активные эпики

| ID | Название | Статус |
|----|----------|--------|
| [EPIC-010](epics/EPIC-010-visual-controls-polish.md) | Visual & Controls Polish | In Progress |
| [EPIC-011](epics/EPIC-011-player-loop.md) | End-to-End Player Loop | Planned |

## Архивированные эпики (Done)

| ID | Название | Канон (§) |
|----|----------|-----------|
| [EPIC-001](epics/archived/EPIC-001-trading.md) | Торговая система | §4 |
| [EPIC-002](epics/archived/EPIC-002-combat.md) | Боевая система (in-flight) | §7 |
| [EPIC-003](epics/archived/EPIC-003-living-galaxy.md) | Живая галактика (NPC) | §6 |
| [EPIC-004](epics/archived/EPIC-004-grand-system-radar-background.md) | Масштаб системы, радар, фон | §3 |
| [EPIC-005](epics/archived/EPIC-005-text-quests-onnx.md) | Текст-квесты на ONNX | §8, §10 |
| [EPIC-006](epics/archived/EPIC-006-planet-station-services.md) | Услуги планет и станций | §11.1–11.6 |
| [EPIC-007](epics/archived/EPIC-007-ship-fitting-equipment.md) | Снаряжение корабля | §11.3 |
| [EPIC-008](epics/archived/EPIC-008-quest-generation-and-missions.md) | Quest generation | §8, §11.1 |
| [EPIC-009](epics/archived/EPIC-009-information-system.md) | Information system | §11.5 |

## Активные User Stories

| ID | Название | Эпик | Статус |
|----|----------|------|--------|
| [US-071](user-stories/US-071-free-pan-during-turn.md) | Пан во время хода | EPIC-010 | Planned |
| [US-072](user-stories/US-072-minimap-center-on-player.md) | Кнопка «Вернуть камеру» | EPIC-010 | Planned |
| [US-073](user-stories/US-073-moon-z-order.md) | Спутники за планетой | EPIC-010 | Planned |
| [US-074](user-stories/US-074-player-loop.md) | End-to-end player loop | EPIC-011 | Planned |
| [US-075](user-stories/US-075-visual-assets.md) | Визуальные ассеты | EPIC-010 | Planned |
| [US-070](user-stories/US-070-space-flight-playability-sweep.md) | Flight playability sweep | — | Partial |

## Статусы

`Planned` → `In Progress` → `Done`. Статус истории должен отражать **реальное
состояние кода**, а не намерение.

## Дизайн-документы (вне эпиков)

- [`../design/AUDIO_TRACKLIST.md`](../design/AUDIO_TRACKLIST.md) — треки по ситуациям.
- [`../design/ART_PROMPTS.md`](../design/ART_PROMPTS.md) — промпты генерации арта.
- [`../design/ASSET_PIPELINE.md`](../design/ASSET_PIPELINE.md) — куда класть растр/музыку.
- [`../architecture/MODULES.md`](../architecture/MODULES.md) — схема модулей.

## Правила работы

1. Новая механика? Сверься с **SOURCE-OF-TRUTH**.
2. Заведи/обнови **эпик** и **user story**.
3. Реализуй, покрой тестами, обнови статус на `Done`.
4. Code review → UX review (если есть UI) → merge.
