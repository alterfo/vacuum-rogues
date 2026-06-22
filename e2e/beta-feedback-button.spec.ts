import { test, expect } from '@playwright/test';
import { applyMockHeavySystems, waitForEngine, waitForScene } from './fixtures/mockHeavySystems';
import { ErrorCollector } from './helpers/errorCollector';

/**
 * Task 4 (beta-tester feedback collection): the «Сообщить отзыв» button must be
 * present and visible in BOTH homes — the Main Menu and the in-flight system
 * menu — so a tester can file a structured GitHub Issue from either surface.
 *
 * Visual placement is screenshot-verified (CLAUDE.md presentation rule). This is
 * a NEW spec (existing menu specs are left untouched per the standing rule).
 */

type EngineHandle = {
  currentScene: {
    hud?: {
      toggleSystemMenu: () => void;
      isSystemMenuOpen: () => boolean;
      uiLayer: { children?: unknown[] };
    };
  } | null;
  transitionTo: (scene: string, ctx?: object) => Promise<void>;
};

test.describe('Beta-feedback «Сообщить отзыв» button', () => {
  test.setTimeout(90_000);

  test('renders on the Main Menu', async ({ page }) => {
    const errorCollector = new ErrorCollector(page);
    await applyMockHeavySystems(page);
    await page.goto('/');
    await waitForEngine(page);
    await waitForScene(page, 'MainMenuScene');

    // Collect labels mounted under the renderer's UI layer (the menu buttons live
    // in buttonsContainer on uiLayer).
    const labels = await page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        renderer: { uiLayer: unknown };
      };
      const out: string[] = [];
      const walk = (node: unknown) => {
        if (!node || typeof node !== 'object') return;
        const n = node as { text?: unknown; children?: unknown[] };
        if (typeof n.text === 'string') out.push(n.text);
        for (const c of n.children ?? []) walk(c);
      };
      walk(engine.renderer.uiLayer);
      return out;
    });

    expect(labels).toContain('Новая игра');
    expect(labels).toContain('Сообщить отзыв');

    await page.locator('canvas').screenshot({
      path: 'e2e/screenshots/main-menu-feedback-button.png',
    });
    errorCollector.assertAndDetach();
  });

  test('renders in the in-flight system menu', async ({ page }) => {
    const errorCollector = new ErrorCollector(page);
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

    const opened = await page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as EngineHandle;
      const hud = engine.currentScene?.hud;
      hud?.toggleSystemMenu();
      return hud?.isSystemMenuOpen() ?? false;
    });
    expect(opened, 'in-flight system menu opens').toBe(true);

    const labels = await page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as EngineHandle;
      const out: string[] = [];
      const walk = (node: unknown) => {
        if (!node || typeof node !== 'object') return;
        const n = node as { text?: unknown; children?: unknown[] };
        if (typeof n.text === 'string') out.push(n.text);
        for (const c of n.children ?? []) walk(c);
      };
      walk(engine.currentScene?.hud?.uiLayer);
      return out;
    });

    expect(labels).toContain('Продолжить');
    expect(labels).toContain('Сообщить отзыв');

    await page.locator('canvas').screenshot({
      path: 'e2e/screenshots/in-flight-feedback-button.png',
    });
    errorCollector.assertAndDetach();
  });
});
