---
# Master Plan: Vacuum Rogues — Phase 2

## Overview

Phase 2 of the game after rebranding to «Вакуумные Пройдохи». Covers five sprints:

- **Sprint 1** — навигация: ребрендинг, реструктуризация требований, US-071 (free pan), US-072 (camera return), zoom-to-cursor
- **Sprint 2** — визуал: US-073 (moon z-depth), новые unit-тесты, E2E smoke refactor
- **Sprint 3** — бой: финализация CombatScene (EPIC-002)
- **Sprint 4** — квесты и player loop: quest director, win condition (US-074)
- **Sprint 5** — полировка UX: индикаторы, тултипы, звуки, mini-log, obfuscation

## Context

### Ключевые файлы

- `src/presentation/SpaceFlightScene.ts` — pan/zoom, маршрут, ввод (US-071, A3–A6)
- `src/presentation/SystemMiniMap.ts` — миникарта, кнопка «вернуть камеру» (US-072)
- `src/presentation/PlanetSprite.ts` — рендер лун, z-порядок (US-073)
- `src/config/balance.ts` — `GameConfig.GAME_TITLE`, `SYSTEM_GEOMETRY.*`
- `src/types/index.ts` + `src/validation/schemas.ts` — типы, Zod-схемы
- `src/systems/CombatSystem.ts` — боевая система (Sprint 3)
- `src/systems/QuestDirector.ts` — квест-директор (Sprint 4)
- `e2e/` — Playwright E2E тесты (smoke refactor Sprint 2)
- `src/tests/` — unit-тесты (panZoom, moonZOrder, combat, tradeSystem)
- `docs/requirements/epics/` — EPIC-010/011 (уже созданы); `archived/` (уже перенесены)
- `docs/requirements/user-stories/` — US-071–075 (уже созданы)

### Состояние на старт плана

- EPIC-001–009 перенесены в `archived/` ✓
- EPIC-010, EPIC-011 созданы ✓
- US-071–075 созданы ✓
- Переименование в index.html / package.json — **не выполнено**
- SpaceFlightScene: pan/zoom частично; `isPanning` guard при `isTurnRunning` — **не выполнено**
- SystemMiniMap: кнопка «⊙» — **не выполнено**
- PlanetSprite: z-порядок лун — **не выполнено**

## Development Approach

- **TDD**: новые тесты пишутся первыми; код реализуется чтобы тесты прошли.
- Каждая задача завершается **до** перехода к следующей.
- Каждая задача включает `npm test -- --run` + `npm run lint` в финальном шаге.
- **Не растить SpaceFlightScene**: любая логика > 30 строк выносится в helper/system.
- Геометрические константы только в `src/config/balance.ts`.
- `stopPropagation()` во всех UI-обработчиках поверх gameLayer.

---

## Background: Стратегический контекст

### Переименование → «Вакуумные Пройдохи»

| Что менять | Где |
|-----------|-----|
| Заголовок `<title>` | `index.html` |
| `GameConfig.GAME_TITLE` / стартовый экран | `src/config/balance.ts`, `MainMenuScene` |
| Package name | `package.json` → `"name": "vacuum-rogues"` |
| README.md | корень репо |
| Имя SW-кеша | `src/workers/serviceWorker.ts` → `vacuum-rogues-vdev` |
| `docs/requirements/README.md` заголовок | один раз |

Репозиторий переименовывает **владелец** через GitHub Settings → Repository name
(`vacuum-rogues`). Все локальные remote-ссылки: `git remote set-url origin <new-url>`.

---

### Acceptance Criteria: US-071 — Свободное панорамирование во время хода

```gherkin
Scenario: Панорамирование во время движения
  Given корабль летит к цели (ход запущен)
  When я зажимаю ПКМ и тащу мышь
  Then карта панорамируется без прерывания маршрута
  And флаг isPanning активен → onPointerDown не интерпретирует клик как новый маршрут

Scenario: Панорамирование не ставит маршрут
  Given isPanning = true при отпускании кнопки
  When pointer отпускается
  Then маршрут НЕ ставится (dragDistance > DRAG_THRESHOLD → swallow click)
```

