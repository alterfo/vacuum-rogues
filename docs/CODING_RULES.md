# Правила кодирования — Космические рейнджеры: Нейросетевое вторжение

> См. также: [AI Prompt Guide](AI_PROMPT_GUIDE.md) — шаблоны промптов и чеклисты для AI-ассистированной разработки.

## 1. Ввод и интерактивность (PixiJS)

### RULE-INPUT-01: Хитбоксы вместо пикселей
**В продакшен-коде запрещено** использовать хардкод-координаты для определения кликов по UI или игровому миру.

| ❌ BAD | ✅ GOOD |
|--------|--------|
| `if (pointer.x > 300 && pointer.x < 400 && pointer.y > 200 && pointer.y < 250)` | `button.eventMode = 'static'; button.on('pointerdown', handler);` |
| `canvas.click({ position: { x: 512, y: 300 } })` | `page.evaluate(() => window.__gameEngine.currentScene.handleStarClick('sol-system'))` |
| `hitArea.circle(100, 100, 20);` без `eventMode` | `hitArea.circle(worldX, worldY, radius); hitArea.eventMode = 'static';` |

**Почему:** Pixel coords break on resize/different screens. PixiJS objects have event handlers — use them.

### RULE-INPUT-02: Каждый интерактивный элемент — семантический объект
Кнопки, иконки, гексы, звёздные системы должны быть `Container` или `Graphics` с `eventMode = 'static'`. Их позиция задаётся в **мировых координатах** или относительно родительского `Container`, а не в пикселях экрана.

### RULE-INPUT-03: Нет магических чисел в позиционировании UI
Все константы позиционирования (отступы, размеры кнопок, anchor-точки) выносятся в приватные константы класса или в `src/config/GameConfig.ts`.

---

## 2. E2E-тестирование (Playwright)

### RULE-E2E-01: Тест знает ЧТО, а не ГДЕ
**Запрещено** кликать по canvas через `position: { x, y }` без крайней необходимости.

- ❌ `canvas.click({ position: { x: box.width / 2 - 50, y: box.height / 2 + 150 } })`
- ✅ `page.evaluate(() => window.__gameEngine.currentScene.handleNewGame())`
- ✅ `page.getByTestId('new-game-btn')` (если в PixiJS включена accessibility)

### RULE-E2E-02: Page Object — единственная точка знания о селекторах
Любой селектор или способ взаимодействия со сценой живёт в `e2e/page-objects/*.page.ts`. Спеки не должны содержать `locator` напрямую.

### RULE-E2E-03: `waitForTimeout` — антипаттерн
Используй `waitForSelector`, `waitForFunction`, `waitForResponse` или состояние PixiJS через `evaluate`. `waitForTimeout(2000)` допустим только с комментарием `// FIXME: заменить на явное ожидание`.

---

## 3. Сцены и рендеринг

### RULE-SCENE-01: `destroy()` очищает всё — Memory Leaks
При уничтожении сцены обязательно:
1. `removeChild` + `destroy()` для всех `DisplayObject` в `gameLayer` и `uiLayer`.
2. `clearTimeout` / `clearInterval`.
3. Обнуление ссылок (`this.foo = null`).

| ❌ BAD | ✅ GOOD |
|--------|--------|
| `destroy() { this.container.destroy(); }` | `destroy() { this.stars.forEach(s => s.destroy()); this.container.destroy(); clearInterval(this._timer); this._timer = null; }` |

**Почему:** Partial destroy() causes memory bloat. Every DisplayObject, listener, and interval must be cleared.

### RULE-SCENE-02: Нет прямого доступа к IndexedDB / ONNX из сцены
Сцена обращается к `GameEngine` → `SaveManager` / `ONNXModelRegistry`. Прямой вызов `indexedDB` или `new ONNXModel()` из `presentation/` — запрещён.

| ❌ BAD | ✅ GOOD |
|--------|--------|
| `// in StarMapScene.ts`<br>`const db = await openDB('saves', 1);` | `// in StarMapScene.ts`<br>`await this.engine.saveManager.write('slot1', state);` |

**Почему:** Scenes are presentation. Data access belongs in GameEngine → SaveManager → IndexedDBAdapter.

