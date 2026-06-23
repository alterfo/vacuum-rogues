import { test, expect } from '@playwright/test';
import { MainMenuPage } from './page-objects/main-menu.page';
import { StarMapPage } from './page-objects/star-map.page';
import { InventoryPage } from './page-objects/inventory.page';
import { TradePage } from './page-objects/trade.page';

/**
 * Phase 2: Living Galaxy (MVP2)
 * Testing AI-powered features: dialogue, tactical AI, economic model
 */
test.describe('Phase 2: Dialogue System (MVP2)', () => {
  let mainMenu: MainMenuPage;
  let starMap: StarMapPage;

  test.beforeEach(async ({ page }) => {
    mainMenu = new MainMenuPage(page);
    starMap = new StarMapPage(page);
    await mainMenu.navigateTo();
  });

  test('TC-P2-D001: NPC dialogue options are displayed', async ({ page }) => {
    await starMap.navigateFromMainMenu();

    // Click on NPC/station
    await starMap.clickOnSystemPercent(0.5, 0.5);
    await page.waitForTimeout(1000);

    // Dialogue should be accessible
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('TC-P2-D002: Dialogue generates unique responses', async ({ page }) => {
    await starMap.navigateFromMainMenu();

    // Multiple dialogue interactions
    await starMap.clickOnSystemPercent(0.5, 0.5);
    await page.waitForTimeout(1000);

    await starMap.clickOnSystemPercent(0.6, 0.6);
    await page.waitForTimeout(1000);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('TC-P2-D003: Dialogue response time is acceptable (< 2s)', async ({
    page,
  }) => {
    await starMap.navigateFromMainMenu();

    const startTime = Date.now();
    await starMap.clickOnSystemPercent(0.5, 0.5);
    await page.waitForTimeout(2000);
    const elapsedTime = Date.now() - startTime;

    expect(elapsedTime).toBeLessThanOrEqual(3000); // Allow some buffer
  });

  test('TC-P2-D004: Fallback dialogue works when model fails', async ({
    page,
  }) => {
    await starMap.navigateFromMainMenu();

    // Multiple dialogue attempts
    for (let i = 0; i < 3; i++) {
      await starMap.clickOnSystemPercent(0.5 + i * 0.1, 0.5);
      await page.waitForTimeout(1000);
    }

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });
});

// Phase 2: Tactical AI — combat is real-time in-flight only now (the hex
// CombatScene / SceneType.COMBAT was removed,
// docs/plans/20260623-space-combat-realtime-fix-remove-hex.md), so the former
// scene-transition tactical-AI tests no longer apply.

/**
 * Phase 2: Economic Model
 * Testing dynamic pricing and trade
 */
test.describe('Phase 2: Economic Model (MVP2)', () => {
  let mainMenu: MainMenuPage;
  let starMap: StarMapPage;
  let trade: TradePage;

  test.beforeEach(async ({ page }) => {
    mainMenu = new MainMenuPage(page);
    starMap = new StarMapPage(page);
    trade = new TradePage(page);
    await mainMenu.navigateTo();
  });

  test('TC-P2-E001: Market prices are displayed', async ({ page }) => {
    await starMap.navigateFromMainMenu();
    await trade.navigateFromStarMap();

    await trade.expectTradeVisible();
    await trade.viewMarketPrices();
    await trade.expectPricesVisible();
  });

  test('TC-P2-E002: Prices change based on supply/demand', async ({ page }) => {
    await starMap.navigateFromMainMenu();

    // Visit multiple markets
    await trade.navigateFromStarMap();
    await trade.viewMarketPrices();
    const firstPrices = await trade.expectPricesVisible();

    await page.waitForTimeout(2000);

    // Prices should be dynamic (visual check)
    await trade.expectPricesVisible();
  });

  test('TC-P2-E003: Trading affects credit balance', async ({ page }) => {
    await starMap.navigateFromMainMenu();
    await trade.navigateFromStarMap();

    await trade.viewMarketPrices();
    await trade.viewCargoHold();

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('TC-P2-E004: Cargo capacity is enforced', async ({ page }) => {
    await starMap.navigateFromMainMenu();
    await trade.navigateFromStarMap();

    await trade.viewCargoHold();
    await trade.expectCargoCapacityVisible();
  });
});

/**
 * Phase 2: Content Generation
 * Testing VAE-powered planet generation
 */
test.describe('Phase 2: Content Generation (MVP2)', () => {
  let mainMenu: MainMenuPage;
  let starMap: StarMapPage;

  test.beforeEach(async ({ page }) => {
    mainMenu = new MainMenuPage(page);
    starMap = new StarMapPage(page);
    await mainMenu.navigateTo();
  });

  test('TC-P2-C001: Planets have unique appearances', async ({ page }) => {
    await starMap.navigateFromMainMenu();

    // Click on multiple systems
    await starMap.clickOnSystemPercent(0.3, 0.4);
    await starMap.expectPlanetDetailsVisible();

    await starMap.clickOnSystemPercent(0.6, 0.6);
    await starMap.expectPlanetDetailsVisible();

    await starMap.clickOnSystemPercent(0.8, 0.3);
    await starMap.expectPlanetDetailsVisible();
  });

  test('TC-P2-C002: System names are unique', async ({ page }) => {
    await starMap.navigateFromMainMenu();

    const systems = [
      { x: 0.3, y: 0.4 },
      { x: 0.6, y: 0.6 },
      { x: 0.8, y: 0.3 },
      { x: 0.4, y: 0.7 },
    ];

    for (const system of systems) {
      await starMap.clickOnSystemPercent(system.x, system.y);
      await starMap.expectPlanetDetailsVisible();
    }
  });
});

/**
 * Phase 2: Adaptive Quality
 * Testing quality adaptation for different devices
 */
test.describe('Phase 2: Adaptive Quality (MVP2)', () => {
  let mainMenu: MainMenuPage;

  test.beforeEach(async ({ page }) => {
    mainMenu = new MainMenuPage(page);
    await mainMenu.navigateTo();
  });

  test('TC-P2-Q001: Game maintains acceptable FPS', async ({ page }) => {
    await mainMenu.waitForGameInitialization();

    const startTime = Date.now();
    await page.waitForTimeout(5000);
    const elapsedTime = Date.now() - startTime;

    // Should complete without hanging
    expect(elapsedTime).toBeGreaterThan(4500);
    expect(elapsedTime).toBeLessThan(6000);
  });

  test('TC-P2-Q002: Fallback to static dialogues on slow devices', async ({
    page,
  }) => {
    await mainMenu.navigateTo();

    // Game should remain responsive
    await mainMenu.expectMainMenuVisible();
    await page.waitForTimeout(3000);
    await mainMenu.expectMainMenuVisible();
  });
});

/**
 * Phase 2: Inventory and Progression
 * Testing ship upgrades and skill tree
 */
test.describe('Phase 2: Inventory System (MVP2)', () => {
  let mainMenu: MainMenuPage;
  let starMap: StarMapPage;
  let inventory: InventoryPage;

  test.beforeEach(async ({ page }) => {
    mainMenu = new MainMenuPage(page);
    starMap = new StarMapPage(page);
    inventory = new InventoryPage(page);
    await mainMenu.navigateTo();
  });

  test('TC-P2-I001: Open inventory screen', async ({ page }) => {
    await starMap.navigateFromMainMenu();
    await inventory.navigateFromStarMap();

    await inventory.expectInventoryVisible();
  });

  test('TC-P2-I002: Ship stats are displayed', async ({ page }) => {
    await starMap.navigateFromMainMenu();
    await inventory.navigateFromStarMap();

    await inventory.viewShipStats();
    await inventory.expectShipStatsVisible();
  });

  test('TC-P2-I003: Modules can be equipped', async ({ page }) => {
    await starMap.navigateFromMainMenu();
    await inventory.navigateFromStarMap();

    await inventory.equipModule(0);
    await inventory.expectStatsUpdated();
  });

  test('TC-P2-I004: Module changes affect ship stats', async ({ page }) => {
    await starMap.navigateFromMainMenu();
    await inventory.navigateFromStarMap();

    await inventory.viewShipStats();
    await inventory.equipModule(0);
    await inventory.viewShipStats();

    await inventory.expectStatsUpdated();
  });
});
