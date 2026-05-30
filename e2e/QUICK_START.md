# E2E Test Suite - Quick Start Guide

## 🚀 Быстрый старт

### Установка зависимостей

```bash
npm install
npx playwright install --with-deps
```

### Запуск тестов

```bash
# Все тесты во всех браузерах (headless)
npm run test:e2e

# Конкретная фаза
npm run test:e2e -- phase-0-1-prototype.spec.ts

# Конкретный тест по ID
npm run test:e2e -- --grep "TC-P1-001"

# UI режим (interactive)
npm run test:e2e:ui

# Headed режим (с видимым браузером)
npm run test:e2e:headed

# Отладка
npm run test:e2e:debug
```

### Просмотр отчетов

```bash
# HTML отчет
npm run test:e2e:report

# Открывается в браузере с детальными результатами
```

---

## 📊 Обзор тестовой сессии

### Статистика

- **Всего тестов**: 83 E2E теста
- **Page Objects**: 6 классов
- **Покрытие требований**: 98% (50/51 AC)
- **Браузеры**: Chromium, Firefox, WebKit

### Фазы покрытия

| Фаза | Описание | Тестов | AC покрытие |
|------|----------|--------|-------------|
| Phase 0 | Technical Prototype | 6 | 100% |
| Phase 1 | MVP1 - Один в космосе | 14 | 100% |
| Phase 2 | MVP2 - Живая галактика | 19 | 100% |
| Phase 3 | Альфа - Neural Onslaught | 22 | 93% |
| Phase 4 | Бета и релиз | 22 | 100% |

---

## 📁 Структура проекта

```
e2e/
├── page-objects/              # Page Object Model
│   ├── base.page.ts          # Базовый класс
│   ├── main-menu.page.ts     # Главное меню
│   ├── star-map.page.ts      # Звёздная карта
│   ├── combat.page.ts        # Тактический бой
│   ├── inventory.page.ts     # Инвентарь
│   └── trade.page.ts         # Торговля
│
├── fixtures/                  # Тестовые данные
│   └── game-fixtures.ts      # Players, saves, утилиты
│
├── phase-0-1-prototype.spec.ts          # Phase 0-1 тесты
├── phase-2-living-galaxy.spec.ts        # Phase 2 тесты
├── phase-3-neural-onslaught.spec.ts     # Phase 3 тесты
├── phase-4-beta-release.spec.ts         # Phase 4 тесты
│
├── E2E_TEST_DOCUMENTATION.md            # Полная документация
├── acceptance-criteria-matrix.md        # Матрица трассируемости
└── QUICK_START.md                       # Этот файл
```

---

## 🧪 Примеры тестов

### Базовый тест

```typescript
import { test, expect } from '@playwright/test';
import { MainMenuPage } from '../page-objects/main-menu.page';

test.describe('Game Launch', () => {
  test('should load and display main menu', async ({ page }) => {
    const mainMenu = new MainMenuPage(page);
    await mainMenu.navigateTo();
    
    await mainMenu.expectMainMenuVisible();
    await expect(page).toHaveTitle(/Space Rangers/);
  });
});
```

### Тест с несколькими страницами

```typescript
test('complete gameplay loop', async ({ page }) => {
  const mainMenu = new MainMenuPage(page);
  const starMap = new StarMapPage(page);
  const combat = new CombatPage(page);
  
  // Launch
  await mainMenu.navigateTo();
  
  // New game
  await mainMenu.clickNewGame();
  await starMap.expectStarMapVisible();
  
  // Combat
  await starMap.triggerRandomEncounter();
  await combat.expectCombatVisible();
});
```

---

## 🔧 Page Objects API

### MainMenuPage

```typescript
const mainMenu = new MainMenuPage(page);

await mainMenu.navigateTo();              // Перейти на главное меню
await mainMenu.clickNewGame();            // Клик "Новая игра"
await mainMenu.clickContinue();           // Клик "Продолжить"
await mainMenu.expectMainMenuVisible();   // Проверка видимости
await mainMenu.expectNoWorkerErrors();    // Проверка workers
```

### StarMapPage

```typescript
const starMap = new StarMapPage(page);

await starMap.navigateFromMainMenu();     // Переход с меню
await starMap.clickOnSystem(300, 200);    // Клик по системе
await starMap.clickOnSystemPercent(0.5, 0.5); // Клик по %
await starMap.triggerRandomEncounter();   // Случайная встреча
await starMap.openSystemDetails();        // Открыть детали
await starMap.expectStarMapVisible();     // Проверка карты
```

### CombatPage

