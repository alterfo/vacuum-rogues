# Космические рейнджеры: Нейросетевое вторжение

**Space Rangers: Neural Onslaught** — браузерная космическая RPG/стратегия с локальными ONNX-моделями для генерации диалогов и тактического ИИ.

## Фазы разработки

### ✅ Фаза 0: Технический прототип (Proof of Concept)

- **Интеграция ONNX-моделей** — загрузка, кэширование в IndexedDB, инференс в Web Workers
- **Базовая сцена с кораблём** — параллакс-фон со звёздами, управление кораблём мышью
- **CI/CD** — автоматическая сборка и деплой через GitHub Actions + Vercel

## Быстрый старт

### Предварительные требования

- Node.js 20+
- npm или pnpm

### Установка и запуск

```bash
# Установка зависимостей
npm install

# Запуск dev-сервера
npm run dev

# Сборка для production
npm run build

# Предпросмотр production-сборки
npm run preview

# Запуск тестов
npm test

# Проверка линтером
npm run lint
```

## Архитектура

### Технологический стек

- **TypeScript 5.4+** — строгая типизация
- **Vite 5.2+** — сборка и dev-сервер
- **PixiJS 8.0+** — рендеринг (WebGL / Canvas2D)
- **onnxruntime-web 1.17+** — локальный ONNX-инференс
- **IndexedDB** — кэширование моделей и сохранений
- **Web Workers** — параллельный инференс

### Ключевые компоненты

```
src/
  main.ts              — Точка входа
  systems/GameEngine.ts — Центральный движок
  presentation/
    SpaceFlightScene.ts — Сцена полёта с кораблём (NEW!)
    StarMapScene.ts     — Звёздная карта
    MainMenuScene.ts    — Главное меню
  ai/
    ONNXModelRegistry.ts — Регистрация и загрузка ONNX-моделей
    SimpleONNXModel.ts   — Mock-сессии для POC
    inference.worker.ts  — Web Worker для инференса
  data/
    SaveManager.ts       — Управление сохранениями
```

## Особенности Фазы 0

### 1. ONNX-интеграция

- **Загрузка моделей** с CDN с кэшированием в IndexedDB
- **Fallback-механизм** — при отсутствии модели создаётся mock-сессия для тестирования
- **Web Worker Pool** — параллельный инференс без блокировки UI
- **Адаптивный инференс** — таймауты и обработка ошибок

**Demo**: Кнопка "ONNX Демо" в главном меню демонстрирует загрузку модели и время инференса.

### 2. Сцена полёта

- **Параллакс-фон** — 3 слоя звёзд с разной скоростью
- **Туманности** — процедурно генерируемые цветные облака
- **Управление кораблём** — клик для движения, корабль поворачивается к цели
- **Эффекты двигателя** — анимация при движении

**Запуск**: Кнопка "Полёт" в главном меню.

### 3. CI/CD Pipeline

- **GitHub Actions** — автоматическая сборка при push/pull-request
- **Vercel** — автоматический деплой в production
- **Тесты и линтинг** — обязательны перед деплоем

## Структура проекта

```
space-rangers-neural-onslaught/
├── .github/workflows/ci-cd.yml   # CI/CD pipeline
├── dist/                         # Production build
├── src/
│   ├── ai/                       # ONNX-инфраструктура
│   ├── config/                   # Конфигурация
│   ├── data/                     # Персистентность
│   ├── domain/                   # Доменные сущности
│   ├── ecs/                      # Entity-Component-System
│   ├── exceptions/               # Обработка ошибок
│   ├── presentation/             # Сцены PixiJS
│   ├── systems/                  # Игровые системы
│   ├── tests/                    # Модульные тесты
│   ├── types/                    # Типы TypeScript
│   └── utils/                    # Утилиты
├── requirements/                 # GDD и пользовательские истории
└── vercel.json                   # Конфиг Vercel
```

## Разработка

### Документация для разработчиков

- **[Developer Guide](docs/DEVELOPER_GUIDE.md)** — архитектура, жизненный цикл сцены, FAQ
- **[Coding Rules](docs/CODING_RULES.md)** — архитектурные ограничения, anti-patterns, правила ввода/ONNX/исключений
- **[AI Prompt Guide](docs/AI_PROMPT_GUIDE.md)** — шаблоны промптов для AI-ассистентов, чеклист перед запросом, типичные ошибки story

### Добавление новой сцены

1. Создать класс, наследующий `GameScene`
2. Реализовать методы `initialize()`, `update()`, `destroy()`
3. Зарегистрировать в `GameEngine.transitionTo()`
4. Добавить `SceneType` в `src/types/index.ts`

### Интеграция ONNX-модели

1. Добавить конфигурацию в `src/ai/ModelManifest.ts`
2. Создать адаптер (напр., `T5DialogueAdapter`)
3. Использовать через `ONNXModelRegistry`

### Тестирование

```bash
# Запуск всех тестов
npm test

# Запуск в watch-режиме
npm test -- --watch

# Запуск конкретных тестов
npm test -- --reporter=verbose path/to/test.ts
```

## Деплой

### Vercel (рекомендуется)

1. Подключить репозиторий на [vercel.com](https://vercel.com)
2. Настроить переменные окружения (если нужны)
3. Автоматический деплой при push в `main`

### Ручной деплой

```bash
npm run build
# Загрузить dist/ на любой статический хостинг
```

## Переменные окружения (для CI/CD)

Создайте секреты в GitHub Repository Settings:

- `VERCEL_TOKEN` — токен деплоя Vercel
- `VERCEL_ORG_ID` — ID организации Vercel (если есть)
- `VERCEL_PROJECT_ID` — ID проекта Vercel

## Лицензия

Проект в разработке. Все права защищены.

---

**Разработано командой NLP-Core-Team**
