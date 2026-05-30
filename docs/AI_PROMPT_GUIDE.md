# AI-Assisted SDLC Guide — Космические рейнджеры: Нейросетевое вторжение

> Этот документ — рабочее соглашение с AI-ассистентами. Следуй ему при каждом запросе к модели.

---

## 1. SDLC Framework

### Фазы разработки

| Фаза | Название | Статус | AI-стратегия |
|------|----------|--------|--------------|
| **P0** | Proof of Concept | ✅ Done | Architecture generation — используй REASONS Canvas с полными entity-диаграммами |
| **P1** | MVP Core Gameplay | 🔄 Active | Story-by-story implementation — одна story = один промпт, включай AC и тесты |
| **P2** | Living Galaxy | 📋 Planned | Incremental feature layering — явно ссылайся на существующие доменные типы |
| **P3** | Neural Onslaught | 📋 Planned | ONNX adapter pattern — одна модель = одна story, всегда включай FallbackEngine path |
| **P4** | Beta Release | 📋 Planned | Integration + polish — фокус на E2E-сценариях, edge cases и error boundaries |

### Workflow: Story → Code → Test

```
Requirements .md
  → Analysis (REASONS Canvas)
    → Prompt (one story per prompt)
      → AI generates code
        → Review vs AC
          → Vitest passes
            → Playwright passes
              → PR merge
```

**Золотое правило:** 1 story = 1 prompt. Не пихай несколько story в один запрос.

---

## 2. AI Prompt Patterns

### 2.1 Architecture / REASONS Canvas

**Когда:** Перед реализацией любой новой подсистемы или фазы.

```
You are implementing a new subsystem for Space Rangers: Neural Onslaught
(browser TypeScript game using PixiJS + onnxruntime-web + Vite).

Context:
- Current phase: [PHASE_NAME]
- Tech stack: TypeScript 5.4, PixiJS 8, onnxruntime-web 1.17, Zod 3.23, Vitest, Playwright
- Architecture layers: domain → ecs → systems → presentation → ai → data
- Existing: [LIST KEY EXISTING CLASSES]

Task: Design the [SUBSYSTEM_NAME] using REASONS Canvas format:
- Requirements (numbered list)
- Entities (class diagram in Mermaid)
- Attributes (fields per class with types)
- State (lifecycle states)
- Operations (method signatures + logic steps)
- Norms (coding rules: no any, immutable domain, logger not console)
- Scenarios (numbered AC per story)

Constraints:
- Scenes must NOT call IndexedDB/ONNX directly — route through GameEngine
- All domain fields must be readonly
- Errors thrown via GameBusinessException / GameSystemException only
- ONNX inference via WebWorkerPool only (never on main thread)
```

**Pro tips:**
- Всегда включай имена существующих классов — избегаешь дублирования.
- Добавь ограничение Mermaid-диаграммы для type-safe импортов.
- Явно упомяни `readonly` — AI часто забывает.

---

### 2.2 User Story Implementation

**Когда:** Реализация одной user story.

```
Implement [STORY-ID]: [Story Title] for Space Rangers: Neural Onslaught.

Story Background:
[PASTE the Background section from the story .md file]

Scope In:
[PASTE the Scope In bullet list]

Acceptance Criteria:
[PASTE ALL AC items — AI will use these as test targets]

Existing code to extend (do NOT recreate):
- src/systems/GameEngine.ts — scene manager, exposes transitionTo()
- src/presentation/GameScene.ts — abstract base: initialize(), update(), destroy()
- src/types/index.ts — SceneType enum, all domain types
- src/validation/schemas.ts — Zod schemas for saves
- [ADD any other relevant existing files]

Rules:
- Follow CODING_RULES.md: no hardcoded pixel positions (RULE-INPUT-01),
  destroy() clears all refs (RULE-SCENE-01), logger not console (RULE-ERR-02)
- For each AC write a Vitest test in src/tests/[story-id].test.ts
- For E2E scenarios write Playwright tests in e2e/ using Page Object pattern (RULE-E2E-02)
- TypeScript strict mode — no implicit any

Output: implementation files + test files
```