```typescript
const combat = new CombatPage(page);

await combat.expectCombatVisible();       // Проверка боя
await combat.expectHexGridVisible();      // Проверка сетки
await combat.selectPlayerAction(0);       // Выбор действия
await combat.executeAttack();             // Атака
await combat.waitForEnemyTurn(3000);      // Ожидание врага
await combat.expectCombatEnded(true);     // Конец боя
```

### InventoryPage

```typescript
const inventory = new InventoryPage(page);

await inventory.navigateFromStarMap();    // Открыть инвентарь
await inventory.viewShipStats();          // Просмотр статистики
await inventory.equipModule(0);           // Экипировка
await inventory.expectStatsUpdated();     // Проверка обновлений
await inventory.closeInventory();         // Закрыть инвентарь
```

### TradePage

```typescript
const trade = new TradePage(page);

await trade.navigateFromStarMap();        // Открыть торговлю
await trade.viewMarketPrices();           // Просмотр цен
await trade.buyResource(0, 10);           // Покупка
await trade.sellResource(0, 5);           // Продажа
await trade.expectPricesVisible();        // Проверка цен
```

---

## 📋 Написание новых тестов

### Шаблон теста

```typescript
import { test, expect } from '@playwright/test';
import { MainMenuPage } from '../page-objects/main-menu.page';

test.describe('Feature Name', () => {
  let mainMenu: MainMenuPage;

  test.beforeEach(async ({ page }) => {
    mainMenu = new MainMenuPage(page);
    await mainMenu.navigateTo();
  });

  test('TC-XXX: Test descriptive name', async ({ page }) => {
    // Given - initial state
    await mainMenu.expectMainMenuVisible();

    // When - user action
    await mainMenu.clickNewGame();

    // Then - expected outcome
    await page.waitForTimeout(2000);
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });
});
```

### Naming conventions

```
TC-{PHASE}-{CATEGORY}{NUMBER}: Descriptive name

PHASE: P0, P1, P2, P3, P4
CATEGORY:
  - D = Dialogue
  - A = AI
  - E = Economy
  - C = Combat
  - I = Inventory
  - T = Trade
  - S = Save
  - U = UI
  - F = Full Journey
  - R = Regression
```

---

## 🐛 Troubleshooting

### Тесты не находят canvas

```typescript
// Убедитесь, что ждёте инициализации
await page.waitForSelector('canvas', { timeout: 10000 });
await page.waitForTimeout(3000); // Дать время на рендеринг
```

### Worker MIME type errors

```typescript
// Проверка в логах
await mainMenu.expectNoWorkerErrors();

// Убедитесь, что workers правильно сконфигурированы
// в vite.config.ts и main.ts
```

### Тесты нестабильны

```typescript
// Добавьте больше времени ожидания
await page.waitForTimeout(5000);

// Используйте explicit waits
await page.waitForSelector('.element', { state: 'visible' });
```

### IndexedDB не доступен

```typescript
// Проверьте поддержку в браузере
test.skip(browserName === 'webkit', 'WebKit may have limitations');

// Используйте утилиту
const dbStatus = await checkIndexedDB(page);
```

---

## 📊 CI/CD Integration

### GitHub Actions

Тесты автоматически запускаются при:
- Push в `main` или `develop`
- Pull Request в `main`

```yaml
# .github/workflows/e2e-tests.yml
- name: Run E2E tests
  run: npm run test:e2e
```

### Локальный запуск перед PR

```bash
# Запустить все тесты
npm run test:e2e

# Проверить линтинг
npm run lint

# Запустить unit тесты
npm test -- --run
```

---

## 📚 Дополнительная документация

- [Полная документация](./E2E_TEST_DOCUMENTATION.md)
- [Матрица трассируемости](./acceptance-criteria-matrix.md)
- [Playwright Documentation](https://playwright.dev)

---

## ✅ Checklist перед merge

- [ ] Все E2E тесты проходят
- [ ] Покрытие AC > 90%
- [ ] Нет критических JavaScript ошибок
- [ ] Performance baseline не деградировал
- [ ] Page Objects обновлены при изменении UI
- [ ] Документация актуальна

---

## 🤝 Contributing

При добавлении новых тестов:
1. Следуйте существующим паттернам Page Object Model
2. Используйте семантические имена тестов (TC-XXX)
3. Обновите матрицу трассируемости
4. Добавьте описание в документацию
5. Проверьте на всех браузерах

---

**Last Updated**: 2026-01-15  
**Test Suite Version**: 0.1.1  
**Coverage**: 98% (50/51 AC)
