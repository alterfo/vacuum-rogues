import { test, expect, type Page } from '@playwright/test';
import { SpaceFlightPage } from './page-objects/space-flight.page';
import { applyMockHeavySystems, waitForEngine, waitForScene } from './fixtures/mockHeavySystems';
import { ErrorCollector } from './helpers/errorCollector';


async function setupNewGame(page: Page): Promise<SpaceFlightPage> {
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
      currentScene: {
        e2eSelectFaction?: (f: string) => void;
        e2eConfirmSelection?: () => void;
      } | null;
    };
    engine.currentScene?.e2eSelectFaction?.('OUTLANDERS');
    engine.currentScene?.e2eConfirmSelection?.();
  });
  await waitForScene(page, 'SpaceFlightScene', 20_000);
  return new SpaceFlightPage(page);
}

test.describe('SpaceFlightScene — visual E2E suite', () => {
  test.setTimeout(60_000);

  test('scene loads with planets, a ship and the HUD', async ({ page }) => {
    const errors = new ErrorCollector(page);
    const sf = await setupNewGame(page);

    const state = await sf.getSceneState();
    expect(state.planetsCount).toBeGreaterThan(0);

    const ship = await sf.getShipPosition();
    expect(Number.isFinite(ship.x)).toBe(true);
    expect(Number.isFinite(ship.y)).toBe(true);

    await sf.expectMinimapVisible();

    errors.assertAndDetach();
  });

  test('clicking a planet plans a route', async ({ page }) => {
    const sf = await setupNewGame(page);

    expect(await sf.hasPlannedRoute()).toBe(false);
    await sf.clickPlanet(0);
    await sf.settle();
    expect(await sf.hasPlannedRoute()).toBe(true);
  });

  test('Ход starts the ship; a second Ход defers the stop to the day boundary (playtest3 F1)', async ({ page }) => {
    const sf = await setupNewGame(page);

    await sf.clickPlanet(0);
    expect(await sf.hasPlannedRoute()).toBe(true);

    await sf.startTurn();
    expect((await sf.getSceneState()).isFlying).toBe(true);

    await sf.pressPause();
    await sf.settle(2);
    expect((await sf.getSceneState()).isFlying).toBe(true);
    expect((await sf.getDeferredPause()).pauseDeferred).toBe(true);
  });

  test('hovering a planet shows the pointer cursor', async ({ page }) => {
    const sf = await setupNewGame(page);
    expect(await sf.getPlanetCursor(0)).toBe('pointer');
  });

  test('hovering an NPC ship shows a target or pointer cursor', async ({ page }) => {
    const sf = await setupNewGame(page);

    expect((await sf.getSceneState()).npcsCount).toBeGreaterThan(0);
    expect(['target', 'pointer']).toContain(await sf.getNpcCursor(0));
  });

  test('NPC ships stay clickable after a turn ends (regression Sprint 3 Task 6)', async ({ page }) => {
    const sf = await setupNewGame(page);

    expect((await sf.getSceneState()).npcsCount).toBeGreaterThan(0);

    await sf.startTurn();
    await sf.settle();
    await sf.pressPause();
    await sf.waitForTurnEnd();

    expect(await sf.isNpcClickable(0)).toBe(true);
    await sf.clickNpc(0);
    expect(await sf.isContactPanelOpen()).toBe(true);
  });

  test('visual: initial scene matches baseline', async ({ page }) => {
    test.skip(process.platform !== 'darwin', 'screenshot baselines are darwin-only');
    const sf = await setupNewGame(page);

    await sf.settle(30);
    await sf.freezeWorld();

    await expect(page.locator('canvas')).toHaveScreenshot('space-flight-initial.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('visual: planned route matches baseline', async ({ page }) => {
    test.skip(process.platform !== 'darwin', 'screenshot baselines are darwin-only');
    const sf = await setupNewGame(page);

    await sf.clickPlanet(0);
    expect(await sf.hasPlannedRoute()).toBe(true);

    await sf.settle(30);
    await sf.freezeWorld();

    await expect(page.locator('canvas')).toHaveScreenshot('space-flight-route.png', {
      maxDiffPixelRatio: 0.05,
    });
  });
});
