import { test } from '@playwright/test';
import * as fs from 'fs';
import { MainMenuPage } from '../page-objects/main-menu.page';
import { SpaceFlightPage } from '../page-objects/space-flight.page';
import { StarMapPage } from '../page-objects/star-map.page';

const SCREENSHOT_DIR = 'e2e/screenshots';

test.describe('Visual Regression Tests', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test('main menu renders correctly', async ({ page }) => {
    await page.goto('/');
    const mainMenu = new MainMenuPage(page);
    await mainMenu.waitForMainMenu();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/main-menu.png` });
  });

  test('race selection screen renders correctly', async ({ page }) => {
    await page.goto('/');
    const mainMenu = new MainMenuPage(page);
    await mainMenu.waitForMainMenu();
    await mainMenu.startNewGame();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/race-selection.png` });
  });

  test('space flight scene renders correctly', async ({ page }) => {
    await page.goto('/');
    const mainMenu = new MainMenuPage(page);
    await mainMenu.waitForMainMenu();
    await mainMenu.startNewGame();
    await mainMenu.selectRace('OUTLANDERS');
    await mainMenu.clickStartGame();
    const spaceFlight = new SpaceFlightPage(page);
    await spaceFlight.waitForSpaceFlight();
    await page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eGetPlanets?: () => unknown } | null;
      };
      engine?.currentScene?.e2eGetPlanets?.();
    });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/space-flight.png` });
  });

  test('star map renders correctly', async ({ page }) => {
    await page.goto('/');
    const mainMenu = new MainMenuPage(page);
    await mainMenu.waitForMainMenu();
    await page.evaluate(async () => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        transitionTo: (scene: string) => Promise<void>;
      };
      await engine.transitionTo('STAR_MAP');
    });
    const starMap = new StarMapPage(page);
    await starMap.waitForStarMap();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/star-map.png` });
  });

  test('inventory screen renders correctly', async ({ page }) => {
    await page.goto('/');
    const mainMenu = new MainMenuPage(page);
    await mainMenu.waitForMainMenu();
    await mainMenu.startNewGame();
    await mainMenu.selectRace('OUTLANDERS');
    await mainMenu.clickStartGame();
    const spaceFlight = new SpaceFlightPage(page);
    await spaceFlight.waitForSpaceFlight();
    await page.evaluate(async () => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        transitionTo: (scene: string) => Promise<void>;
      };
      await engine.transitionTo('INVENTORY');
    });
    await page.waitForFunction(
      () => {
        const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
          currentScene: { constructor: { name: string } } | null;
        };
        return engine?.currentScene?.constructor.name === 'InventoryScene';
      },
      { timeout: 10000 },
    );
    await page.screenshot({ path: `${SCREENSHOT_DIR}/inventory.png` });
  });

  // Combat is real-time in-flight only — the hex CombatScene (SceneType.COMBAT)
  // was removed, so there is no standalone combat scene to screenshot.

  test('station scene renders correctly', async ({ page }) => {
    await page.goto('/');
    const mainMenu = new MainMenuPage(page);
    await mainMenu.waitForMainMenu();
    await mainMenu.startNewGame();
    await mainMenu.selectRace('OUTLANDERS');
    await mainMenu.clickStartGame();
    const spaceFlight = new SpaceFlightPage(page);
    await spaceFlight.waitForSpaceFlight();
    await page.evaluate(async () => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        transitionTo: (scene: string) => Promise<void>;
      };
      // No station context — renders fallback/empty state as a known baseline
      await engine.transitionTo('STATION');
    });
    await page.waitForFunction(
      () => {
        const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
          currentScene: { constructor: { name: string } } | null;
        };
        return engine?.currentScene?.constructor.name === 'StationScene';
      },
      { timeout: 10000 },
    );
    await page.screenshot({ path: `${SCREENSHOT_DIR}/station.png` });
  });
});
