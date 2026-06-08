---
# Sprint 4: Text Quest Engine & Original Quests

## Overview

Реализуем полноценный движок текстовых квестов по образцу Space Rangers 2 (TGE/QMM),
и разрабатываем с нуля 6 оригинальных квестов разных жанров: логика, экономика,
дедукция, комбинаторика, нарратив, физика. Квесты должны быть не хуже оригинала —
уникальные головоломки, которых нигде больше не встретишь.

## Context

- **Связанные US**: US-050 (text quest graph engine), US-051 (ONNX narration fallback)
- **Вдохновение**: SR2 text quests — Driver, Elum, Xenopark, Plasma Checkers, Ski Resort,
  Olympic Games, Ministry, Pachvaraus, Tourist Routes, Sorting
- **Ключевые файлы**: `src/systems/quests/` (новые файлы движка),
  `src/presentation/TextQuestScene.ts` (уже существует как стаб),
  `src/ai/FallbackEngine.ts`, `src/types/index.ts`
- **Движок SR2**: параметры-целые числа, переходы с условиями и формулами, критические
  пороги как прерывания, текстовая подстановка `<p47>`, рандомизация при старте

## Development Approach

- Regular (code first, then tests)
- Движок — TDD: тесты на машину состояний до реализации UI
- Квесты — сначала дизайн-документ как комментарий, потом код
- `npm test -- --run` + `npm run lint` после каждой задачи

## Implementation Steps

### Task 1: Ядро движка — QuestVM (State Machine)

**Files:**
- Create: `src/systems/quests/QuestVM.ts`
- Create: `src/systems/quests/QuestScript.ts`
- Create: `src/tests/questVM.test.ts`

- [x] Определить тип `QuestScript` в `QuestScript.ts`:
  ```typescript
  interface QuestParam { id: string; name: string; min: number; max: number;
    initial: number | 'random'; critMin?: number; critMax?: number;
    critTarget?: string; showInUI: boolean }
  interface QuestTransition { id: string; label: string; toLocation: string;
    condition?: string; effects: string[]; autoExecute?: boolean }
  interface QuestLocation { id: string; text: string; transitions: QuestTransition[];
    isSuccess?: boolean; isFailure?: boolean }
  interface QuestScript { id: string; title: string; params: QuestParam[];
    locations: QuestLocation[]; startLocation: string }
  ```
- [x] Реализовать `QuestVM` — интерпретатор:
  - `constructor(script, seed)` — инициализирует `params: Map<string,number>`,
    рандомизирует `initial:'random'` через SeededRNG
  - `currentLocation(): QuestLocation`
  - `availableTransitions(): QuestTransition[]` — фильтрует по `evaluate(condition)`
  - `execute(transitionId)` — применяет `effects[]` (формулы), меняет локацию,
    проверяет `critMin/critMax` → принудительный переход если нарушено
  - `evaluate(expr: string): boolean` — парсит `"p.money >= 500"`, `"p.hp > 0"` и т.д.
  - `applyEffect(expr: string)` — парсит `"p.money -= 100"`, `"p.money = p.money * 2"`,
    `"p.hp = random(1,20)"` и т.д.
  - `interpolate(text: string)` — заменяет `{money}` → значение параметра в тексте
  - `isFinished(): boolean`, `isSuccess(): boolean`
- [x] Написать тест `questVM.test.ts`: базовый сценарий 3 локации, проверка условий,
  критический порог, интерполяция текста, рандомный параметр воспроизводим с тем же seed
- [x] `npm test -- --run src/tests/questVM.test.ts` — зелёный
- [x] `npm test -- --run` + `npm run lint` — без регрессий

### Task 2: UI движка — TextQuestScene рефакторинг

**Files:**
- Modify: `src/presentation/TextQuestScene.ts`

- [x] Подключить `QuestVM` к `TextQuestScene`: принимает `QuestScript` через `context`
- [x] Layout (без Canvas-координат): верхняя 60% — панель описания (`Text`, wordWrap,
  fontSize из `fontScale`, белый текст, scrollable если не влезает); нижняя 40% —
  кнопки переходов (до 6 штук, `UiButton` из Sprint 3 Task 6)
- [x] Правая панель (180px): список `showInUI` параметров с именем и значением;
  числовые — с прогресс-баром если `min/max` заданы
