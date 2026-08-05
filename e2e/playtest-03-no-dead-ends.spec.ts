import { test, expect } from '@playwright/test';
import { applyMockHeavySystems, waitForEngine, waitForScene } from './fixtures/mockHeavySystems';
import { ErrorCollector } from './helpers/errorCollector';

type EngineHandle = {
  currentScene: { constructor: { name: string } } | null;
  currentSceneType: string;
  transitionTo: (scene: string, ctx?: object) => Promise<void>;
  galaxy: { systems: Array<{ id: string; planets: unknown[]; stations: unknown[] }> } | null;
  player: { currentSystemId: string } | null;
  saveManager: { hasSave: () => Promise<boolean>; clearSave?: () => Promise<void> };
};


test.describe('Playtest 03: No dead-ends', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
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
  });

  test('every scene has a way back', async ({ page }) => {
    const errorCollector = new ErrorCollector(page);

    const getCtx = () =>
      page.evaluate(() => {
        const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
        const sys = engine.galaxy?.systems[0];
        return {
          planetId: (sys?.planets[0] as { id?: string })?.id ?? '',
          stationId: (sys?.stations[0] as { id?: string })?.id ?? '',
        };
      });

    const goTo = async (sceneType: string, extraCtx: Record<string, unknown> = {}) => {
      await page.evaluate(
        async ({ scene, ctx }) => {
          const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
          await engine.transitionTo(scene, { gameEngine: engine, ...ctx });
        },
        { scene: sceneType, ctx: extraCtx }
      );
    };

    const callGoBack = async () => {
      await page.evaluate(async () => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: Record<string, unknown> | null;
        };
        const scene = engine.currentScene;
        if (typeof scene?.['goBack'] === 'function') {
          await (scene['goBack'] as () => Promise<void>)();
        }
      });
    };

    const waitForSceneChange = async (fromScene: string, timeout = 10_000) => {
      await page.waitForFunction(
        (s) => {
          const eng = (window as Record<string, unknown>).__gameEngine as {
            currentScene: { constructor: { name: string } } | null;
          };
          return eng?.currentScene?.constructor.name !== s;
        },
        fromScene,
        { timeout }
      );
    };

    await goTo('STAR_MAP');
    await waitForScene(page, 'StarMapScene', 10_000);
    await goTo('SPACE_FLIGHT');
    await waitForScene(page, 'SpaceFlightScene', 10_000);

    const { planetId, stationId } = await getCtx();
    if (planetId) {
      await page.evaluate(
        async ({ pid }) => {
          const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
          const planet = engine.galaxy?.systems
            .flatMap((s) => s.planets)
            .find((p) => (p as { id?: string })?.id === pid);
          if (planet) {
            await engine.transitionTo('PLANET', { gameEngine: engine, planet });
          }
        },
        { pid: planetId }
      );
      await waitForScene(page, 'PlanetScene', 10_000);
      await goTo('SPACE_FLIGHT');
      await waitForScene(page, 'SpaceFlightScene', 10_000);
    }

    if (planetId) {
      await page.evaluate(
        async ({ pid }) => {
          const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
          const planet = engine.galaxy?.systems
            .flatMap((s) => s.planets)
            .find((p) => (p as { id?: string })?.id === pid);
          if (planet) {
            await engine.transitionTo('TRADE', { gameEngine: engine, planet });
          }
        },
        { pid: planetId }
      );
      await waitForScene(page, 'TradeScene', 10_000);
      await page.keyboard.press('Escape');
      await waitForSceneChange('TradeScene');
    }

    await goTo('SPACE_FLIGHT');
    await waitForScene(page, 'SpaceFlightScene', 10_000);
    await goTo('INVENTORY');
    await waitForScene(page, 'InventoryScene', 10_000);
    await page.keyboard.press('Escape');
    await waitForSceneChange('InventoryScene');

    if (planetId) {
      await page.evaluate(
        async ({ pid }) => {
          const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
          const planet = engine.galaxy?.systems
            .flatMap((s) => s.planets)
            .find((p) => (p as { id?: string })?.id === pid);
          if (planet) {
            await engine.transitionTo('INFO_CENTER', { gameEngine: engine, planet });
          }
        },
        { pid: planetId }
      );
      await waitForScene(page, 'InfoCenterScene', 10_000);
      await callGoBack();
      await waitForSceneChange('InfoCenterScene');
    }

    if (planetId) {
      await page.evaluate(
        async ({ pid }) => {
          const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
          const planet = engine.galaxy?.systems
            .flatMap((s) => s.planets)
            .find((p) => (p as { id?: string })?.id === pid);
          if (planet) {
            await engine.transitionTo('GOVERNMENT', { gameEngine: engine, planet });
          }
        },
        { pid: planetId }
      );
      await waitForScene(page, 'GovernmentScene', 10_000);
      await callGoBack();
      await waitForSceneChange('GovernmentScene');
    }

    if (stationId) {
      await page.evaluate(
        async ({ sid }) => {
          const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
          const station = engine.galaxy?.systems
            .flatMap((s) => s.stations)
            .find((st) => (st as { id?: string })?.id === sid);
          if (station) {
            await engine.transitionTo('STATION', { gameEngine: engine, station });
          }
        },
        { sid: stationId }
      );
      await waitForScene(page, 'StationScene', 10_000);
      await callGoBack();
      await waitForSceneChange('StationScene');
    }

    await goTo('SPACE_FLIGHT');
    await waitForScene(page, 'SpaceFlightScene', 10_000);
    await goTo('DIALOGUE');
    await waitForScene(page, 'DialogueScene', 10_000);
    await callGoBack();
    await waitForSceneChange('DialogueScene');

    if (planetId) {
      await page.evaluate(
        async ({ pid }) => {
          const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
          const planet = engine.galaxy?.systems
            .flatMap((s) => s.planets)
            .find((p) => (p as { id?: string })?.id === pid);
          if (planet) {
            await engine.transitionTo('EQUIPMENT_SHOP', { gameEngine: engine, planet });
          }
        },
        { pid: planetId }
      );
      await waitForScene(page, 'EquipmentShopScene', 10_000);
      await page.keyboard.press('Escape');
      await waitForSceneChange('EquipmentShopScene');
    }

    if (planetId) {
      await page.evaluate(
        async ({ pid }) => {
          const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
          const planet = engine.galaxy?.systems
            .flatMap((s) => s.planets)
            .find((p) => (p as { id?: string })?.id === pid);
          if (planet) {
            await engine.transitionTo('PLANET', { gameEngine: engine, planet });
          }
        },
        { pid: planetId }
      );
      await waitForScene(page, 'PlanetScene', 10_000);
      await page.evaluate(async () => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          startTextQuest: (id: string, seed?: number) => Promise<void>;
        };
        await engine.startTextQuest('reactor', 42);
      });
      await waitForScene(page, 'TextQuestScene', 10_000);
      await page.keyboard.press('Escape');
      await waitForSceneChange('TextQuestScene');
    }

    await goTo('WIN_SCREEN');
    await waitForScene(page, 'WinScene', 10_000);
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      await engine.transitionTo('MAIN_MENU', { gameEngine: engine });
    });
    await waitForSceneChange('WinScene');

    errorCollector.assertAndDetach();
  });

  test('main menu continue without save shows disabled button', async ({ page }) => {
    const errorCollector = new ErrorCollector(page);

    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const slots = await engine.saveManager.hasSave
        ? await (engine.saveManager as unknown as { listSlots: () => Promise<Array<{ slotId: string }>> }).listSlots()
        : [];
      for (const slot of slots) {
        await (engine.saveManager as unknown as { deleteSlot: (id: string) => Promise<void> }).deleteSlot(slot.slotId);
      }
    });

    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      await engine.transitionTo('MAIN_MENU', { gameEngine: engine });
    });
    await waitForScene(page, 'MainMenuScene', 10_000);

    await page.waitForFunction(
      () => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: Record<string, unknown> | null;
        };
        const scene = engine?.currentScene;
        return scene !== null && scene['saveAvailable'] === false;
      },
      { timeout: 10_000 }
    );

    const continueBtnAlpha = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const scene = engine?.currentScene;
      const buttonsContainer = scene?.['buttonsContainer'] as {
        children: Array<{ alpha: number }>;
      } | null;
      return buttonsContainer?.children[1]?.alpha ?? 1;
    });

    expect(continueBtnAlpha).toBeLessThan(1);

    errorCollector.assertAndDetach();
  });

  test('info center search returns results', async ({ page }) => {
    const errorCollector = new ErrorCollector(page);

    const { planetId } = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const sys = engine.galaxy?.systems[0];
      return {
        planetId: (sys?.planets[0] as { id?: string })?.id ?? '',
      };
    });

    expect(planetId, 'galaxy must have at least one planet').toBeTruthy();

    await page.evaluate(
      async ({ pid }) => {
        const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
        const planet = engine.galaxy?.systems
          .flatMap((s) => s.planets)
          .find((p) => (p as { id?: string })?.id === pid);
        if (planet) {
          await engine.transitionTo('INFO_CENTER', { gameEngine: engine, planet });
        }
      },
      { pid: planetId }
    );
    await waitForScene(page, 'InfoCenterScene', 10_000);

    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const scene = engine?.currentScene;
      if (typeof scene?.['runGearSearch'] === 'function') {
        (scene['runGearSearch'] as () => void)();
      }
    });

    await page.waitForFunction(
      () => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: Record<string, unknown> | null;
        };
        const scene = engine?.currentScene;
        const results = scene?.['gearResults'] as unknown[] | undefined;
        return Array.isArray(results) && results.length > 0;
      },
      { timeout: 5_000 }
    );

    const resultCount = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const results = engine?.currentScene?.['gearResults'] as unknown[] | undefined;
      return results?.length ?? 0;
    });

    expect(resultCount).toBeGreaterThan(0);

    errorCollector.assertAndDetach();
  });
});
