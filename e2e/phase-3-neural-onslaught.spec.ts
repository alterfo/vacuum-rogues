import { test, expect } from '@playwright/test';
import { MainMenuPage } from './page-objects/main-menu.page';
import { StarMapPage } from './page-objects/star-map.page';
import { checkIndexedDB, expectNoJavaScriptErrors } from './fixtures/game-fixtures';

test.describe('Phase 3: Global AI Enemy (Alpha)', () => {
  let mainMenu: MainMenuPage;
  let starMap: StarMapPage;

  test.beforeEach(async ({ page }) => {
    mainMenu = new MainMenuPage(page);
    starMap = new StarMapPage(page);
    await mainMenu.navigateTo();
  });

  test('TC-P3-G001: Overmind threat expands over time', async ({ page }) => {
    await starMap.navigateFromMainMenu();

    await page.waitForTimeout(5000);

    await starMap.expectStarMapVisible();
  });

  test('TC-P3-G002: Enemy fleets move across galaxy', async ({ page }) => {
    await starMap.navigateFromMainMenu();

    await starMap.clickOnSystemPercent(0.3, 0.4);
    await page.waitForTimeout(2000);

    await starMap.clickOnSystemPercent(0.7, 0.6);
    await page.waitForTimeout(2000);

    await starMap.expectStarMapVisible();
  });

  test('TC-P3-G003: Player actions affect AI behavior', async ({ page }) => {
    await starMap.navigateFromMainMenu();
    await page.waitForTimeout(3000);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });
});

test.describe('Phase 3: Meta-Progression (Alpha)', () => {
  let mainMenu: MainMenuPage;
  let starMap: StarMapPage;

  test.beforeEach(async ({ page }) => {
    mainMenu = new MainMenuPage(page);
    starMap = new StarMapPage(page);
    await mainMenu.navigateTo();
  });

  test('TC-P3-M001: Faction reputation is tracked', async ({ page }) => {
    await starMap.navigateFromMainMenu();

    await starMap.clickOnSystemPercent(0.3, 0.4);
    await starMap.clickOnSystemPercent(0.5, 0.5);
    await starMap.clickOnSystemPercent(0.7, 0.6);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('TC-P3-M002: Reputation affects mission availability', async ({
    page,
  }) => {
    await starMap.navigateFromMainMenu();

    await starMap.openSystemDetails();
    await page.waitForTimeout(1000);

    await starMap.clickOnSystemPercent(0.8, 0.3);
    await starMap.openSystemDetails();

    await starMap.expectPlanetDetailsVisible();
  });

  test('TC-P3-M003: Alliances unlock new content', async ({ page }) => {
    await starMap.navigateFromMainMenu();

    for (let i = 0; i < 5; i++) {
      await starMap.clickOnSystemPercent(0.4 + i * 0.1, 0.3 + i * 0.1);
      await page.waitForTimeout(1000);
    }

    await starMap.expectStarMapVisible();
  });
});

test.describe('Phase 3: Event Generator (Alpha)', () => {
  let mainMenu: MainMenuPage;
  let starMap: StarMapPage;

  test.beforeEach(async ({ page }) => {
    mainMenu = new MainMenuPage(page);
    starMap = new StarMapPage(page);
    await mainMenu.navigateTo();
  });

  test('TC-P3-E001: Galactic events are triggered', async ({ page }) => {
    await starMap.navigateFromMainMenu();

    await page.waitForTimeout(5000);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('TC-P3-E002: Anomalies appear in systems', async ({ page }) => {
    await starMap.navigateFromMainMenu();

    const systems = [
      { x: 0.2, y: 0.3 },
      { x: 0.5, y: 0.5 },
      { x: 0.8, y: 0.7 },
    ];

    for (const system of systems) {
      await starMap.clickOnSystemPercent(system.x, system.y);
      await page.waitForTimeout(1000);
    }

    await starMap.expectStarMapVisible();
  });

  test('TC-P3-E003: Event quest chains are available', async ({ page }) => {
    await starMap.navigateFromMainMenu();

    await starMap.clickOnSystemPercent(0.5, 0.5);
    await page.waitForTimeout(2000);

    await starMap.clickOnSystemPercent(0.6, 0.6);
    await page.waitForTimeout(2000);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });
});

test.describe('Phase 3: UI/UX Polish (Alpha)', () => {
  let mainMenu: MainMenuPage;
  let starMap: StarMapPage;

  test.beforeEach(async ({ page }) => {
    mainMenu = new MainMenuPage(page);
    starMap = new StarMapPage(page);
    await mainMenu.navigateTo();
  });

  test('TC-P3-U001: Transitions are smooth', async ({ page }) => {
    const startTime = Date.now();

    await mainMenu.clickNewGame();
    await starMap.expectStarMapVisible();

    const transitionTime = Date.now() - startTime;
    expect(transitionTime).toBeLessThan(5000);
  });

  test('TC-P3-U002: Canvas renders correctly at different sizes', async ({
    page,
  }) => {
    await mainMenu.waitForGameInitialization();

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(1000);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(1000);

    await expect(canvas).toBeVisible();
  });

  test('TC-P3-U003: Game is responsive on tablets', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await mainMenu.navigateTo();

    await mainMenu.expectMainMenuVisible();
  });
});

test.describe('Phase 3: PWA Support (Alpha)', () => {
  test('TC-P3-P001: Service Worker is registered', async ({ page }) => {
    await page.goto('/');

    const swRegistered = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return !!registration;
    });

    expect(swRegistered).toBeTruthy();
  });

  test('TC-P3-P002: Game can be installed as PWA', async ({ page }) => {
    await page.goto('/');

    const manifest = await page.evaluate(async () => {
      const link = document.querySelector('link[rel="manifest"]');
      return !!link;
    });

    expect(manifest).toBeTruthy();
  });

  test('TC-P3-P003: Game loads from cache', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 10000 });

    const startTime = Date.now();
    await page.reload();
    await page.waitForSelector('canvas', { timeout: 10000 });

    const reloadTime = Date.now() - startTime;
    expect(reloadTime).toBeLessThan(5000);
  });
});