- [x] При `autoExecute=true` переход выполняется автоматически через 800ms с анимацией «...»
- [x] На `isSuccess` → toast «Квест выполнен!» + `transitionTo(PLANET)` через 2 сек
- [x] На `isFailure` → toast «Провал.» + кнопка «Попробовать снова» (re-init VM с тем же seed)
- [x] Escape закрывает квест (возврат к планете без результата)
- [x] `npm test -- --run` + `npm run lint` — без регрессий

### Task 3: Квест «Таможня» (логика + ресурсы)

**Files:**
- Create: `src/systems/quests/scripts/customs.ts`
- Modify: `src/tests/questScripts.test.ts`

*Дизайн:* Ты — таможенный инспектор на орбитальной станции. За смену (20 кораблей)
нужно заработать 5000 кредитов. Каждый корабль — манифест с грузом. Сканер стоит 200 кр
за использование. Незадекларированный контрабандный груз = штраф 1000 кр с владельца.
Ошибочный досмотр легального корабля = дипломатический скандал (-500 рейтинга).
Корабли имеют «подозрительность» (0–10). Высокая — значит контрабанда вероятна,
но не гарантирована. Нужно решить: сканировать или пропустить каждый корабль.

- [x] Реализовать `customs.ts` как `QuestScript` (JSON-структура):
  - 20 «раундов» через параметр `shipNum` (1–20); `suspicion` — подозрительность (random 0–10)
  - Локация `inspect_decision`: текст с подозрительностью корабля и остатком кредитов;
    переходы: `scan` (−200 кр, открывает `scan_result`) или `pass` (→ `next_ship`)
  - Локация `scan_result`: если `smuggler=1` → +1000 кр, иначе `diplomatic_incident` → −500 рейтинга
  - `smuggler` = 1 если `suspicion >= 7` + 40% шанс при `suspicion 4–6` (через `random`)
  - Критический порог: `rating < 0` → `quest_failure`; `shipNum > 20 AND money >= 5000` → `quest_success`
- [x] Тест: квест завершается успехом при оптимальной стратегии (сканировать всех с `suspicion>=7`)
- [x] `npm test -- --run` + `npm run lint` — без регрессий

### Task 4: Квест «Гравитационный слалом» (физика + планирование)

**Files:**
- Create: `src/systems/quests/scripts/gravity-slalom.ts`

*Дизайн:* Учёный-Фэянин просит доставить зонд через систему с 5 гравитационными
объектами к финишной точке. Топлива — 100 единиц. Можно лететь прямо (дорого) или
использовать гравитационный манёвр — пролететь рядом с объектом и получить ускорение
(бесплатно, но добавляет время и меняет траекторию). Объекты расположены на сетке 3×3.
Нужно прибыть с ≥10 топлива в запасе. Расчёт топлива: прямой перелёт = дистанция / 5;
гравитационный манёвр = 0 топлива но нужно точно попасть в «окно» (параметр `window_open`,
выставляется random 0/1 при старте квеста).

- [x] 9 локаций — ячейки сетки; стартовая — `cell_a1`; финишная — `cell_c3`
- [x] Каждый переход: прямой (−N топлива) или через гравитационный объект (−0 если `window_N=1`, −40 если `window_N=0` — промахнулся)
- [x] Параметры `window_1..window_4` инициализируются `random(0,1)` — окна открыты случайно
- [x] Оптимальный маршрут зависит от seed — разные прохождения требуют разной стратегии
- [x] Тест: все маршруты из `cell_a1` в `cell_c3` корректно рассчитывают топливо
- [x] `npm test -- --run` + `npm run lint` — без регрессий

### Task 5: Квест «Следствие» (дедукция, ложные улики)

**Files:**
- Create: `src/systems/quests/scripts/investigation.ts`

*Дизайн:* На складе станции убили торговца. 4 подозреваемых: механик, пилот, торговец,
охранник. У каждого — мотив (деньги/месть/страх/случайность) и алиби. 8 улик на складе.
Проблема: 3 из 8 улик — подброшены убийцей (ложные). В досье каждого подозреваемого
есть противоречие с хотя бы одной реальной уликой. Задача: опросить всех (по 1 разу —
каждый допрос = параметр `interviewed_N = 1`), осмотреть улики (каждый осмотр = параметр
`examined_N = 1`), выявить ложные улики по противоречиям, обвинить правильного подозреваемого.

- [ ] Убийца определяется при старте квеста: `murderer = random(0,3)` — 0=механик, 1=пилот, 2=торговец_2, 3=охранник
- [ ] Улики 0–4 — настоящие (соответствуют реальному убийце), улики 5–7 — подброшены
  (указывают на другого персонажа, но противоречат уликам 0–4)
