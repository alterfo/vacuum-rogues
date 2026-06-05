# Требования — Space Rangers: Neural Onslaught

Требования живут **рядом с кодом** и должны оставаться **актуальными**: меняешь
поведение игры — обновляешь соответствующий документ здесь.

## Источник истины

**[`reference/SOURCE-OF-TRUTH.md`](reference/SOURCE-OF-TRUTH.md)** — каноническое
описание оригинальных «Космических рейнджеров» (по открытым источникам). Это
**первоисточник** всех требований. Если требование или код противоречат канону —
прав канон; расхождение либо фиксируется в разделе «Осознанные отличия», либо
считается дефектом.

## Структура

```
docs/requirements/
├── reference/
│   └── SOURCE-OF-TRUTH.md   ← канон оригинальной игры (первоисточник)
├── epics/                    ← крупные функциональные блоки (EPIC-XXX)
└── user-stories/             ← отдельные истории с Gherkin-критериями (US-XXX)
```

- **Эпик** = большой блок механики, ссылается на главу канона и список историй.
- **User story** = конкретная проверяемая единица работы с Acceptance Criteria
  (Gherkin), статусом и списком затронутых файлов.

## Эпики

| ID | Название | Канон (§) | Статус |
|----|----------|-----------|--------|
| [EPIC-001](epics/EPIC-001-trading.md) | Торговая система | §4 | In Progress |
| [EPIC-002](epics/EPIC-002-combat.md) | Боевая система | §7 | Planned |
| [EPIC-003](epics/EPIC-003-living-galaxy.md) | Живая галактика (NPC-корабли) | §6 | In Progress |
| [EPIC-004](epics/EPIC-004-grand-system-radar-background.md) | Масштаб системы, радар, фон | §3 | In Progress |
| [EPIC-005](epics/EPIC-005-text-quests-onnx.md) | Текст-квесты на диалоговом ONNX | §8, §10 | Planned |
| [EPIC-006](epics/EPIC-006-planet-station-services.md) | Услуги планет и станций (хаб) | §11.1–11.6 | Planned |
| [EPIC-007](epics/EPIC-007-ship-fitting-equipment.md) | Снаряжение корабля (корпус/модули/оружие) | §11.3 | Planned |
| [EPIC-008](epics/EPIC-008-quest-generation-and-missions.md) | Quest generation & galaxy-spanning missions | §8, §11.1 | Planned |
| [EPIC-009](epics/EPIC-009-information-system.md) | Information system (registry + search) | §11.5, §11.3 | Planned |

## Статусы

`Planned` → `In Progress` → `Done`. Статус истории должен отражать **реальное
состояние кода**, а не намерение.

## Дизайн-документы (вне эпиков)

- [`../design/AUDIO_TRACKLIST.md`](../design/AUDIO_TRACKLIST.md) — треки по ситуациям (ключи состояний).
- [`../design/ART_PROMPTS.md`](../design/ART_PROMPTS.md) — промпты генерации арта (без проприетарных имён).
- [`../design/ASSET_PIPELINE.md`](../design/ASSET_PIPELINE.md) — куда класть растр/музыку (авто-подхват по имени).
- [`../architecture/MODULES.md`](../architecture/MODULES.md) — модули для независимой разработки.

## Связь с другими документами

- **`DEVELOPMENT_PLAN.md`** (корень репо) — рабочий план/журнал реализации с
  BDD-сценариями и нарезкой на срезы. Это «как делаем», тогда как требования
  здесь — «что и почему» (выводится из канона).
- **`CLAUDE.md`** — инженерные правила (слои, PixiJS, сохранения). Не дублировать
  сюда — ссылаться.

## Рабочий процесс

1. Новая механика? Сверься с **SOURCE-OF-TRUTH** (или дополни его со ссылкой на
   источник, если канон расширился).
2. Заведи/обнови **эпик** и **user story** здесь.
3. Реализуй, покрой тестами, обнови статус истории на `Done`.
