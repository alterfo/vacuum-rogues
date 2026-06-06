import { test, expect } from '@playwright/test';

/**
 * E2E: Shop and equip flow
 *
 * Validates the critical loop:
 *   start game → buy engine module from shop → equip it → derived speed increases
 *
 * All interaction driven via window.__gameEngine to avoid coordinate-based clicks.
 * Assertions use waitForFunction or game-state reads.
 */

type GameEngine = {
  player: {
    credits: number;
    inventory: { items?: unknown[] };
  };
  playerLoadout: {
    install: (gearId: string) => boolean;
    derivedStats: () => { speed: number; canTakeOff: boolean };
    installedGearIds: () => string[];
  } | null;
  currentSceneType: string;
  transitionTo: (scene: string) => Promise<void>;
};

declare global {
  interface Window {
    __gameEngine: GameEngine;
  }
}

test.describe('Shop and Equip flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => !!(window as unknown as { __gameEngine?: unknown }).__gameEngine,
      { timeout: 15000 },
    );
    // Navigate to gameplay scene (creates player + starter loadout with eq_engine_i)
    await page.evaluate(async () => {
      const engine = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      await engine.transitionTo('SPACE_FLIGHT');
    });
    await page.waitForFunction(
      () =>
        (window as unknown as { __gameEngine: GameEngine }).__gameEngine
          .currentSceneType === 'SPACE_FLIGHT',
      { timeout: 8000 },
    );
  });

  test('buying and installing a higher-tier engine increases derived speed', async ({ page }) => {
    // Verify the starter loadout already has an engine → canTakeOff is true
    const initialStats = await page.evaluate(() => {
      const engine = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      return engine.playerLoadout?.derivedStats() ?? null;
    });
    expect(initialStats).not.toBeNull();
    expect(initialStats!.speed).toBeGreaterThan(0);
    const initialSpeed = initialStats!.speed;

    // Fund player for purchase
    await page.evaluate(() => {
      const engine = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      engine.player.credits = 10000;
    });

    // Simulate buying eq_engine_iii (price 9000) and installing it in the loadout.
    // This mirrors exactly what EquipmentShopScene.buyItem() + StationScene hangar do:
    //   - deduct credits
    //   - call loadout.install(gearId)
    const purchaseResult = await page.evaluate(() => {
      const engine = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      const player = engine.player;
      const loadout = engine.playerLoadout;
      if (!player || !loadout) return { ok: false, reason: 'no player or loadout' };
      const price = 9000;
      if (player.credits < price) return { ok: false, reason: 'insufficient credits' };
      player.credits -= price;
      const installed = loadout.install('eq_engine_iii');
      return { ok: installed, reason: installed ? 'ok' : 'install failed' };
    });

    expect(purchaseResult.ok).toBe(true);

    // Verify derived speed increased (eq_engine_iii tech level 5 > eq_engine_i tech level 2)
    const newStats = await page.evaluate(() => {
      const engine = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      return engine.playerLoadout?.derivedStats() ?? null;
    });
    expect(newStats).not.toBeNull();
    expect(newStats!.speed).toBeGreaterThan(initialSpeed);
    expect(newStats!.canTakeOff).toBe(true);

    // Verify the gear appears in installed list
    const installedGears = await page.evaluate(() => {
      const engine = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      return engine.playerLoadout?.installedGearIds() ?? [];
    });
    expect(installedGears).toContain('eq_engine_iii');
  });

  test('player cannot take off without an engine', async ({ page }) => {
    // Uninstall the engine
    const removed = await page.evaluate(() => {
      const engine = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      const loadout = engine.playerLoadout as unknown as {
        remove: (gearId: string) => boolean;
        derivedStats: () => { speed: number; canTakeOff: boolean };
      } | null;
      if (!loadout) return false;
      loadout.remove('eq_engine_i');
      return true;
    });
    expect(removed).toBe(true);

    const statsWithoutEngine = await page.evaluate(() => {
      const engine = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      return engine.playerLoadout?.derivedStats() ?? null;
    });
    expect(statsWithoutEngine).not.toBeNull();
    expect(statsWithoutEngine!.speed).toBe(0);
    expect(statsWithoutEngine!.canTakeOff).toBe(false);
  });
});
