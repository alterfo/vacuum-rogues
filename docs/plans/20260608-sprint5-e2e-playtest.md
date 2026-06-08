---
# Sprint 5: Automated Playtests + Monkey Testing

## Overview

Расширяем E2E-покрытие до полноценных плейтестов: полный игровой цикл (взлёт → полёт →
посадка → торговля → квест → возврат), проверка всех сцен на dead-ends, и monkey testing —
серии случайных кликов/скроллов/клавиш с проверкой что игра не падает, не зависает и
остаётся в валидном состоянии.

## Context

- **Инфраструктура**: Playwright, порт 5175, `window.__gameEngine` в dev-режиме
- **Существующие тесты**: `e2e/` — 5 smoke-тестов, `e2e/page-objects/`
- **Ограничения**: скриншоты ненадёжны (render loop); визуал — только ручная проверка;
  `waitForTimeout` запрещён — использовать `waitForFunction`/`waitForSelector`
- **Метрики monkey-теста**: 0 uncaught JS errors, игра не зависает (engine.isRunning),
  после N кликов сцена существует и имеет валидный тип

## Development Approach

- Каждый тест изолирован: свежий `page`, новая игра через `startNewGame()`
- Seed рандома в monkey-тестах фиксирован для воспроизводимости (`Math.seedrandom(42)`)
- `waitForFunction` вместо `waitForTimeout` везде
- Ошибки консоли перехватываются через `page.on('console')` и `page.on('pageerror')`

## Implementation Steps

### Task 1: Вспомогательная инфраструктура плейтестов

**Files:**
- Create: `e2e/helpers/gameDriver.ts`
- Create: `e2e/helpers/monkeyTester.ts`
- Create: `e2e/helpers/errorCollector.ts`

- [x] Создать `e2e/helpers/errorCollector.ts`: класс `ErrorCollector` — перехватывает
  `page.on('console', 'pageerror')`, накапливает ошибки; метод `assertNoErrors()`
  бросает если есть uncaught JS error или `[ERROR]` в console
- [x] Создать `e2e/helpers/gameDriver.ts`: враппер над `window.__gameEngine`:
  - `waitForScene(sceneName)` — `waitForFunction` пока `engine.currentScene.constructor.name === sceneName`
  - `getPlayer()` — `evaluate(() => engine.player)`
  - `playTurn()` — вызывает `engine.currentScene.handlePlayPause()` + ждёт `isTurnRunning=false`
  - `landOnPlanet(index?)` — берёт первую/указанную планету, запускает посадку
  - `takeOff()` — `engine.currentScene.handleTakeOff()`
  - `acceptQuest(questId)` — `engine.acceptBoardQuest(questId)`
  - `getCredits()` — `engine.player.credits`
  - `getHP()` — `engine.player.hull.hp`
  - `isAlive()` — HP > 0 и сцена существует
- [x] Создать `e2e/helpers/monkeyTester.ts`: класс `MonkeyTester`:
  - `constructor(page, seed=42)` — инициализирует seeded RNG (lcg: `seed = (seed * 1664525 + 1013904223) & 0xffffffff`)
  - `nextFloat()` — [0,1) из seed
  - `randomClick(bounds?)` — клик в случайной точке canvas (bounds: {x,y,w,h} или весь экран)
  - `randomRightClick()` — ПКМ для pan
  - `randomScroll(delta?)` — wheel event со случайным deltaY (-300..+300)
  - `randomKey(keys?)` — нажать случайную клавишу из `['Escape', ' ', 'Tab']`
  - `run(n, opts)` — выполнить N случайных действий с паузой `opts.delayMs=50` между ними;
    распределение: 60% левый клик, 20% ПКМ, 15% scroll, 5% клавиша
  - возвращает `{ actions: number, errors: string[] }`
- [x] `npm run lint` — без ошибок

### Task 2: Full-loop playtest — новая игра до первой торговли

**Files:**
- Create: `e2e/playtest-01-full-loop.spec.ts`

- [x] Тест `should complete full game loop: flight → land → trade → takeoff`:
  - Запустить новую игру, дождаться `SpaceFlightScene`
  - Запустить ход (`playTurn()`), дождаться паузы
  - Выбрать маршрут к планете (`engine.currentScene.onPlanetClick(planets[0])`)
  - Запустить ход снова, дождаться посадки (`waitForScene('PlanetScene')`)
  - Проверить `credits = getCredits()`
  - В TradeScene купить 1 единицу дешёвого товара
  - Проверить `getCredits() < credits` (деньги списаны)
  - Взлететь, дождаться `SpaceFlightScene`
  - `errorCollector.assertNoErrors()`