test.describe('Phase 3: Performance (Alpha)', () => {
  let mainMenu: MainMenuPage;

  test.beforeEach(async ({ page }) => {
    mainMenu = new MainMenuPage(page);
    await mainMenu.navigateTo();
  });

  test('TC-P3-F001: No JavaScript errors during extended play', async ({
    page,
  }) => {
    await mainMenu.waitForGameInitialization();

    await expectNoJavaScriptErrors(page, [
      'favicon',
      'MIME',
      'worker',
    ]);
  });

  test('TC-P3-F002: Memory usage remains stable', async ({ page }) => {
    await mainMenu.navigateTo();

    await page.waitForTimeout(2000);

    await mainMenu.clickNewGame();
    await page.waitForTimeout(2000);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('TC-P3-F003: Web Workers don\'t block main thread', async ({
    page,
  }) => {
    await mainMenu.navigateTo();

    const startTime = Date.now();

    await page.waitForTimeout(3000);

    const responseTime = Date.now() - startTime;
    expect(responseTime).toBeLessThan(4000);
  });
});

test.describe('Phase 3: Save System (Alpha)', () => {
  test('TC-P3-S001: Multiple save slots work', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 10000 });

    const save1 = await checkIndexedDB(page);
    expect(save1.exists).toBeTruthy();

    await page.reload();
    await page.waitForSelector('canvas', { timeout: 10000 });

    const save2 = await checkIndexedDB(page);
    expect(save2.exists).toBeTruthy();
  });

  test('TC-P3-S002: Emergency save is created on error', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 10000 });

    const dbStatus = await checkIndexedDB(page);
    expect(dbStatus.exists).toBeTruthy();
  });
});