---

### Acceptance Criteria: US-072 — Кнопка «Вернуть камеру к кораблю»

```gherkin
Scenario: Кнопка возврата камеры
  Given камера панорамирована (корабль не в центре экрана)
  When я нажимаю кнопку «⊙» на миникарте
  Then cameraPanX/cameraPanY плавно анимируются к позиции корабля
  And кнопка исчезает / становится неактивной когда корабль уже в центре

Scenario: Кнопка не перекрывает радар
  Then кнопка 28×28 px расположена в углу миникарты (вне области карты)
  And не блокирует drag-to-pan на самой миникарте
```

---

### Acceptance Criteria: US-073 — Луны за планетой (z-depth)

```gherkin
Scenario: Луна за планетой
  Given планета с лунами отображается в SpaceFlightScene
  When луна в «дальней» части орбиты (0°–180°, т.е. «за» планетой)
  Then z-index луны < z-index планеты (луна перекрыта)
  When луна в «ближней» части орбиты (180°–360°, т.е. «перед» планетой)
  Then z-index луны > z-index планеты (луна поверх)

Scenario: Плавный переход z-порядка
  Then смена z-порядка происходит в момент пересечения горизонтальной оси планеты
  And нет резкого «скачка» видимости
```

---

### Acceptance Criteria: US-074 — End-to-end player loop

```gherkin
Scenario: Торговый цикл работает
  Given player.credits = 1000
  When buy('fuel', 10, marketPrice=8)
  Then player.credits = 920
  And player.ship.cargo includes {item: 'fuel', qty: 10}

Scenario: Квест принят и завершён
  Given quest DELIVERY accepted at planet A
  When player lands on planet B (destination)
  Then quest status = COMPLETED
  And player.credits += quest.reward
  And player.reputation[quest.factionId] += quest.repDelta

Scenario: Бой с пиратом — победа
  Given player.ship.hull.hp = 100, pirate.hull.hp = 60
  When combat runs until pirate.hull.hp <= 0
  Then player receives loot
  And pirate sprite removed from scene
  And player.rank.points += KILL_REWARD

Scenario: Win condition достигнута
  Given player.rank = VETERAN
  And player.reputation.OUTLANDERS > 50
  And player.reputation.PROGRESSORS > 50
  And player.reputation.BASTIONS > 50
  When game.checkWinCondition()
  Then returns true
  And transitionTo(WIN_SCREEN)
```

---

### Acceptance Criteria: US-075 — Визуальные ассеты

```gherkin
Scenario: Туманности не выглядят как прямоугольные патчи
  Given SpaceFlightScene открыта
  Then параллакс-фон показывает ≥3 слоя туманности с разными цветами и прозрачностью
  And нет прямоугольных артефактов при zoom
  And туманность не перекрывает звёзды (alpha blending)

Scenario: Каждое солнце уникально
  Then цвет/размер солнца детерминирован от system.seed
  And есть минимум 5 визуальных типов (жёлтый, красный гигант, голубой, белый карлик, пульсар)

Scenario: Планеты различимы
  Then планеты разных типов имеют разные спрайты/процедурные текстуры
  And у планет с атмосферой есть glow/halo
```

---

### Правила играбельности (Mouse-First)

**Обязательные (Категория A):**

- **A1.** Все основные действия доступны одной мышью. Клавиатура — только акселераторы.
- **A2.** Клик = действие. Ни один клик не теряется молча. Отклик ≤ 200 мс.
- **A3.** ПКМ = панорамирование, всегда (пауза / ход / открытая панель).
- **A4.** Колесо мыши = только зум. Горизонтальный скролл — игнорировать.
- **A5.** Зум сохраняет мировую точку под курсором.
- **A6.** Маршрут = один ЛКМ. Второй клик на той же точке — отменяет.
- **A7.** Посадка = клик на планету (hitArea увеличен).
- **A8.** Кнопка «⊙» на миникарте возвращает камеру к кораблю.

