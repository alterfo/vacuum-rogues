import { test, expect, type Page } from '@playwright/test';
import { waitForEngine, waitForScene } from './fixtures/mockHeavySystems';

/**
 * Letsplay discovery session — full game loop with REAL visuals.
 *
 * Unlike the regular E2E suite this spec does NOT hide the flight background:
 * the point is to see the game exactly as the player sees it and capture a
 * screenshot of every scene/state for visual inspection. ONNX/audio are still
 * mocked (headless stability), but rendering is untouched.
 *
 * This is an exploration harness, not an assertion suite. Each segment is a
 * "soft step": failures are recorded and logged, but the run continues so one
 * broken scene doesn't hide bugs in the rest. The final report (STEP_RESULTS,
 * JS_ERRORS lines in stdout) plus the PNGs in e2e/screenshots/letsplay/ are
 * the deliverable.
 */

const SHOT_DIR = 'e2e/screenshots/letsplay';

type EngineHandle = {
  transitionTo: (scene: string, ctx?: object) => Promise<void>;
  galaxy: {
    systems: {
      planets: { name?: string }[];
      stations: { id?: string; name?: string }[];
    }[];
  } | null;
  player: { credits?: number; currentSystemId?: string } | null;
  currentScene: Record<string, unknown> | null;
};

/**
 * NOTE: page.evaluate callbacks are serialized — they cannot close over module
 * scope. This declaration exists only for TypeScript; the real implementation
 * is installed on `window` (global scope) by the addInitScript below, which is
 * what the free identifier `getEngine` resolves to inside the browser.
 */
declare function getEngine(): EngineHandle;

/** Wait a few rAF frames so the WebGL canvas has a fresh composited frame. */
async function settle(page: Page, frames = 5): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        let i = 0;
        const tick = () => (i++ < n ? requestAnimationFrame(tick) : resolve());
        requestAnimationFrame(tick);
      }),
    frames,
  );
}

async function shot(page: Page, name: string): Promise<void> {
  await settle(page);
  await page.locator('canvas').first().screenshot({ path: `${SHOT_DIR}/${name}.png` });
}