**Pro tips:**
- Одна story = один промпт — золотое правило.
- Всегда вставляй список AC — это AI-определение готовности.
- Называй существующие файлы — предотвращаешь переизобретение.

---

### 2.3 Bug Fix / Regression

**Когда:** Исправление конкретного падающего теста или runtime-ошибки.

```
Fix this failing test/error in Space Rangers: Neural Onslaught.

Error:
```
[PASTE full error message / stack trace]
```

Failing test (if applicable):
```typescript
[PASTE failing test code]
```

Relevant source files:
```typescript
// [filename]
[PASTE relevant section of source code]
```

What was working before: [describe last known good state]

Constraints:
- Do NOT change test expectations — fix the implementation, not the test
- Do NOT introduce any: use proper types
- If fix touches domain types, update src/validation/schemas.ts accordingly (RULE-DOMAIN-02)
- If fix touches scene lifecycle, verify destroy() clears all references (RULE-SCENE-01)

Output: minimal diff to fix the issue + explanation of root cause
```

**Pro tips:**
- Вставляй полный stack trace, а не только последнюю строку.
- Явно скажи: "fix the implementation, not the test".
- Упомяни RULE-DOMAIN-02, если затронуты типы.

---

### 2.4 ONNX Model Adapter

**Когда:** Добавление новой AI-модели.

```
Add a new ONNX model adapter for Space Rangers: Neural Onslaught.

Model: [MODEL_NAME] (e.g., T5DialogueAdapter)
Architecture: [e.g., encoder-decoder text generation]
Input: [e.g., Float32Array shape [1, 512] — tokenized prompt]
Output: [e.g., Int32Array shape [1, 256] — token IDs]
Model file: [URL or placeholder URL]
Timeout: [e.g., 3000ms — dialogue models can be slow]

Existing infrastructure to use:
- src/ai/ONNXModelRegistry.ts — call .infer(modelId, tensor)
- src/ai/inference.worker.ts — DO NOT modify; inference already runs in workers
- src/ai/FallbackEngine.ts — implement fallback here for template-based response
- src/ai/adapters/ — create new file here

Create:
1. src/ai/adapters/[MODEL_NAME]Adapter.ts
   - preprocessInput(rawInput: [TYPE]): ort.Tensor
   - postprocessOutput(tensor: ort.Tensor): [OUTPUT_TYPE]
   - infer(input: [TYPE]): Promise<[OUTPUT_TYPE]>
   - Handle InferenceTimeoutException → call FallbackEngine
2. Entry in src/ai/ModelManifest.ts
3. Unit test in src/tests/[model]-adapter.test.ts

RULE-AI-01: Never call ort.InferenceSession.run() directly — use ONNXModelRegistry.infer()
RULE-AI-02: Timeout and FallbackEngine are mandatory
```

**Pro tips:**
- Всегда указывай tensor shape и dtype явно.
- Напомни AI, что инференс уже работает в воркерах.
- FallbackEngine — обязателен по правилам проекта.

---

### 2.5 E2E Test Scenario

**Когда:** Написание Playwright E2E-тестов.

```
Write Playwright E2E tests for [FEATURE_NAME] in Space Rangers: Neural Onslaught.

Acceptance Criteria to test:
[PASTE relevant AC items]

Page Objects available:
- e2e/page-objects/main-menu.page.ts — menu navigation
- e2e/page-objects/star-map.page.ts — star map interactions
- [ADD others as needed]

Test file to create: e2e/[feature-name].spec.ts

Rules (from CODING_RULES.md):
- RULE-E2E-01: NO canvas.click({ position: {x, y} }) — use
  page.evaluate(() => window.__gameEngine.currentScene.handler()) or data-testid attributes
- RULE-E2E-02: All selectors live in Page Objects — no locators in spec files
- RULE-E2E-03: No waitForTimeout — use waitForFunction or waitForSelector

Game exposes window.__gameEngine in dev/test mode.

Output: Page Object additions (if needed) + spec file
```

**Pro tips:**
- Вставь RULE-E2E-01 дословно — AI склонен использовать position clicks.
- Упомяни window.__gameEngine — AI может не знать об этом.
- Перечисли существующие Page Objects, чтобы избежать дублирования.