- [x] Тест `should not lose credits on cancel trade`:
  - Зайти на планету, открыть рынок, НЕ покупать, взлететь
  - Проверить `credits === initialCredits`
- [x] `npm run test:e2e -- --run e2e/playtest-01-full-loop.spec.ts`
- [x] `npm run lint` — без ошибок

### Task 3: Full-loop playtest — текстовые квесты

**Files:**
- Create: `e2e/playtest-02-text-quests.spec.ts`

- [x] Тест `should start and complete reactor quest`:
  - Новая игра → посадка на планету
  - `engine.startTextQuest('reactor', 42)` → `waitForScene('TextQuestScene')`
  - Проверить что в DOM/canvas есть параметр `time_left` (через `engine.currentScene.vm.getParam('time_left')`)
  - Сделать 5 переходов через `engine.currentScene.executeTransition('rod_a_up')`
  - Проверить что `time_left` уменьшилось
  - `errorCollector.assertNoErrors()`
- [x] Тест `should handle quest failure gracefully`:
  - Запустить квест reactor с seed где начальные стержни далеко от цели
  - Нажимать произвольные переходы пока `time_left <= 0`
  - Проверить что показан экран провала (не crash)
  - Проверить `waitForScene('PlanetScene')` после нажатия «Попробовать снова» → «Выход»
- [x] Тест `should complete customs quest optimally`:
  - seed=1 (конкретный seed); запустить квест, пройти все 20 раундов
  - сканировать корабли с `suspicion >= 7` → skip остальных
  - проверить `quest.isSuccess === true`
- [x] `npm run test:e2e -- --run e2e/playtest-02-text-quests.spec.ts`
- [x] `npm run lint` — без ошибок

### Task 4: Dead-end проверка всех сцен

**Files:**
- Create: `e2e/playtest-03-no-dead-ends.spec.ts`

- [x] Тест `every scene has a way back`:
  - Для каждой сцены из списка `[StarMap, Planet, Trade, Dialogue, Inventory, Station, InfoCenter, Government, TextQuest, WinScreen]`:
    - Перейти в сцену через `engine.transitionTo(SceneType.X, ctx)`
    - Нажать Escape или найти кнопку «Назад»/«Взлёт»
    - Проверить что сцена сменилась (не осталась та же)
- [x] Тест `main menu continue without save shows disabled button`:
  - Очистить localStorage, открыть MainMenu
  - Проверить `engine.currentScene.continueBtn.alpha < 1` (задимлена)
- [x] Тест `info center search returns results`:
  - `engine.transitionTo('INFO_CENTER', ctx)`
  - `engine.currentScene.runGearSearch({ facet: 'engine' })`
  - Проверить `engine.currentScene.gearResults.length > 0`
- [x] `npm run test:e2e -- --run e2e/playtest-03-no-dead-ends.spec.ts`
- [x] `npm run lint` — без ошибок

### Task 5: Monkey testing — SpaceFlightScene

**Files:**
- Create: `e2e/monkey-01-space-flight.spec.ts`

- [x] Тест `monkey: 200 random inputs in SpaceFlightScene do not crash`:
  - Новая игра → `waitForScene('SpaceFlightScene')`
  - `monkey.run(200, { delayMs: 30 })`
  - После: `waitForFunction(() => !!engine.currentScene)` — сцена жива
  - `errorCollector.assertNoErrors()`
  - Проверить `engine.isRunning === true`
- [x] Тест `monkey: clicks during turn execution are ignored (no route set)`:
  - Запустить ход
  - `monkey.run(50, { delayMs: 20, types: ['leftClick'] })` пока `isTurnRunning`
  - После паузы: проверить `engine.currentScene.plannedRoute === null` — клики не сломали маршрут
- [x] Тест `monkey: rapid scroll does not break zoom bounds`:
  - `monkey.run(100, { delayMs: 10, types: ['scroll'] })`
  - Проверить `cameraZoom >= MIN_ZOOM && cameraZoom <= MAX_ZOOM`
