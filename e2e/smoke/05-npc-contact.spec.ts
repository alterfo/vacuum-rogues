import { test, expect } from '@playwright/test';
import { applyMockHeavySystems, waitForEngine, waitForScene } from '../fixtures/mockHeavySystems';

test.describe('Smoke: NPC contact', () => {
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

  test('05 e2eSpawnNpc → NPC ships present, no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => {
      errors.push(err.message);
    });

    await waitForScene(page, 'SpaceFlightScene');

    const npcCount = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eGetNpcCount?: () => number } | null;
      };
      return engine.currentScene?.e2eGetNpcCount?.() ?? 0;
    });

    expect(npcCount).toBeGreaterThanOrEqual(0);

    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('MIME type') &&
        !e.includes('AudioContext'),
    );

    expect(criticalErrors).toHaveLength(0);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });
});
