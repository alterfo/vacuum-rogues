import { test, expect } from '@playwright/test';
import { applyMockHeavySystems, waitForEngine, waitForScene } from '../fixtures/mockHeavySystems';

test.describe('Smoke: Space flight', () => {
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

  test('04 e2eSetRoute → ship position changes', async ({ page }) => {
    const initialPos = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eGetShipPosition?: () => { x: number; y: number } } | null;
      };
      return engine.currentScene?.e2eGetShipPosition?.() ?? { x: 0, y: 0 };
    });

    await page.evaluate((pos) => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eSetTarget?: (x: number, y: number) => void } | null;
      };
      engine.currentScene?.e2eSetTarget?.(pos.x + 500, pos.y + 500);
    }, initialPos);

    await page.waitForFunction(
      (start) => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: { e2eGetShipPosition?: () => { x: number; y: number } } | null;
        };
        const pos = engine.currentScene?.e2eGetShipPosition?.();
        if (!pos) return false;
        const dx = pos.x - start.x;
        const dy = pos.y - start.y;
        return Math.sqrt(dx * dx + dy * dy) > 5;
      },
      initialPos,
      { timeout: 10000 },
    );

    const finalPos = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eGetShipPosition?: () => { x: number; y: number } } | null;
      };
      return engine.currentScene?.e2eGetShipPosition?.() ?? { x: 0, y: 0 };
    });

    const dx = finalPos.x - initialPos.x;
    const dy = finalPos.y - initialPos.y;
    expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThan(5);
  });
});