**Желательные (Категория B):**

- **B1.** Tooltip на hover (планета / корабль / оборудование).
- **B2.** Предпросмотр маршрута пунктирной линией при наведении.
- **B3.** Двойной клик на пустое место → zoom to fit.
- **B4.** Escape = закрыть верхнюю панель / отменить маршрут.
- **B5.** Mini-log: последние 5 событий в углу экрана.

---

### Стратегия E2E тестов — три уровня

**Уровень 1 — Unit/Integration (Vitest, < 5 сек):** чистая логика без DOM/Canvas/ONNX.

Новые файлы: `panZoom.test.ts`, `combat.test.ts`, `tradeSystem.test.ts`, `moonZOrder.test.ts`, `cameraReturn.test.ts`.

**Уровень 2 — Scene Integration (Vitest + jsdom, < 30 сек):** mock-renderer, `window.__gameEngine`.

**Уровень 3 — E2E Smoke (Playwright, только CI):** максимум 5 тестов в `e2e/smoke/`:
`01-new-game.spec.ts`, `02-planet-trade.spec.ts`, `03-star-map.spec.ts`, `04-flight.spec.ts`, `05-npc-contact.spec.ts`.

Правила E2E: нет `waitForTimeout`, нет `canvas.click({position})`, mock AudioContext + ONNX через `addInitScript`.

---

### Стратегия безопасности кода (Sprint 5)

**Фаза 1:** Obfuscation (`rollup-plugin-obfuscator`) + Domain Lock (`GameConfig.ALLOWED_ORIGINS`).

**Фаза 2 (релиз):** License Key + Cloudflare Worker.

**Фаза 3 (при коммерческом интересе):** WASM Core (Rust → критическая логика).

---

### Схема фракций

| Наш ID | Наше имя | Тех-уровень | Характер |
|--------|---------|------------|---------|
| `BASTIONS` | Бастионы | Низкий | Грубые, поклоняются мощи |
| `SYNDICATE` | Синдикат | Средний | Хитрые, торговцы |
| `OUTLANDERS` | Окраинники | Средний | Колонисты, универсалы |
| `PROGRESSORS` | Прогрессоры | Высокий | Технологи |
| `PARADOXES` | Парадоксы | Максимальный | Загадочные, уникальные модули |
| `OVERMIND` | Овермайнд | — | Угроза, не Coalition |

---

### Code Review чеклист (для каждого PR)

- [ ] Нет прямого `console.log` (только `logger`)
- [ ] Нет `eventMode='none'` на контейнере с интерактивными детьми
- [ ] `stopPropagation()` в каждом UI-обработчике над gameLayer
- [ ] `eventMode='none'` на каждом `Text` над кликабельным элементом
- [ ] `destroy()` чистит все DisplayObjects и listeners
- [ ] Изменение `src/types` → обновлён `src/validation/schemas.ts`
- [ ] Новая сцена → добавлена в `contextDependentScenes` если нужно
- [ ] Нет хардкодных пиксельных координат для hit detection

### UX Review чеклист

- [ ] Каждая кнопка даёт видимый feedback (toast / переход / маршрут)
- [ ] Каждое модальное окно закрывается по ✕ и кликом за пределами
- [ ] Нет действий, требующих клавиатуру как **единственный** способ
- [ ] Миникарта всегда интерактивна (drag → pan)
- [ ] Кнопка «вернуть камеру» доступна когда камера не на корабле
- [ ] При HP < 30% — явное предупреждение, автостоп
- [ ] Загрузка / переходы сопровождаются индикатором

---

## Implementation Steps

