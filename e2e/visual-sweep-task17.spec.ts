import { test, type Page } from '@playwright/test';
import { applyMockHeavySystems, waitForEngine, waitForScene } from './fixtures/mockHeavySystems';


type EngineHandle = {
  currentScene: Record<string, unknown> | null;
  transitionTo: (scene: string, ctx?: object) => Promise<void>;
  galaxy: {
    systems: Array<{
      id: string;
      planets: Array<{ id: string; isHabitable: boolean }>;
      stations?: unknown[];
    }>;
  } | null;
  player: { currentSystemId: string } | null;
  startTextQuest: (id: string, seed?: number) => Promise<void>;
};

const DIR = 'e2e/screenshots/task17';

async function shot(page: Page, name: string): Promise<void> {
  await page.locator('canvas').screenshot({ path: `${DIR}/${name}.png` });
}

async function setupNewGame(page: Page): Promise<void> {
  await applyMockHeavySystems(page);
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        'sr_help_seen',
        JSON.stringify([
          'welcome', 'RACE_SELECTION', 'SPACE_FLIGHT', 'STAR_MAP', 'PLANET',
          'TRADE', 'STATION', 'EQUIPMENT_SHOP', 'GOVERNMENT', 'INFO_CENTER',
          'BANK', 'INVENTORY', 'TEXT_QUEST', 'quest-journal', 'combat', 'refuel',
        ]),
      );
    } catch {
      /* storage unavailable */
    }
  });
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

async function gotoHabitablePlanet(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
    const systems = engine.galaxy?.systems ?? [];
    const here = systems.find((s) => s.id === engine.player?.currentSystemId);
    const planet =
      here?.planets.find((p) => p.isHabitable) ??
      systems.flatMap((s) => s.planets).find((p) => p.isHabitable);
    if (!planet) return;
    await engine.transitionTo('PLANET', { gameEngine: engine, planet });
  });
  await waitForScene(page, 'PlanetScene', 15_000);
  await page.waitForFunction(
    () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        loadingOverlayObjects?: unknown[];
      };
      return (engine.loadingOverlayObjects?.length ?? 0) === 0;
    },
    undefined,
    { timeout: 15_000 },
  ).catch(() => {});
}

test('visual sweep: capture every player-facing scene', async ({ page }) => {
  test.setTimeout(180_000);
  await setupNewGame(page);

  await page.waitForTimeout(600);
  await shot(page, '01-space-flight');

  await page.evaluate(async () => {
    const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
    await engine.transitionTo('STAR_MAP', { gameEngine: engine });
  });
  await waitForScene(page, 'StarMapScene', 15_000);
  await page.waitForTimeout(400);
  await shot(page, '02-star-map');

  await gotoHabitablePlanet(page);
  await page.waitForTimeout(400);
  await shot(page, '03-planet');

  await page.evaluate(async () => {
    const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
    const systems = engine.galaxy?.systems ?? [];
    const planet = systems.flatMap((s) => s.planets).find((p) => p.isHabitable);
    await engine.transitionTo('TRADE', { gameEngine: engine, planet });
  });
  await waitForScene(page, 'TradeScene', 15_000).catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, '04-trade');

  await page.evaluate(async () => {
    const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
    const systems = engine.galaxy?.systems ?? [];
    const planet = systems.flatMap((s) => s.planets).find((p) => p.isHabitable);
    await engine.transitionTo('EQUIPMENT_SHOP', { gameEngine: engine, planet });
  });
  await waitForScene(page, 'EquipmentShopScene', 15_000).catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, '05-equipment-shop');

  await page.evaluate(async () => {
    const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
    const systems = engine.galaxy?.systems ?? [];
    const planet = systems.flatMap((s) => s.planets).find((p) => p.isHabitable);
    await engine.transitionTo('GOVERNMENT', { gameEngine: engine, planet });
  });
  await waitForScene(page, 'GovernmentScene', 15_000).catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, '06-government');

  await page.evaluate(async () => {
    const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
    const systems = engine.galaxy?.systems ?? [];
    const planet = systems.flatMap((s) => s.planets).find((p) => p.isHabitable);
    await engine.transitionTo('INFO_CENTER', { gameEngine: engine, planet });
  });
  await waitForScene(page, 'InfoCenterScene', 15_000).catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, '07-info-center');

  await page.evaluate(async () => {
    const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
    const systems = engine.galaxy?.systems ?? [];
    const planet = systems.flatMap((s) => s.planets).find((p) => p.isHabitable);
    await engine.transitionTo('BANK', { gameEngine: engine, planet });
  });
  await waitForScene(page, 'BankScene', 15_000).catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, '08-bank');

  const hasStation = await page.evaluate(async () => {
    const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
    const station = engine.galaxy?.systems.flatMap((s) => s.stations ?? [])[0];
    if (!station) return false;
    await engine.transitionTo('STATION', { gameEngine: engine, station });
    return true;
  });
  if (hasStation) {
    await waitForScene(page, 'StationScene', 15_000).catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, '09-station');
  }

  await gotoHabitablePlanet(page);
  await page.evaluate(async () => {
    const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
    await engine.startTextQuest('reactor', 42);
  });
  await waitForScene(page, 'TextQuestScene', 15_000).catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, '10-text-quest');
});
