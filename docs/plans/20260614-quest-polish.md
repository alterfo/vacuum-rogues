---
# Quest Polish: BOUNTY clarity, highlights, return-to-issuer, dead templates, minRank

## Overview

Комплексная доработка квестовой системы:
1. **BOUNTY** — в описании нет имени корабля-цели и не понятно, где его искать
2. **Highlights** — значимые имена (корабль, система, планета, груз, заказчик) не выделены в UI
3. **Return-to-issuer** — BOUNTY/ESCORT/EXPLORATION/DEFENSE завершаются в полёте без визита к заказчику; нужен физический возврат за наградой
4. **Dead templates** — 8 хардкодных шаблонов в `QuestManager.loadQuestTemplates()` никогда не выдаются (заменены генератором), но засоряют код
5. **minRank** — поле есть в шаблоне, но `JobBoardPanel` его не проверяет

DELIVERY/DIPLOMACY/TEXT_ADVENTURE получают награду на целевой планете (текущее поведение сохраняется). BOUNTY/ESCORT/EXPLORATION/DEFENSE — после выполнения задачи переходят в режим «вернитесь за наградой».

## Context

- `src/domain/Quest.ts` — доменная сущность; добавляем `isPendingReturn: boolean`
- `src/systems/QuestManager.ts` — `loadQuestTemplates()` (мёртвый код), `forceCompleteQuest()`, `completeQuest()`
- `src/systems/quests/QuestGenerator.ts` — `buildRoutineQuest()`, `pickBountyDesc()`, `GeneratedQuest`
- `src/presentation/flight/QuestCompletion.ts` — `bountyByNpcKill()`, `escortBySystemEntry()`, `explorationBySystemEntry()`, `defenseBySystemEntry()`
- `src/presentation/PlanetScene.ts` — `checkDeliveryQuestCompletion()`, новый `checkReturnQuestCompletion()`
- `src/presentation/JobBoardPanel.ts` — `MAX_ACTIVE_QUESTS`, проверка `minRank`
- `src/presentation/QuestJournalUI.ts` — отображение активных квестов
- `src/validation/schemas.ts` — схема Quest
- `src/data/MigrationPipeline.ts` — миграция для isPendingReturn
- `src/tests/quests/` — тесты генератора и завершения квестов

## Development Approach

- **TDD**: для каждой задачи сначала пишем падающий тест, потом фикс
- Каждая задача завершается зелёными тестами перед переходом к следующей
- Backward-compatible: старые сейвы должны загружаться без ошибок (дефолт `isPendingReturn = false`)
- Не трогаем существующие тесты; добавляем новые

## Testing Strategy

- Юнит-тесты для всей логики в `src/tests/quests/` и `src/tests/presentation/`
- E2E только если уже есть сценарий для квестов в `e2e/` — добавить тогда туда

## Implementation Steps

### Task 1: Remove dead hardcoded quest templates

**Files:**
- Modify: `src/systems/QuestManager.ts`
- Create: `src/tests/quests/questManagerClean.test.ts`

- [x] Удалить метод `loadQuestTemplates()` из `QuestManager` (все 8 шаблонов: `quest_urgent_medicine`, `quest_bounty_hunt`, `quest_research_artifacts`, `quest_contraband`, `quest_diplomacy`, `quest_rescue`, `quest_delivery_ore`, `quest_explore_system`)
- [x] Убрать вызов `this.loadQuestTemplates()` из конструктора
- [x] Убедиться, что `this.questTemplates` пустой на старте (шаблоны добавляются только через `acceptQuestFromTemplate`)
- [x] Написать тест: `new QuestManager()` → `getQuestTemplate('quest_urgent_medicine')` возвращает `undefined`
- [x] Запустить `npm test -- --run` — все тесты зелёные

### Task 2: BOUNTY — named target ship in description and highlights

**Files:**
- Modify: `src/systems/quests/QuestGenerator.ts`
- Create: `src/tests/quests/questGeneratorBounty.test.ts`