### Task 1: Rebrand + UI localisation (US-078 + rename)

> Covers: rename to «Вакуумные Пройдохи» + UX C5 (no English strings in Russian UI)

**Files:**
- Modify: `index.html`
- Modify: `src/config/balance.ts`
- Modify: `src/presentation/MainMenuScene.ts`
- Modify: `src/presentation/StarMapScene.ts`
- Modify: `src/presentation/CombatScene.ts`
- Modify: `src/presentation/QuestJournalUI.ts`
- Modify: `src/main.ts`
- Modify: `src/domain/NPC.ts`
- Modify: `package.json`
- Modify: `src/workers/serviceWorker.ts`
- Modify: `docs/requirements/README.md`
- Modify: `README.md`

- [x] Update `<title>` in `index.html` to «Вакуумные Пройдохи»
- [x] Update `GameConfig.GAME_TITLE` in `src/config/balance.ts`
- [x] Replace `"GALACTIC HORIZON\nНЕЙРОСЕТЕВОЕ ВТОРЖЕНИЕ"` in `MainMenuScene.ts` with `"ВАКУУМНЫЕ ПРОЙДОХИ"` (single Russian line)
- [x] Replace `"SECTOR MAP"` in `StarMapScene.ts` → `"КАРТА ГАЛАКТИКИ"`
- [x] Replace `"TACTICAL COMBAT"` in `CombatScene.ts` → `"ТАКТИЧЕСКИЙ БОЙ"`
- [x] Fix quest type labels in `QuestJournalUI.ts`: import and use `TYPE_LABEL` from `JobBoardPanel.ts`
- [x] Update `'Galactic Horizon'` notification title in `src/main.ts` → `'Вакуумные Пройдохи'`
- [x] Update `logger.info('Galactic Horizon...')` string in `src/main.ts`
- [x] Update old-brand comment in `src/domain/NPC.ts`
- [x] Update `"name": "vacuum-rogues"` in `package.json`
- [x] Update SW cache name in `serviceWorker.ts` → `vacuum-rogues-vdev`
- [x] Update `docs/requirements/README.md` and `README.md` headings
- [x] Run `npm run build` — no errors
- [x] Run `npm test -- --run` — all tests green
- [x] Run `npm run lint` — no errors

### Task 2: UX Critical — Navigation dead-ends (US-079, US-081, US-083, US-084)

> Covers: UX C4 (RaceSelection no back), H9 (StarMap no back), H11 (DialogueScene null tree),
> H1 (MainMenu Continue+message bugs), C2 (Station null context), H12 (micromodule raw ID), H4 (planet faction)

**Files:**
- Modify: `src/presentation/RaceSelectionScene.ts`
- Modify: `src/presentation/StarMapScene.ts`
- Modify: `src/presentation/DialogueScene.ts`
- Modify: `src/presentation/InfoCenterScene.ts`
- Modify: `src/presentation/MainMenuScene.ts`
- Modify: `src/presentation/StationScene.ts`
- Modify: `src/presentation/PlanetInfoPanel.ts`
- Modify: `src/systems/GameEngine.ts`

- [x] **RaceSelectionScene**: add "[ Назад ]" button + Esc handler → `transitionTo(MAIN_MENU)`
- [x] **StarMapScene**: add "[ Назад ]" button in `fixedUIContainer` → `transitionTo(SPACE_FLIGHT)`
- [x] **DialogueScene**: add fallback for null dialogue tree — show 1-node "Нет слов для разговора." with "Завершить" button
- [x] **InfoCenterScene.goBack()**: add fallback `transitionTo(SPACE_FLIGHT)` when both `station` and `planet` are null
- [x] **MainMenuScene**: check save existence on init → dim/disable "Продолжить" when no save; fix `showMessage()` to remove previous message before adding new; add 5s auto-remove timer
- [x] **StationScene.renderMain()**: add null-context guard — if `this.station` is null, show error + "[ Назад ]" button → `transitionTo(SPACE_FLIGHT)`
- [x] **GameEngine**: add `StationScene` to `contextDependentScenes` so "Continue" never navigates there without context
- [x] **StationScene**: look up micromodule name from `MICRO_MODULES` catalogue before rendering; show human-readable name not raw ID
- [x] **PlanetInfoPanel**: look up actual `planet.factionId` from its `StarSystem`; map to Russian name via `FACTION_LABEL` constant
- [x] Add `FACTION_LABEL: Record<FactionType, string>` constant (reuse or create in `src/config/balance.ts` or `src/types/`)
- [x] Run `npm test -- --run` + `npm run lint` — no regressions

