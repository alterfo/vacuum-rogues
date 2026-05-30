# E2E Test Suite Documentation

## Обзор

Комплексная E2E тест-сессия для игры «Космические рейнджеры: Нейросетевое вторжение», покрывающая все фазы разработки от Phase 0 (Technical Prototype) до Phase 4 (Beta & Release).

## Структура тестов

```
e2e/
├── page-objects/              # Page Object Model классы
│   ├── base.page.ts          # Базовый класс с общими утилитами
│   ├── main-menu.page.ts     # Главное меню
│   ├── star-map.page.ts      # Звёздная карта
│   ├── combat.page.ts        # Тактический бой
│   ├── inventory.page.ts     # Инвентарь
│   └── trade.page.ts         # Торговля
│
├── fixtures/                  # Тестовые данные и утилиты
│   └── game-fixtures.ts      # Test players, saves, IndexedDB helpers
│
├── phase-0-1-prototype.spec.ts    # Phase 0-1: Prototype & MVP1
├── phase-2-living-galaxy.spec.ts  # Phase 2: MVP2 (AI features)
├── phase-3-neural-onslaught.spec.ts # Phase 3: Alpha Release
├── phase-4-beta-release.spec.ts   # Phase 4: Beta & Release
└── acceptance-criteria-matrix.md  # Матрица трассируемости
```

## Запуск тестов

```bash
# Запуск всех E2E тестов во всех браузерах
npm run test:e2e

# Запуск конкретной фазы
npm run test:e2e -- phase-0-1-prototype.spec.ts

# Запуск с UI-интерфейсом
npm run test:e2e:ui

# Запуск в headed режиме (с браузером)
npm run test:e2e:headed

# Запуск конкретного теста по имени
npm run test:e2e -- --grep "TC-P1-001"

# Просмотр HTML-отчета
npm run test:e2e:report
```

## Покрытие требований

### Phase 0: Technical Prototype (6 тестов)

| ID | Требование | Тест | Статус |
|----|------------|------|--------|
| P0-001 | Интеграция onnxruntime-web | `TC-P0-002: Web Workers should load` | ✅ |
| P0-002 | Базовая сцена | `TC-P0-001: Game should load` | ✅ |
| P0-003 | CI/CD | `TC-P0-005: Initialization timeout` | ✅ |

### Phase 1: MVP1 - «Один в космосе» (14 тестов)

| ID | Требование | Тест | Статус |
|----|------------|------|--------|
| P1-001 | Звёздная карта (10 систем) | `TC-P1-002: Star map displays 10 systems` | ✅ |
| P1-002 | Варп-переходы | `TC-P1-003: Navigate between systems` | ✅ |
| P1-003 | Туман войны | `TC-P1-005: Fog of war implemented` | ✅ |
| P1-004 | Тактический бой | `TC-P1-C001-003: Combat tests` | ✅ |
| P1-005 | Текстовые квесты | `TC-P1-004: System details` | ✅ |
| P1-006 | Инвентарь | `TC-P1-I001-004: Inventory tests` | ✅ |
| P1-007 | Сохранение/загрузка | `TC-P1-S001-003: Save/Load tests` | ✅ |

### Phase 2: MVP2 - «Живая галактика» (19 тестов)

| ID | Требование | Тест | Статус |
|----|------------|------|--------|
| P2-001 | Диалоговая модель | `TC-P2-D001-004: Dialogue tests` | ✅ |
| P2-002 | Тактический ИИ (PPO) | `TC-P2-A001-002: Tactical AI tests` | ✅ |
| P2-003 | Экономическая модель | `TC-P2-E001-004: Economic tests` | ✅ |
| P2-004 | Генератор контента (VAE) | `TC-P2-C001-002: Content generation` | ✅ |
| P2-005 | Реплики fallback | `TC-P2-D004: Fallback dialogue` | ✅ |
| P2-006 | Адаптивное качество | `TC-P2-Q001-002: Adaptive quality` | ✅ |
| P2-007 | Инвентарь и прогрессия | `TC-P2-I001-004: Inventory tests` | ✅ |

### Phase 3: Альфа-релиз (22 теста)

| ID | Требование | Тест | Статус |
|----|------------|------|--------|
| P3-001 | Глобальный ИИ врага | `TC-P3-G001-003: Global AI tests` | ✅ |
| P3-002 | Мета-прогрессия (фракции) | `TC-P3-M001-003: Meta-progression` | ✅ |
| P3-003 | Генератор событий | `TC-P3-E001-003: Event generator` | ✅ |
| P3-004 | Полноценный UI/UX | `TC-P3-U001-003: UI/UX tests` | ✅ |
| P3-005 | PWA и офлайн | `TC-P3-P001-003: PWA tests` | ✅ |
| P3-006 | Оптимизация (60 FPS) | `TC-P3-F001-003: Performance tests` | ✅ |
| P3-007 | Save system | `TC-P3-S001-002: Save system` | ✅ |

### Phase 4: Бета и релиз (22 теста)