- [x] Добавить пул имён кораблей `BOUNTY_SHIP_NAMES` в `QuestGenerator.ts` (20+ имён: «Стальная Тень», «Красный Клинок», «Ночной Призрак», «Ядовитый Зуб», «Железная Хватка», «Серебряный Вор», «Чёрная Молния», «Кровавый Рассвет», «Злой Рок», «Стальная Крыса», и т.д.)
- [x] В `buildRoutineQuest` для `QuestType.BOUNTY`: сгенерировать имя корабля через RNG из пула, сохранить в переменную `targetShipName`
- [x] Обновить `pickBountyDesc()`: добавить параметр `shipName: string`, во все 5 шаблонов добавить явное упоминание «корабль «{shipName}»»
- [x] Добавить к описанию чёткую строку: `\nЦель: корабль «{shipName}», система {targetName}`
- [x] Добавить `targetNpcName: string | null` в `GeneratedQuest` interface; заполнять для BOUNTY
- [x] Написать тест: BOUNTY квест содержит ship name в description и в `targetNpcName`
- [x] Написать тест: `pickBountyDesc` с shipName включает имя в результат
- [x] Запустить `npm test -- --run` — зелёные

### Task 3: Structured highlights in GeneratedQuest + render in UI

**Files:**
- Modify: `src/systems/quests/QuestGenerator.ts`
- Modify: `src/presentation/JobBoardPanel.ts`
- Modify: `src/presentation/QuestJournalUI.ts`
- Create: `src/tests/quests/questGeneratorHighlights.test.ts`

- [ ] Добавить в интерфейс `GeneratedQuest`:
  ```typescript
  highlights: ReadonlyArray<{ label: string; value: string; color: number }>;
  issuerPlanetId: string;
  ```
- [ ] В каждом builder (`buildRoutineQuest`, `buildChainQuest`, `buildFinaleQuest`, `buildLocalDelivery`, `buildTextQuest`, `buildFinaleQuest`, defense-блок) заполнять `highlights` по типу:
  - DELIVERY: `{ label: 'Груз', value: cargoLabel, color: 0x88ccff }`, `{ label: 'Система', value: target.name, color: 0x66ffcc }`, `{ label: 'Выдан', value: planetId, color: 0xaaaaaa }`
  - BOUNTY: `{ label: 'Цель', value: «shipName», color: 0xff6666 }`, `{ label: 'Система', value: target.name, color: 0x66ffcc }`, `{ label: 'Выдан', value: planetId, color: 0xaaaaaa }`
  - ESCORT: `{ label: 'Конвой', value: convoiName, color: 0x88ff88 }`, `{ label: 'Система', value: target.name, color: 0x66ffcc }`, `{ label: 'Выдан', value: planetId, color: 0xaaaaaa }`
  - DIPLOMACY: `{ label: 'Планета', value: targetPlanetId || target.name, color: 0xffcc66 }`, `{ label: 'Выдан', value: planetId, color: 0xaaaaaa }`
  - EXPLORATION / DEFENSE: `{ label: 'Система', value: target.name, color: 0x66ddff }`, `{ label: 'Выдан', value: planetId, color: 0xaaaaaa }`
- [ ] Заполнять `issuerPlanetId = planetId` во всех builders
- [ ] В `JobBoardPanel`: под description рендерить highlight-теги (цветные `Text` объекты) `[Груз: медикаменты]  [Система: Арктур]  [Выдан: планета X]` горизонтально, wrap при нехватке места
- [ ] В `QuestJournalUI`: в карточке активного квеста добавить строку highlights под описанием
- [ ] Написать тест: BOUNTY квест имеет highlight `{ label: 'Цель', ... }` и `{ label: 'Система', ... }`
- [ ] Написать тест: DELIVERY квест имеет highlight `{ label: 'Груз', ... }`
- [ ] Запустить `npm test -- --run` — зелёные

### Task 4: minRank check in JobBoardPanel

**Files:**
- Modify: `src/presentation/JobBoardPanel.ts`
- Modify: `src/presentation/PlanetScene.ts` (передача playerRank в JobBoardPanel)
- Create: `src/tests/presentation/jobBoardMinRank.test.ts`