### Task 3: UX Critical — Star map zoom-to-fit on open (US-077)

> Covers: UX C1 — map renders as tiny cluster on initial open

**Files:**
- Modify: `src/presentation/StarMapScene.ts`

- [x] In `initialize()`: compute bounding box of all `player.visitedSystemIds` map coordinates
- [x] Set `zoomLevel` and `viewportX/Y` so all explored systems occupy ~70% of canvas width
- [x] Clamp: minimum `zoomLevel = 0.5`, maximum `zoomLevel = 4`
- [x] Player's current system should be near-centred in the initial view
- [x] Run `npm test -- --run` + `npm run lint` — no regressions

### Task 4: UX High — Loading state during async transitions (US-076)

> Covers: UX H2 — no loading feedback during `loadGame` or warp

**Files:**
- Modify: `src/systems/GameEngine.ts`
- Modify: `src/presentation/MainMenuScene.ts`
- Modify: `src/presentation/StarMapScene.ts`

- [x] Add `GameEngine.showLoadingOverlay(label: string)` / `hideLoadingOverlay()`: full-screen semi-transparent black + centred label Text (18px, cyan) on a top `uiLayer`
- [x] `MainMenuScene.handleContinue()`: disable buttons → show overlay → `await loadGame()` → hide overlay
- [x] `StarMapScene.performWarpJump()`: disable warp button → show overlay → `await transitionTo()` → (overlay destroyed with scene)
- [x] Run `npm test -- --run` + `npm run lint` — no regressions

### Task 5: US-071 — Свободное панорамирование во время хода

**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`
- Create: `src/tests/panZoom.test.ts`

- [x] Написать тест `panZoom.test.ts`: pan во время `isTurnRunning=true` — маршрут не ставится; drag > DRAG_THRESHOLD → swallow click
- [x] В `SpaceFlightScene.onPointerDown`: если `event.button === 2` (ПКМ) — всегда запускать pan, независимо от `isTurnRunning`
- [x] В `SpaceFlightScene.onPointerUp`: если `dragDistance > DRAG_THRESHOLD` — не вызывать `setRoute()`
- [x] Убедиться что `isPanning=false` сбрасывается при `pointerup` и `pointerleave`
- [x] Запустить `npm test -- --run src/tests/panZoom.test.ts` — тесты зелёные
- [x] Запустить `npm test -- --run` + `npm run lint` — без регрессий

### Task 6: US-072 — Кнопка «вернуть камеру» на миникарте

**Files:**
- Modify: `src/presentation/SystemMiniMap.ts`
- Modify: `src/presentation/SpaceFlightScene.ts`
- Create: `src/tests/cameraReturn.test.ts`

- [x] Написать тест `cameraReturn.test.ts`: при `cameraPanX/Y ≠ shipX/Y` кнопка видима; `centerOnPlayer()` устанавливает правильные координаты
- [x] В `SystemMiniMap.ts` добавить кнопку «⊙» (`Graphics`, 28×28 px) в правый нижний угол вне области карты
- [x] Кнопка эмитирует событие `'center-on-player'` через callback (`setReturnCameraHandler`)
- [x] `Text` кнопки — `eventMode='none'`; кнопка `Graphics` — `eventMode='static'` + `stopPropagation()`
- [x] В `SpaceFlightScene.ts` подписаться на `'center-on-player'` → запустить lerp-анимацию к позиции корабля
- [x] Кнопка скрыта (`visible=false`) когда корабль уже в центре экрана (threshold 10 px)
- [x] Запустить `npm test -- --run src/tests/cameraReturn.test.ts` — тесты зелёные
- [x] Запустить `npm test -- --run` + `npm run lint` — без регрессий

### Task 7: Zoom-to-cursor (A5)

**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`

