import { test, type Page } from '@playwright/test';
import { applyMockHeavySystems, waitForEngine, waitForScene } from './fixtures/mockHeavySystems';

// ---------------------------------------------------------------------------
// Task 17 visual audit sweep. NOT a CI gate — a developer tool that walks a
// fresh game through every player-facing scene and drops a full-canvas
// screenshot per scene into e2e/screenshots/task17/. Run with:
//   NO_PROXY=localhost,127.0.0.1 npx playwright test e2e/visual-sweep-task17.spec.ts
// then eyeball the PNGs for sameness / misalignment / missing art / dead space.
// The regression guards for whatever this sweep uncovers live in
// playtest-regression.spec.ts (real-pointer where hit geometry is involved).
// ---------------------------------------------------------------------------

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
  // Full canvas capture — the world only animates while the loop ticks, but a
  // single frame is enough to judge composition/art/alignment.
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
  // Let the lazy faction panorama settle so the composed scene is captured.
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

  // 1. Space flight (home system)
  await page.waitForTimeout(600);
  await shot(page, '01-space-flight');

  // 2. Star map
  await page.evaluate(async () => {
    const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
    await engine.transitionTo('STAR_MAP', { gameEngine: engine });
  });
  await waitForScene(page, 'StarMapScene', 15_000);
  await page.waitForTimeout(400);
  await shot(page, '02-star-map');

  // 3. Planet (habitable → full service menu)
  await gotoHabitablePlanet(page);
  await page.waitForTimeout(400);
  await shot(page, '03-planet');

  // 4. Trade / market
  await page.evaluate(async () => {
    const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
    const systems = engine.galaxy?.systems ?? [];
    const planet = systems.flatMap((s) => s.planets).find((p) => p.isHabitable);
    await engine.transitionTo('TRADE', { gameEngine: engine, planet });
  });
  await waitForScene(page, 'TradeScene', 15_000).catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, '04-trade');

  // 5. Equipment shop
  await page.evaluate(async () => {
    const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
    const systems = engine.galaxy?.systems ?? [];
    const planet = systems.flatMap((s) => s.planets).find((p) => p.isHabitable);
    await engine.transitionTo('EQUIPMENT_SHOP', { gameEngine: engine, planet });
  });
  await waitForScene(page, 'EquipmentShopScene', 15_000).catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, '05-equipment-shop');

  // 6. Government (quest board is reachable from here / planet)
  await page.evaluate(async () => {
    const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
    const systems = engine.galaxy?.systems ?? [];
    const planet = systems.flatMap((s) => s.planets).find((p) => p.isHabitable);
    await engine.transitionTo('GOVERNMENT', { gameEngine: engine, planet });
  });
  await waitForScene(page, 'GovernmentScene', 15_000).catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, '06-government');

  // 7. Info center (news feed)
  await page.evaluate(async () => {
    const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
    const systems = engine.galaxy?.systems ?? [];
    const planet = systems.flatMap((s) => s.planets).find((p) => p.isHabitable);
    await engine.transitionTo('INFO_CENTER', { gameEngine: engine, planet });
  });
  await waitForScene(page, 'InfoCenterScene', 15_000).catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, '07-info-center');

  // 8. Bank
  await page.evaluate(async () => {
    const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
    const systems = engine.galaxy?.systems ?? [];
    const planet = systems.flatMap((s) => s.planets).find((p) => p.isHabitable);
    await engine.transitionTo('BANK', { gameEngine: engine, planet });
  });
  await waitForScene(page, 'BankScene', 15_000).catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, '08-bank');

  // 9. Station (if any exists)
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

  // 10. Text quest
  await gotoHabitablePlanet(page);
  await page.evaluate(async () => {
    const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
    await engine.startTextQuest('reactor', 42);
  });
  await waitForScene(page, 'TextQuestScene', 15_000).catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, '10-text-quest');
});