- [ ] Локации: `warehouse`, `interview_mechanic`, `interview_pilot`, ... `examine_evidence_0..7`
- [ ] Локация `accuse`: 4 кнопки-перехода; если `accused == murderer` → `success`; иначе → `wrong_accusation` (можно обвинить ещё раз, но штраф −200 рейтинга)
- [ ] Условие победы: `interviewed_all = 4 AND examined_min = 5 AND accused == murderer`
- [ ] Тест: при правильной последовательности допросов/осмотров квест разрешим для любого seed
- [ ] `npm test -- --run` + `npm run lint` — без регрессий

### Task 6: Квест «Сортировка грузов» (комбинаторика / расписание)

**Files:**
- Create: `src/systems/quests/scripts/cargo-sort.ts`

*Дизайн:* Диспетчер орбитального склада. 5 прибывающих транспортов, 3 разгрузочных
дока. Каждый транспорт везёт груз одного типа (A/B/C/D/E). Доки не могут смешивать
типы. Время разгрузки каждого транспорта — 1–4 часа (random). Суммарное время работы
не должно превышать 12 часов (иначе штраф). Нужно распределить транспорты по докам
минимизируя общее время. Это задача bin-packing. Случайные события: транспорт ломается
(+2 часа), требует приоритетной разгрузки (+500 кр если успел).

- [ ] Параметры: `time_A..E` (random 1–4 при старте), `dock1_load`, `dock2_load`, `dock3_load` (изначально 0)
- [ ] Локация `dispatch_hub`: 5 переходов — назначить транспорт A/B/C/D/E → выбор дока
- [ ] После назначения `dock_N_load += time_X`; если `dock_N_load > 12` → перегруз (штраф −300 кр)
- [ ] Random-событие `breakdown`: `random(0,4) == ship_id` → +2 к времени того транспорта
- [ ] Победа: все 5 транспортов назначены + суммарный overtime по всем докам < 4 часов
- [ ] Тест: оптимальное распределение для фиксированного seed даёт overtime < 4
- [ ] `npm test -- --run` + `npm run lint` — без регрессий

### Task 7: Квест «Реактор» (constraint satisfaction)

**Files:**
- Create: `src/systems/quests/scripts/reactor.ts`

*Дизайн:* Аварийный реактор корабля. 4 управляющих стержня (A/B/C/D), каждый на уровне
0–5. Стабильное состояние реактора — когда выполняются 4 условия одновременно:
`A + B = 7`, `C - D = 2`, `A * C = 12`, `B + D = 6`. Единственное решение:
A=3, B=4, C=4, D=2 (проверяемо). Каждое нажатие «поднять/опустить стержень» стоит
5 секунд (из 120 сек до взрыва). Начальные значения — random (но не совпадающие с решением).
Текстовый интерфейс: «Стержень A: [уровень]. Статус: [условия выполнены N/4]».

- [ ] Параметры: `rod_a` (random 0–5, ≠3), `rod_b` (≠4), `rod_c` (≠4), `rod_d` (≠2), `time_left=120`
- [ ] Переходы в каждой локации: `A+1`, `A-1`, `B+1`, `B-1`, `C+1`, `C-1`, `D+1`, `D-1`; каждый `-= 5` к `time_left`
- [ ] Вычислять `conditions_met` = count истинных из 4 условий (через текстовую подстановку)
- [ ] Критический порог: `time_left <= 0` → `reactor_explosion` (failure)
- [ ] Победа: `rod_a==3 AND rod_b==4 AND rod_c==4 AND rod_d==2` → `stable` (success)
- [ ] Тест: существует последовательность ≤ 10 ходов из любого random start (max манхэттенское расстояние = 9)
- [ ] `npm test -- --run` + `npm run lint` — без регрессий

### Task 8: Квест «Аукцион» (теория игр / риск)

**Files:**
- Create: `src/systems/quests/scripts/auction.ts`

*Дизайн:* Аукцион космического лома на станции Мэлоков. 8 лотов, бюджет 800 кредитов.
У каждого лота — видимый «класс» (I–IV) и скрытая реальная стоимость (от класса × random
множитель 0.5–2.0). 3 бота-участника с разными стратегиями: агрессивный (бьёт любую цену
+100), осторожный (не выше 200), случайный. Цель: выиграть лоты с суммарной прибылью
≥ 500 кр (реальная стоимость − цена покупки). Каждый раунд: стартовая цена лота — 50 кр.
Можно назвать свою ставку (фиксированные шаги: +50, +100, +200) или пропустить.

