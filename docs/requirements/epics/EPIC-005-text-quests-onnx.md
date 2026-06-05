# EPIC-005: Текст-квесты на диалоговом ONNX

> Канон: [SOURCE-OF-TRUTH §8 «Квесты и репутация»](../reference/SOURCE-OF-TRUTH.md#8-квесты-и-репутация)
> и [§10 «Технические особенности»](../reference/SOURCE-OF-TRUTH.md#10-технические-особенности).

## Описание
Текстовые квесты-новеллы с ветвлением — фирменная черта оригинальных «Космических
рейнджеров». Игрок попадает в ситуацию (нашёл дрейфующий корабль, таможенный
досмотр, переговоры с пиратом), читает её описание и выбирает действия; исход
зависит от выбора, навыков, репутации и ресурсов. Уникальность нашей реализации —
**локальная диалоговая ONNX-модель** генерирует описания ситуаций и реплики NPC,
а не зачитывает их из фиксированного текста. Каркас квеста (узлы, условия, исходы)
детерминирован и проверяем; «мясо» текста — генеративное.

## Бизнес-ценность
**Главный дифференциатор проекта.** В оригинале культовыми были не бои, а
текст-квесты. Связка «движок диалогов на ONNX + ветвящийся квест» даёт то, чего
нет ни у оригинала, ни у конкурентов: процедурные квесты, где исход реагирует на
свободный/выбранный ответ игрока. Контент масштабируется без ручного написания
тысяч строк.

## User Stories

| ID | Название | Статус |
|----|----------|--------|
| [US-050](../user-stories/US-050-text-quest-graph-engine.md) | Движок графа текст-квеста (узлы, выборы, исходы) | Planned |
| [US-051](../user-stories/US-051-onnx-narration-with-fallback.md) | ONNX-генерация текста узла с детерминированным фоллбэком | Planned |
| US-052 | Сцена текст-квеста (UI: текст ситуации + кнопки выборов) | Planned |
| US-053 | Исходы влияют на кредиты/репутацию/инвентарь/журнал | Planned |
| US-054 | Триггеры: квест-новелла из контакта с NPC и событий в системе | Planned |
| US-055 | Персист состояния активного текст-квеста в сейве | Planned |

## Acceptance Criteria (Epic Level)
- [ ] Квест описывается **детерминированным графом** узлов: текст-ключ, набор
      выборов, условия (навык/репутация/ресурс), переходы и исходы.
- [ ] Текст узла **генерируется ONNX-моделью** из структурированного промпта
      (роль NPC, тон, факты ситуации); при недоступности модели — детерминированный
      шаблон-фоллбэк (по образцу `FallbackEngine`). Инференс **только в воркере**.
- [ ] Выбор игрока ведёт по графу; исход меняет кредиты/репутацию/инвентарь и
      пишет запись в журнал.
- [ ] Текст-квест запускается из контакта с NPC (EPIC-003) и/или события в системе.
- [ ] Состояние активного квеста (текущий узел, seed, накопленные эффекты)
      сохраняется и восстанавливается (`schemas.ts` + `MigrationPipeline`).
- [ ] Граф и эффекты покрыты unit-тестами; генерация замокана (без реального ONNX).

## AI: генерация + детерминированный каркас
- **Каркас** (граф, условия, исходы) — чистые данные/логика, **детерминированы и
  тестируемы** без модели. Это «контракт» квеста.
- **Текст** — `QuestNarrator` с реализацией `OnnxQuestNarrator` (через
  `ONNXModelRegistry.infer()` в воркере) и `TemplateQuestNarrator` (фоллбэк).
  Образец разделения — `NpcBrain` (Rule/Onnx) из EPIC-003 и `FallbackEngine`.
- **Перф-правило (CLAUDE.md):** инференс никогда на главном потоке; модель
  грузится лениво и кешируется в IndexedDB. Генерацию применять точечно (ключевые
  узлы), не на каждый чих.

## Затрагиваемые компоненты (план)
- `src/types/index.ts` — `QuestType.TEXT_ADVENTURE`, типы узла/выбора/исхода графа.
- `src/domain/` — `TextQuest` (граф как чистые данные), модель состояния прохождения.
- `src/systems/quests/` — рантайм графа (переходы, проверка условий, применение
  исходов), `QuestNarrator` интерфейс.
- `src/ai/adapters/` — `OnnxQuestNarrator` (preprocess→infer→postprocess) +
  фоллбэк в `src/ai/FallbackEngine.ts`.
- `src/presentation/` — `TextQuestScene` (текст ситуации + кнопки выборов; правила
  PixiJS-событий из CLAUDE.md: `stopPropagation` на кнопках, текст `eventMode='none'`).
- `src/systems/GameEngine.ts` — переход в `SceneType.TEXT_QUEST`.
- `src/validation/schemas.ts`, `src/data/MigrationPipeline.ts` — персист состояния.

## Зависимости
- ONNX-инфраструктура (`ONNXModelRegistry`, воркеры, IndexedDB) — есть.
- `QuestManager`/`Quest`, журнал, репутация — есть (награды/эффекты).
- EPIC-003 (живая галактика) — источник триггеров «контакт с NPC → квест».
- Желательно EPIC-001 (рынки) — для квестов с торговыми исходами.

## Design: difficulty and rarity (the "cherry on top")
In the original, text-quests were **hard and multi-step** — the player did not
beat them on the first try and looked up walkthroughs. We hold the same bar
without turning them into routine:
- **Multi-step and branching**: the graph has several nodes, dead-end/fail
  branches, delayed consequences of choices, sometimes a logical puzzle (the two
  canon categories — logical and atmospheric, see §11.9).
- **Failure has a real cost**: a fail → loss of time/credits/reputation, but makes
  clear where the player went wrong (as in the original — "beat it on the tenth try").
- **Rarity as value**: text-quests **do not pile up** — they are issued by the
  director ([EPIC-008](EPIC-008-quest-generation-and-missions.md)) at a share of
  **≈ 1 in 5** of all quests (parameter `QUEST_TEXT_RATIO`). The other 4/5 are
  routine missions that drive the player across the galaxy; a text-quest is a
  reward event.
- **Balance separate from text**: difficulty is set by the graph structure
  (conditions, branches, outcomes) — deterministic and testable; ONNX only writes
  the "prose".

## Осознанные отличия от канона
- Оригинал использовал **рукописные** текст-квесты на скриптовом языке. Мы
  заменяем ручной текст на **генеративный** (ONNX) поверх детерминированного
  графа. Каркас и исходы остаются авторскими/проверяемыми — модель пишет только
  «прозу», что сохраняет баланс и тестируемость.
- Доля текст-квестов (≈1/5) — наш дизайн-параметр распределения (EPIC-008), в
  каноне явной пропорции нет.

## План реализации
Нарезку на срезы (граф → нарратор+фоллбэк → сцена → исходы → триггеры → персист)
вести в `DEVELOPMENT_PLAN.md` как «Feature 10». Начинать с US-050/US-051: граф и
нарратор с фоллбэком тестируются без UI и без реальной модели.
