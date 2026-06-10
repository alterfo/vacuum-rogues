import { test, expect, type Page } from '@playwright/test';
import { SpaceFlightPage } from './page-objects/space-flight.page';
import { applyMockHeavySystems, waitForEngine, waitForScene } from './fixtures/mockHeavySystems';
import { ErrorCollector } from './helpers/errorCollector';

/**
 * Visual / behavioural E2E suite for SpaceFlightScene (Task 4 of
 * 20260609-e2e-visual-spaceflightscene).
 *
 * Replaces the old text-only spec (which asserted canvas-rendered Russian
 * strings via page.getByText — those never matched because the whole scene is
 * drawn to a WebGL canvas, not the DOM). Everything here drives the real scene
 * through the __DEBUG__-guarded e2e* hooks (SpaceFlightPage) — never pixel
 * clicks (CLAUDE.md E2E rules). The heavy nebula background is hidden
 * automatically by applyMockHeavySystems, so screenshots are clean + light.
 *
 * The galaxy uses the fixed `NEURAL_ONSLAUGHT` seed (src/main.ts), so the
 * starting system, planets and NPC spawns are deterministic across runs — which
 * is what lets the screenshot baselines below be stable once the world is frozen.
 */

/** Start a fresh game and land in SpaceFlightScene with the background hidden. */
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

    // Ship exists at a finite world position (spawns at the system edge).
    const ship = await sf.getShipPosition();
    expect(Number.isFinite(ship.x)).toBe(true);
    expect(Number.isFinite(ship.y)).toBe(true);

    // HUD present — the mini-map is owned by the HUD module.
    await sf.expectMinimapVisible();

    errors.assertAndDetach();
  });

  test('clicking a planet plans a route', async ({ page }) => {
    const sf = await setupNewGame(page);

    expect(await sf.hasPlannedRoute()).toBe(false);
    await sf.clickPlanet(0);
    // Route survives the next render tick (Sprint 3 regression: it used to clear).
    await sf.settle();
    expect(await sf.hasPlannedRoute()).toBe(true);
  });

  test('Ход starts the ship; a second Ход defers the stop to the day boundary (playtest3 F1)', async ({ page }) => {
    const sf = await setupNewGame(page);

    // Plan a route so the turn has somewhere to fly.
    await sf.clickPlanet(0);
    expect(await sf.hasPlannedRoute()).toBe(true);

    // Ход → execute the route. setPath() flips isMoving=true synchronously.
    await sf.startTurn();
    expect((await sf.getSceneState()).isFlying).toBe(true);

    // Ход again → F1: the ship finishes its current day before stopping, so it
    // keeps flying with the deferred-pause latch set (no immediate halt).
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

    // Run a (course-less wait) turn, then end it. F1 (playtest3): Pause finishes
    // the current waited day before the turn ends — wait for the actual stop.
    await sf.startTurn();
    await sf.settle();
    await sf.pressPause();
    await sf.waitForTurnEnd();

    // Interactivity is restored when the turn ends...
    expect(await sf.isNpcClickable(0)).toBe(true);
    // ...and a click opens the contact panel (the handler still fires).
    await sf.clickNpc(0);
    expect(await sf.isContactPanelOpen()).toBe(true);
  });

  test('visual: initial scene matches baseline', async ({ page }) => {
    // Snapshot baselines are committed per-OS (…-chromium-darwin.png). Skip on
    // other platforms rather than fail with a missing-baseline error on CI.
    test.skip(process.platform !== 'darwin', 'screenshot baselines are darwin-only');
    const sf = await setupNewGame(page);

    // Let lazy planet textures load, then freeze the world so the WebGL frame is
    // byte-deterministic (no sun pulse / drift between baseline and verify runs).
    await sf.settle(30);
    await sf.freezeWorld();

    await expect(page.locator('canvas')).toHaveScreenshot('space-flight-initial.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('visual: planned route matches baseline', async ({ page }) => {
    // Snapshot baselines are committed per-OS (…-chromium-darwin.png). Skip on
    // other platforms rather than fail with a missing-baseline error on CI.
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