- [ ] 8 лотов: `lot_N_class` = random(1,4), `lot_N_true_value` = `lot_N_class * random_mult`
  где `random_mult` из набора [50, 75, 100, 150, 200] (seed-deterministic)
- [ ] Параметры: `budget=800`, `profit=0`, `current_lot=1`, `current_bid=50`
- [ ] Каждый шаг: показать лот N, его класс, текущую ставку; переходы `bid_+50/+100/+200/skip`
- [ ] При `bid`: бот-агрессивный автоматически даёт +100 если `current_bid < 400`; осторожный — пасует при `current_bid > 200`; случайный — 50% шанс +50
- [ ] Победа: `profit >= 500 AND current_lot > 8`; поражение: `budget <= 0 AND current_lot <= 8`
- [ ] Тест: агрессивная стратегия «бить всё» с фиксированным seed даёт предсказуемый результат
- [ ] `npm test -- --run` + `npm run lint` — без регрессий

### Task 9: Интеграция квестов в GameEngine + ONNX нарратив

**Files:**
- Modify: `src/systems/GameEngine.ts`
- Modify: `src/systems/quests/QuestGenerator.ts`
- Modify: `src/ai/FallbackEngine.ts`

- [ ] В `GameEngine` добавить `startTextQuest(scriptId: string, seed?: number)`:
  загружает скрипт, создаёт `QuestVM`, переходит в `TextQuestScene` с VM в context
- [ ] В `QuestGenerator` добавить маппинг квестов к планетам: каждая планета имеет
  `availableQuestIds[]` из 1–2 скриптов (детерминировано по `planet.id % scripts.length`)
- [ ] `GovernmentScene`: кнопка «Задания» → `JobBoardPanel` → строки квестов из двух источников:
  `deliveryQuests` (процедурные) + `textQuests` (скриптовые, с тегом «Особое задание»)
- [ ] ONNX нарратив: перед стартом text quest — `ONNXModelRegistry.infer('narration', {questTitle, planetName})`
  → вставить 1–2 предложения флейвора в первую локацию квеста; fallback —
  `FallbackEngine.narrateQuestIntro(script)` (детерминированные шаблоны)
- [ ] `npm test -- --run` + `npm run lint` — без регрессий

### Task 10: Верификация всех квестов

**Files:**
- None (verification)

- [ ] `npm test -- --run` — все тесты зелёные (включая `questVM`, `questScripts`)
- [ ] `npm run lint` — 0 ошибок
- [ ] `npm run build` — нет TypeScript ошибок
- [ ] Live: зайти на планету → Губернатор → Доска заданий → «Особое задание: Таможня»
- [ ] Live: пройти «Таможня» — квест завершается и возвращает на планетарный экран
- [ ] Live: пройти «Реактор» — текст динамически подставляет значения стержней
- [ ] Live: попробовать «Следствие» — ложные улики противоречат настоящим
- [ ] Live: ONNX fallback работает (квест запускается без модели)

## Technical Details

**QuestVM формулы** — использовать `Function()` только с whitelist операций (нет eval
произвольного кода). Парсить простые выражения `p.name op value` вручную:
```typescript
function evaluate(expr: string, params: Map<string, number>): boolean {
  const m = expr.match(/^(\w+)\s*(>=|<=|==|!=|>|<)\s*(-?\d+)$/);
  if (!m) throw new Error(`Bad condition: ${expr}`);
  const [,name, op, val] = m;
  const v = params.get(name) ?? 0;
  return { '>=': v >= +val, '<=': v <= +val, '==': v === +val,
           '!=': v !== +val, '>': v > +val, '<': v < +val }[op]!;
}
```

**Рандомизация**: `SeededRNG(seed)` уже есть в кодовой базе — использовать для всех
`random(min, max)` в эффектах квестов. Seed берётся из `Date.now()` при старте квеста
и сохраняется в `SaveManager` для возможности retry с тем же seed.

**Квестовые скрипты** — TypeScript объекты (не JSON файлы) для type safety. Каждый
скрипт экспортирует `const script: QuestScript`.

## Post-Completion

- Добавить ещё 4–5 квестов до итогового числа 10–12 (план следующего спринта)
- Редактор квестов (visual node editor) — долгосрочно
- Импорт `.qm`/`.qmm` файлов из оригинального SR2 (через парсер `igorsaux/qmm-rs` → WASM)
- Локализация квестовых текстов на английский