---

## 3. User Story Guide

### Типичные проблемы со story и их решения

| Проблема | Симптом | Решение | Пример |
|----------|---------|---------|--------|
| **Story слишком большая** | AI генерирует частичный код, пропускает AC или теряет контекст | Разбей на под-story: одна на сцену, систему или группу AC. Макс ~5 AC на промпт. | ❌ "Implement full combat system" → ✅ "Implement HexGrid rendering (AC1–AC2)" + отдельная story для "Combat turn logic (AC3–AC5)" |
| **Нет контекста о существующем коде** | AI создаёт дубли классов или использует неправильные имена методов | Всегда вставляй релевантные сниппеты или хотя бы список существующих классов/методов | Добавь в промпт: "Existing: GameEngine.transitionTo(scene: SceneType), Renderer.app.stage contains gameLayer and uiLayer" |
| **Нет acceptance criteria** | AI реализует что-то "похожее", но не соответствующее ожиданиям | Скопируй полный список AC из requirements/*.md в промпт. Каждый AC = один тест. | Включи: "AC3: When credits < price, executeTrade() throws GameBusinessException(INSUFFICIENT_CREDITS)" |
| **Story нарушает архитектурные правила** | AI кладёт вызовы IndexedDB в сцены, использует console.log или хардкодит позиции | Включи блок Constraints с релевантными RULE-кодами из CODING_RULES.md | Добавь: "RULE-SCENE-02: scene cannot call IndexedDB — route through GameEngine.saveManager" |
| **Тесты написаны до имплементации** | AI меняет ожидания тестов под сломанный код | Явно укажи: "Do NOT change test expectations — fix the implementation" | Помести это в BugFix-шаблон и никогда не опускай |

### Структура story-файла

```
Story ID + Title         (e.g., STORY-001-003: Zod Save Validation)
Background               — зачем эта story существует, бизнес-контекст
Scope In                 — явный список того, что строим
Scope Out                — явный список того, что НЕ строим
Acceptance Criteria      — нумерованные, тестируемые (каждый AC = один тест)
Test Cases               — формат TC-XXX-NNN, привязка к AC
Dependencies             — что должно существовать до этой story
```

---

## 4. Pre-Prompt Checklist

Пройди этот чеклист перед отправкой любого промпта AI.

### Context
- [ ] В какой фазе мы находимся? (0/1/2/3/4)
- [ ] Какой Story ID? (например, STORY-001-003)
- [ ] Какие файлы уже существуют и релевантны?
- [ ] Что было попробовано ранее и не сработало?

### Scope
- [ ] Достаточно ли маленькая эта story? (≤5 AC на промпт)
- [ ] Вставлены ли AC в промпт?
- [ ] Включён ли список Scope In?
- [ ] Ясно ли Scope Out (что НЕ строим)?

### Architecture Rules
- [ ] Включены ли релевантные RULE-коды?
- [ ] Упомянут ли RULE-INPUT-01, если затронут UI?
- [ ] Упомянут ли RULE-SCENE-02, если сцена работает с данными?
- [ ] Упомянут ли RULE-AI-01, если затронут ONNX?
- [ ] Упомянут ли RULE-DOMAIN-02, если меняются типы?

### Testing
- [ ] Ожидаются ли Vitest-тесты (unit)?
- [ ] Ожидаются ли Playwright-тесты (E2E)?
- [ ] Сказано ли "don't change test expectations"?
- [ ] Перечислены ли существующие Page Objects?

### Output Clarity
- [ ] Чётко ли указан ожидаемый output?
- [ ] Попросил ли ты указать пути файлов в output?
- [ ] Для багов: вставлены ли полная ошибка + релевантный исходник?
- [ ] Попросил ли объяснение изменений?

> 🚦 **Rule of Thumb:** Если в любой категории есть неотмеченные пункты, промпт, скорее всего, провалится.
>
> Самые частые причины провала:
> 1. Большая story без AC.
> 2. Забыли упомянуть существующие файлы — AI переизобретает колесо.
> 3. Опущены архитектурные правила — AI нарушает слоистую архитектуру.