- [x] В обработчике `wheel`: вычислить мировую точку под курсором до zoom и после
- [x] Скорректировать `cameraPanX/cameraPanY` так чтобы мировая точка осталась под курсором
- [x] Формула: `panX = cursorX - (cursorX - panX) * (newZoom / oldZoom)`; аналогично для Y
- [x] Проверить граничные случаи: `MIN_ZOOM`, `MAX_ZOOM`
- [x] Запустить `npm test -- --run` + `npm run lint` — без регрессий

### Task 8: US-073 — Луны за планетой (z-depth)

**Files:**
- Modify: `src/presentation/PlanetSprite.ts`
- Create: `src/tests/moonZOrder.test.ts`

- [x] Написать тест `moonZOrder.test.ts`: угол 0–π → луна за планетой; угол π–2π → луна перед планетой
- [x] В `PlanetSprite.update()`: при каждом тике для каждой луны проверять `moonAngle % (2*PI)`
  - `angle < Math.PI` → `backMoonsLayer.addChild(moonSprite)` (под планетой)
  - `angle >= Math.PI` → `frontMoonsLayer.addChild(moonSprite)` (над планетой)
- [x] Альтернатива: два слоя в `gameLayer` — `backMoonsLayer` (indx < planets) / `frontMoonsLayer` (indx > planets)
- [x] Избегать `addChildAt` каждый тик если угол не пересёк ось (flag `wasBehind`)
- [x] Запустить `npm test -- --run src/tests/moonZOrder.test.ts` — тесты зелёные
- [x] Запустить `npm test -- --run` + `npm run lint` — без регрессий

### Task 9: Новые unit-тесты (combat, tradeSystem)

**Files:**
- Create: `src/tests/combat.test.ts`
- Create: `src/tests/tradeSystem.test.ts`

- [ ] Написать `combat.test.ts`:
  - shield damage: урон сначала в щит, остаток в корпус
  - hull damage at 0 shield: весь урон идёт в корпус
  - auto-break at ≤ 30% HP: бой завершается, событие `'combat-retreat'`
  - loot drop: при hp=0 противника → `player.cargo` получает loot
- [ ] Написать `tradeSystem.test.ts`:
  - buy/sell spread: `sellPrice < buyPrice` для каждого товара
  - contraband penalty: `reputationDelta < 0` при продаже контрабанды без лицензии
  - supply/demand shift: после 10 покупок `buyPrice` растёт
- [ ] Запустить `npm test -- --run src/tests/combat.test.ts` — зелёные
- [ ] Запустить `npm test -- --run src/tests/tradeSystem.test.ts` — зелёные
- [ ] Запустить `npm test -- --run` + `npm run lint` — без регрессий

### Task 10: E2E smoke tests refactor (5 сценариев)

**Files:**
- Create: `e2e/smoke/01-new-game.spec.ts`
- Create: `e2e/smoke/02-planet-trade.spec.ts`
- Create: `e2e/smoke/03-star-map.spec.ts`
- Create: `e2e/smoke/04-flight.spec.ts`
- Create: `e2e/smoke/05-npc-contact.spec.ts`
- Create: `e2e/fixtures/mockHeavySystems.ts`

