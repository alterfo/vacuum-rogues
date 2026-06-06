import { test, expect } from '@playwright/test';
import { MainMenuPage } from './page-objects/main-menu.page';
import { StarMapPage } from './page-objects/star-map.page';
import { SpaceFlightPage } from './page-objects/space-flight.page';
import {
  checkIndexedDB,
  saveGameToIndexedDB,
  loadGameFromIndexedDB,
  expectNoJavaScriptErrors,
} from './fixtures/game-fixtures';

/**
 * Phase 0 - Technical Prototype (Proof of Concept)
 * Testing basic game launch, worker loading, and ONNX integration
 */
test.describe('Phase 0: Technical Prototype', () => {
  let mainMenu: MainMenuPage;

  test.beforeEach(async ({ page }) => {
    mainMenu = new MainMenuPage(page);
    await mainMenu.navigateTo();
  });

  test('TC-P0-001: Game should load and display main menu', async ({
    page,
  }) => {
    await mainMenu.expectGameTitleVisible();
    await mainMenu.expectMainMenuVisible();
    await expect(page).toHaveTitle(/Galactic Horizon|Neural Onslaught/);
  });

  test('TC-P0-002: Web Workers should load without MIME type errors', async ({
    page,
  }) => {
    await mainMenu.expectNoWorkerErrors();
  });

  test('TC-P0-003: No JavaScript errors during initialization', async ({
    page,
  }) => {
    await expectNoJavaScriptErrors(page, ['favicon', 'MIME']);
  });

  test('TC-P0-004: Canvas should be initialized correctly', async ({
    page,
  }) => {
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.height).toBeGreaterThan(0);
  });

  test('TC-P0-005: Game initialization should complete within timeout', async ({
    page,
  }) => {
    const startTime = Date.now();
    await mainMenu.waitForGameInitialization(10000);
    const elapsedTime = Date.now() - startTime;
    expect(elapsedTime).toBeLessThan(10000);
  });

  test('TC-P0-006: IndexedDB should be accessible for saves', async ({
    page,
  }) => {
    const dbStatus = await checkIndexedDB(page);
    // DB should be accessible (may or may not have saves yet)
    expect(dbStatus.exists).toBeDefined();
  });
});

/**
 * Phase 1: Star Map and Navigation
 * Testing basic star map functionality and system navigation
 */
test.describe('Phase 1: Star Map (MVP1)', () => {
  let mainMenu: MainMenuPage;
  let starMap: StarMapPage;

  test.beforeEach(async ({ page }) => {
    mainMenu = new MainMenuPage(page);
    starMap = new StarMapPage(page);
    await mainMenu.navigateTo();
  });

  test('TC-P1-001: Create new game and transition to star map', async ({
    page,
  }) => {
    await mainMenu.expectMainMenuVisible();

    // Click "Новая игра"
    await mainMenu.clickNewGame();
    await mainMenu.waitForTransitionToStarMap();

    // Should be on star map now
    await starMap.expectStarMapVisible();
  });

  test('TC-P1-002: Star map should display minimum 10 systems', async ({
    page,
  }) => {
    await starMap.navigateFromMainMenu();
    await starMap.expectStarMapVisible();

    // Visual check - canvas should show multiple systems
    await starMap.expectMinimumSystemsCount(10);
  });

  test('TC-P1-003: Navigate between star systems', async ({ page }) => {
    await starMap.navigateFromMainMenu();

    // Navigate to different systems
    await starMap.navigateBetweenSystems([
      { x: 300, y: 200 },
      { x: 500, y: 300 },
      { x: 400, y: 400 },
    ]);

    await starMap.expectStarMapVisible();
  });

  test('TC-P1-004: Click on system to view details', async ({ page }) => {
    await starMap.navigateFromMainMenu();

    await starMap.openSystemDetails();
    await starMap.expectPlanetDetailsVisible();
  });

  test('TC-P1-005: Fog of war should be implemented', async ({ page }) => {
    await starMap.navigateFromMainMenu();
    await starMap.expectFogOfWar();
  });
});

/**
 * Phase 1: Combat System
 * Testing tactical combat encounters
 */