- [x] Тест `monkey: right-click panning does not accumulate NaN`:
  - `monkey.run(100, { delayMs: 20, types: ['rightClick'] })`
  - Проверить `!isNaN(cameraPanX) && !isNaN(cameraPanY)`
- [x] `npm run test:e2e -- --run e2e/monkey-01-space-flight.spec.ts`
- [x] `npm run lint` — без ошибок

### Task 6: Monkey testing — планетарные и квестовые сцены

**Files:**
- Create: `e2e/monkey-02-planet-and-quests.spec.ts`

- [x] Тест `monkey: 100 random clicks on PlanetScene do not crash`:
  - Посадить на планету
  - `monkey.run(100, { delayMs: 40 })`
  - Проверить что сцена — Planet или SpaceFlight (взлетели от случайного клика — ок)
  - `errorCollector.assertNoErrors()`
- [x] Тест `monkey: rapid transitions in TextQuestScene are safe`:
  - Запустить квест `reactor` seed=99
  - В цикле 30 раз: выбрать случайный доступный переход из `vm.availableTransitions()`
    и выполнить его через `engine.currentScene.executeTransition(id)`
  - Проверить что квест завершился (success/failure) а не завис
  - `errorCollector.assertNoErrors()`
- [x] Тест `monkey: trade scene quantity buttons mashing`:
  - Открыть рынок
  - `monkey.run(80, { delayMs: 20, types: ['leftClick'], bounds: tradeAreaBounds })`
  - Проверить `player.credits >= 0` (не ушли в минус)
  - Проверить `player.cargo.totalWeight <= player.hull.cargoCapacity`
- [x] `npm run test:e2e -- --run e2e/monkey-02-planet-and-quests.spec.ts`
- [x] `npm run lint` — без ошибок

### Task 7: Регрессионный playtest — запускать в CI

**Files:**
- Modify: `playwright.config.ts`
- Create: `e2e/playtest-regression.spec.ts`

- [ ] Создать `e2e/playtest-regression.spec.ts` — единый быстрый (< 60 сек) набор:
  - smoke: новая игра запускается
  - smoke: маршрут к планете строится и НЕ исчезает (regression Task 1 Sprint 3)
  - smoke: квест `reactor` стартует без ошибок
  - monkey: 50 кликов в SpaceFlightScene без crash
- [ ] В `playwright.config.ts` добавить project `regression` с `testMatch: '**/playtest-regression.spec.ts'`
- [ ] Добавить `npm run test:e2e:regression` в `package.json` scripts:
  `playwright test --project=regression`
- [ ] `npm run test:e2e:regression` — проходит < 60 сек
- [ ] `npm run lint` — без ошибок

### Task 8: Верификация

**Files:**
- None

- [ ] `npm test -- --run` — все unit-тесты зелёные
- [ ] `npm run test:e2e -- --run smoke/` — 5 smoke-тестов проходят
- [ ] `npm run test:e2e -- --run playtest-01` — full-loop проходит
- [ ] `npm run test:e2e -- --run monkey-01` — monkey SpaceFlight проходит
- [ ] `npm run test:e2e:regression` — < 60 сек, всё зелёное
- [ ] `npm run lint` — 0 ошибок
- [ ] `npm run build` — нет TypeScript ошибок

## Technical Details

**Seeded RNG** (без зависимостей):
```typescript
class SeededRandom {
  constructor(private seed: number) {}
  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }
}
```

**Monkey bounds**: canvas размер берётся из `page.evaluate(() => ({ w: app.screen.width, h: app.screen.height }))`.

**Распределение действий monkey** (configurable):
```typescript
const MONKEY_WEIGHTS = { leftClick: 60, rightClick: 20, scroll: 15, key: 5 };
```

**Timeout для playtest-тестов**: `timeout: 120_000` (2 мин) — длиннее дефолтного.

**Изоляция**: каждый тест делает `await page.reload()` + `startNewGame()` чтобы
не зависеть от состояния предыдущего.

## Post-Completion

- Добавить в GitHub Actions / CI pipeline: `npm run test:e2e:regression` на каждый PR
- Расширить monkey до 1000 кликов для ночных прогонов
- Сохранять `monkey-report.json` с воспроизводимым seed при падении
- Визуальная запись провальных тестов через Playwright video (уже поддерживается конфигом)
