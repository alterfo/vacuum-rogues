import { test, expect } from '@playwright/test';
import { applyMockHeavySystems, waitForEngine, waitForScene } from './fixtures/mockHeavySystems';
import { GameDriver } from './helpers/gameDriver';
import { ErrorCollector } from './helpers/errorCollector';

test.describe('Playtest 01: Full game loop', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await applyMockHeavySystems(page);
    await page.goto('/');
    await waitForEngine(page);
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        transitionTo: (scene: string, ctx?: object) => Promise<void>;
      };
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

  test('should complete full game loop: flight → land → trade → takeoff', async ({ page }) => {
    const errorCollector = new ErrorCollector(page);
    const driver = new GameDriver(page);

    const initialCredits = await driver.getCredits();

    // Land on first planet in system
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eLandOnPlanet?: () => Promise<void> } | null;
      };
      await engine.currentScene?.e2eLandOnPlanet?.();
    });
    await waitForScene(page, 'PlanetScene', 15_000);

    // Navigate to trade scene directly with the first available planet
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        transitionTo: (scene: string, ctx?: object) => Promise<void>;
        galaxy: { systems: { planets: unknown[] }[] } | null;
      };
      const planet = engine.galaxy?.systems[0]?.planets[0];
      if (planet) {
        await engine.transitionTo('TRADE', { gameEngine: engine, planet });
      }
    });
    await waitForScene(page, 'TradeScene', 15_000);

    // Buy 1 unit of fuel
    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eBuyItem?: (resource: string, qty: number) => boolean } | null;
      };
      engine.currentScene?.e2eBuyItem?.('FUEL', 1);
    });

    const creditsAfterTrade = await driver.getCredits();
    expect(creditsAfterTrade).toBeLessThan(initialCredits);

    // Take off back to space flight
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        transitionTo: (scene: string, ctx?: object) => Promise<void>;
      };
      await engine.transitionTo('SPACE_FLIGHT', { gameEngine: engine });
    });
    await waitForScene(page, 'SpaceFlightScene', 15_000);

    errorCollector.assertNoErrors();
    errorCollector.detach();
  });

  test('should not lose credits on cancel trade', async ({ page }) => {
    const errorCollector = new ErrorCollector(page);
    const driver = new GameDriver(page);

    const initialCredits = await driver.getCredits();

    // Land on first planet
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eLandOnPlanet?: () => Promise<void> } | null;
      };
      await engine.currentScene?.e2eLandOnPlanet?.();
    });
    await waitForScene(page, 'PlanetScene', 15_000);

    // Open trade scene
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        transitionTo: (scene: string, ctx?: object) => Promise<void>;
        galaxy: { systems: { planets: unknown[] }[] } | null;
      };
      const planet = engine.galaxy?.systems[0]?.planets[0];
      if (planet) {
        await engine.transitionTo('TRADE', { gameEngine: engine, planet });
      }
    });
    await waitForScene(page, 'TradeScene', 15_000);

    // Exit without buying — go back to planet then take off
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        transitionTo: (scene: string, ctx?: object) => Promise<void>;
        galaxy: { systems: { planets: unknown[] }[] } | null;
      };
      const planet = engine.galaxy?.systems[0]?.planets[0];
      await engine.transitionTo('PLANET', { gameEngine: engine, planet });
    });
    await waitForScene(page, 'PlanetScene', 15_000);

    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        transitionTo: (scene: string, ctx?: object) => Promise<void>;
      };
      await engine.transitionTo('SPACE_FLIGHT', { gameEngine: engine });
    });
    await waitForScene(page, 'SpaceFlightScene', 15_000);

    const finalCredits = await driver.getCredits();
    expect(finalCredits).toBe(initialCredits);

    errorCollector.assertNoErrors();
    errorCollector.detach();
  });
});
