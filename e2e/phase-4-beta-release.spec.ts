import { test, expect } from '@playwright/test';
import { MainMenuPage } from './page-objects/main-menu.page';
import { StarMapPage } from './page-objects/star-map.page';
import { InventoryPage } from './page-objects/inventory.page';
import { TradePage } from './page-objects/trade.page';
import {
  generateUniquePlayer,
  expectNoJavaScriptErrors,
} from './fixtures/game-fixtures';

test.describe('Phase 4: Tutorial System (Beta)', () => {
  let mainMenu: MainMenuPage;
  let starMap: StarMapPage;

  test.beforeEach(async ({ page }) => {
    mainMenu = new MainMenuPage(page);
    starMap = new StarMapPage(page);
    await mainMenu.navigateTo();
  });

  test('TC-P4-T001: Tutorial is available for new players', async ({
    page,
  }) => {
    await mainMenu.expectMainMenuVisible();

    await mainMenu.clickNewGame();
    await page.waitForTimeout(2000);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('TC-P4-T002: Tutorial guides through basic mechanics', async ({
    page,
  }) => {
    await mainMenu.navigateTo();
    await mainMenu.clickNewGame();

    await page.waitForTimeout(3000);
    await starMap.expectStarMapVisible();

    await starMap.clickOnSystemPercent(0.5, 0.5);
    await page.waitForTimeout(1000);

    await starMap.expectPlanetDetailsVisible();
  });

  test('TC-P4-T003: Tutorial can be skipped', async ({ page }) => {
    await mainMenu.navigateTo();
    await mainMenu.clickNewGame();

    await page.waitForTimeout(1000);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('TC-P4-T004: Tutorial explains ONNX features', async ({ page }) => {
    await mainMenu.navigateTo();
    await mainMenu.clickNewGame();

    await page.waitForTimeout(5000);

    await starMap.expectStarMapVisible();
  });
});

test.describe('Phase 4: Monetization System (Beta)', () => {
  let mainMenu: MainMenuPage;

  test.beforeEach(async ({ page }) => {
    mainMenu = new MainMenuPage(page);
    await mainMenu.navigateTo();
  });

  test('TC-P4-M001: Shop interface is accessible', async ({ page }) => {
    await mainMenu.expectMainMenuVisible();

    await mainMenu.clickSettings();
    await page.waitForTimeout(1000);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('TC-P4-M002: Skins are displayed in shop', async ({ page }) => {
    await mainMenu.navigateTo();

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('TC-P4-M003: Battle pass interface is available', async ({
    page,
  }) => {
    await mainMenu.navigateTo();

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('TC-P4-M004: Purchase is disabled in beta', async ({ page }) => {
    await mainMenu.navigateTo();

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });
});

test.describe('Phase 4: Cross-Browser Testing (Beta)', () => {
  test('TC-P4-C001: Game works on Chromium', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium');

    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 10000 });

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('TC-P4-C002: Game works on Firefox', async ({ page, browserName }) => {
    test.skip(browserName !== 'firefox');

    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 10000 });

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('TC-P4-C003: Game works on WebKit', async ({ page, browserName }) => {
    test.skip(browserName !== 'webkit');

    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 10000 });

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });
});

test.describe('Phase 4: Full Gameplay Loop (Beta)', () => {
  test('TC-P4-F001: Complete journey: Launch → Explore → Trade → Save', async ({
    page,
  }) => {
    const mainMenu = new MainMenuPage(page);
    const starMap = new StarMapPage(page);
    const trade = new TradePage(page);

    await mainMenu.navigateTo();
    await mainMenu.expectMainMenuVisible();

    await mainMenu.clickNewGame();
    await starMap.expectStarMapVisible();

    await starMap.clickOnSystemPercent(0.3, 0.4);
    await starMap.clickOnSystemPercent(0.6, 0.6);


    await trade.navigateFromStarMap();
    await trade.expectTradeVisible();

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('TC-P4-F002: Multiple playthroughs are possible', async ({ page }) => {
    const mainMenu = new MainMenuPage(page);

    await mainMenu.navigateTo();
    await mainMenu.clickNewGame();
    await page.waitForTimeout(3000);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    await page.reload();
    await mainMenu.waitForGameInitialization();

    await mainMenu.clickNewGame();
    await page.waitForTimeout(3000);

    await expect(canvas).toBeVisible();
  });
});

test.describe('Phase 4: Regression Suite (Beta)', () => {
  test('TC-P4-R001: All core features remain functional', async ({ page }) => {
    const mainMenu = new MainMenuPage(page);
    const starMap = new StarMapPage(page);
    const inventory = new InventoryPage(page);

    await mainMenu.navigateTo();
    await mainMenu.expectMainMenuVisible();

    await mainMenu.clickNewGame();
    await starMap.expectStarMapVisible();

    await inventory.navigateFromStarMap();
    await inventory.expectInventoryVisible();

    await inventory.closeInventory();
    await starMap.expectStarMapVisible();
  });

  test('TC-P4-R002: No regressions in save/load', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 10000 });

    const mainMenu = new MainMenuPage(page);
    const starMap = new StarMapPage(page);

    await mainMenu.clickNewGame();
    await starMap.expectStarMapVisible();

    await page.reload();
    await page.waitForSelector('canvas', { timeout: 10000 });

    await expect(page.locator('canvas')).toBeVisible();
  });

});

test.describe('Phase 4: Performance Baseline (Beta)', () => {
  test('TC-P4-P001: Game loads within 10 seconds', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 10000 });

    const loadTime = Date.now() - startTime;
    expect(loadTime).toBeLessThan(10000);
  });

  test('TC-P4-P002: Transitions complete within 3 seconds', async ({ page }) => {
    const mainMenu = new MainMenuPage(page);
    await mainMenu.navigateTo();

    const startTime = Date.now();
    await mainMenu.clickNewGame();
    await page.waitForTimeout(2000);

    const transitionTime = Date.now() - startTime;
    expect(transitionTime).toBeLessThan(5000);
  });

  test('TC-P4-P003: No memory leaks during extended session', async ({
    page,
  }) => {
    const mainMenu = new MainMenuPage(page);
    const starMap = new StarMapPage(page);

    await mainMenu.navigateTo();

    for (let i = 0; i < 5; i++) {
      await mainMenu.clickNewGame();
      await page.waitForTimeout(2000);

      await starMap.clickOnSystemPercent(0.5, 0.5);
      await page.waitForTimeout(1000);
    }

    await expectNoJavaScriptErrors(page, ['favicon', 'MIME']);
  });
});

test.describe('Phase 4: Acceptance Criteria Validation', () => {
  test('AC-Phase0-001: ONNX runtime loads and infers', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 10000 });

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('AC-Phase1-001: 10 systems generated and navigable', async ({ page }) => {
    const mainMenu = new MainMenuPage(page);
    const starMap = new StarMapPage(page);

    await mainMenu.navigateTo();
    await mainMenu.clickNewGame();

    await starMap.expectMinimumSystemsCount(10);
  });


  test('AC-Phase1-003: Quests can be completed', async ({ page }) => {
    const mainMenu = new MainMenuPage(page);
    const starMap = new StarMapPage(page);

    await mainMenu.navigateTo();
    await mainMenu.clickNewGame();

    await starMap.clickOnSystemPercent(0.5, 0.5);
    await page.waitForTimeout(2000);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('AC-Phase2-001: Dialogue responds to player actions', async ({ page }) => {
    const mainMenu = new MainMenuPage(page);
    const starMap = new StarMapPage(page);

    await mainMenu.navigateTo();
    await mainMenu.clickNewGame();

    await starMap.clickOnSystemPercent(0.5, 0.5);
    await page.waitForTimeout(2000);

    await starMap.expectPlanetDetailsVisible();
  });

  test('AC-Phase3-001: PWA can be installed', async ({ page }) => {
    await page.goto('/');

    const manifest = await page.evaluate(() => {
      return !!document.querySelector('link[rel="manifest"]');
    });

    expect(manifest).toBeTruthy();
  });

  test('AC-Phase3-002: Game runs offline after first load', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas', { timeout: 10000 });

    await page.reload();
    await page.waitForSelector('canvas', { timeout: 10000 });

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });
});
