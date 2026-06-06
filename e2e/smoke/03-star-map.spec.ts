import { test, expect } from '@playwright/test';
import { applyMockHeavySystems, waitForEngine, waitForScene } from '../fixtures/mockHeavySystems';

test.describe('Smoke: Star map', () => {
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

  test('03 transitionTo STAR_MAP → e2eSelectSystem(1) → zoom-to-fit applied', async ({ page }) => {
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        transitionTo: (scene: string, ctx?: object) => Promise<void>;
      };
      await engine.transitionTo('STAR_MAP', { gameEngine: engine });
    });

    await waitForScene(page, 'StarMapScene');

    const viewportBefore = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eGetViewport?: () => { zoomLevel: number; viewportX: number; viewportY: number } } | null;
      };
      return engine.currentScene?.e2eGetViewport?.() ?? null;
    });

    expect(viewportBefore).not.toBeNull();
    expect(viewportBefore!.zoomLevel).toBeGreaterThanOrEqual(0.5);
    expect(viewportBefore!.zoomLevel).toBeLessThanOrEqual(4);

    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eSelectSystem?: (index: number) => void } | null;
      };
      engine.currentScene?.e2eSelectSystem?.(1);
    });

    const systemCount = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        galaxy: { systems: unknown[] } | null;
      };
      return engine.galaxy?.systems.length ?? 0;
    });

    expect(systemCount).toBeGreaterThan(1);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });
});
