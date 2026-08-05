import { test, expect } from '@playwright/test';
import { applyMockHeavySystems, waitForEngine, waitForScene } from './fixtures/mockHeavySystems';
import { ErrorCollector } from './helpers/errorCollector';

type VMHandle = {
  getParam: (id: string) => number;
  availableTransitions: () => Array<{ id: string; autoExecute?: boolean }>;
  execute: (id: string) => void;
  isFinished: () => boolean;
  isSuccess: () => boolean;
};

function pumpAutoExec(vm: VMHandle, maxSteps = 50): void {
  let steps = maxSteps;
  while (!vm.isFinished() && steps-- > 0) {
    const transitions = vm.availableTransitions();
    if (transitions.length === 0 || !transitions.every((t) => t.autoExecute)) break;
    vm.execute(transitions[0].id);
  }
}

test.describe('Playtest 02: Text quests', () => {
  test.setTimeout(120_000);

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
    await waitForScene(page, 'SpaceFlightScene', 20_000);

    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eLandOnPlanet?: () => Promise<void> } | null;
      };
      await engine.currentScene?.e2eLandOnPlanet?.();
    });
    await waitForScene(page, 'PlanetScene', 15_000);
  });

  test('should start reactor quest and verify time_left decreases after 5 transitions', async ({ page }) => {
    const errorCollector = new ErrorCollector(page);

    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        startTextQuest: (id: string, seed?: number) => Promise<void>;
      };
      await engine.startTextQuest('reactor', 42);
    });
    await waitForScene(page, 'TextQuestScene', 15_000);

    const initialTimeLeft = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const scene = engine.currentScene;
      if (!scene) return -1;

      if (scene['autoExecuteTimer'] != null) {
        clearTimeout(scene['autoExecuteTimer'] as number);
        scene['autoExecuteTimer'] = null;
      }

      const vm = scene['vm'] as VMHandle | null;
      if (!vm) return -1;

      let pumps = 20;
      while (!vm.isFinished() && pumps-- > 0) {
        const t = vm.availableTransitions();
        if (!t.every((x) => x.autoExecute)) break;
        vm.execute(t[0].id);
      }

      return vm.getParam('time_left');
    });
    expect(initialTimeLeft).toBe(120);

    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const scene = engine.currentScene;
      if (!scene) return;

      if (scene['autoExecuteTimer'] != null) {
        clearTimeout(scene['autoExecuteTimer'] as number);
        scene['autoExecuteTimer'] = null;
      }

      const vm = scene['vm'] as VMHandle | null;
      if (!vm) return;

      for (let i = 0; i < 5 && !vm.isFinished(); i++) {
        const playerTransitions = vm.availableTransitions().filter((t) => !t.autoExecute);
        if (playerTransitions.length === 0) break;
        vm.execute(playerTransitions[0].id);

        let pumps = 20;
        while (!vm.isFinished() && pumps-- > 0) {
          const auto = vm.availableTransitions();
          if (!auto.every((t) => t.autoExecute)) break;
          vm.execute(auto[0].id);
        }
      }
    });

    const finalTimeLeft = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const vm = engine.currentScene?.['vm'] as VMHandle | null;
      return vm?.getParam('time_left') ?? -1;
    });

    expect(finalTimeLeft).toBe(95);

    errorCollector.assertAndDetach();
  });

  test('should handle reactor quest failure gracefully', async ({ page }) => {
    const errorCollector = new ErrorCollector(page);

    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        startTextQuest: (id: string, seed?: number) => Promise<void>;
      };
      await engine.startTextQuest('reactor', 99);
    });
    await waitForScene(page, 'TextQuestScene', 15_000);

    const didFail = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const scene = engine.currentScene;
      if (!scene) return false;

      if (scene['autoExecuteTimer'] != null) {
        clearTimeout(scene['autoExecuteTimer'] as number);
        scene['autoExecuteTimer'] = null;
      }

      const vm = scene['vm'] as VMHandle | null;
      if (!vm) return false;

      let pumps = 20;
      while (!vm.isFinished() && pumps-- > 0) {
        const t = vm.availableTransitions();
        if (!t.every((x) => x.autoExecute)) break;
        vm.execute(t[0].id);
      }

      let moves = 0;
      while (!vm.isFinished() && moves < 30) {
        const playerTransitions = vm.availableTransitions().filter((t) => !t.autoExecute);
        if (playerTransitions.length === 0) break;
        vm.execute(playerTransitions[0].id);
        moves++;

        let ap = 20;
        while (!vm.isFinished() && ap-- > 0) {
          const auto = vm.availableTransitions();
          if (!auto.every((t) => t.autoExecute)) break;
          vm.execute(auto[0].id);
        }
      }

      return vm.isFinished() && !vm.isSuccess();
    });

    expect(didFail).toBe(true);

    await waitForScene(page, 'TextQuestScene', 5_000);

    await page.keyboard.press('Escape');
    await waitForScene(page, 'PlanetScene', 10_000);

    errorCollector.assertAndDetach();
  });

  test('should complete customs quest optimally with seed=1', async ({ page }) => {
    const errorCollector = new ErrorCollector(page);

    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        startTextQuest: (id: string, seed?: number) => Promise<void>;
      };
      await engine.startTextQuest('customs', 1);
    });
    await waitForScene(page, 'TextQuestScene', 15_000);

    const succeeded = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const scene = engine.currentScene;
      if (!scene) return false;

      if (scene['autoExecuteTimer'] != null) {
        clearTimeout(scene['autoExecuteTimer'] as number);
        scene['autoExecuteTimer'] = null;
      }

      const vm = scene['vm'] as VMHandle | null;
      if (!vm) return false;

      const pumpAuto = () => {
        let p = 50;
        while (!vm.isFinished() && p-- > 0) {
          const t = vm.availableTransitions();
          if (!t.every((x) => x.autoExecute)) break;
          vm.execute(t[0].id);
        }
      };

      let iterations = 0;
      while (!vm.isFinished() && iterations < 200) {
        iterations++;
        const transitions = vm.availableTransitions();

        if (transitions.every((t) => t.autoExecute)) {
          pumpAuto();
          continue;
        }

        const suspicion = vm.getParam('suspicion');
        if (suspicion >= 7) {
          const scanT = transitions.find((t) => t.id === 'scan');
          if (scanT) {
            vm.execute('scan');
            pumpAuto();
            continue;
          }
        }
        const passT = transitions.find((t) => t.id === 'pass');
        if (passT) {
          vm.execute('pass');
          pumpAuto();
        } else {
          break;
        }
      }

      return vm.isFinished() && vm.isSuccess();
    });

    expect(succeeded).toBe(true);

    errorCollector.assertAndDetach();
  });

  test('text quest scene renders correctly with no quest_art asset (graceful no-art fallback)', async ({ page }) => {
    const errorCollector = new ErrorCollector(page);

    for (const scriptId of ['auction', 'reactor', 'tribunal']) {
      await page.evaluate(async (id) => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          startTextQuest: (id: string, seed?: number) => Promise<void>;
        };
        await engine.startTextQuest(id, 7);
      }, scriptId);
      await waitForScene(page, 'TextQuestScene', 15_000);

      const narration = await page.evaluate(() => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: Record<string, unknown> | null;
        };
        const text = engine.currentScene?.['vmNarrationText'] as
          | { text?: string }
          | null
          | undefined;
        return text?.text ?? '';
      });
      expect(narration.length).toBeGreaterThan(0);
    }

    errorCollector.assertAndDetach();
  });
});