- [ ] Добавить параметр `playerRank: number = 0` в конструктор `JobBoardPanel`
- [ ] В рендере каждой строки квеста: если `quest.template.minRank > 0 && playerRank < quest.template.minRank`, кнопка «Принять» серая + tooltip `Ранг ${quest.template.minRank}+`
- [ ] В `PlanetScene.ts`: передавать `this.gameEngine.player.rank` (или аналог) при создании `JobBoardPanel`
- [ ] Написать тест: JobBoardPanel с playerRank=1 и квестом minRank=3 → кнопка disabled
- [ ] Написать тест: playerRank=5, minRank=3 → кнопка enabled
- [ ] Запустить `npm test -- --run` — зелёные

### Task 5: Quest.isPendingReturn — domain + schema + migration

**Files:**
- Modify: `src/domain/Quest.ts`
- Modify: `src/validation/schemas.ts`
- Modify: `src/data/MigrationPipeline.ts`
- Create: `src/tests/quests/questPendingReturn.test.ts`

- [ ] Добавить в `Quest` поле `isPendingReturn: boolean = false`
- [ ] Изменить `updateProgress()`: когда `this.objectives.every(o => o.completed)` (все цели выполнены) — вместо `this.isCompleted = true` устанавливать `this.isPendingReturn = true` (для quest типов BOUNTY/ESCORT/EXPLORATION/DEFENSE); для DELIVERY/DIPLOMACY/TEXT_ADVENTURE — `this.isCompleted = true` (прежнее поведение сохраняется)
  - Добавить `readonly type: QuestType` в список params Quest (уже есть) — использовать его
  - Константа `RETURN_TO_ISSUER_TYPES = new Set([QuestType.BOUNTY, QuestType.ESCORT, QuestType.EXPLORATION, QuestType.DEFENSE])`
- [ ] Обновить `isExpired()` и `getRemainingDays()`: учитывать `isPendingReturn || isCompleted` как «финальный» статус
- [ ] Обновить `schemas.ts`: добавить `isPendingReturn: z.boolean().default(false)` в схему Quest (default = backward compatible)
- [ ] Обновить `MigrationPipeline.ts`: в финальной миграции (или добавить новую) — `quest.isPendingReturn ??= false` для activeQuests
- [ ] Написать тест: BOUNTY quest, все objectives выполнены → `isPendingReturn = true`, `isCompleted = false`
- [ ] Написать тест: DELIVERY quest, все objectives выполнены → `isCompleted = true`, `isPendingReturn = false`
- [ ] Запустить `npm test -- --run` — зелёные

### Task 6: Return-to-issuer gate in QuestCompletion + PlanetScene

**Files:**
- Modify: `src/presentation/flight/QuestCompletion.ts`
- Modify: `src/systems/QuestManager.ts`
- Modify: `src/presentation/PlanetScene.ts`
- Modify: `src/core/ports/IQuestService.ts`
- Modify: `src/core/adapters/QuestManagerAdapter.ts`
- Create: `src/tests/quests/questReturnGate.test.ts`

- [ ] В `QuestManager`: добавить метод `markObjectivesDone(questId: string): boolean` — устанавливает `quest.isPendingReturn = true` без начисления наград, перемещает в `pendingReturnQuests: Map<string, Quest>` (убирает из `activeQuests`)
- [ ] Добавить `getPendingReturnQuests(): Quest[]` в `QuestManager` и `IQuestService`
- [ ] Добавить в `QuestManagerAdapter` делегацию `markObjectivesDone` и `getPendingReturnQuests`
- [ ] В `QuestCompletion.bountyByNpcKill()`: заменить `forceCompleteQuest` → `markObjectivesDone` + уведомление «Цель уничтожена! Вернитесь в {quest.planetId} за наградой»
- [ ] Аналогично для `escortBySystemEntry()`, `explorationBySystemEntry()`, `defenseBySystemEntry()`
- [ ] В `PlanetScene.ts`: добавить `checkReturnQuestCompletion()` — при посадке на планету проверяет `questManager.getPendingReturnQuests()` на `quest.planetId === currentPlanetId` → для каждого такого квеста: звук sfx_reward + toast «Награда получена: +N ₡» + вызов `questManager.claimReturnReward(quest.id, player)` (новый метод, внутри = `completeQuest`)
- [ ] Вызывать `checkReturnQuestCompletion()` в `initialize()` PlanetScene (рядом с `checkDeliveryQuestCompletion()`)
- [ ] Написать тест: bountyByNpcKill помечает квест `isPendingReturn`, НЕ начисляет кредиты
- [ ] Написать тест: `getPendingReturnQuests()` возвращает квест после `markObjectivesDone`
- [ ] Написать тест: `claimReturnReward` начисляет кредиты и перемещает в completedQuests
- [ ] Запустить `npm test -- --run` — зелёные