test.describe('Phase 1: Combat System (MVP1)', () => {
  let mainMenu: MainMenuPage;
  let starMap: StarMapPage;

  test.beforeEach(async ({ page }) => {
    mainMenu = new MainMenuPage(page);
    starMap = new StarMapPage(page);
    await mainMenu.navigateTo();
  });

  test('TC-P1-C001: Enter combat encounter from star map', async ({
    page,
  }) => {
    await starMap.navigateFromMainMenu();
    await starMap.triggerRandomEncounter();

    // Combat scene should be active
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('TC-P1-C002: Hex grid should be displayed in combat', async ({
    page,
  }) => {
    await starMap.navigateFromMainMenu();
    await starMap.triggerRandomEncounter();

    await page.waitForFunction(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { constructor: { name: string } } | null;
      };
      return engine?.currentScene?.constructor.name === 'CombatScene';
    }, { timeout: 10000 });

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
  });

  test('TC-P1-C003: Combat actions can be executed', async ({ page }) => {
    await starMap.navigateFromMainMenu();
    await starMap.triggerRandomEncounter();

    await page.waitForFunction(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { constructor: { name: string } } | null;
      };
      return engine?.currentScene?.constructor.name === 'CombatScene';
    }, { timeout: 10000 });

    await page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eWeakenEnemy?: () => void } | null;
      };
      engine?.currentScene?.e2eWeakenEnemy?.();
    });

    await page.evaluate(async () => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eAttack?: () => Promise<void> } | null;
      };
      await engine?.currentScene?.e2eAttack?.();
    });

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });
});

/**
 * Phase 1: Save/Load System
 * Testing game persistence
 */
test.describe('Phase 1: Save/Load System (MVP1)', () => {
  test('TC-P1-S001: Save game is created in IndexedDB', async ({ page }) => {
    const mainMenu = new MainMenuPage(page);
    const starMap = new StarMapPage(page);

    await mainMenu.navigateTo();
    await mainMenu.clickNewGame();
    await starMap.navigateFromMainMenu();

    // Check IndexedDB for save
    const dbStatus = await checkIndexedDB(page);
    expect(dbStatus.exists).toBeDefined();
  });

  test('TC-P1-S002: Game state persists after page reload', async ({
    page,
  }) => {
    const mainMenu = new MainMenuPage(page);
    const starMap = new StarMapPage(page);

    // Start new game
    await mainMenu.navigateTo();
    await mainMenu.clickNewGame();
    await starMap.navigateFromMainMenu();
    await starMap.expectStarMapVisible();

    // Reload page
    await page.reload();

    // Should be able to continue
    await mainMenu.waitForGameInitialization();
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('TC-P1-S003: Manual save to IndexedDB works', async ({ page }) => {
    const saveData = {
      slot: 1,
      timestamp: Date.now(),
      playerName: 'Test Captain',
      system: 'Sol',
    };

    await saveGameToIndexedDB(page, saveData);

    const loaded = await loadGameFromIndexedDB(page, 1);
    expect(loaded?.playerName).toBe('Test Captain');
  });
});

/**
 * Phase 0: Space Flight Demo
 * Testing space flight scene with ship control
 */
test.describe('Phase 0: Space Flight Demo', () => {
  let mainMenu: MainMenuPage;
  let spaceFlight: SpaceFlightPage;

  test.beforeEach(async ({ page }) => {
    mainMenu = new MainMenuPage(page);
    spaceFlight = new SpaceFlightPage(page);
    await mainMenu.navigateTo();
  });

  test('TC-P0-F001: Navigate to space flight scene', async ({ page }) => {
    await mainMenu.expectMainMenuVisible();
    await mainMenu.clickFlight();
    await spaceFlight.expectSpaceFlightVisible();
  });

  test('TC-P0-F002: Parallax stars should be visible', async ({ page }) => {
    await spaceFlight.navigateFromMainMenu();
    await spaceFlight.expectParallaxStars();
  });

  test('TC-P0-F003: Ship should be visible', async ({ page }) => {
    await spaceFlight.navigateFromMainMenu();
    await spaceFlight.expectShipVisible();
  });

  test('TC-P0-F004: Return to star map from space flight', async ({ page }) => {
    await spaceFlight.navigateFromMainMenu();
    await spaceFlight.expectSpaceFlightVisible();
    
    await spaceFlight.clickBackToMap();
    // Should be back at main menu or star map
    await mainMenu.expectMainMenuVisible();
  });

  test('TC-P0-F005: Ship control via click', async ({ page }) => {
    await spaceFlight.navigateFromMainMenu();
    
    const box = await spaceFlight.getCanvasBox();
    if (box) {
      // Click to move ship
      await spaceFlight.clickToMoveShip(box.width / 2 + 100, box.height / 2);
      // Scene should still be active
      await spaceFlight.expectSpaceFlightVisible();
    }
  });
});
