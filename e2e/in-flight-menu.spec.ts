import { test, expect } from '@playwright/test';
import { applyMockHeavySystems, waitForEngine, waitForScene } from './fixtures/mockHeavySystems';
import { ErrorCollector } from './helpers/errorCollector';

/**
 * Task 4 (in-flight load-save dead-end recovery): the always-available in-flight
 * system menu is the escape hatch from any dead-end (stranded, <30% hull, broke).
 *
 * This drives the REAL flight scene end-to-end: it opens the HUD menu via the
 * HUD's own public API (reached through `currentScene.hud` the way other specs
 * reach into scene internals — no extra e2e* scene method, which would breach the
 * SpaceFlightScene 1900-line guard) and asserts both escape actions are present
 * and the «Загрузить сохранение» action is usable. A companion test proves the
 * menu still opens in the low-hull dead-end (engines stalled, turn running), so a
 * stranded player is never locked out of recovery.
 *
 * NOTE: helpers passed to page.evaluate run in the browser, so each block reads
 * window.__gameEngine inline — a Node-scoped helper would be `undefined` there.
 */

type SceneHandle = {
  hud?: {
    toggleSystemMenu: () => void;
    isSystemMenuOpen: () => boolean;
    isLoadSaveEnabled: () => boolean;
    uiLayer: { children?: unknown[] };
  };
  isTurnRunning?: boolean;
};

type EngineHandle = {
  currentScene: SceneHandle | null;
  player: { ship: { hullHP: number; maxHull: number } } | null;
  transitionTo: (scene: string, ctx?: object) => Promise<void>;
  saveGame: (slotId?: string) => Promise<void>;
};

test.describe('In-flight system menu (dead-end recovery)', () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await applyMockHeavySystems(page);
    await page.goto('/');
    await waitForEngine(page);

    // Start a new game so we have a live player + galaxy in flight.
    await page.evaluate(async () => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as EngineHandle;
      await engine.transitionTo('RACE_SELECTION', { gameEngine: engine });
    });
    await waitForScene(page, 'RaceSelectionScene');

    await page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eSelectFaction?: (f: string) => void; e2eConfirmSelection?: () => void } | null;
      };
      engine.currentScene?.e2eSelectFaction?.('OUTLANDERS');
      engine.currentScene?.e2eConfirmSelection?.();
    });
    await waitForScene(page, 'SpaceFlightScene', 20_000);
  });

  test('opens the menu and exposes both escape actions, load usable', async ({ page }) => {
    const errorCollector = new ErrorCollector(page);

    // Ensure an "auto" save exists so «Загрузить сохранение» is a usable action.
    // (Take-off autosave is fire-and-forget; await an explicit save so the gate is
    // deterministic rather than racing the async autosave in the test env.)
    await page.evaluate(async () => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as EngineHandle;
      await engine.saveGame('auto');
    });

    // Open the in-flight system menu through the HUD's public API.
    const isOpen = await page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as EngineHandle;
      const hud = engine.currentScene?.hud;
      hud?.toggleSystemMenu();
      return hud?.isSystemMenuOpen() ?? false;
    });
    expect(isOpen, 'the in-flight system menu opens from flight').toBe(true);

    // Collect every Text label under the HUD's UI layer — the panel mounts there.
    const labels = await page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as EngineHandle;
      const hud = engine.currentScene?.hud;
      const out: string[] = [];
      const walk = (node: unknown) => {
        if (!node || typeof node !== 'object') return;
        const n = node as { text?: unknown; children?: unknown[] };
        if (typeof n.text === 'string') out.push(n.text);
        for (const c of n.children ?? []) walk(c);
      };
      walk(hud?.uiLayer);
      return out;
    });

    expect(labels).toContain('Продолжить');
    expect(labels).toContain('Загрузить сохранение');
    expect(labels).toContain('В главное меню');

    // The new game auto-saved on the transition into flight, so «Загрузить
    // сохранение» is a usable action (the async hasSave() probe re-runs on open).
    await page.waitForFunction(
      () => {
        const engine = (window as unknown as Record<string, unknown>).__gameEngine as EngineHandle;
        return engine.currentScene?.hud?.isLoadSaveEnabled() === true;
      },
      undefined,
      { timeout: 10_000 },
    );

    // Visual verification of the menu over the live flight scene.
    await page.locator('canvas').screenshot({ path: 'e2e/screenshots/in-flight-system-menu.png' });

    errorCollector.assertAndDetach();
  });

  test('menu stays reachable in the low-hull dead-end (engines stalled, turn running)', async ({ page }) => {
    const errorCollector = new ErrorCollector(page);

    // Engineer the dead-end: hull below the 30% engine-stall threshold AND a turn
    // in progress. The escape menu must never be gated on the engine stall.
    await page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as EngineHandle;
      const ship = engine.player?.ship;
      if (ship) ship.hullHP = Math.max(1, Math.floor(ship.maxHull * 0.1));
      const scene = engine.currentScene;
      if (scene) scene.isTurnRunning = true;
    });

    const isOpen = await page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as EngineHandle;
      const hud = engine.currentScene?.hud;
      hud?.toggleSystemMenu();
      return hud?.isSystemMenuOpen() ?? false;
    });
    expect(isOpen, 'menu opens even while engines are stalled at <30% hull').toBe(true);

    errorCollector.assertAndDetach();
  });
});
