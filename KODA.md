# KODA — Инструкционный контекст

## Обзор проекта

**Название:** Космические рейнджеры: Нейросетевое вторжение  
**Оригинальное название:** Space Rangers: Neural Onslaught  
**Жанр:** Космическая RPG / Стратегия / Текстовые квесты с элементами roguelike  
**Платформа:** Браузер (HTML5, WebGL, PWA)  
**Цель:** Создать «дышащий» космический мир с процедурной генерацией, пошаговыми тактическими боями и диалогами, генерируемыми локальными ONNX-моделями.

Проект представляет собой клиентскую браузерную игру на TypeScript с использованием движка рендеринга PixiJS. Ключевая особенность — интеграция легковесных квантованных ONNX-моделей (через `onnxruntime-web`), работающих полностью на устройстве игрока: диалоговая модель, тактический RL-агент, генератор контента (VAE), эмоциональный движок NPC (GRU).

## Технологический стек

- **Язык:** TypeScript 5.4+ (ES2022, строгий режим)
- **Сборка:** Vite 5.2+ (корень `src`, выход `dist`)
- **Тестирование:** Vitest 1.5+ с окружением `jsdom`
- **Рендеринг:** PixiJS 8.0+ (WebGL / Canvas2D fallback)
- **ИИ-инференс:** onnxruntime-web 1.17+ (WebAssembly / WebGL backend)
- **Валидация:** Zod 3.23+
- **Линтинг:** ESLint 8.57 + @typescript-eslint
- **Форматирование:** Prettier 3.2+
- **Хранение:** IndexedDB (сохранения, кэш моделей), localStorage (настройки)
- **PWA:** Service Worker (`sw.ts`), Web App Manifest

## Архитектура

Кодовая база организована по слоям с четким разделением ответственности:

```
src/
  main.ts              — Точка входа: регистрация SW, инициализация GameEngine
  index.html           — HTML-оболочка, полноэкранный canvas
  sw.ts                — Service Worker (PWA, кэширование)
  manifest.json        — Манифест PWA

  config/              — Глобальные константы и конфигурация
    GameConfig.ts      — Значения по умолчанию, ограничения, регулярные выражения

  types/               — Предметная типизация: enum, интерфейсы, type aliases
    index.ts           — Центральный файл типов (расы, ресурсы, сцены, боевые действия и т.д.)

  domain/              — Чистые доменные сущности (без зависимостей от инфраструктуры)
    Galaxy, StarSystem, Planet, Player, PlayerShip, EnemyShip, NPC,
    Quest, Market, Inventory, TacticalEncounter, HexGrid, EmotionVector,
    Overmind, ChaosGate, SaveState и др.

  ecs/                 — Собственная реализация Entity-Component-System
    Entity.ts          — Базовая сущность с динамическими компонентами
    Component.ts       — Базовый класс компонента
    ECSWorld.ts        — Мир: хранение сущностей, систем, игровой цикл обновления

  systems/             — Высокоуровневые игровые системы
    GameEngine.ts      — Центральный движок: инициализация, смена сцен, игровой цикл, сохранение
    GalaxySimulator.ts — Процедурная генерация галактики по сиду
    CombatSystem.ts    — Пошаговый тактический бой
    TradeSystem.ts     — Торговля и экономика
    DialogueSystem.ts  — Диалоги и дипломатия

  presentation/        — Сцены и визуализация на PixiJS
    Renderer.ts        — Обёртка над PixiJS Application
    GameScene.ts       — Базовый класс сцены (mount / unmount / update / destroy)
    StarMapScene.ts    — Звёздная карта
    CombatScene.ts     — Тактический бой (гексагональная сетка)
    DialogueScene.ts   — Диалоговый интерфейс
    InventoryScene.ts  — Инвентарь и корабль

  ai/                  — ONNX-инфраструктура и адаптеры
    ONNXModel.ts       — Обёртка над onnxruntime-web
    ONNXModelRegistry.ts — Реестр и загрузка моделей
    WebWorkerPool.ts   — Пул воркеров для инференса
    IndexedDBCache.ts  — Кэширование моделей в IndexedDB
    AdaptiveQualityProfile.ts — Адаптация качества под производительность устройства
    FallbackEngine.ts  — Заглушки при недоступности ONNX
    ModelManifest.ts   — Описание моделей (URL, размер, версия)
    inference.worker.ts — Воркер для инференса
    adapters/          — Адаптеры под конкретные архитектуры:
      T5DialogueAdapter.ts, PPOAdapter.ts, VAEAdapter.ts,
      GRUAdapter.ts, OvermindAdapter.ts

  data/                — Персистентность
    SaveManager.ts     — Управление слотами сохранений
    SaveStateSerializer.ts — Сериализация / десериализация
    IndexedDBAdapter.ts — Низкоуровневый доступ к IndexedDB
    MigrationPipeline.ts — Миграции между версиями сохранений

  exceptions/          — Единая обработка ошибок
    GlobalExceptionHandler.ts — Центральный обработчик
    GameBusinessException.ts, GameSystemException.ts,
    GameValidationException.ts, InferenceException.ts,
    InferenceTimeoutException.ts

  utils/               — Утилиты
    logger.ts          — Простой логгер
    seededRNG.ts       — Детерминированный ГПСЧ

  validation/          — Валидация схем (Zod)
    schemas.ts

  tests/               — Модульные тесты
    ecs.test.ts, pathfinding.test.ts, trade.test.ts
```

