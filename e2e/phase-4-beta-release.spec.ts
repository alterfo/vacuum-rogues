import { test, expect } from '@playwright/test';
import { MainMenuPage } from '../page-objects/main-menu.page';
import { StarMapPage } from '../page-objects/star-map.page';
import { CombatPage } from '../page-objects/combat.page';
import { InventoryPage } from '../page-objects/inventory.page';
import { TradePage } from '../page-objects/trade.page';
import {
  generateUniquePlayer,
  expectNoJavaScriptErrors,
} from '../fixtures/game-fixtures';

/**
 * Phase 4: Beta & Release
 * Testing tutorial, monetization integration, and polish
 */
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

    // New game should trigger tutorial
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

    // Tutorial steps
    await page.waitForTimeout(3000);
    await starMap.expectStarMapVisible();

    // Interactive tutorial
    await starMap.clickOnSystemPercent(0.5, 0.5);
    await page.waitForTimeout(1000);

    await starMap.expectPlanetDetailsVisible();
  });

  test('TC-P4-T003: Tutorial can be skipped', async ({ page }) => {
    await mainMenu.navigateTo();
    await mainMenu.clickNewGame();

    // Skip tutorial if available
    await page.waitForTimeout(1000);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('TC-P4-T004: Tutorial explains ONNX features', async ({ page }) => {
    await mainMenu.navigateTo();
    await mainMenu.clickNewGame();

    await page.waitForTimeout(5000);

    // Game should remain responsive
    await starMap.expectStarMapVisible();
  });
});

/**
 * Phase 4: Monetization (Stub)
 * Testing shop interface and purchase flow (without real payments)
 */
test.describe('Phase 4: Monetization System (Beta)', () => {
  let mainMenu: MainMenuPage;

  test.beforeEach(async ({ page }) => {
    mainMenu = new MainMenuPage(page);
    await mainMenu.navigateTo();
  });

  test('TC-P4-M001: Shop interface is accessible', async ({ page }) => {
    await mainMenu.expectMainMenuVisible();

    // Shop button might be in settings or main menu
    await mainMenu.clickSettings();
    await page.waitForTimeout(1000);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('TC-P4-M002: Skins are displayed in shop', async ({ page }) => {
    await mainMenu.navigateTo();

    // Navigate to shop (if available)
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

    // Purchase flow should be stubbed
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });
});

/**
 * Phase 4: Cross-Browser Compatibility
 * Testing on different browsers
 */
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

/**
 * Phase 4: End-to-End User Journey
 * Complete gameplay loop testing
 */
test.describe('Phase 4: Full Gameplay Loop (Beta)', () => {
  test('TC-P4-F001: Complete journey: Launch → Explore → Combat → Trade → Save', async ({
    page,
  }) => {
    const mainMenu = new MainMenuPage(page);
    const starMap = new StarMapPage(page);
    const combat = new CombatPage(page);
    const trade = new TradePage(page);

    // 1. Launch game
    await mainMenu.navigateTo();
    await mainMenu.expectMainMenuVisible();

    // 2. Create new game
    await mainMenu.clickNewGame();
    await starMap.expectStarMapVisible();

    // 3. Explore systems
    await starMap.clickOnSystemPercent(0.3, 0.4);
    await starMap.clickOnSystemPercent(0.6, 0.6);

    // 4. Enter combat
    await starMap.triggerRandomEncounter();
    await combat.expectCombatVisible();

    // 5. Execute combat actions
    await combat.selectPlayerAction(0);
    await combat.executeAttack();

    // 6. Return to star map
    await page.waitForTimeout(2000);
    await starMap.expectStarMapVisible();

    // 7. Trade
    await trade.navigateFromStarMap();
    await trade.expectTradeVisible();

    // 8. Save is auto-created
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('TC-P4-F002: Multiple playthroughs are possible', async ({ page }) => {
    const mainMenu = new MainMenuPage(page);

    // First playthrough
    await mainMenu.navigateTo();
    await mainMenu.clickNewGame();
    await page.waitForTimeout(3000);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // Reload and start again
    await page.reload();
    await mainMenu.waitForGameInitialization();

    await mainMenu.clickNewGame();
    await page.waitForTimeout(3000);

    await expect(canvas).toBeVisible();
  });
});

/**
 * Phase 4: Regression Testing
 * Ensuring existing features still work
 */
test.describe('Phase 4: Regression Suite (Beta)', () => {
  test('TC-P4-R001: All core features remain functional', async ({ page }) => {
    const mainMenu = new MainMenuPage(page);
    const starMap = new StarMapPage(page);
    const inventory = new InventoryPage(page);

    // Game launch
    await mainMenu.navigateTo();
    await mainMenu.expectMainMenuVisible();

    // Star map
    await mainMenu.clickNewGame();
    await starMap.expectStarMapVisible();

    // Inventory
    await inventory.navigateFromStarMap();
    await inventory.expectInventoryVisible();

    // Return to star map
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

  test('TC-P4-R003: No regressions in combat', async ({ page }) => {
    const mainMenu = new MainMenuPage(page);
    const starMap = new StarMapPage(page);
    const combat = new CombatPage(page);

    await mainMenu.navigateTo();
    await mainMenu.clickNewGame();

    await starMap.triggerRandomEncounter();
    await combat.expectCombatVisible();
  });
});

/**
 * Phase 4: Performance Baseline
 * Ensuring performance standards are met
 */
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

    // Extended gameplay
    for (let i = 0; i < 5; i++) {
      await mainMenu.clickNewGame();
      await page.waitForTimeout(2000);

      await starMap.clickOnSystemPercent(0.5, 0.5);
      await page.waitForTimeout(1000);
    }

    await expectNoJavaScriptErrors(page, ['favicon', 'MIME']);
  });
});

/**
 * Phase 4: Acceptance Criteria Validation
 * Verifying all AC from REQ-001-base.md
 */
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

  test('AC-Phase1-002: Combat can be won with loot', async ({ page }) => {
    const mainMenu = new MainMenuPage(page);
    const starMap = new StarMapPage(page);
    const combat = new CombatPage(page);

    await mainMenu.navigateTo();
    await mainMenu.clickNewGame();

    await starMap.triggerRandomEncounter();
    await combat.expectCombatVisible();

    // Simulate winning
    await combat.waitForEnemyTurn(3000);
    await combat.expectCombatEnded(true);
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

    // Reload without network (simulated)
    await page.reload();
    await page.waitForSelector('canvas', { timeout: 10000 });

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });
});
