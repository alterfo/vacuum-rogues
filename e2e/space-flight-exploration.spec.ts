import { test, expect, type Page } from '@playwright/test';
import { applyMockHeavySystems, waitForEngine, waitForScene } from './fixtures/mockHeavySystems';

/**
 * Task 1 (20260609-e2e-visual-spaceflightscene): Browser exploration session.
 *
 * Drives the real SpaceFlightScene through the `__gameEngine` / `e2e*` hooks
 * (never pixel clicks — CLAUDE.md E2E rules) and captures a screenshot of every
 * visually interesting state into `e2e/screenshots/exploration/`. The captured
 * PNGs are inspected by hand (and by the agent) to find remaining visual
 * regressions: planet circular masking, ship visibility/glow, sun corona, HUD.
 *
 * This is an exploration harness, not an assertion suite — it asserts only that
 * the scene loads and screenshots are produced. Visual judgement happens by
 * reviewing the output PNGs. Proper assertion tests land in Task 4.
 */

const SHOT_DIR = 'e2e/screenshots/exploration';

type SceneDiag = {
  centerX: number;
  centerY: number;
  screenW: number;
  screenH: number;
  planets: { name: string; wx: number; wy: number; radius: number }[];
  ship: { x: number; y: number };
  npcCount: number;
};

async function setupNewGame(page: Page): Promise<void> {
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
      currentScene: {
        e2eSelectFaction?: (f: string) => void;
        e2eConfirmSelection?: () => void;
      } | null;
    };
    engine.currentScene?.e2eSelectFaction?.('OUTLANDERS');
    engine.currentScene?.e2eConfirmSelection?.();
  });
  await waitForScene(page, 'SpaceFlightScene', 20_000);
}

/** Read internal scene geometry (world coords of star, planets, ship). */
async function readDiag(page: Page): Promise<SceneDiag> {
  return page.evaluate(() => {
    const engine = (window as Record<string, unknown>).__gameEngine as {
      currentScene: Record<string, unknown> | null;
    };
    const scene = engine.currentScene as Record<string, unknown>;
    const star = scene['starRenderer'] as { centerX: number; centerY: number };
    const renderer = scene['renderer'] as {
      app: { screen: { width: number; height: number } };
    };
    const pm = scene['planetManager'] as {
      planetSprites: {
        planet: { name: string };
        container: { x: number; y: number };
        displayRadius: number;
      }[];
    };
    const ship = scene['shipPhysics'] as { shipX: number; shipY: number } | null;
    const npc = scene['npcManager'] as { npcCount: number };
    return {
      centerX: star.centerX,
      centerY: star.centerY,
      screenW: renderer.app.screen.width,
      screenH: renderer.app.screen.height,
      planets: pm.planetSprites.map((s) => ({
        name: s.planet.name,
        wx: s.container.x,
        wy: s.container.y,
        radius: s.displayRadius,
      })),
      ship: { x: ship?.shipX ?? 0, y: ship?.shipY ?? 0 },
      npcCount: npc.npcCount,
    };
  });
}

/** Park the camera so world point (wx,wy) sits at screen centre at given zoom. */
async function focusWorld(page: Page, wx: number, wy: number, zoom: number): Promise<void> {
  await page.evaluate(
    ({ wx, wy, zoom }) => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: {
          e2eSetCameraZoom?: (z: number) => void;
          e2eSetCameraPan?: (x: number, y: number) => void;
          starRenderer?: { centerX: number; centerY: number };
        } | null;
      };
      const scene = engine.currentScene;
      if (!scene) return;
      const cx = scene.starRenderer?.centerX ?? 0;
      const cy = scene.starRenderer?.centerY ?? 0;
      scene.e2eSetCameraZoom?.(zoom);
      scene.e2eSetCameraPan?.(cx - wx * zoom, cy - wy * zoom);
    },
    { wx, wy, zoom },
  );
}

/** Wait for a few render frames so the WebGL canvas has a fresh composited frame. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let n = 0;
        const tick = () => (n++ < 4 ? requestAnimationFrame(tick) : resolve());
        requestAnimationFrame(tick);
      }),
  );
}

async function shot(page: Page, name: string): Promise<void> {
  await settle(page);
  await page.locator('canvas').screenshot({ path: `${SHOT_DIR}/${name}.png` });
}

test.describe('SpaceFlightScene visual exploration', () => {
  test.setTimeout(90_000);

  test('capture every visual state', async ({ page }) => {
    await setupNewGame(page);

    const diag = await readDiag(page);
    // Surface geometry in the test log for the exploration write-up.
    // eslint-disable-next-line no-console
    console.log('SCENE_DIAG', JSON.stringify(diag));

    expect(diag.planets.length).toBeGreaterThan(0);

    // 1. Initial scene — default camera, full system in view.
    await shot(page, 'space-01-initial');

    // 2. Each planet, zoomed in close to inspect circular masking.
    for (let i = 0; i < diag.planets.length; i++) {
      const p = diag.planets[i];
      await focusWorld(page, p.wx, p.wy, 3);
      await shot(page, `space-02-planet-${i}-${p.name.replace(/[^a-zA-Z0-9]/g, '_')}`);
    }

    // 3. Sun close-up — corona/glow quality.
    await focusWorld(page, diag.centerX, diag.centerY, 1.6);
    await shot(page, 'space-03-sun');

    // 4. Ship close-up — outline + engine glow.
    await focusWorld(page, diag.ship.x, diag.ship.y, 3.5);
    await shot(page, 'space-04-ship');

    // 5. Route line — plan a route to the first planet, then screenshot.
    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const scene = engine.currentScene as Record<string, unknown>;
      const pm = scene['planetManager'] as {
        planetSprites: {
          planet: { id: string };
          screenX: number;
          screenY: number;
        }[];
      };
      const first = pm.planetSprites[0];
      if (!first) return;
      const fn = scene['handlePlanetRouteRequested'] as (
        id: string,
        x: number,
        y: number,
      ) => void;
      fn.call(scene, first.planet.id, first.screenX, first.screenY);
    });
    // Reset camera to default so the whole route line is visible.
    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eSetCameraZoom?: (z: number) => void } | null;
      };
      engine.currentScene?.e2eSetCameraZoom?.(0.6);
    });
    await shot(page, 'space-05-route');

    const routeSet = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      return engine.currentScene?.['plannedRoute'] != null;
    });
    expect(routeSet).toBe(true);

    // 6. Ход (play/pause) → ship starts moving → capture mid-flight.
    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2ePlayPause?: () => void } | null;
      };
      engine.currentScene?.e2ePlayPause?.();
    });
    await settle(page);
    await settle(page);
    await shot(page, 'space-06-after-turn');

    // 7. NPC ships (if any spawned) — focus on the first.
    if (diag.npcCount > 0) {
      const npcPos = await page.evaluate(() => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: Record<string, unknown> | null;
        };
        const scene = engine.currentScene as Record<string, unknown>;
        const nm = scene['npcManager'] as {
          npcSprites?: { container: { x: number; y: number } }[];
        };
        const s = nm.npcSprites?.[0];
        return s ? { x: s.container.x, y: s.container.y } : null;
      });
      if (npcPos) {
        await focusWorld(page, npcPos.x, npcPos.y, 3);
        await shot(page, 'space-07-npc');
      }
    }
  });
});