### RULE-SCENE-03: Resize-логика централизована
Renderer слушает resize и обновляет `app.screen`. Сцены читают размеры из `this.renderer.app.screen.width/height`, а не из `window.innerWidth`.

---

## 4. Домен и типы

### RULE-DOMAIN-01: Иммутабельность по умолчанию
Поля доменных сущностей — `readonly` где возможно. Мутация состояния только через явные методы (`performWarpJump`, `equipModule`).

### RULE-DOMAIN-02: Изменил тип — обновил схему
Любое изменение `src/types/index.ts` или `src/domain/*.ts` должно быть отражено в `src/validation/schemas.ts`. Иначе сохранения сломаются.

| ❌ BAD | ✅ GOOD |
|--------|--------|
| `// Added field to Player domain type but forgot:`<br>`// src/validation/schemas.ts still has old PlayerSchema` | `// After ANY change to src/types/index.ts or src/domain/*.ts:`<br>`// Update src/validation/schemas.ts AND MigrationPipeline.ts` |

**Почему:** Save game validation will reject saves with the new field. Players lose progress.

---

## 5. Исключения и логирование

### RULE-ERR-01: Только иерархия из `src/exceptions/`
Все ошибки бросаются через `GameBusinessException`, `GameSystemException`, `GameValidationException`, `InferenceException` или `InferenceTimeoutException`. `throw new Error('...')` — только во внешних библиотеках.

| ❌ BAD | ✅ GOOD |
|--------|--------|
| `throw new Error('Not enough credits');` | `throw new GameBusinessException('INSUFFICIENT_CREDITS', \`Need ${price} credits, have ${credits}\`, { price, credits });` |

**Почему:** Generic errors can't be classified by GlobalExceptionHandler. Typed exceptions enable recovery logic.

### RULE-ERR-02: Логгер вместо console
Используй `src/utils/logger.ts`. `console.log` допустим только во временном дебаг-коде, который не попадает в PR.

| ❌ BAD | ✅ GOOD |
|--------|--------|
| `console.log('Model loaded:', modelId);` | `logger.info('Model loaded', { modelId });` |

**Почему:** logger.ts respects __DEBUG__ flag and formats consistently. console.log leaks to production.

---

## 6. AI и ONNX

### RULE-AI-01: Инференс только через Worker
Прямой вызов `ort.InferenceSession.run` в главном потоке — запрещён. Только `ONNXModelRegistry.infer()` → `WebWorkerPool`.

| ❌ BAD | ✅ GOOD |
|--------|--------|
| `const session = await ort.InferenceSession.create(modelPath);`<br>`const output = await session.run(feeds);` | `const result = await this.engine.onnxRegistry.infer('dialogue', inputTensor);` |

**Почему:** ONNX inference blocks the main thread. Always dispatch via WebWorkerPool through ONNXModelRegistry.

### RULE-AI-02: Таймаут и fallback
Любой асинхронный инференс должен иметь таймаут и fallback-ответ. Нет модели — игра не падает, а использует заглушку (`FallbackEngine`).

---

## 7. Общие архитектурные запреты

| Запрет | Почему |
|--------|--------|
| `any` без явного `eslint-disable-next-line` | Теряется типобезопасность |
| Циклические зависимости между слоями | `presentation/` → `systems/` — OK; `systems/` → `presentation/` — нет |
| Импорт из `data/` в `domain/` | Домен не знает о персистентности |
| Хранение бизнес-логики в Page Object | Page Object — только навигация; логика — в системах |
| Хардкод путей к ассетам в коде сцен | Пути резолвятся через конфиг или `import.meta.url` |

---

## 8. Как внести изменения

1. **Новая фича** → напиши/обнови Story в `requirements/`, затем код.
2. **Новая сцена** → добавь `SceneType`, класс сцены, вызов в `GameEngine.transitionTo()`, Page Object для E2E.
3. **Новая модель ONNX** → добавь в `src/ai/ModelManifest.ts`, адаптер в `src/ai/adapters/`, тест в `src/tests/onnx-registry.test.ts`.
4. **Новое сохраняемое поле** → обнови домен, `schemas.ts`, `MigrationPipeline.ts`.