- [ ] Создать `e2e/fixtures/mockHeavySystems.ts` с `window.__mockONNX`, `window.__skipAudio`, `window.__fastAnimations`
- [ ] `01-new-game.spec.ts`: launch → main menu (`waitForFunction`) → `startNewGame()` → await SpaceFlightScene
- [ ] `02-planet-trade.spec.ts`: `e2eLandOnPlanet()` → buy fuel → `player.credits` decreased
- [ ] `03-star-map.spec.ts`: `transitionTo('STAR_MAP')` → `e2eSelectSystem(1)` → zoom-to-fit visible
- [ ] `04-flight.spec.ts`: `e2eSetRoute({x, y})` → `waitForFunction` while ship moves
- [ ] `05-npc-contact.spec.ts`: `e2eSpawnNpc()` → `waitForFunction` no console errors
- [ ] No `waitForTimeout`, no `canvas.click({position})` in any test
- [ ] `screenshot: 'only-on-failure'` in `playwright.config.ts`
- [ ] Run `npm run test:e2e -- --run smoke/` — all 5 pass
- [ ] Run `npm run lint` — no errors

### Task 11: Sprint 3 — CombatScene rendering + logic (US-080 + EPIC-002)

> Covers: UX C3 (no ships/HP bars), H6 (hardcoded button positions)

**Files:**
- Modify: `src/systems/CombatSystem.ts`
- Modify: `src/presentation/CombatScene.ts`

- [ ] Render player ship token and enemy token(s) on the hex grid at start positions
- [ ] HP bars visible for both sides; colour: green > 60%, yellow 30-60%, red < 30%
- [ ] Scrollable combat log text area (last 5 events)
- [ ] Shield hit → blue flash; hull hit → red flash
- [ ] Auto-attack loop: each round attacker and defender exchange shots
- [ ] Loot on enemy death → `player.cargo`, toast "Трофеи получены"
- [ ] Reputation: `player.adjustReputation(enemy.factionId, KILL_REP_DELTA)`
- [ ] Auto-retreat trigger: `player.hull.hp ≤ maxHp * 0.3` → `emit('combat-retreat')`
- [ ] Action buttons positioned relative to `app.screen.height / app.screen.width` (not hardcoded px)
- [ ] Run `npm test -- --run` + `npm run lint` — no regressions

### Task 12: Sprint 4 — Trade quantity selector (US-082) + Quest director (US-074)

**Files:**
- Modify: `src/presentation/TradeScene.ts`
- Modify: `src/systems/TradeSystem.ts`
- Modify: `src/systems/QuestDirector.ts`
- Modify: `src/systems/GameEngine.ts`
- Modify: `src/presentation/PlanetScene.ts`

- [ ] **US-082**: quantity controls [-] [qty] [+] in TradeScene; qty capped at min(stock, hold, affordable)
- [ ] **US-082**: sell button disabled when player owns 0 units
- [ ] **US-082**: trade toast auto-removes after 3 seconds
- [ ] **US-074**: `QuestDirector.tick(day)` — check deadlines, emit `'quest-expired'`
- [ ] **US-074**: PlanetScene quest board button → list active quests with countdown
- [ ] **US-074**: On landing at target planet → auto-check `quest.targetId === planet.id` → `completeQuest()`
- [ ] **US-074**: `GameEngine.checkWinCondition()` — rank VETERAN + reputation ≥ 3 factions > 50 → `transitionTo(WIN_SCREEN)`
- [ ] WIN_SCREEN scene: final stats + "В главное меню" button
- [ ] Run `npm test -- --run` + `npm run lint` — no regressions

### Task 13: Sprint 5 — UX polish (tooltips, mini-log, escape, UI sounds)

> Covers: B1 (tooltip), B4 (Escape), B5 (mini-log), US-079 audio sounds

**Files:**
- Modify: `src/presentation/SpaceFlightScene.ts`
- Modify: `src/systems/AudioManager.ts`