| ID | Требование | Тест | Статус |
|----|------------|------|--------|
| P4-001 | Туториал | `TC-P4-T001-004: Tutorial tests` | ✅ |
| P4-002 | Монетизация (заглушка) | `TC-P4-M001-004: Monetization tests` | ✅ |
| P4-003 | Кросс-браузер | `TC-P4-C001-003: Cross-browser` | ✅ |
| P4-004 | Полный геймплейный цикл | `TC-P4-F001-002: Full journey` | ✅ |
| P4-005 | Регрессионная проверка | `TC-P4-R001-003: Regression suite` | ✅ |
| P4-006 | Performance baseline | `TC-P4-P001-003: Performance tests` | ✅ |
| P4-007 | AC validation | `AC-Phase*-***: Acceptance criteria` | ✅ |

**Итого: 83 E2E теста**

## Page Objects

### MainMenuPage
- `navigateTo()` - Запуск игры
- `clickNewGame()` - Новая игра
- `clickContinue()` - Продолжить
- `clickSettings()` - Настройки
- `expectNoWorkerErrors()` - Проверка workers

### StarMapPage
- `navigateFromMainMenu()` - Переход на карту
- `clickOnSystem(x, y)` - Клик по системе
- `navigateBetweenSystems()` - Навигация
- `triggerRandomEncounter()` - Случайная встреча
- `openSystemDetails()` - Детали системы

### CombatPage
- `expectHexGridVisible()` - Проверка гекс-сетки
- `selectPlayerAction(index)` - Выбор действия
- `executeAttack()` - Атака
- `waitForEnemyTurn()` - Ожидание хода врага
- `expectCombatEnded(victory)` - Конец боя

### InventoryPage
- `navigateFromStarMap()` - Открыть инвентарь
- `viewShipStats()` - Просмотр статистики
- `equipModule(index)` - Экипировка модуля
- `expectStatsUpdated()` - Проверка обновлений

### TradePage
- `navigateFromStarMap()` - Открыть торговлю
- `viewMarketPrices()` - Просмотр цен
- `buyResource(index, qty)` - Покупка
- `sellResource(index, qty)` - Продажа
- `expectCreditsUpdated()` - Проверка кредитов

## Тестовые данные

```typescript
// fixtures/game-fixtures.ts
export const testPlayers = {
  default: { name: 'Captain', race: 'Human', credits: 1000, ship: 'Ranger-1' },
  custom: { name: 'Star Voyager', race: 'Human', credits: 1000, ship: 'Explorer-X' },
};

export const testSaves = {
  slot1: { slot: 1, timestamp: Date.now(), playerName: 'Captain', system: 'Sol' },
  slot2: { slot: 2, timestamp: Date.now(), playerName: 'Explorer', system: 'Alpha Centauri' },
};
```

## Утилиты

### IndexedDB Helpers
- `checkIndexedDB(page)` - Проверка наличия БД
- `saveGameToIndexedDB(page, data)` - Сохранение игры
- `loadGameFromIndexedDB(page, slot)` - Загрузка игры

### Console Helpers
- `expectNoJavaScriptErrors(page)` - Проверка ошибок JS
- `collectAllConsoleMessages(page)` - Сбор всех сообщений
- `waitForConsoleMessage(page, text)` - Ожидание сообщения

## CI/CD Интеграция

```yaml
# .github/workflows/e2e-tests.yml
name: E2E Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  e2e-tests:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Install Playwright
        run: npx playwright install --with-deps
      
      - name: Build application
        run: npm run build
      
      - name: Run E2E tests
        run: npm run test:e2e
      
      - name: Upload test report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30
```

## Тестовые стратегии

### Happy Path Testing
Тестирование основных сценариев использования:
1. Запуск игры → Главное меню → Новая игра → Звёздная карта
2. Исследование систем → Бой → Награда → Инвентарь
3. Торговля → Сохранение → Перезагрузка → Загрузка

### Edge Case Testing
- Тестирование граничных условий
- Обработка ошибок
- Fallback механизмы

### Performance Testing
- Время загрузки < 10 сек
- Время переходов < 3 сек
- Стабильные 60 FPS
- Отсутствие утечек памяти

### Cross-Browser Testing
- Chromium ✓
- Firefox ✓
- WebKit ✓

## Quality Gates

### Перед merge в main:
- Все E2E тесты должны проходить ✅
- Покрытие acceptance criteria > 90%
- No critical JavaScript errors
- Performance baseline не деградировал

### Перед релизом:
- Все Phase 4 тесты проходят
- Кросс-браузерное тестирование завершено
- PWA полностью функционален
- Performance на целевых устройствах

## Maintenance

### При изменении требований:
1. Обновить SPDD prompt / REQ-001-base.md
2. Обновить соответствующие E2E тесты
3. Проверить матрицу трассируемости
4. Запустить полный регресс

### При изменении UI:
1. Обновить Page Objects
2. Обновить селекторы в тестах
3. Проверить все affected тесты

## Известные ограничения

1. **Canvas interaction**: UI рисуется в Canvas, клики по координатам
2. **Visual verification**: Некоторые проверки визуальные (canvas bounding box)
3. **ONNX models**: Реальные модели не включены, тесты проверяют интеграцию
4. **Timing**: Некоторые тесты используют `waitForTimeout` для стабильности

## Changelog

### v0.1.0 - Initial E2E Suite
- Created 83 E2E tests covering all phases
- Implemented Page Object Model
- Added comprehensive fixtures and utilities
- Created acceptance criteria traceability matrix

### v0.1.1 - Enhanced Coverage
- Added Phase 2 AI feature tests
- Added Phase 3 PWA and performance tests
- Added Phase 4 beta and regression tests
- Improved worker error detection