test.describe('Letsplay discovery — full loop, real visuals', () => {
  test.setTimeout(240_000);

  test('walk every scene and screenshot it', async ({ page }) => {
    // Mock heavy subsystems but KEEP the real background (no __hideFlightBackground).
    await page.addInitScript(() => {
      (window as Record<string, unknown>).__mockONNX = true;
      (window as Record<string, unknown>).__skipAudio = true;
      (window as Record<string, unknown>).__fastAnimations = true;
      // Browser-side implementation of the `getEngine` free identifier used in
      // every page.evaluate callback below (see declare at module top).
      (window as Record<string, unknown>).getEngine = () =>
        (window as Record<string, unknown>).__gameEngine;
    });

    // Collect JS errors for the whole session without aborting the run.
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') jsErrors.push(`console.error: ${msg.text()}`);
    });

    const results: { step: string; ok: boolean; note?: string }[] = [];
    const step = async (name: string, fn: () => Promise<string | void>): Promise<void> => {
      try {
        const note = await fn();
        results.push({ step: name, ok: true, note: note ?? undefined });
      } catch (e) {
        results.push({ step: name, ok: false, note: e instanceof Error ? e.message : String(e) });
      }
    };

    // ── 01 Main menu ──
    await page.goto('/');
    await waitForEngine(page);
    await step('01-main-menu', async () => {
      await waitForScene(page, 'MainMenuScene', 20_000);
      await shot(page, 'lp-01-main-menu');
    });

    // ── 02 Faction select ──
    await step('02-faction-select', async () => {
      await page.evaluate(async () => {
        const engine = getEngine();
        await engine.transitionTo('RACE_SELECTION', { gameEngine: engine });
      });
      await waitForScene(page, 'RaceSelectionScene');
      await shot(page, 'lp-02-faction-select');
    });

    // ── 03 New game → SpaceFlight with real background ──
    await step('03-flight-initial', async () => {
      await page.evaluate(() => {
        const scene = getEngine().currentScene as {
          e2eSelectFaction?: (f: string) => void;
          e2eConfirmSelection?: () => void;
        } | null;
        scene?.e2eSelectFaction?.('OUTLANDERS');
        scene?.e2eConfirmSelection?.();
      });
      await waitForScene(page, 'SpaceFlightScene', 30_000);
      await settle(page, 30); // give lazy nebula/panorama a moment to mount
      await shot(page, 'lp-03-flight-initial');
    });

    // Scene diagnostics for the write-up.
    const diag = await page.evaluate(() => {
      const scene = getEngine().currentScene as Record<string, unknown>;
      const star = scene['starRenderer'] as { centerX: number; centerY: number };
      const pm = scene['planetManager'] as {
        planetSprites: {
          planet: { name: string };
          container: { x: number; y: number };
          displayRadius: number;
        }[];
      };
      const ship = scene['shipPhysics'] as { shipX: number; shipY: number } | null;
      const nm = scene['npcManager'] as { npcCount: number };
      return {
        star: { x: star.centerX, y: star.centerY },
        planets: pm.planetSprites.map((s) => ({
          name: s.planet.name,
          wx: s.container.x,
          wy: s.container.y,
          r: s.displayRadius,
        })),
        ship: { x: ship?.shipX ?? 0, y: ship?.shipY ?? 0 },
        npcCount: nm.npcCount,
      };
    });
    // eslint-disable-next-line no-console
    console.log('SCENE_DIAG', JSON.stringify(diag));

    const focus = async (wx: number, wy: number, zoom: number): Promise<void> => {
      await page.evaluate(
        ({ wx, wy, zoom }) => {
          const scene = getEngine().currentScene as {
            e2eSetCameraZoom?: (z: number) => void;
            e2eSetCameraPan?: (x: number, y: number) => void;
            e2eGetCameraState?: () => { zoom: number; panX: number; panY: number };
          } | null;
          if (!scene) return;
          scene.e2eSetCameraZoom?.(zoom);
          // The camera clamps zoom to MAX_ZOOM — compute the pan from the zoom
          // that actually applied, or a far-out target misses the frame.
          const z = scene.e2eGetCameraState?.().zoom ?? zoom;
          scene.e2eSetCameraPan?.(
            window.innerWidth / 2 - wx * z,
            window.innerHeight / 2 - wy * z,
          );
        },
        { wx, wy, zoom },
      );
    };

    // ── 04 Planet close-ups (real textures — masking check) ──
    for (let i = 0; i < diag.planets.length; i++) {
      const p = diag.planets[i];
      await step(`04-planet-${i}`, async () => {
        await focus(p.wx, p.wy, 3);
        await shot(page, `lp-04-planet-${i}`);
        return p.name;
      });
    }

    // ── 05 Sun close-up ──
    await step('05-sun', async () => {
      await focus(diag.star.x, diag.star.y, 1.6);
      await shot(page, 'lp-05-sun');
    });

    // ── 06 Ship close-up ──
    await step('06-ship', async () => {
      await focus(diag.ship.x, diag.ship.y, 3.5);
      await shot(page, 'lp-06-ship');
    });

    // ── 06b Free route across the sun (playtest 2 ③: bypass arc + dashes) ──
    await step('06b-sun-route', async () => {
      const info = await page.evaluate(() => {
        const scene = getEngine().currentScene as Record<string, unknown>;
        const star = scene['starRenderer'] as { centerX: number; centerY: number };
        const sp = scene['shipPhysics'] as { shipX: number; shipY: number };
        // Target diametrically opposite the ship across the star — the straight
        // shot pierces the sun, so the planner must produce the bypass arc.
        const dx = star.centerX - sp.shipX;
        const dy = star.centerY - sp.shipY;
        const d = Math.hypot(dx, dy) || 1;
        const tx = star.centerX + (dx / d) * Math.max(900, d);
        const ty = star.centerY + (dy / d) * Math.max(900, d);
        (scene['planRouteTo'] as (x: number, y: number) => void).call(scene, tx, ty);
        const path = scene['routePath'] as { x: number; y: number }[];
        let minR = Infinity;
        for (const p of path) {
          minR = Math.min(minR, Math.hypot(p.x - star.centerX, p.y - star.centerY));
        }
        return { points: path.length, minR: Math.round(minR), span: d * 2 };
      });
      // Frame the bypass arc (radius ≈ 1.15 × exclusion ring around the star)
      // rather than the whole ship→target span — the arc is the evidence.
      const fit = Math.max(0.55, 720 / (info.span * 1.3));
      await focus(diag.star.x, diag.star.y, fit);
      await shot(page, 'lp-06b-sun-route');
      return `bypass points=${info.points} minR=${info.minR}px`;
    });

    // ── 07 Route to a planet ──
    await step('07-route', async () => {
      await page.evaluate(() => {
        const scene = getEngine().currentScene as Record<string, unknown>;
        const pm = scene['planetManager'] as {
          planetSprites: { planet: { id: string }; screenX: number; screenY: number }[];
        };
        const target = pm.planetSprites[0];
        if (!target) throw new Error('no planets');
        const fn = scene['handlePlanetRouteRequested'] as (
          id: string,
          x: number,
          y: number,
        ) => void;
        fn.call(scene, target.planet.id, target.screenX, target.screenY);
      });
      await page.evaluate(() => {
        const scene = getEngine().currentScene as {
          e2eSetCameraZoom?: (z: number) => void;
        } | null;
        scene?.e2eSetCameraZoom?.(0.6);
      });
      await shot(page, 'lp-07-route');
    });

    // ── 08 Mid-flight + 09 pause-stops-immediately check ──
    await step('08-mid-flight', async () => {
      await page.evaluate(() => {
        const scene = getEngine().currentScene as { e2eStartTurn?: () => void } | null;
        scene?.e2eStartTurn?.();
      });
      await settle(page, 20);
      await shot(page, 'lp-08-mid-flight');
    });

    await step('09-pause-immediate-stop', async () => {
      const before = await page.evaluate(() => {
        const scene = getEngine().currentScene as Record<string, unknown>;
        const sp = scene['shipPhysics'] as { shipX: number; shipY: number } | null;
        (scene as { e2ePressPause?: () => void }).e2ePressPause?.();
        return sp ? { x: sp.shipX, y: sp.shipY } : null;
      });
      await settle(page, 20);
      const after = await page.evaluate(() => {
        const scene = getEngine().currentScene as Record<string, unknown>;
        const sp = scene['shipPhysics'] as { shipX: number; shipY: number } | null;
        return sp ? { x: sp.shipX, y: sp.shipY } : null;
      });
      await shot(page, 'lp-09-paused');
      if (before && after) {
        const drift = Math.hypot(after.x - before.x, after.y - before.y);
        return `drift after pause: ${drift.toFixed(2)}px`;
      }
    });

    // ── 10 Land on planet → PlanetScene ──
    await step('10-planet-scene', async () => {
      await page.evaluate(async () => {
        const scene = getEngine().currentScene as {
          e2eLandOnPlanet?: () => Promise<void>;
        } | null;
        await scene?.e2eLandOnPlanet?.();
      });
      await waitForScene(page, 'PlanetScene', 20_000);
      await settle(page, 20); // panorama parallax mount
      await shot(page, 'lp-10-planet-scene');
    });

    const gotoPlanetSub = async (sceneType: string, sceneName: string): Promise<void> => {
      await page.evaluate(
        async ({ sceneType }) => {
          const engine = getEngine();
          const planet = engine.galaxy?.systems.flatMap((s) => s.planets)[0];
          if (!planet) throw new Error('no planet in galaxy');
          await engine.transitionTo(sceneType, { gameEngine: engine, planet });
        },
        { sceneType },
      );
      await waitForScene(page, sceneName, 15_000);
    };

    // ── 11-14 Planet sub-scenes ──
    await step('11-trade', async () => {
      await gotoPlanetSub('TRADE', 'TradeScene');
      await shot(page, 'lp-11-trade');
    });
    await step('12-equipment-shop', async () => {
      await gotoPlanetSub('EQUIPMENT_SHOP', 'EquipmentShopScene');
      await shot(page, 'lp-12-equipment-shop');
    });
    await step('13-government', async () => {
      await gotoPlanetSub('GOVERNMENT', 'GovernmentScene');
      await shot(page, 'lp-13-government');
    });
    await step('14-info-center', async () => {
      await gotoPlanetSub('INFO_CENTER', 'InfoCenterScene');
      await shot(page, 'lp-14-info-center');
    });

    // ── 15 Take off → re-entry spawn check ──
    await step('15-reentry', async () => {
      await page.evaluate(async () => {
        const engine = getEngine();
        await engine.transitionTo('SPACE_FLIGHT', { gameEngine: engine });
      });
      await waitForScene(page, 'SpaceFlightScene', 20_000);
      await settle(page, 20);
      const pos = await page.evaluate(() => {
        const scene = getEngine().currentScene as Record<string, unknown>;
        const sp = scene['shipPhysics'] as { shipX: number; shipY: number } | null;
        return sp ? { x: sp.shipX, y: sp.shipY } : null;
      });
      await shot(page, 'lp-15-reentry');
      return pos ? `ship at (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})` : 'no shipPhysics';
    });

    // ── 16 Star map ──
    await step('16-star-map', async () => {
      await page.evaluate(async () => {
        const engine = getEngine();
        await engine.transitionTo('STAR_MAP', { gameEngine: engine });
      });
      await waitForScene(page, 'StarMapScene', 15_000);
      await shot(page, 'lp-16-star-map');
    });

    // ── 17 Station (if the system has one) ──
    await step('17-station', async () => {
      const hasStation = await page.evaluate(async () => {
        const engine = getEngine();
        const station = engine.galaxy?.systems.flatMap((s) => s.stations ?? [])[0];
        if (!station) return false;
        await engine.transitionTo('STATION', { gameEngine: engine, station });
        return true;
      });
      if (!hasStation) return 'no stations in galaxy — skipped';
      await waitForScene(page, 'StationScene', 15_000);
      await shot(page, 'lp-17-station');
    });

    // ── 18 Back to flight → NPC click panel ──
    await step('18-npc-panel', async () => {
      await page.evaluate(async () => {
        const engine = getEngine();
        await engine.transitionTo('SPACE_FLIGHT', { gameEngine: engine });
      });
      await waitForScene(page, 'SpaceFlightScene', 20_000);
      await settle(page, 10);
      const clicked = await page.evaluate(() => {
        const scene = getEngine().currentScene as {
          e2eClickNpc?: (i: number) => void;
          e2eGetSceneState?: () => { npcsCount: number };
        } | null;
        const n = scene?.e2eGetSceneState?.().npcsCount ?? 0;
        if (n === 0) return false;
        scene?.e2eClickNpc?.(0);
        return true;
      });
      if (!clicked) return 'no NPCs — skipped';
      await shot(page, 'lp-18-npc-panel');
    });

    // ── 19 Inventory ──
    await step('19-inventory', async () => {
      await page.evaluate(async () => {
        const engine = getEngine();
        await engine.transitionTo('INVENTORY', { gameEngine: engine });
      });
      await waitForScene(page, 'InventoryScene', 15_000);
      await shot(page, 'lp-19-inventory');
    });

    // ── 20 Combat ──
    await step('20-combat', async () => {
      await page.evaluate(async () => {
        const engine = getEngine();
        await engine.transitionTo('COMBAT', { gameEngine: engine });
      });
      await waitForScene(page, 'CombatScene', 15_000);
      await settle(page, 15);
      await shot(page, 'lp-20-combat');
    });

    // ── 21 Return to main menu ──
    await step('21-back-to-menu', async () => {
      await page.evaluate(async () => {
        const engine = getEngine();
        await engine.transitionTo('MAIN_MENU', { gameEngine: engine });
      });
      await waitForScene(page, 'MainMenuScene', 15_000);
      await shot(page, 'lp-21-back-to-menu');
    });

    // ── Report ──
    // eslint-disable-next-line no-console
    console.log('STEP_RESULTS', JSON.stringify(results, null, 2));
    // eslint-disable-next-line no-console
    console.log('JS_ERRORS', JSON.stringify(jsErrors.slice(0, 50), null, 2));

    // The harness itself only requires that the game booted at all.
    expect(results.find((r) => r.step === '03-flight-initial')?.ok).toBe(true);
  });
});
