import { test, expect } from '@playwright/test';
import { applyMockHeavySystems, waitForEngine, waitForScene } from '../fixtures/mockHeavySystems';

test.describe('Smoke: Planet trade', () => {
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
    await waitForScene(page, 'SpaceFlightScene', 20000);
  });

  test('02 e2eLandOnPlanet → PLANET scene loaded', async ({ page }) => {
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eLandOnPlanet?: () => Promise<void> } | null;
      };
      await engine.currentScene?.e2eLandOnPlanet?.();
    });

    await waitForScene(page, 'PlanetScene');

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('02 buy fuel via TradeScene → player.credits decreased', async ({ page }) => {
    const initialCredits = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        player: { credits: number } | null;
      };
      return engine.player?.credits ?? 0;
    });

    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        transitionTo: (scene: string, ctx?: object) => Promise<void>;
        player: { credits: number } | null;
        galaxy: { systems: { planets: unknown[] }[] } | null;
      };
      const planet = engine.galaxy?.systems[0]?.planets[0];
      if (planet) {
        await engine.transitionTo('TRADE', { gameEngine: engine, planet });
      }
    });

    await waitForScene(page, 'TradeScene');

    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eBuyItem?: (resource: string, qty: number) => boolean } | null;
      };
      engine.currentScene?.e2eBuyItem?.('FUEL', 1);
    });

    const finalCredits = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        player: { credits: number } | null;
      };
      return engine.player?.credits ?? 0;
    });

    expect(finalCredits).toBeLessThan(initialCredits);
  });
});
