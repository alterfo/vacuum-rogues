import { test, expect, type Page } from '@playwright/test';
import { applyMockHeavySystems, waitForEngine, waitForScene } from './fixtures/mockHeavySystems';
import { ErrorCollector } from './helpers/errorCollector';

interface ArcadeProbe {
  state: {
    phase: string;
    level: number;
    levelTimeMs: number;
    player: { x: number; y: number };
    enemies: unknown[];
    playerBullets: unknown[];
    plan: { spawns: unknown[] };
  };
  fieldX: number;
  fieldY: number;
  fieldScale: number;
}

const probe = <T>(page: Page, fn: (scene: ArcadeProbe) => T): Promise<T> =>
  page.evaluate(
    ([source]) => {
      const engine = (window as unknown as Record<string, { currentScene: ArcadeProbe }>).__gameEngine;
      return (new Function('scene', `return (${source})(scene)`) as (s: ArcadeProbe) => T)(engine.currentScene);
    },
    [fn.toString()],
  );

test.describe('Black hole arcade', () => {
  test.setTimeout(90_000);

  test('?arcade=3 opens the vertical shooter; the ship follows the mouse and fires on its own', async ({ page }) => {
    const errors = new ErrorCollector(page);
    await applyMockHeavySystems(page);
    await page.goto('/?arcade=3');
    await waitForEngine(page);
    await waitForScene(page, 'BlackHoleArcadeScene');

    const layout = await probe(page, (s) => ({ x: s.fieldX, y: s.fieldY, k: s.fieldScale }));
    const toScreen = (fx: number, fy: number) => ({ x: layout.x + fx * layout.k, y: layout.y + fy * layout.k });

    const target = toScreen(180, 520);
    await page.mouse.move(target.x, target.y);
    await page.waitForTimeout(200);
    const pos = await probe(page, (s) => ({ x: s.state.player.x, y: s.state.player.y }));
    expect(Math.abs(pos.x - 180)).toBeLessThan(2);
    expect(Math.abs(pos.y - 520)).toBeLessThan(2);

    await page.waitForFunction(
      () => {
        const scene = (window as unknown as Record<string, { currentScene: ArcadeProbe }>).__gameEngine.currentScene;
        return scene.state.levelTimeMs > 2000 && scene.state.playerBullets.length > 0;
      },
      null,
      { timeout: 15000 },
    );
    const live = await probe(page, (s) => ({
      level: s.state.level,
      t: s.state.levelTimeMs,
      enemies: s.state.enemies.length,
      bullets: s.state.playerBullets.length,
    }));
    expect(live.level).toBe(3);
    expect(live.t).toBeGreaterThan(2000);
    expect(live.bullets).toBeGreaterThan(0);

    await page.screenshot({ path: process.env.ARCADE_SHOT ?? 'test-results/arcade.png' });

    await page.keyboard.press('Escape');
    const frozen = await probe(page, (s) => s.state.levelTimeMs);
    await page.waitForTimeout(500);
    expect(await probe(page, (s) => s.state.levelTimeMs)).toBe(frozen);
    await page.keyboard.press('Escape');

    errors.assertAndDetach(['Failed to load resource']);
  });

  test('clearing a level, cashing out and leaving pays credits once and returns to flight', async ({ page }) => {
    const errors = new ErrorCollector(page);
    await applyMockHeavySystems(page);
    await page.goto('/?arcade=2&game');
    await waitForEngine(page);
    await waitForScene(page, 'BlackHoleArcadeScene');

    const credits = () =>
      page.evaluate(() => (window as unknown as Record<string, { player: { credits: number } }>).__gameEngine.player.credits);
    const before = await credits();

    await probe(page, (s) => {
      s.state.plan.spawns = [];
      return true;
    });
    await page.waitForFunction(
      () => (window as unknown as Record<string, { currentScene: { state: { phase: string } } }>).__gameEngine.currentScene.state.phase === 'intermission',
      null,
      { timeout: 15000 },
    );

    await page.keyboard.press('KeyC');
    const after = await credits();
    expect(after).toBeGreaterThan(before);
    await page.keyboard.press('KeyC');
    expect(await credits()).toBe(after);

    await page.keyboard.press('Enter');
    await waitForScene(page, 'SpaceFlightScene');
    expect(await credits()).toBe(after);
    errors.assertAndDetach(['Failed to load resource']);
  });
});
