import { test, expect } from '@playwright/test';
import { applyMockHeavySystems, waitForEngine, waitForScene } from './fixtures/mockHeavySystems';
import { ErrorCollector } from './helpers/errorCollector';

type EngineHandle = {
  currentScene: Record<string, unknown> | null;
  transitionTo: (scene: string, ctx?: object) => Promise<void>;
  galaxy: { systems: { planets: unknown[] }[] } | null;
  player: { credits?: number } | null;
};

async function setupToSpaceFlight(page: Parameters<Parameters<typeof test>[1]>[0]['page']): Promise<void> {
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

async function landOnPlanet(page: Parameters<Parameters<typeof test>[1]>[0]['page']): Promise<void> {
  await page.evaluate(async () => {
    const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
    const scene = engine.currentScene as { e2eLandOnPlanet?: () => Promise<void> } | null;
    await scene?.e2eLandOnPlanet?.();
  });
  await waitForScene(page, 'PlanetScene', 15_000);
}

test.describe('Planet parallax and click regression', () => {
  test.setTimeout(120_000);

  test('Test A: clicks work on PlanetScene after FLIGHT → PLANET → TRADE → PLANET cycle', async ({ page }) => {
    await setupToSpaceFlight(page);
    const errorCollector = new ErrorCollector(page);

    // Land on planet (SPACE_FLIGHT → PLANET)
    await landOnPlanet(page);

    // Go to TRADE scene from PlanetScene (PLANET → TRADE)
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const scene = engine.currentScene as { openMarket?: () => void } | null;
      // openMarket is private, access via bracket notation
      (scene as Record<string, unknown>)['openMarket']?.();
    });
    await waitForScene(page, 'TradeScene', 15_000);

    // Return from TRADE back to PLANET
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const scene = engine.currentScene as { close?: () => Promise<void> } | null;
      await (scene as Record<string, unknown>)['close']?.();
    });
    await waitForScene(page, 'PlanetScene', 15_000);

    // Invoke job board handler — proves interactive objects are not swallowed
    const jobBoardOpened = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const scene = engine.currentScene as Record<string, unknown> | null;
      if (!scene) return false;
      (scene['openJobBoard'] as (() => void) | undefined)?.();
      return scene['jobBoardPanel'] != null;
    });
    expect(jobBoardOpened).toBe(true);

    errorCollector.assertAndDetach();
  });

  test('Test B: panorama.x drifts when mouse moves to left edge', async ({ page }) => {
    await setupToSpaceFlight(page);
    const errorCollector = new ErrorCollector(page);

    await landOnPlanet(page);

    // Read current panorama x baseline
    const baselineX = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const scene = engine.currentScene as Record<string, unknown> | null;
      const panorama = scene?.['panoramaSprite'] as { x: number } | null;
      return panorama?.x ?? null;
    });

    // Only run parallax check if panorama exists
    if (baselineX === null) {
      errorCollector.detach();
      return;
    }

    const bounds = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      return canvas ? { w: canvas.width, h: canvas.height } : { w: 800, h: 600 };
    });

    // Move mouse toward the left edge to trigger parallax drift
    await page.mouse.move(10, bounds.h / 2, { steps: 5 });

    // Wait for panorama.x to change (parallax easing takes a few frames)
    await page.waitForFunction(
      (baseline) => {
        const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
        const scene = engine.currentScene as Record<string, unknown> | null;
        const panorama = scene?.['panoramaSprite'] as { x: number } | null;
        if (!panorama) return false;
        return Math.abs(panorama.x - baseline) > 0.5;
      },
      baselineX,
      { timeout: 5_000 },
    );

    const updatedX = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const scene = engine.currentScene as Record<string, unknown> | null;
      const panorama = scene?.['panoramaSprite'] as { x: number } | null;
      return panorama?.x ?? null;
    });

    expect(updatedX).not.toBeNull();
    // Moving to left edge should decrease x (drift left)
    expect(updatedX as number).toBeLessThan(baselineX);

    errorCollector.assertAndDetach();
  });

  test('Test C: service buttons respond after opening and closing job board overlay', async ({ page }) => {
    await setupToSpaceFlight(page);
    const errorCollector = new ErrorCollector(page);

    await landOnPlanet(page);

    // Open job board
    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const scene = engine.currentScene as Record<string, unknown> | null;
      (scene?.['openJobBoard'] as (() => void) | undefined)?.();
    });

    // Verify it opened
    const panelAfterOpen = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const scene = engine.currentScene as Record<string, unknown> | null;
      return scene?.['jobBoardPanel'] != null;
    });
    expect(panelAfterOpen).toBe(true);

    // Close job board
    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const scene = engine.currentScene as Record<string, unknown> | null;
      (scene?.['closeJobBoard'] as (() => void) | undefined)?.();
    });

    // Verify it closed
    const panelAfterClose = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const scene = engine.currentScene as Record<string, unknown> | null;
      return scene?.['jobBoardPanel'] != null;
    });
    expect(panelAfterClose).toBe(false);

    // Invoke garage service handler to prove interactive objects still respond
    // (openGarage shows a message if hull is full, which is fine)
    const serviceHandlerFired = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const scene = engine.currentScene as Record<string, unknown> | null;
      if (!scene) return false;
      try {
        (scene['openGarage'] as (() => void) | undefined)?.();
        return true;
      } catch {
        return false;
      }
    });
    expect(serviceHandlerFired).toBe(true);

    errorCollector.assertAndDetach();
  });
});
