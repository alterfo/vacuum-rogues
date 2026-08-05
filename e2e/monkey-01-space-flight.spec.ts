import { test, expect } from '@playwright/test';
import { applyMockHeavySystems, waitForEngine, waitForScene } from './fixtures/mockHeavySystems';
import { MonkeyTester } from './helpers/monkeyTester';
import { ErrorCollector } from './helpers/errorCollector';

type EngineHandle = {
  currentScene: Record<string, unknown> | null;
  isRunning?: boolean;
  transitionTo: (scene: string, ctx?: object) => Promise<void>;
};


test.describe('Monkey 01: SpaceFlightScene resilience', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await applyMockHeavySystems(page);
    await page.goto('/');
    await waitForEngine(page);
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      await engine.transitionTo('RACE_SELECTION', { gameEngine: engine });
    });
    await waitForScene(page, 'RaceSelectionScene');
    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eSelectFaction?: (f: string) => void; e2eConfirmSelection?: () => void } | null;
      };
      engine.currentScene?.e2eSelectFaction?.('OUTLANDERS');
      engine.currentScene?.e2eConfirmSelection?.();
    });
    await waitForScene(page, 'SpaceFlightScene', 20_000);
  });

  test('monkey: 40 random inputs in SpaceFlightScene do not crash', async ({ page }) => {
    const errorCollector = new ErrorCollector(page);
    const monkey = new MonkeyTester(page, 42);

    await monkey.run(40, { delayMs: 0 });

    await page.waitForFunction(
      () => {
        const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
        return !!engine?.currentScene;
      },
      { timeout: 10_000 },
    );

    const sceneName = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      return engine?.currentScene?.constructor?.name ?? null;
    });
    expect(sceneName).not.toBeNull();

    errorCollector.assertAndDetach();
  });

  test('monkey: clicks during turn execution are ignored (no route set)', async ({ page }) => {
    const errorCollector = new ErrorCollector(page);
    const monkey = new MonkeyTester(page, 7);

    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { handlePlayPause?: () => void } | null;
      };
      engine.currentScene?.handlePlayPause?.();
    });

    await monkey.run(15, { delayMs: 0, types: ['leftClick'] });

    await page.waitForFunction(
      () => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: { isTurnRunning?: boolean } | null;
        };
        return engine?.currentScene && !engine.currentScene.isTurnRunning;
      },
      { timeout: 60_000 },
    );

    const routeOk = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { plannedRoute?: { x: number; y: number } | null } | null;
      };
      const route = engine?.currentScene?.plannedRoute;
      if (route == null) return true;
      return !isNaN(route.x) && !isNaN(route.y);
    });
    expect(routeOk).toBe(true);

    errorCollector.assertAndDetach();
  });

  test('monkey: rapid scroll does not break zoom bounds', async ({ page }) => {
    const errorCollector = new ErrorCollector(page);
    const monkey = new MonkeyTester(page, 13);

    await monkey.run(30, { delayMs: 0, types: ['scroll'] });

    const zoomInBounds = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { cameraZoom?: number } | null;
      };
      const zoom = engine?.currentScene?.cameraZoom;
      if (zoom == null) return true;
      return zoom >= 0.25 && zoom <= 2.0;
    });
    expect(zoomInBounds).toBe(true);

    errorCollector.assertAndDetach();
  });

  test('monkey: right-click panning does not accumulate NaN', async ({ page }) => {
    const errorCollector = new ErrorCollector(page);
    const monkey = new MonkeyTester(page, 99);

    await monkey.run(30, { delayMs: 0, types: ['rightClick'] });

    const panOk = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { cameraPanX?: number; cameraPanY?: number } | null;
      };
      const x = engine?.currentScene?.cameraPanX;
      const y = engine?.currentScene?.cameraPanY;
      if (x == null || y == null) return true;
      return !isNaN(x) && !isNaN(y) && isFinite(x) && isFinite(y);
    });
    expect(panOk).toBe(true);

    errorCollector.assertAndDetach();
  });
});
