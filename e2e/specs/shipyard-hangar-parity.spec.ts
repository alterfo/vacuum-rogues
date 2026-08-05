import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import {
  applyMockHeavySystems,
  waitForEngine,
  waitForScene,
} from '../fixtures/mockHeavySystems';


const SCREENSHOT_DIR = 'e2e/screenshots';

type EngineHandle = {
  currentScene:
    | {
        constructor: { name: string };
        e2eSelectFaction?: (f: string) => void;
        e2eConfirmSelection?: () => void;
        e2eGetPlanets?: () => { id: string }[];
        e2eLandOnPlanet?: () => Promise<void>;
        e2eOpenHangar?: () => void;
        planet?: unknown;
      }
    | null;
  transitionTo: (scene: string, ctx?: object) => Promise<void>;
};

async function setupNewGame(page: import('@playwright/test').Page): Promise<void> {
  await applyMockHeavySystems(page);
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        'sr_help_seen',
        JSON.stringify([
          'welcome', 'RACE_SELECTION', 'SPACE_FLIGHT', 'STAR_MAP', 'PLANET',
          'TRADE', 'STATION', 'EQUIPMENT_SHOP', 'GOVERNMENT', 'INFO_CENTER',
          'BANK', 'INVENTORY', 'TEXT_QUEST', 'quest-journal', 'combat',
        ]),
      );
    } catch {
      /* storage unavailable — onboarding degrades to "nothing seen" */
    }
  });
  await page.goto('/');
  await waitForEngine(page);
  await page.evaluate(async () => {
    const engine = (window as unknown as { __gameEngine: EngineHandle }).__gameEngine;
    await engine.transitionTo('RACE_SELECTION', { gameEngine: engine });
  });
  await waitForScene(page, 'RaceSelectionScene');
  await page.evaluate(() => {
    const engine = (window as unknown as { __gameEngine: EngineHandle }).__gameEngine;
    engine.currentScene?.e2eSelectFaction?.('OUTLANDERS');
    engine.currentScene?.e2eConfirmSelection?.();
  });
  await waitForScene(page, 'SpaceFlightScene', 20_000);
}

test.describe('Shipyard hangar visual parity (planet Верфь ⇄ station)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test('planet Верфь АНГАР tab renders the shared hangar board', async ({ page }) => {
    await setupNewGame(page);

    await page.evaluate(async () => {
      const engine = (window as unknown as { __gameEngine: EngineHandle }).__gameEngine;
      await engine.currentScene?.e2eLandOnPlanet?.();
    });
    await waitForScene(page, 'PlanetScene', 15_000);
    await page.evaluate(async () => {
      const engine = (window as unknown as { __gameEngine: EngineHandle }).__gameEngine;
      const planet = engine.currentScene?.planet;
      await engine.transitionTo('EQUIPMENT_SHOP', { gameEngine: engine, planet });
    });
    await waitForScene(page, 'EquipmentShopScene', 15_000);
    const opened = await page.evaluate(() => {
      const engine = (window as unknown as { __gameEngine: EngineHandle }).__gameEngine;
      const open = engine.currentScene?.e2eOpenHangar;
      if (!open) return false;
      open.call(engine.currentScene);
      return true;
    });
    expect(opened).toBe(true);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/hangar-planet-verf.png` });
  });

  test('station hangar service renders the shared hangar board', async ({ page }) => {
    await setupNewGame(page);

    await page.evaluate(async () => {
      const engine = (window as unknown as { __gameEngine: EngineHandle }).__gameEngine;
      await engine.transitionTo('STATION', {
        gameEngine: engine,
        station: {
          id: 'craft-parity',
          name: 'Тестовый центр крафта',
          type: 'CRAFT_CENTER',
          faction: 'OUTLANDERS',
          orbitRadius: 100,
          orbitAngle: 0,
        },
      });
    });
    await waitForScene(page, 'StationScene', 15_000);
    const opened = await page.evaluate(() => {
      const engine = (window as unknown as { __gameEngine: EngineHandle }).__gameEngine;
      const open = engine.currentScene?.e2eOpenHangar;
      if (!open) return false;
      open.call(engine.currentScene);
      return true;
    });
    expect(opened).toBe(true);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/hangar-station.png` });
  });
});