- [ ] **Tooltip (B1)**: on hover over planet/ship/equipment — `Text` 300ms delay, `eventMode='none'`, auto-remove on pointerout
- [ ] **Escape (B4)**: in `SpaceFlightScene` — first closes top open panel, then cancels route
- [ ] **Mini-log (B5)**: last 5 events in bottom-left corner; `Text`, `eventMode='none'`; fade-out after 5s
- [ ] **UI sounds**: `AudioManager.playUiClick()`, `playUiHover()`, `playToast()` wired to respective events
- [ ] Run `npm test -- --run` + `npm run lint` — no regressions

### Task 14: Sprint 5 — Obfuscation + domain lock

**Files:**
- Modify: `vite.config.ts`
- Modify: `package.json`
- Modify: `src/config/balance.ts`

- [ ] Add `rollup-plugin-obfuscator` to devDependencies
- [ ] Configure in `vite.config.ts` for `mode === 'production'` only: `compact, controlFlowFlattening, stringArray, stringArrayEncoding: ['base64'], identifierNamesGenerator: 'hexadecimal', selfDefending: true`
- [ ] `sourcemap: false` in production Vite config
- [ ] Domain lock: `GameConfig.ALLOWED_ORIGINS = ['vacuum-rogues.com', 'localhost']`; check `location.origin` on start
- [ ] Run `npm run build` (production) — success, no source maps
- [ ] Run `npm test -- --run` + `npm run lint` — no regressions

### Task 15: Verify acceptance criteria

- [ ] Run `npm test -- --run` — all unit tests green (incl. `panZoom`, `cameraReturn`, `moonZOrder`, `combat`, `tradeSystem`)
- [ ] Run `npm run test:e2e -- --run smoke/` — all 5 smoke tests pass
- [ ] Run `npm run lint` — no errors
- [ ] Run `npm run build` — no TypeScript errors
- [ ] Browser check: title «Вакуумные Пройдохи», no English strings visible, RMB-pan works during turn, «⊙» button returns camera
- [ ] Browser check: moons go behind planets during orbit
- [ ] Browser check: star map opens with all systems visible (zoom-to-fit)
- [ ] Browser check: RaceSelection has "Назад" button; StarMap has "[ Назад ]" button
- [ ] Browser check: CombatScene shows ships + HP bars + log
- [ ] Browser check: TradeScene has quantity controls
- [ ] Browser check: win condition triggers win screen
- [ ] Update plan status → **Completed**

---

## Приоритизированный backlog

| Priority | Task | US/Rule | Sprint | UX Source |
|----------|------|---------|--------|-----------|
| P1 | Rebrand + localisation | Task 1 | Now | C5 |
| P2 | Navigation dead-ends + station + planet | Task 2 | Now | C2, C4, H1, H4, H9, H11, H12 |
| P3 | StarMap zoom-to-fit | Task 3 | Now | C1 |
| P4 | Loading overlay | Task 4 | Sprint 1 | H2 |
| P5 | US-071: Free pan during turn | Task 5 | Sprint 1 | A3 |
| P6 | US-072: Camera return button | Task 6 | Sprint 1 | A8 |
| P7 | Zoom-to-cursor | Task 7 | Sprint 1 | A5 |
| P8 | US-073: Moon z-depth | Task 8 | Sprint 2 | — |
| P9 | Unit tests (combat, trade) | Task 9 | Sprint 2 | — |
| P10 | E2E smoke tests | Task 10 | Sprint 2 | — |
| P11 | CombatScene rendering (US-080) | Task 11 | Sprint 3 | C3, H6 |
| P12 | Trade qty (US-082) + Quest director (US-074) | Task 12 | Sprint 4 | H8 |
| P13 | UX polish (tooltip, mini-log, escape) | Task 13 | Sprint 5 | B1, B4, B5 |
| P14 | Obfuscation + domain lock | Task 14 | Sprint 5 | — |
| P15 | Verify all acceptance criteria | Task 15 | Sprint 5 | — |