### Task 7: Journal UI — показывать статус «Вернитесь за наградой»

**Files:**
- Modify: `src/presentation/QuestJournalUI.ts`
- Modify: `src/core/ports/IQuestService.ts` (если нужно добавить getPendingReturnQuests в интерфейс)
- Create: `src/tests/presentation/questJournalPendingReturn.test.ts`

- [ ] В `QuestJournalUI`: добавить третью секцию «Выполнено — забрать награду» между «Активные» и «Провалено»
- [ ] В карточке pending-return квеста: выделить жёлтым «↩ Вернитесь в {highlight[issuerPlanet]}»
- [ ] Highlight «Выдан: X» в таких карточках рендерить жёлтым (цвет цели)
- [ ] Написать тест: QuestJournalUI с pending-return квестом отображает «Вернитесь» секцию
- [ ] Запустить `npm test -- --run` — зелёные

### Task 8: Проверка пересечения сохранений — schema + миграция работают

**Files:**
- Modify: `src/tests/core/saveMigration.test.ts` (добавить случай)

- [ ] Добавить тест: сейв без `isPendingReturn` в quest-объектах мигрирует корректно (поле = false)
- [ ] Добавить тест: `pendingReturnQuests` отсутствующий в старом сейве → загружается как `[]`
- [ ] Запустить `npm test -- --run` — зелёные

### Task 9: Финальная верификация

**Files:** все изменённые

- [ ] Запустить полный `npm test -- --run`
- [ ] Запустить `npm run lint`
- [ ] Проверить что `npm run build` проходит без ошибок TS
- [ ] Запустить `npm run test:e2e:regression`

## Technical Details

### Новые поля GeneratedQuest
```typescript
interface GeneratedQuest {
  // existing fields...
  targetNpcName: string | null;          // BOUNTY only
  highlights: ReadonlyArray<{
    label: string;
    value: string;
    color: number;
  }>;
  issuerPlanetId: string;                // planet where quest was posted
}
```

### RETURN_TO_ISSUER_TYPES
```typescript
const RETURN_TO_ISSUER_TYPES = new Set([
  QuestType.BOUNTY,
  QuestType.ESCORT,
  QuestType.EXPLORATION,
  QuestType.DEFENSE,
]);
```

### Quest.isPendingReturn в updateProgress
```typescript
updateProgress(event): void {
  // ... existing objective update logic ...
  const allDone = this.objectives.every(o => o.completed);
  if (allDone) {
    if (RETURN_TO_ISSUER_TYPES.has(this.type)) {
      this.isPendingReturn = true;
    } else {
      this.isCompleted = true;
    }
  }
}
```

### QuestManager.pendingReturnQuests
- Отдельный `Map<string, Quest>` — не activeQuests, не completedQuests
- Сохраняется в save via `questLog.pendingReturnQuests` (новое поле)
- `getPendingReturnQuests()` → массив для UI
- `claimReturnReward(questId, player)` → внутри вызывает `completeQuest()` из pendingReturnQuests

## Post-Completion

**Ручная проверка:**
- Взять квест BOUNTY → имя корабля видно в описании и в журнале
- Убить корабль → toast «вернитесь за наградой», кредиты НЕ начислены
- Прилететь на исходную планету → toast с наградой, кредиты начислены
- Взять квест DELIVERY → по прежнему завершается на целевой планете (без возврата)
- Квест ESCORT — прилететь в систему → «Вернитесь за наградой»; вернуться → награда
- Проверить журнал: три секции (Активные / Выполнено—забрать / Провалено)