### Ключевые архитектурные решения

- **ECS** используется для тактических боёв и динамических игровых объектов (сущности + компоненты + системы обновления).
- **GameEngine** управляет жизненным циклом: инициализация → генерация мира → переход между сценами → игровой цикл `requestAnimationFrame`.
- **Сцены** (`StarMapScene`, `CombatScene` и др.) наследуются от `GameScene` и управляются через `GameEngine.transitionTo()`.
- **ONNX-модели** загружаются лениво, кэшируются в IndexedDB, инференс выполняется в Web Workers.
- **Сохранения** поддерживают версионирование и аварийное сохранение (`_emergency`) при критических ошибках.

## Сборка и запуск

Команды определены в `package.json`:

| Команда | Описание |
|---------|----------|
| `npm run dev` | Запуск dev-сервера Vite |
| `npm run build` | Компиляция TypeScript + production-сборка Vite в `dist/` |
| `npm run preview` | Локальный предпросмотр production-сборки |
| `npm run lint` | Проверка ESLint для `src/**/*.ts` |
| `npm test` | Запуск тестов Vitest (watch-режим по умолчанию) |

### TypeScript

- `tsconfig.json` настроен на строгий режим (`strict: true`, `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`).
- Пути: `@/*` → `src/*`.
- Цель: ES2022, модульность ESNext, разрешение модулей `bundler`.
- `rootDir`: `./src`, `outDir`: `./dist`.

### Vite

- Корень проекта для dev-сборки: `src/`.
- Выходная директория: `../dist`.
- Алиас `@` разрешён в `vite.config.ts` и `vitest.config.ts`.
- Поддержка воркеров в формате ES-модулей.
- Переменная `__DEBUG__` доступна в коде (`true` при `development`).

## Правила разработки

### Стиль кодирования

- **ESLint**: расширяет `eslint:recommended` и `@typescript-eslint/recommended`.
- Запрещено использование `any` без предупреждения (`@typescript-eslint/no-explicit-any: warn`).
- Неиспользуемые переменные — ошибка; параметы, начинающиеся с `_`, игнорируются.
- `no-console` отключён; вместо `console` рекомендуется использовать `logger` из `utils/logger.ts`.
- Код оформлен в едином стиле с помощью Prettier.

### Тестирование

- **Vitest** с глобальными API (`globals: true`) и окружением `jsdom`.
- Тесты располагаются в `src/tests/`.
- Покрыты ключевые системы: ECS, поиск пути (`pathfinding`), торговля (`trade`).
- При добавлении новой системы рекомендуется добавлять соответствующий `.test.ts`.

### Контрибуция и договорённости

- Все доменные сущности должны быть иммутабельными (readonly поля / интерфейсы).
- Исключения наследуются от базовых классов в `exceptions/` и содержат код ошибки.
- Любой асинхронный инференс должен иметь таймаут и fallback-механизм.
- Конфигурационные константы (баланс, ограничения) выносятся в `config/GameConfig.ts`.
- Сцены не должны напрямую обращаться к IndexedDB или ONNX — только через `GameEngine`, `SaveManager`, `ONNXModelRegistry`.

## Ключевые файлы и документация

### Документация проекта

- `requirements/GDD-001.md` — Game Design Document: сеттинг, механики, план разработки, риски.
- `requirements/REQ-001-base.md` — Базовые требования.
- `requirements/[User-story-1]pixijs-renderer-and-scenes.md` — Пользовательские истории (Story 1–5):
  - Рендерер и сцены PixiJS
  - ONNX-инференс в Web Worker
  - Валидация сохранений через Zod
  - PWA и Service Worker
  - Модульные тесты на Vitest
- `spdd/prompt/` — SPDD-промпты (REASONS Canvas) для генерации архитектуры.
- `spdd/analysis/` — Аналитические артефакты SPDD.

### Конфигурационные файлы

- `package.json` — Зависимости и скрипты.
- `tsconfig.json` — Настройки компилятора TypeScript.
- `vite.config.ts` — Конфигурация сборщика.
- `vitest.config.ts` — Конфигурация тестового фреймворка.
- `.eslintrc.json` — Правила линтинга.

### Точки входа

- `src/main.ts` — Инициализация игры.
- `src/index.html` — Корневая HTML-страница.

## Использование репозитория

1. Установить зависимости: `npm install`.
2. Запустить dev-режим: `npm run dev`.
3. Для production-сборки: `npm run build`.
4. Для запуска тестов: `npm test`.
5. Для проверки линтером: `npm run lint`.

## Примечания для будущих взаимодействий

- Проект находится на ранней стадии (Phase 1 / прототип). Многие механики имеют заглушки или минимальную реализацию.
- При изменении доменных типов в `src/types/index.ts` необходимо синхронизировать валидацию в `src/validation/schemas.ts`.
- ONNX-модели не включены в репозиторий; они загружаются по URL и кэшируются в IndexedDB. Для работы без сети требуется хотя бы одна первоначальная загрузка.
- Генерация галактики детерминирована при фиксированном сиде (`seededRNG`).
- Сервис-воркер регистрируется из `main.ts`; при локальной разработке может требоваться сброс кэша браузера.
