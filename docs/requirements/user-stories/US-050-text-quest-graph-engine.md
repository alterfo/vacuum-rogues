# US-050: Движок графа текст-квеста

> Эпик: [EPIC-005](../epics/EPIC-005-text-quests-onnx.md) · Канон: SOURCE-OF-TRUTH §8

## User Story
**Как** игрок
**Хочу** проходить текстовый квест-новеллу с ветвлением
**Чтобы** мои выборы вели к разным исходам, как в оригинальных «Рейнджерах»

## Статус: Planned

## Acceptance Criteria

```gherkin
Scenario: Переход по узлам графа
  Given активен текст-квест с текущим узлом
  When я выбираю один из доступных вариантов
  Then квест переходит к узлу, указанному в выборе
  And если узел — терминальный, квест завершается с его исходом

Scenario: Выбор скрыт по невыполненному условию
  Given у варианта есть условие (навык/репутация/ресурс)
  And условие не выполнено
  Then вариант недоступен (скрыт или заблокирован), переход по нему невозможен

Scenario: Детерминированность
  Given один и тот же граф и один и тот же seed
  When я делаю одну и ту же последовательность выборов
  Then я прихожу в тот же узел с тем же набором эффектов
```

## Дизайн (для реализации)
- `TextQuest` — чистые данные: `nodes: Record<NodeId, QuestNode>`, `startNodeId`.
- `QuestNode` = `{ id, textKey, narrationPrompt, choices: QuestChoice[], outcome? }`.
- `QuestChoice` = `{ label, toNodeId, condition?, effects? }`.
- `condition` проверяется против `Player` (навык/репутация/кредиты/инвентарь).
- Рантайм (`TextQuestRuntime`) — чистая логика: `availableChoices(node, player)`,
  `apply(choice) → nextNodeId + effects`. **Без PixiJS и без ONNX** — тестируемо.
- Текст узла отдаётся отдельно нарратором (US-051); граф от него не зависит.

## Затрагиваемые файлы (план)
- `src/types/index.ts` — `QuestType.TEXT_ADVENTURE`, типы графа.
- `src/domain/TextQuest.ts` — граф (чистые данные).
- `src/systems/quests/TextQuestRuntime.ts` — переходы/условия/эффекты.
- `src/tests/textQuest.test.ts` — переходы, условия, детерминированность.

## Зависимости
- `Player`, репутация, инвентарь — есть.

## Out of Scope
- UI-сцена (US-052), генерация текста (US-051), персист (US-055).
