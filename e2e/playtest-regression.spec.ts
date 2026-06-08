import { test, expect, type Page } from '@playwright/test';
import { applyMockHeavySystems, waitForEngine, waitForScene } from './fixtures/mockHeavySystems';
import { MonkeyTester } from './helpers/monkeyTester';
import { ErrorCollector } from './helpers/errorCollector';

type EngineHandle = {
  currentScene: Record<string, unknown> | null;
  isRunning?: boolean;
  transitionTo: (scene: string, ctx?: object) => Promise<void>;
  galaxy: { systems: { planets: unknown[] }[] } | null;
  player: { credits?: number } | null;
  startTextQuest: (id: string, seed?: number) => Promise<void>;
};

async function setupNewGame(page: Page): Promise<void> {
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
}

test.describe.serial('Regression: quick smoke + monkey suite', () => {
  test.setTimeout(90_000);

  test('smoke: new game starts in SpaceFlightScene', async ({ page }) => {
    await setupNewGame(page);

    const sceneName = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      return engine?.currentScene?.constructor?.name ?? null;
    });
    expect(sceneName).toBe('SpaceFlightScene');
  });

  test('smoke: route to planet builds and is not cleared immediately (regression Sprint 3)', async ({ page }) => {
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    // Trigger onPlanetClick via the first planet in scene to plan a route
    const routeSet = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const scene = engine.currentScene;
      if (!scene) return false;

      const planetSprites = scene['planetSprites'] as Array<{ planet: unknown }> | undefined;
      if (!planetSprites || planetSprites.length === 0) return false;

      const onPlanetClick = scene['onPlanetClick'] as ((p: unknown) => void) | undefined;
      if (!onPlanetClick) return false;

      onPlanetClick.call(scene, planetSprites[0].planet);

      const route = scene['plannedRoute'] as { x: number; y: number } | null;
      return route != null && !isNaN(route.x) && !isNaN(route.y);
    });

    expect(routeSet).toBe(true);

    // Verify route is still set after a render cycle (regression: route was cleared on next tick)
    await page.waitForFunction(
      () => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: Record<string, unknown> | null;
        };
        return engine?.currentScene != null;
      },
      { timeout: 5_000 },
    );

    const routeStillSet = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const route = engine.currentScene?.['plannedRoute'] as { x: number; y: number } | null;
      return route != null;
    });

    expect(routeStillSet).toBe(true);

    errorCollector.assertAndDetach();
  });

  test('smoke: reactor quest starts without errors', async ({ page }) => {
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    // Land on planet first (required context for text quest return)
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eLandOnPlanet?: () => Promise<void> } | null;
      };
      await engine.currentScene?.e2eLandOnPlanet?.();
    });
    await waitForScene(page, 'PlanetScene', 15_000);

    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      await engine.startTextQuest('reactor', 42);
    });
    await waitForScene(page, 'TextQuestScene', 15_000);

    const sceneName = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      return engine?.currentScene?.constructor?.name ?? null;
    });
    expect(sceneName).toBe('TextQuestScene');

    errorCollector.assertAndDetach();
  });

  test('monkey: 50 random inputs in SpaceFlightScene do not crash', async ({ page }) => {
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);
    const monkey = new MonkeyTester(page, 42);

    await monkey.run(50, { delayMs: 0 });

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
});
