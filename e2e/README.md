# Playwright E2E Testing

## Запуск тестов

```bash
# Запуск всех тестов во всех браузерах (headless)
npm run test:e2e

# Запуск с UI-интерфейсом
npm run test:e2e:ui

# Запуск с открытым браузером (headed)
npm run test:e2e:headed

# Запуск в режиме отладки
npm run test:e2e:debug

# Просмотр HTML-отчета
npm run test:e2e:report
```

## Структура тестов

```
e2e/
├── game-launch.spec.ts      # Тесты запуска игры и workers
├── main-menu.spec.ts        # Тесты главного меню и перехода в новую игру
├── star-map.spec.ts         # Тесты звездной карты
├── inventory.spec.ts        # Тесты инвентаря
├── trade.spec.ts            # Тесты торговой системы
├── combat.spec.ts           # Тесты тактических боёв
└── save-load.spec.ts        # Тесты сохранений
```

## Конфигурация

- **Браузеры**: Chromium, Firefox, WebKit
- **Base URL**: `http://localhost:5173`
- **Автоматический запуск dev-сервера** перед тестами
- **Скриншоты и видео** при неудачных тестах
- **Trace** для отладки

## Особенности

Тесты взаимодействуют с PixiJS-рендерингом через canvas. Клик по элементам интерфейса выполняется по координатам, так как UI рисуется в Canvas.

### Worker Testing

Новый тест `should load workers without MIME type errors` проверяет, что Web Workers (включая `inference.worker.ts`) загружаются без ошибок MIME type.

### Game Start Flow

Тест `should start new game with player creation` проверяет полный цикл:
1. Клик по кнопке "Новая игра" на главном меню
2. Создание игрока и корабля в GameEngine
3. **Передача галактики в StarMapScene**
4. Переход на экран звёздной карты с отображением систем
5. Проверка, что игра отображается корректно

## Что происходит при нажатии "Новая игра"

1. **MainMenuScene.handleNewGame()** вызывается при клике
2. **GameEngine.transitionTo('STAR_MAP')** запускается
3. Если игрок ещё не создан:
   - Создаётся раса Human
   - Создаётся SkillTree
   - Создаётся Player с именем "Captain"
   - Создаётся PlayerShip "Ranger-1"
   - Игрок получает 1000 кредитов
4. **Galaxy** (уже созданная при старте игры) передаётся в StarMapScene
5. **StarMapScene** рендерит:
   - Звёздные системы (точки)
   - Warp lanes (линии между системами)
   - Заголовок "SECTOR MAP"
6. Игрок видит звёздную карту и может исследовать системы

## Юнит-тесты

```bash
# Запуск всех юнит-тестов
npm test

# Запуск конкретного теста
npm test -- --run src/tests/worker-pool.test.ts
```

### Модули тестирования

- `ecs.test.ts` — Entity-Component-System
- `pathfinding.test.ts` — Поиск пути на гексагональной сетке
- `trade.test.ts` — Торговая система и экономика
- `worker-pool.test.ts` — Пул Web Workers для ONNX-инференса
- `onnx-registry.test.ts` — Реестр ONNX-моделей

## CI/CD

Для CI добавьте в workflow:

```yaml
- name: Install dependencies
  run: npm ci

- name: Install Playwright
  run: npx playwright install --with-deps

- name: Run Unit Tests
  run: npm test -- --run

- name: Run E2E tests
  run: npm run test:e2e
```

## Последние изменения

### v0.1.1 — Fix Game Start Flow
- Исправлен переход из главного меню в новую игру
- `GameEngine.transitionTo()` теперь асинхронный и создаёт игрока при необходимости
- **Galaxy теперь корректно передаётся в StarMapScene**
- Обновлены тесты для проверки создания игрока и отображения звёздной карты
- Исправлена загрузка Web Workers (worker URL через Vite import)
- Все 20 E2E тестов проходят ✓
- Все 37 юнит-тестов проходят ✓

## Структура тестов

```
e2e/
├── game-launch.spec.ts      # Тесты запуска игры и workers
├── main-menu.spec.ts        # Тесты главного меню
├── star-map.spec.ts         # Тесты звездной карты
├── inventory.spec.ts        # Тесты инвентаря
├── trade.spec.ts            # Тесты торговой системы
├── combat.spec.ts           # Тесты тактических боёв
└── save-load.spec.ts        # Тесты сохранений
```

## Конфигурация

- **Браузеры**: Chromium, Firefox, WebKit
- **Base URL**: `http://localhost:5173`
- **Автоматический запуск dev-сервера** перед тестами
- **Скриншоты и видео** при неудачных тестах
- **Trace** для отладки

## Особенности

Тесты взаимодействуют с PixiJS-рендерингом через canvas. Клик по элементам интерфейса выполняется по координатам, так как UI рисуется в Canvas.

### Worker Testing

Новый тест `should load workers without MIME type errors` проверяет, что Web Workers (включая `inference.worker.ts`) загружаются без ошибок MIME type.

## Юнит-тесты

```bash
# Запуск всех юнит-тестов
npm test

# Запуск конкретного теста
npm test -- --run src/tests/worker-pool.test.ts
```

### Модули тестирования

- `ecs.test.ts` — Entity-Component-System
- `pathfinding.test.ts` — Поиск пути на гексагональной сетке
- `trade.test.ts` — Торговая система и экономика
- `worker-pool.test.ts` — Пул Web Workers для ONNX-инференса
- `onnx-registry.test.ts` — Реестр ONNX-моделей

## CI/CD

Для CI добавьте в workflow:

```yaml
- name: Install dependencies
  run: npm ci

- name: Install Playwright
  run: npx playwright install --with-deps

- name: Run Unit Tests
  run: npm test -- --run

- name: Run E2E Tests
  run: npm run test:e2e
```
