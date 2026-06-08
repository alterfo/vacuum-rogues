import { test, expect } from '@playwright/test';
import { applyMockHeavySystems, waitForEngine, waitForScene } from './fixtures/mockHeavySystems';
import { MonkeyTester } from './helpers/monkeyTester';
import { ErrorCollector } from './helpers/errorCollector';

// Each Playwright mouse action takes ~500ms due to PixiJS event processing.
// beforeEach includes faction selection (~18s) + landing (~15s) = ~33s setup.
// Keep mouse-action counts low: 30 × 500ms = 15s; total ≈ 48s — within 120s budget.

type EngineHandle = {
  currentScene: Record<string, unknown> | null;
  isRunning?: boolean;
  transitionTo: (scene: string, ctx?: object) => Promise<void>;
  startTextQuest: (id: string, seed?: number) => Promise<void>;
  galaxy: { systems: { planets: unknown[] }[] } | null;
  player: {
    credits: number;
    ship: { cargoCapacity: number };
    inventory: { resources: { type: string; amount: number }[] };
  } | null;
};

type VMHandle = {
  availableTransitions: () => Array<{ id: string; autoExecute?: boolean }>;
  execute: (id: string) => void;
  isFinished: () => boolean;
  isSuccess: () => boolean;
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

test.describe('Monkey 02: Planet and quest scene resilience', () => {
  test.setTimeout(120_000);

  test('monkey: 30 random clicks on PlanetScene do not crash', async ({ page }) => {
    await setupToSpaceFlight(page);
    await landOnPlanet(page);

    const errorCollector = new ErrorCollector(page);
    const monkey = new MonkeyTester(page, 42);

    await monkey.run(30, { delayMs: 0 });

    // Scene must be either PlanetScene or SpaceFlightScene
    // (random click on take-off button is acceptable)
    const sceneName = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      return engine?.currentScene?.constructor?.name ?? null;
    });
    expect(sceneName).not.toBeNull();
    expect(['PlanetScene', 'SpaceFlightScene']).toContain(sceneName);

    errorCollector.assertNoErrors();
    errorCollector.detach();
  });

  test('monkey: rapid transitions in TextQuestScene are safe', async ({ page }) => {
    await setupToSpaceFlight(page);
    await landOnPlanet(page);

    const errorCollector = new ErrorCollector(page);

    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      await engine.startTextQuest('reactor', 99);
    });
    await waitForScene(page, 'TextQuestScene', 15_000);

    // Execute 30 random available transitions via VM directly (no mouse — instant)
    const questFinished = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const scene = engine.currentScene;
      if (!scene) return false;

      // Cancel pending auto-execute timer from scene rendering
      if (scene['autoExecuteTimer'] != null) {
        clearTimeout(scene['autoExecuteTimer'] as number);
        scene['autoExecuteTimer'] = null;
      }

      const vm = scene['vm'] as VMHandle | null;
      if (!vm) return false;

      // Seeded RNG for reproducibility
      let seed = 99;
      const rand = () => {
        seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
        return seed / 0x7fffffff;
      };

      let iterations = 0;
      while (!vm.isFinished() && iterations < 30) {
        iterations++;
        const transitions = vm.availableTransitions();
        if (transitions.length === 0) break;

        const idx = Math.floor(rand() * transitions.length);
        vm.execute(transitions[idx].id);

        // Pump consecutive auto-executes after each player choice
        let pumps = 20;
        while (!vm.isFinished() && pumps-- > 0) {
          const auto = vm.availableTransitions();
          if (!auto.every((t) => t.autoExecute)) break;
          vm.execute(auto[0].id);
        }
      }

      return vm.isFinished();
    });

    // Quest must have reached a terminal state (not stuck)
    expect(questFinished).toBe(true);

    errorCollector.assertNoErrors();
    errorCollector.detach();
  });

  test('monkey: trade scene button mashing does not corrupt player state', async ({ page }) => {
    await setupToSpaceFlight(page);
    await landOnPlanet(page);

    const errorCollector = new ErrorCollector(page);

    // Record initial credits before opening trade
    const initialCredits = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      return engine?.player?.credits ?? 0;
    });

    // Open trade scene with first planet
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const planet = engine.galaxy?.systems[0]?.planets[0];
      if (planet) {
        await engine.transitionTo('TRADE', { gameEngine: engine, planet });
      }
    });
    await waitForScene(page, 'TradeScene', 15_000);

    const monkey = new MonkeyTester(page, 17);
    await monkey.run(30, { delayMs: 0, types: ['leftClick'] });

    // Player must not have negative credits
    const credits = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      return engine?.player?.credits ?? 0;
    });
    expect(credits).toBeGreaterThanOrEqual(0);

    // Cargo must not exceed ship capacity
    const cargoOk = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const player = engine?.player;
      if (!player) return true;
      const totalCargo = player.inventory.resources.reduce((sum, r) => sum + r.amount, 0);
      return totalCargo <= player.ship.cargoCapacity;
    });
    expect(cargoOk).toBe(true);

    // Credits must not exceed initial (no duplication bug)
    expect(credits).toBeLessThanOrEqual(initialCredits);

    errorCollector.assertNoErrors();
    errorCollector.detach();
  });
});
