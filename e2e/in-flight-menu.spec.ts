import { test, expect } from '@playwright/test';
import { applyMockHeavySystems, waitForEngine, waitForScene } from './fixtures/mockHeavySystems';
import { ErrorCollector } from './helpers/errorCollector';


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

    await page.evaluate(async () => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as EngineHandle;
      await engine.saveGame('auto');
    });

    const isOpen = await page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as EngineHandle;
      const hud = engine.currentScene?.hud;
      hud?.toggleSystemMenu();
      return hud?.isSystemMenuOpen() ?? false;
    });
    expect(isOpen, 'the in-flight system menu opens from flight').toBe(true);

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

    await page.waitForFunction(
      () => {
        const engine = (window as unknown as Record<string, unknown>).__gameEngine as EngineHandle;
        return engine.currentScene?.hud?.isLoadSaveEnabled() === true;
      },
      undefined,
      { timeout: 10_000 },
    );

    await page.locator('canvas').screenshot({ path: 'e2e/screenshots/in-flight-system-menu.png' });

    errorCollector.assertAndDetach();
  });

  test('menu stays reachable in the low-hull dead-end (engines stalled, turn running)', async ({ page }) => {
    const errorCollector = new ErrorCollector(page);

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
