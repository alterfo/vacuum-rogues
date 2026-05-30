# Developer Guide — Космические рейнджеры: Нейросетевое вторжение

> См. также: [Coding Rules](CODING_RULES.md) — правила кодирования и anti-patterns.  
> См. также: [AI Prompt Guide](AI_PROMPT_GUIDE.md) — шаблоны промптов для AI-ассистентов и чеклисты.

## 1. Архитектура в двух словах

Проект разделён на 5 слоёв. **Никогда** не лезь из верхнего слоя в нижний напрямую — только через публичный API.

| Слой | Папка | Отвечает за |
|------|-------|-------------|
| **Presentation** | `src/presentation/` | PixiJS: сцены, спрайты, рендер, ввод игрока |
| **Systems** | `src/systems/` | Игровые системы: бой, торговля, диалоги, генерация галактики |
| **Domain** | `src/domain/` | Чистые сущности: `Player`, `Galaxy`, `StarSystem`, `Inventory` — без зависимостей от PixiJS/ONNX/DOM |
| **AI / Infrastructure** | `src/ai/`, `src/data/` | ONNX-инференс, Web Workers, IndexedDB, сохранения |
| **Types / Config** | `src/types/`, `src/config/` | Единые типы, enum, константы баланса |

---

## 2. Где искать то, что нужно

### «Мне нужно найти логику кнопки „Новая игра"»

1. **Визуал кнопки** → `src/presentation/MainMenuScene.ts` (`renderMainMenu()`)
2. **Обработчик клика** → тот же файл, метод `handleNewGame()`
3. **Переход на звёздную карту** → `src/systems/GameEngine.ts`, метод `transitionTo(SceneType.STAR_MAP)`
4. **Создание игрока при новой игре** → тот же `transitionTo()`, ветка `if (sceneType === SceneType.STAR_MAP && !this.player)`
5. **E2E-тест, который жмёт эту кнопку** → `e2e/page-objects/main-menu.page.ts`, метод `clickNewGame()`

### «Мне нужны спрайты / текстуры / ассеты звёздных систем»

- **Векторная графика / примитивы** → `src/presentation/StarMapScene.ts` (сейчас системы — это `Graphics.circle()`, не спрайты).
- **Если завезёте PNG/Spritesheet** → складывайте в `public/assets/` (Vite раздаёт статику из `public/` на корневом пути).
- **Загрузка текстур в PixiJS** → `src/presentation/Renderer.ts` или отдельный `AssetLoader` (когда появится).
- **Иконки PWA** → `public/icon-192.png`, `public/icon-512.png`, `src/manifest.json`.

### «Мне нужно изменить баланс цен / характеристики корабля»

- `src/config/GameConfig.ts` — константы: `PRICE_MODIFIER_MIN`, `REPUTATION_MAX`, и т.д.
- `src/domain/PlayerShip.ts` — базовые характеристики корабля.
- `src/systems/TradeSystem.ts` — формула ценообразования.

### «Мне нужно добавить новую сцену»

1. Создать класс в `src/presentation/MyScene.ts`, унаследовать от `GameScene`.
2. Добавить `SceneType.MY_SCENE` в `src/types/index.ts`.
3. Зарегистрировать в `GameEngine.transitionTo()` (switch-case).
4. Добавить Page Object в `e2e/page-objects/my-scene.page.ts` (если пишешь E2E).

---

## 3. Золотые правила обработки ввода (PixiJS)

> **Запрещено** кликать по canvas через хардкод-координаты или «магические пиксели». Это ломается при любом resize, масштабе, переводе или добавлении UI.

### ✅ Правильно — семантические интерактивные объекты

```typescript
// MainMenuScene.ts — ПРАВИЛЬНО
const newGameText = new Text({ text: 'Новая игра', ... });
newGameText.eventMode = 'static';
newGameText.cursor = 'pointer';
newGameText.on('pointerdown', () => this.handleNewGame());
```

### ❌ Неправильно — координатная магия

```typescript
// НИКОГДА ТАК НЕ ДЕЛАЙ В ПРОДАКШЕНЕ
await canvas.click({ position: { x: box.width / 2 - 50, y: box.height / 2 + 150 } });
```

### Почему это важно

| Риск | Что случится |
|------|--------------|
| Resize окна | Кнопка уедёт, клик промахнётся |
| Смена языка | Текст станет длиннее, центрирование съедет |
| Добавление новой кнопки сверху | Все сдвинутся, клики промахиваются |
| Разные DPI / мобильные | Координаты в физических пикселях не совпадут с логическими |

### Если нужно кликнуть в произвольную точку мира (например, по гексу)

Используй **хитбоксы** (`Graphics` с `eventMode = 'static'`), привязанные к мировым координатам, а не к пикселям экрана:

```typescript
const hitArea = new Graphics();
hitArea.fill({ color: 0xffffff, alpha: 0 });
hitArea.circle(worldX, worldY, 10);
hitArea.eventMode = 'static';
hitArea.on('pointerdown', () => this.handleSystemClick(system));
```

---

## 4. Правила E2E-тестирования (Playwright)

### Принцип: тест должен знать **что** кликать, а не **где**

Текущие тесты используют `canvas.click({ position: { x: ..., y: ... } })` — это технический долг. При рефакторинге UI они будут падать.

### Стратегии в порядке предпочтения

| Приоритет | Способ | Когда использовать |
|-----------|--------|-------------------|
| 1 | **PixiJS Accessibility / data-testid** | Добавь `accessible = true`, `accessibleTitle = 'new-game-btn'`, ищи через `page.getByRole('button', { name: 'Новая игра' })` |
| 2 | **Page.evaluate + поиск в stage** | `page.evaluate(() => window.__gameEngine.currentScene.buttons.find(b => b.name === 'newGame'))` |
| 3 | **Screenshot + pixelmatch** | Только для визуальной регрессии |
| 4 | **Координаты** | ❌ Запрещено без письменного обоснования в комментарии |

