---
# Bounty Quest: Real Named NPC + Info Center Tracking

## Overview
BOUNTY-квесты генерируют имя корабля-цели (напр. «Стальной ворон») только как нарративный текст —
настоящего NPC с таким именем в галактике нет, `targetObjectId` не заполнен. Игрок ищет в
Инфоцентре и не находит. Нужно: при принятии квеста найти реального пирата в целевой системе,
переименовать его, привязать через `targetObjectId`. Тогда GalacticRegistry (пересоздаётся каждый
игровой день из актуального `npcShip.currentSystemId`) автоматически отдаёт корабль при поиске по
имени — с системой и расстоянием в прыжках. Если цель убита другим NPC до прилёта игрока —
`matchesSystem`-фолбэк засчитывает любой kill в системе.

## Context
- `GameEngine.acceptBoardQuest()` — точка принятия квеста; здесь есть `galaxy.npcShips`
- `QuestTemplate.type` (не `questType`) — поле типа квеста
- `NpcRole.PIRATE`, `NpcState.DEAD` — в `src/types/index.ts`
- `GeneratedQuest.targetNpcName` — имя корабля из BOUNTY_SHIP_NAMES (строка или null)
- `GeneratedQuest.template.targetSystemId` — целевая система
- `QuestCompletion.bountyByNpcKill()` — завершение; проверяет `matchesNpc || matchesSystem`
- `GalacticRegistry` — `findShips({name})` уже работает; шипы индексируются по `s.name`
- `ShipLocation` не имеет `planetId`; NPC-пираты всегда в полёте — показываем систему
- Доп. файлы: `src/tests/presentation/questCompletionFlight.test.ts`

## Development Approach
- TDD: сначала тесты (красные), потом реализация
- Изменения только в двух production-файлах: `GameEngine.ts` + `QuestCompletion.ts`
- Не трогать существующие тесты — только дополнять
- Fallback (no pirate in system) сохраняет текущее поведение (`targetObjectId: null`, `matchesSystem`)

## Implementation Steps

### Task 1: Assign real NPC at acceptance time
**Files:**
- Modify: `src/systems/GameEngine.ts`

- [x] В `acceptBoardQuest()`: если `quest.template.type === QuestType.BOUNTY && quest.targetNpcName && quest.template.targetSystemId`, найти в `this.galaxy.npcShips` первый корабль с `currentSystemId === targetSystemId && role === NpcRole.PIRATE && state !== NpcState.DEAD`
- [x] Если пират найден: `pirate.name = quest.targetNpcName` и создать `{ ...quest.template, targetObjectId: pirate.id }` — передать этот шаблон в `questManager.acceptQuestFromTemplate`
- [x] Если пират НЕ найден: передать оригинальный шаблон без изменений (фолбэк на matchesSystem)
- [x] Добавить нужные импорты (`NpcRole`, `NpcState`, `QuestType`) если их нет
- [x] Написать `src/tests/systems/questBountyNpcAssignment.test.ts`: тест «пират в системе — переименован + targetObjectId выставлен», тест «нет пирата — targetObjectId null»
- [x] `npm test -- --run src/tests/systems/questBountyNpcAssignment.test.ts` — зелёный

### Task 2: Fallback when bounty target killed off-screen
**Files:**
- Modify: `src/presentation/flight/QuestCompletion.ts`

- [ ] В `bountyByNpcKill()`: вычислить `bountyTargetGone = !!quest.targetObjectId && !this.gameEngine?.galaxy?.npcShips.some(n => n.id === quest.targetObjectId)`
- [ ] Изменить `matchesSystem`: `(!quest.targetObjectId || bountyTargetGone) && quest.targetSystemId === currentSystemId`
- [ ] В `questCompletionFlight.test.ts` добавить тест «bounty с targetObjectId, но NPC не в galaxy.npcShips → matchesSystem срабатывает»
- [ ] `npm test -- --run src/tests/presentation/questCompletionFlight.test.ts` — зелёный

### Task 3: Final verification
**Files:** (none new)

- [ ] `npm run lint` — без ошибок
- [ ] `npm test -- --run` — все тесты зелёные
- [ ] `npm run build` — сборка чистая
- [ ] NO_PROXY=localhost,127.0.0.1 npm run test:e2e:regression — E2E regression OK
