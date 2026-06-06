import { test, expect } from '@playwright/test';
import { applyMockHeavySystems, waitForEngine, waitForScene } from '../fixtures/mockHeavySystems';

test.describe('Smoke: New game flow', () => {
  test.beforeEach(async ({ page }) => {
    await applyMockHeavySystems(page);
    await page.goto('/');
    await waitForEngine(page);
  });

  test('01 launch → main menu → start new game → SpaceFlightScene', async ({ page }) => {
    await waitForScene(page, 'MainMenuScene');

    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        transitionTo: (scene: string, ctx?: object) => Promise<void>;
        currentScene: object | null;
      };
      await engine.transitionTo('RACE_SELECTION', { gameEngine: engine });
    });

    await waitForScene(page, 'RaceSelectionScene');

    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eSelectFaction?: (f: string) => void } | null;
      };
      engine.currentScene?.e2eSelectFaction?.('OUTLANDERS');
    });

    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eConfirmSelection?: () => void } | null;
      };
      engine.currentScene?.e2eConfirmSelection?.();
    });

    await waitForScene(page, 'SpaceFlightScene', 20000);

    const hasPlayer = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        player: { credits: number } | null;
      };
      return engine.player != null && engine.player.credits >= 0;
    });

    expect(hasPlayer).toBe(true);
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });
});