### Пример правильного Page Object

```typescript
// e2e/page-objects/main-menu.page.ts — ЦЕЛЕВОЙ ВАРИАНТ
async clickNewGame() {
  // Через evaluate обращаемся к PixiJS stage
  await this.page.evaluate(() => {
    const engine = (window as any).__gameEngine;
    const scene = engine.currentScene as MainMenuScene;
    scene.handleNewGame();
  });
}
```

Для этого в `main.ts` нужно экспонировать движок глобально (только в dev/test):

```typescript
if (__DEBUG__) {
  (window as any).__gameEngine = engine;
}
```

---

## 5. Жизненный цикл сцены

```
GameEngine.transitionTo(SceneType.X)
  ├─ currentScene.destroy()     // очистка gameLayer + uiLayer
  ├─ new SceneX(renderer)
  ├─ scene.initialize(context)  // построение UI, подписка на события
  └─ каждый кадр: scene.update(dt)
```

### Обязанности сцены

- `initialize()` — строит весь UI, подписывает обработчики.
- `update(dt)` — анимация, логика, не связанная с вводом.
- `destroy()` — **полная** очистка: removeChild + destroy для всех DisplayObject, clearTimeout/Interval, обнуление ссылок.

### Частая ошибка

Забыть удалить `Text` из `uiLayer` при `destroy()`. Если остатки UI «залипают» на следующей сцене — проверь `destroy()` предыдущей сцены.

---

## 6. Сохранения и миграции

- **Слоты** → `src/data/SaveManager.ts`
- **Сериализация** → `src/data/SaveStateSerializer.ts`
- **Валидация (Zod)** → `src/validation/schemas.ts`
- **Миграции между версиями** → `src/data/MigrationPipeline.ts`

При изменении доменных типов **обязательно** синхронизируй схемы в `schemas.ts`, иначе сохранения сломаются.

---

## 7. ONNX / AI

- **Реестр моделей** → `src/ai/ONNXModelRegistry.ts`
- **Воркер** → `src/ai/inference.worker.ts`
- **Адаптеры** → `src/ai/adapters/` (T5, PPO, VAE, GRU, Overmind)
- **Кэш** → `src/ai/IndexedDBCache.ts`

Модели загружаются лениво по первому запросу, кэшируются в IndexedDB. Инференс — только через Web Worker.

---

## 8. Быстрый FAQ

| Вопрос | Ответ |
|--------|-------|
| Где точка входа? | `src/main.ts` → `GameEngine.initialize()` |
| Где создаётся галактика? | `src/systems/GalaxySimulator.ts`, вызывается из `GameEngine.initialize()` |
| Где игровой цикл? | `GameEngine.gameLoop()` — `requestAnimationFrame` |
| Где обработка ошибок? | `src/exceptions/GlobalExceptionHandler.ts` |
| Где логгер? | `src/utils/logger.ts` — используй его вместо `console` |
| Как добавить расу? | `src/domain/Race.ts` + `src/types/index.ts` (`RaceType`) |
| Как настроить PWA-кэш? | `src/sw.ts` — список `CORE_ASSETS` и стратегии кэширования |
| Где unit-тесты? | `src/tests/*.test.ts` (Vitest + jsdom) |
| Где E2E-тесты? | `e2e/*.spec.ts` (Playwright) |

---

## 9. AI-ассистированная разработка

При работе с AI-ассистентами (Claude, GPT, Koda и др.) используй подход **одна story = один промпт**.

### Быстрый старт

1. Выбери шаблон промпта из [AI Prompt Guide](AI_PROMPT_GUIDE.md):
   - **Architecture / REASONS Canvas** — для проектирования подсистем
   - **User Story Implementation** — для кодирования фичи
   - **Bug Fix / Regression** — для исправления багов
   - **ONNX Model Adapter** — для интеграции моделей
   - **E2E Test Scenario** — для тестов

2. Пройди **Pre-Prompt Checklist** из AI Prompt Guide перед отправкой запроса.

3. Всегда включай в промпт:
   - Story ID и Acceptance Criteria
   - Список существующих файлов (чтобы AI не переизобретал)
   - Релевантные RULE-коды из CODING_RULES.md

### Частые ошибки

| Ошибка | Последствие | Как избежать |
|--------|-------------|--------------|
| Story слишком большая | AI теряет контекст, пропускает AC | ≤5 AC на один промпт |
| Нет списка существующих файлов | Дублирование классов, неверные имена методов | Всегда вставляй `Existing:` блок |
| Нет AC в промпте | AI делает "похоже", но неправильно | Копируй AC из requirements/*.md |
| Нет архитектурных ограничений | AI ломает слоистую архитектуру | Включай RULE-коды в Constraints |

---

## 10. Чеклист перед PR

- [ ] Нет хардкод-координат в обработке ввода (только `eventMode` + хитбоксы).
- [ ] E2E-тесты не полагаются на магические пиксели (или есть тикет на рефакторинг).
- [ ] `destroy()` сцены чистит **все** DisplayObject из `gameLayer` и `uiLayer`.
- [ ] Изменения в доменных типах отражены в `src/validation/schemas.ts`.
- [ ] Новые исключения наследуются от `GameBusinessException` / `GameSystemException` / `GameValidationException`.
- [ ] Линтер проходит: `npm run lint`.
- [ ] Unit-тесты проходят: `npm test -- --run`.
