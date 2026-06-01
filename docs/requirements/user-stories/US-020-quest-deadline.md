# US-020: Квесты с дедлайнами и штрафами

## User Story
**Как** космический рейнджер
**Хочу** видеть дедлайны квестов и понимать последствия их невыполнения
**Чтобы** приоритизировать задачи и избегать штрафов

## Статус: Done

## Acceptance Criteria

```gherkin
Scenario: Квест с дедлайном отображается корректно
  Given у игрока есть активный квест с дедлайном 3 дня
  When игрок просматривает журнал квестов
  Then видно оставшееся время до дедлайна
  And квест помечен как срочный если осталось < 2 дней

Scenario: Просроченный квест
  Given у игрока есть квест с дедлайном
  When проходит больше дней чем дедлайн
  Then квест помечается как проваленный
  And применяется штраф репутации на планете выдачи
  And при наличии штрафа кредитов - списываются кредиты
  And при наличии тюремного срока - игрок попадает в тюрьму

Scenario: Квест без дедлайна
  Given квест выдан без ограничения времени
  When игрок просматривает квест
  Then дедлайн показан как "Без ограничений"
```

## Technical Context
- **Domain**: Quest.ts (deadline, failurePenalty, isExpired, getRemainingDays)
- **System**: QuestManager.ts (checkExpiredQuests, applyFailurePenalty)
- **Scene**: DialogueScene.ts, SpaceFlightScene.ts

## Implementation Details
```typescript
// Quest.ts
interface QuestFailurePenalty {
  reputationLoss: number;    // Обязательно
  creditsFine?: number;      // Опционально
  jailTime?: number;         // Опционально (дни)
  description: string;       // Текст для UI
}

// QuestManager.ts
checkExpiredQuests(currentDay: number, player: Player): void
applyFailurePenalty(quest: Quest, player: Player): void
getUrgentQuests(currentDay: number): Quest[]
```

## Затрагиваемые файлы
- `src/domain/Quest.ts` - добавлены поля deadline, failurePenalty
- `src/systems/QuestManager.ts` - логика истечения и штрафов
- `src/validation/schemas.ts` - Zod схемы для сохранения
- `src/core/ports/IQuestService.ts` - интерфейс сервиса

## Out of Scope
- UI тюрьмы (отдельная User Story)
- Продление дедлайнов за деньги
- Квесты с несколькими этапами дедлайнов
