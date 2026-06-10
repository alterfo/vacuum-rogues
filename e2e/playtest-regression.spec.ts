import { test, expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { applyMockHeavySystems, waitForEngine, waitForScene } from './fixtures/mockHeavySystems';
import { MonkeyTester } from './helpers/monkeyTester';
import { ErrorCollector } from './helpers/errorCollector';
import { SpaceFlightPage } from './page-objects/space-flight.page';

type EngineHandle = {
  currentScene: Record<string, unknown> | null;
  isRunning?: boolean;
  transitionTo: (scene: string, ctx?: object) => Promise<void>;
  galaxy: { systems: { planets: unknown[] }[] } | null;
  player: { credits?: number } | null;
  startTextQuest: (id: string, seed?: number) => Promise<void>;
};

async function setupNewGame(page: Page): Promise<void> {
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

test.describe.serial('Regression: quick smoke + monkey suite', () => {
  test.setTimeout(90_000);

  test('smoke: new game starts in SpaceFlightScene', async ({ page }) => {
    await setupNewGame(page);

    const sceneName = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      return engine?.currentScene?.constructor?.name ?? null;
    });
    expect(sceneName).toBe('SpaceFlightScene');
  });

  test('smoke: route to planet builds and is not cleared immediately (regression Sprint 3)', async ({ page }) => {
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    // Plan a route to the first planet via the scene's route handler. After the
    // SOLID refactor the planet sprites live on planetManager and clicks route
    // through handlePlanetRouteRequested(id, x, y) rather than onPlanetClick.
    const routeSet = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const scene = engine.currentScene;
      if (!scene) return false;

      const planetManager = scene['planetManager'] as
        | { planetSprites: Array<{ planet: { id: string }; screenX: number; screenY: number }> }
        | undefined;
      const planetSprites = planetManager?.planetSprites;
      if (!planetSprites || planetSprites.length === 0) return false;

      const routeTo = scene['handlePlanetRouteRequested'] as
        | ((id: string, x: number, y: number) => void)
        | undefined;
      if (!routeTo) return false;

      const first = planetSprites[0];
      routeTo.call(scene, first.planet.id, first.screenX, first.screenY);

      const route = scene['plannedRoute'] as { x: number; y: number } | null;
      return route != null && !isNaN(route.x) && !isNaN(route.y);
    });

    expect(routeSet).toBe(true);

    // Verify route is still set after a render cycle (regression: route was cleared on next tick)
    await page.waitForFunction(
      () => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: Record<string, unknown> | null;
        };
        return engine?.currentScene != null;
      },
      { timeout: 5_000 },
    );

    const routeStillSet = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const route = engine.currentScene?.['plannedRoute'] as { x: number; y: number } | null;
      return route != null;
    });

    expect(routeStillSet).toBe(true);

    errorCollector.assertAndDetach();
  });

  // ---------------------------------------------------------------------------
  // SpaceFlightScene smoke tests (Task 5 of 20260609-e2e-visual-spaceflightscene).
  // Fast, platform-independent regression guards for the visual/behavioural fixes
  // verified in Tasks 2–4. They drive the scene through the __DEBUG__-guarded
  // e2e* hooks (SpaceFlightPage) — never pixel clicks (CLAUDE.md E2E rules) — and
  // deliberately avoid pixel-screenshot baselines so the CI gate stays OS-agnostic.
  // ---------------------------------------------------------------------------

  test('smoke: planets render circular, not rectangular (masking regression Task 2)', async ({ page }) => {
    // Only the TilingSprite-disc fallback path can ever regress to a rectangle;
    // in a WebGL renderer planets take the GLSL filter / sphere-mesh paths
    // instead, which clip in-shader / by geometry and never expose a mask via
    // e2eMaskInfo(). Force every planet onto the tiling-disc path so this guard
    // actually exercises (and asserts on) the masking invariant — without the
    // flag e2eMaskInfo() is null for every planet and the loop below is a no-op.
    await page.addInitScript(() => {
      (window as Record<string, unknown>).__forcePlanetTilingFallback = true;
    });
    await setupNewGame(page);

    // Tiling-disc bodies are built only once the lazy planet surface map loads
    // (async). Wait until at least one planet exposes its mask geometry rather
    // than sleeping a fixed number of frames.
    await page.waitForFunction(
      () => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: Record<string, unknown> | null;
        };
        const pm = engine.currentScene?.['planetManager'] as
          | { planetSprites: Array<{ e2eMaskInfo?: () => unknown | null }> }
          | undefined;
        return (pm?.planetSprites ?? []).some((s) => s.e2eMaskInfo?.() != null);
      },
      { timeout: 15_000 },
    );

    const maskInfos = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const pm = engine.currentScene?.['planetManager'] as
        | {
            planetSprites: Array<{
              e2eMaskInfo?: () => {
                maskIsChild: boolean;
                maskBounds: { x: number; y: number; width: number; height: number };
              } | null;
            }>;
          }
        | undefined;
      return (pm?.planetSprites ?? []).map((s) => s.e2eMaskInfo?.() ?? null);
    });

    // The guard must have actually run — at least one planet built a tiling disc.
    const checked = maskInfos.filter(
      (info): info is NonNullable<typeof info> => info != null,
    );
    expect(checked.length).toBeGreaterThan(0);

    for (const info of checked) {
      // The circular mask must be a child of the wrapper Container (PixiJS 8
      // scene-graph rule) and centred on the planet origin — exactly the
      // invariant whose violation rendered planets as bottom-clipped rectangles.
      expect(info.maskIsChild).toBe(true);
      // Centred circle: bounds are a square whose centre sits on the origin.
      const cx = info.maskBounds.x + info.maskBounds.width / 2;
      const cy = info.maskBounds.y + info.maskBounds.height / 2;
      expect(Math.abs(cx)).toBeLessThan(1);
      expect(Math.abs(cy)).toBeLessThan(1);
      expect(Math.abs(info.maskBounds.width - info.maskBounds.height)).toBeLessThan(1);
    }
  });

  test('smoke: GLSL-filter planets clip to a circle — bbox corner is pure background (F1)', async ({ page }) => {
    // Letsplay finding F1 (docs/playtests/20260610-letsplay-discovery.md): in the
    // real game planets render as RECTANGLES through the GLSL PlanetRotationFilter
    // path — the path WebGL actually takes (the previously-fixed TilingSprite mask
    // was only the fallback). Root cause: the fragment shader derived disc-local
    // coords from vTextureCoord assuming it spans [0,1] over the sprite, but the
    // PixiJS v8 filter input texture is power-of-two POOLED, so vTextureCoord only
    // reaches k = frame/pooled < 1 → the in-shader circular clip is mis-scaled and
    // surface texture leaks into the sprite's bounding-box corners.
    //
    // jsdom cannot execute shaders, so this is a pixel-level browser assertion:
    // isolate one filter-path planet, centre the camera on it, screenshot the
    // bottom-right corner of its bounding box (a region fully OUTSIDE the
    // inscribed circle) and require it to be near-black background.
    await setupNewGame(page);
    const sf = new SpaceFlightPage(page);

    // The GLSL filter mounts only after the lazy planet_maps texture loads.
    // Scene-owned e2e seam (CLAUDE.md E2E rules) — no reaching into module
    // internals from the spec.
    await page.waitForFunction(
      () => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: { e2eHasFilterPlanet?: () => boolean } | null;
        };
        return engine.currentScene?.e2eHasFilterPlanet?.() === true;
      },
      { timeout: 20_000 },
    );

    // Isolate the planet's filtered body (the scene hides the rest of the game
    // layer, the PlanetManager/PlanetSprite strip the sprite to its body) and
    // centre the camera on it at MAX_ZOOM, so the corner pixels can only come
    // from the shader under test or the background.
    const region = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: {
          e2eIsolateFilterPlanet?: () => {
            screenX: number;
            screenY: number;
            displayRadius: number;
          } | null;
          e2eSetCameraZoom?: (z: number) => void;
          e2eSetCameraPan?: (x: number, y: number) => void;
          e2eGetCameraState?: () => { zoom: number; panX: number; panY: number };
        } | null;
      };
      const scene = engine.currentScene;
      const target = scene?.e2eIsolateFilterPlanet?.() ?? null;
      if (!scene || !target) return null;

      // Request an over-MAX zoom and read back the EFFECTIVE camera (zoom and
      // pan are both clamped) instead of hardcoding MAX_ZOOM here.
      scene.e2eSetCameraZoom?.(99);
      const zoom = scene.e2eGetCameraState?.().zoom ?? 1;
      scene.e2eSetCameraPan?.(
        window.innerWidth / 2 - target.screenX * zoom,
        window.innerHeight / 2 - target.screenY * zoom,
      );
      const cam = scene.e2eGetCameraState?.() ?? { zoom, panX: 0, panY: 0 };
      return {
        cx: cam.panX + target.screenX * cam.zoom,
        cy: cam.panY + target.screenY * cam.zoom,
        R: target.displayRadius * cam.zoom,
      };
    });
    expect(region).not.toBeNull();
    const { cx, cy, R } = region!;

    await sf.freezeWorld();

    // Corner clip: the square [0.75R, 0.99R]² (relative to the planet centre)
    // sits inside the sprite's bounding box but fully outside the inscribed
    // circle (closest point is at distance 0.75·√2 ≈ 1.06R from the centre).
    const canvasBox = await page.locator('canvas').boundingBox();
    expect(canvasBox).not.toBeNull();
    const side = R * 0.24;
    const shot = await page.screenshot({
      clip: {
        x: canvasBox!.x + cx + R * 0.75,
        y: canvasBox!.y + cy + R * 0.75,
        width: side,
        height: side,
      },
    });

    const png = PNG.sync.read(shot);
    const total = png.width * png.height;
    let dark = 0;
    for (let i = 0; i < total; i++) {
      const r = png.data[i * 4];
      const g = png.data[i * 4 + 1];
      const b = png.data[i * 4 + 2];
      // Near-black = renderer clear color 0x000510 plus headroom for AA/dither.
      if (r <= 32 && g <= 32 && b <= 32) dark++;
    }
    // ≥95% background: with the bug the mis-scaled disc floods the corner with
    // bright surface-texture pixels and this drops to ~0%.
    expect(dark / total).toBeGreaterThanOrEqual(0.95);
  });

  test('smoke: Ход stops the ship immediately when mid-flight (Sprint 3 regression)', async ({ page }) => {
    await setupNewGame(page);
    const sf = new SpaceFlightPage(page);

    // Plan a route so the turn has somewhere to fly.
    await sf.clickPlanet(0);
    expect(await sf.hasPlannedRoute()).toBe(true);

    // Ход → execute the route (setPath flips isMoving=true synchronously).
    await sf.startTurn();
    expect((await sf.getSceneState()).isFlying).toBe(true);

    // Ход again → immediate stop, no longer deferred to the next day segment.
    await sf.pressPause();
    expect((await sf.getSceneState()).isFlying).toBe(false);
  });

  test('smoke: NPC ships stay clickable after the first turn (Sprint 3 Task 6 regression)', async ({ page }) => {
    await setupNewGame(page);
    const sf = new SpaceFlightPage(page);

    expect((await sf.getSceneState()).npcsCount).toBeGreaterThan(0);

    // Run a course-less wait turn, then end it.
    await sf.startTurn();
    await sf.settle();
    await sf.pressPause();
    await sf.settle();

    // Interactivity is restored when the turn ends...
    expect(await sf.isNpcClickable(0)).toBe(true);
    // ...and a click opens the contact panel (the handler still fires).
    await sf.clickNpc(0);
    expect(await sf.isContactPanelOpen()).toBe(true);
  });

  test('smoke: no JS errors during a 3-turn play session', async ({ page }) => {
    await setupNewGame(page);
    const sf = new SpaceFlightPage(page);
    const errorCollector = new ErrorCollector(page);

    const planetsCount = (await sf.getSceneState()).planetsCount;
    expect(planetsCount).toBeGreaterThan(0);

    for (let turn = 0; turn < 3; turn++) {
      // Plan a route to a planet, fly part of the way, then stop — each cycle
      // exercises route planning, flight physics, NPC updates and turn teardown.
      await sf.clickPlanet(turn % planetsCount);
      await sf.startTurn();
      await sf.settle(8);
      await sf.pressPause();
      await sf.settle(2);
    }

    // Scene survived the session and is still SpaceFlightScene.
    const sceneName = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      return engine?.currentScene?.constructor?.name ?? null;
    });
    expect(sceneName).toBe('SpaceFlightScene');

    errorCollector.assertAndDetach();
  });

  test('smoke: HUD buttons respond to REAL mouse clicks (UiButton hit-geometry regression)', async ({ page }) => {
    // The e2e* driver methods bypass PixiJS hit-testing entirely, so they can
    // never catch "button is mouse-dead" bugs. This test clicks with the real
    // mouse at coordinates derived from scene introspection (allowed exception
    // to the no-position-clicks rule — the POINT is to exercise hit-testing).
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    // Warm up the event boundary (rootTarget is set on the first mapped event)
    await page.mouse.move(5, 5);

    const btn = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const hud = (engine.currentScene as Record<string, unknown>)?.['hud'] as Record<string, unknown>;
      const c = (hud?.['playPauseButton'] as {
        container?: { getGlobalPosition: () => { x: number; y: number }; width: number; height: number };
      })?.container;
      if (!c) return null;
      const p = c.getGlobalPosition();
      return { x: p.x + c.width / 2, y: p.y + c.height / 2 };
    });
    expect(btn).not.toBeNull();

    // Real click on Ход → a turn must start (isTurnRunning, not isFlying:
    // with no route planned the ship stays parked while the world advances)
    await page.mouse.click(btn!.x, btn!.y);
    await page.waitForFunction(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      return engine.currentScene?.['isTurnRunning'] === true;
    }, undefined, { timeout: 3_000 });

    // Real click again (now ПАУЗА) → the turn must stop immediately
    await page.mouse.click(btn!.x, btn!.y);
    await page.waitForFunction(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      return engine.currentScene?.['isTurnRunning'] === false;
    }, undefined, { timeout: 3_000 });

    errorCollector.assertAndDetach();
  });

  test('smoke: cursor changes over an NPC ship on REAL mouse hover after a turn (playtest2 ②)', async ({ page }) => {
    // The user's playtest finding ②: the pointer stays the default arrow over
    // NPC ships. Root cause: every NPC spawned IDLE, so the first day-tick sent
    // 100% of them TRAVELING → refresh() began departure on every sprite →
    // eventMode='none' → the whole system was mouse-dead after the first turn.
    // e2e* seams bypass PixiJS hit-testing, so only a REAL mousemove
    // (coordinates from scene introspection, never hardcoded) can catch this.
    await setupNewGame(page);
    const sf = new SpaceFlightPage(page);
    const errorCollector = new ErrorCollector(page);

    // Warm up the event boundary (rootTarget is set on the first mapped event)
    await page.mouse.move(5, 5);

    // Run a course-less wait turn until at least one game day passes (the
    // day-tick is what runs the NPC simulation + sprite refresh), then pause.
    const day0 = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        galaxy: { gameDays: number } | null;
      };
      return engine.galaxy?.gameDays ?? 0;
    });
    await sf.startTurn();
    await page.waitForFunction(
      (d0) => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          galaxy: { gameDays: number } | null;
        };
        return (engine.galaxy?.gameDays ?? 0) > d0;
      },
      day0,
      { timeout: 20_000 },
    );
    await sf.pressPause();
    await sf.settle();

    // At least one NPC must still be interactive (the mass-exodus bug left
    // zero), centre the camera on it and read back its on-screen position.
    const target = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const scene = engine.currentScene as
        | ({
            e2eSetCameraZoom?: (z: number) => void;
            e2eSetCameraPan?: (x: number, y: number) => void;
            e2eGetCameraState?: () => { zoom: number; panX: number; panY: number };
          } & Record<string, unknown>)
        | null;
      const mgr = scene?.['npcManager'] as
        | {
            npcSprites: Array<{
              x: number;
              y: number;
              container: {
                cursor: string;
                eventMode: string;
                getGlobalPosition: () => { x: number; y: number };
              };
            }>;
          }
        | undefined;
      const sprite = mgr?.npcSprites?.find((s) => s.container.eventMode === 'static');
      if (!scene || !sprite) return null;
      scene.e2eSetCameraZoom?.(1);
      const zoom = scene.e2eGetCameraState?.().zoom ?? 1;
      scene.e2eSetCameraPan?.(
        window.innerWidth / 2 - sprite.x * zoom,
        window.innerHeight / 2 - sprite.y * zoom,
      );
      const p = sprite.container.getGlobalPosition();
      // cursorKind is what setClickHandler assigned: "target" (pirate) or
      // "pointer" (trader/ranger/patrol) — the css the canvas must show follows
      // from installGameCursors' cursorStyles mapping.
      return { x: p.x, y: p.y, cursorKind: sprite.container.cursor };
    });
    expect(target).not.toBeNull();

    // Real mouse hover over the NPC must switch the canvas cursor to the
    // role's intent cursor (reticle over pirates, landing pointer otherwise).
    await page.mouse.move(target!.x, target!.y, { steps: 3 });
    const expected =
      target!.cursorKind === 'target' ? /cursor_target|crosshair/ : /cursor_landing|pointer/;
    await expect
      .poll(
        () => page.evaluate(() => document.querySelector('canvas')?.style.cursor ?? ''),
        { timeout: 3_000 },
      )
      .toMatch(expected);

    errorCollector.assertAndDetach();
  });

  test('smoke: reactor quest starts without errors', async ({ page }) => {
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    // Land on planet first (required context for text quest return)
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eLandOnPlanet?: () => Promise<void> } | null;
      };
      await engine.currentScene?.e2eLandOnPlanet?.();
    });
    await waitForScene(page, 'PlanetScene', 15_000);

    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      await engine.startTextQuest('reactor', 42);
    });
    await waitForScene(page, 'TextQuestScene', 15_000);

    const sceneName = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      return engine?.currentScene?.constructor?.name ?? null;
    });
    expect(sceneName).toBe('TextQuestScene');

    errorCollector.assertAndDetach();
  });

  test('monkey: 50 random inputs in SpaceFlightScene do not crash', async ({ page }) => {
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);
    const monkey = new MonkeyTester(page, 42);

    await monkey.run(50, { delayMs: 0 });

    await page.waitForFunction(
      () => {
        const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
        return !!engine?.currentScene;
      },
      { timeout: 10_000 },
    );

    const sceneName = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      return engine?.currentScene?.constructor?.name ?? null;
    });
    expect(sceneName).not.toBeNull();

    errorCollector.assertAndDetach();
  });
});
