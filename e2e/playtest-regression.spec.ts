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

  test('smoke: Pause mid-flight finishes the current day, not an immediate stop (playtest3 F1)', async ({ page }) => {
    // F1 reverses the sprint-3 immediate-stop: pressing Pause while flying must
    // let the ship finish its current day segment, THEN stop. So right after
    // Pause the ship is still flying with the stop latched (pauseDeferred), not
    // halted. The whole-day-boundary stop itself is pinned by the unit test
    // (src/tests/pauseFinishesDay.test.ts) — a full 500px/day flight is too slow
    // and physics-dependent to gate deterministically here.
    await setupNewGame(page);
    const sf = new SpaceFlightPage(page);

    // Plan a route so the turn has somewhere to fly.
    await sf.clickPlanet(0);
    expect(await sf.hasPlannedRoute()).toBe(true);

    // Ход → execute the route (setPath flips isMoving=true synchronously).
    await sf.startTurn();
    expect((await sf.getSceneState()).isFlying).toBe(true);

    // Ход again → the stop is deferred to the day boundary: the ship keeps
    // flying and the turn stays running, with the deferred-pause latch set.
    await sf.pressPause();
    await sf.settle(2);
    expect((await sf.getSceneState()).isFlying).toBe(true);
    const dp = await sf.getDeferredPause();
    expect(dp.turnRunning).toBe(true);
    expect(dp.pauseDeferred).toBe(true);
  });

  test('smoke: NPC ships stay clickable after the first turn (Sprint 3 Task 6 regression)', async ({ page }) => {
    await setupNewGame(page);
    const sf = new SpaceFlightPage(page);

    expect((await sf.getSceneState()).npcsCount).toBeGreaterThan(0);

    // Run a course-less wait turn, then end it. F1 (playtest3): Pause finishes
    // the current (waited) day before the turn ends, so wait for the turn to
    // actually stop rather than assuming an immediate halt.
    await sf.startTurn();
    await sf.settle();
    await sf.pressPause();
    await sf.waitForTurnEnd();

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
      // Plan a route to a planet and fly part of the way, then request a pause —
      // each cycle exercises route planning, flight physics and NPC updates.
      // F1 (playtest3) defers the pause to the day boundary, so the ship keeps
      // flying its first route across the short settle windows (well short of
      // both the 500px/day boundary and the distant planet); this stays in
      // SpaceFlightScene and just checks the session is error-free.
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

    // Real click again (now ПАУЗА) → the button fires and latches a deferred
    // pause (F1): the turn finishes its current day before ending, so we assert
    // the latch was set rather than waiting out the ~1s wait-day boundary.
    await page.mouse.click(btn!.x, btn!.y);
    await page.waitForFunction(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { pauseAtDayBoundary?: boolean } | null;
      };
      return engine.currentScene?.pauseAtDayBoundary === true;
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
    // F1 (playtest3): Pause finishes the current day before ending the turn —
    // wait for the actual stop so the NPC intent cursors are restored.
    await sf.waitForTurnEnd();

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

  test('smoke: PlanetScene menu buttons respond to REAL mouse hover + click (playtest2 ⑥)', async ({ page }) => {
    // Finding ⑥: on a planet the background panned with the grab cursor
    // everywhere and no menu button was clickable. Root cause was the global
    // UiButton hit-geometry regression (every planet-menu button is a UiButton,
    // PlanetScene.makeServiceBtn). e2e* seams bypass PixiJS hit-testing, so only
    // a REAL mousemove/click — coordinates from scene introspection, never
    // hardcoded — proves the menu is alive again post-fix.
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    // Warm up the event boundary (rootTarget is set on the first mapped event).
    await page.mouse.move(5, 5);

    // Land on a HABITABLE planet so the full service menu — incl. «Маркет» — is
    // shown (uninhabited worlds only offer «Взлёт»).
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        galaxy: {
          systems: Array<{ id: string; planets: Array<{ id: string; isHabitable: boolean }> }>;
        } | null;
        player: { currentSystemId: string } | null;
        transitionTo: (scene: string, ctx?: object) => Promise<void>;
      };
      const systems = engine.galaxy?.systems ?? [];
      const here = systems.find((s) => s.id === engine.player?.currentSystemId);
      const planet =
        here?.planets.find((p) => p.isHabitable) ??
        systems.flatMap((s) => s.planets).find((p) => p.isHabitable);
      if (!planet) return;
      await engine.transitionTo('PLANET', { gameEngine: engine, planet });
    });
    await waitForScene(page, 'PlanetScene', 15_000);

    // The lazy faction-panorama load shows a loading overlay and can rebuild the
    // menu once. Wait until the overlay is gone AND the (final) service buttons
    // exist before reading any on-screen coordinates.
    await page.waitForFunction(
      () => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: Record<string, unknown> | null;
          loadingOverlayObjects?: unknown[];
        };
        if ((engine.loadingOverlayObjects?.length ?? 0) > 0) return false;
        const ui = engine.currentScene?.['uiContainer'] as
          | { children: Array<{ eventMode: string; cursor: string }> }
          | undefined;
        return (
          ui?.children.some((c) => c.eventMode === 'static' && c.cursor === 'pointer') ?? false
        );
      },
      undefined,
      { timeout: 15_000 },
    );

    // Read each service button's on-screen centre + label from scene
    // introspection (the UiButton containers are the static/pointer children of
    // the scene's uiContainer; the label is their longest Text child).
    const buttons = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const ui = engine.currentScene?.['uiContainer'] as
        | {
            children: Array<{
              eventMode: string;
              cursor: string;
              width: number;
              height: number;
              getGlobalPosition: () => { x: number; y: number };
              children: Array<{ text?: string }>;
            }>;
          }
        | undefined;
      if (!ui) return [];
      return ui.children
        .filter((c) => c.eventMode === 'static' && c.cursor === 'pointer')
        .map((c) => {
          const p = c.getGlobalPosition();
          const label = c.children
            .map((ch) => ch.text ?? '')
            .reduce((a, b) => (b.length > a.length ? b : a), '');
          return { label, x: p.x + c.width / 2, y: p.y + c.height / 2 };
        });
    });
    expect(buttons.length).toBeGreaterThan(0);

    // Every service button must report the landing/pointer cursor on REAL hover
    // — never the grab/move pan cursor that covered the whole screen in ⑥.
    for (const b of buttons) {
      await page.mouse.move(b.x, b.y, { steps: 3 });
      await expect
        .poll(
          () => page.evaluate(() => document.querySelector('canvas')?.style.cursor ?? ''),
          { timeout: 3_000 },
        )
        .toMatch(/cursor_landing|pointer/);
      const cursor = await page.evaluate(
        () => document.querySelector('canvas')?.style.cursor ?? '',
      );
      expect(cursor).not.toMatch(/grab|grabbing|move/);
    }

    // Real click on «Маркет» → TradeScene opens.
    const market = buttons.find((b) => b.label.includes('Маркет'));
    expect(market).toBeDefined();
    await page.mouse.click(market!.x, market!.y);
    await waitForScene(page, 'TradeScene', 10_000);

    // Real click on the close button «Покинуть маркет» → back to PlanetScene.
    const close = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const main = engine.currentScene?.['mainContainer'] as
        | {
            children: Array<{
              eventMode: string;
              cursor: string;
              width: number;
              height: number;
              getGlobalPosition: () => { x: number; y: number };
              children: Array<{ text?: string }>;
            }>;
          }
        | undefined;
      const btn = main?.children.find(
        (c) =>
          c.eventMode === 'static' &&
          c.cursor === 'pointer' &&
          c.children.some((ch) => (ch.text ?? '').includes('Покинуть')),
      );
      if (!btn) return null;
      const p = btn.getGlobalPosition();
      return { x: p.x + btn.width / 2, y: p.y + btn.height / 2 };
    });
    expect(close).not.toBeNull();
    await page.mouse.click(close!.x, close!.y);
    await waitForScene(page, 'PlanetScene', 10_000);

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

  test('smoke: clicking inside the open quest journal keeps it open and builds no route (playtest3 F6)', async ({ page }) => {
    // F6: clicks inside the journal — both the empty backdrop AND the panel /
    // labels — bubbled to the stage handler, which closed the modal (and, but
    // for the modal guard, would have planned a route behind it; CLAUDE.md
    // Rule 2). The fix swallows every journal click at the catch-all backdrop
    // (non-button content is eventMode="none"), so a click inside the window
    // does nothing — the journal stays open and no route is planned. e2e*
    // shortcuts bypass hit-testing, so only a REAL mouse click can catch this.
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    // Warm up the event boundary (rootTarget is set on the first mapped event).
    await page.mouse.move(5, 5);

    // No route planned yet.
    const before = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      return engine.currentScene?.['plannedRoute'] ?? null;
    });
    expect(before).toBeNull();

    // Open the quest journal via the HUD — its full-screen catch-all backdrop now
    // covers the flight stage.
    const isJournalOpen = () =>
      page.evaluate(() => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: Record<string, unknown> | null;
        };
        const hud = engine.currentScene?.['hud'] as
          | { isQuestJournalOpen: () => boolean }
          | undefined;
        return hud?.isQuestJournalOpen() ?? false;
      });
    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const hud = engine.currentScene?.['hud'] as
        | { toggleQuestJournal: () => void }
        | undefined;
      hud?.toggleQuestJournal();
    });
    expect(await isJournalOpen()).toBe(true);

    const screen = await page.evaluate(() => {
      const c = document.querySelector('canvas') as HTMLCanvasElement;
      return { w: c.clientWidth, h: c.clientHeight };
    });

    // Click the PANEL centre (inside the 600×500 window): this used to hit the
    // panel Graphics → bubble to the stage guard → CLOSE the journal. After the
    // fix it is swallowed by the backdrop and the journal stays open.
    await page.mouse.click(screen.w / 2, screen.h / 2);
    expect(await isJournalOpen()).toBe(true);

    // Also click an empty corner over the dark backdrop, well outside the panel.
    await page.mouse.click(40, screen.h - 40);
    expect(await isJournalOpen()).toBe(true);

    // No route was planned by any of those clicks.
    const after = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      return engine.currentScene?.['plannedRoute'] ?? null;
    });
    expect(after).toBeNull();

    errorCollector.assertAndDetach();
  });

  test('smoke: take-off after the equipment shop parks beside the planet, not at the system edge (playtest3 F4)', async ({ page }) => {
    // F4: land → equipment shop → return → "Взлёт". The take-off must spawn the
    // ship beside the planet it left, not fling it to the distant system edge.
    // Drives the REAL PlanetScene.takeOff() (e2eTakeOff) so the fromPlanetId
    // re-entry marker is actually exercised across the shop round-trip.
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    // Capture the planet we will land on (e2eLandOnPlanet lands on sprite[0]).
    const landedPlanetId = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eGetPlanets?: () => { id: string }[] } | null;
      };
      return engine.currentScene?.e2eGetPlanets?.()[0]?.id ?? null;
    });
    expect(landedPlanetId).not.toBeNull();

    // Land on the planet.
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eLandOnPlanet?: () => Promise<void> } | null;
      };
      await engine.currentScene?.e2eLandOnPlanet?.();
    });
    await waitForScene(page, 'PlanetScene', 15_000);

    // Open the equipment shop (PLANET → EQUIPMENT_SHOP), then return (the shop's
    // goBack returns to PLANET) — the round-trip that lost the marker.
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { planet?: unknown } | null;
        transitionTo: (s: string, ctx?: object) => Promise<void>;
      };
      const planet = engine.currentScene?.planet;
      await engine.transitionTo('EQUIPMENT_SHOP', { gameEngine: engine, planet });
    });
    await waitForScene(page, 'EquipmentShopScene', 15_000);
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { planet?: unknown } | null;
        transitionTo: (s: string, ctx?: object) => Promise<void>;
      };
      const planet = engine.currentScene?.planet;
      await engine.transitionTo('PLANET', { gameEngine: engine, planet });
    });
    await waitForScene(page, 'PlanetScene', 15_000);

    // Take off via the real "Взлёт" action.
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eTakeOff?: () => Promise<void> } | null;
      };
      await engine.currentScene?.e2eTakeOff?.();
    });
    await waitForScene(page, 'SpaceFlightScene', 20_000);

    // The ship must be parked beside the planet it left, not at the system edge.
    const result = await page.evaluate((planetId) => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const scene = engine.currentScene;
      if (!scene) return null;
      const phys = scene['shipPhysics'] as { shipX: number; shipY: number } | null;
      const pm = scene['planetManager'] as
        | { planetSprites: Array<{ planet: { id: string }; screenX: number; screenY: number; displayRadius: number }> }
        | undefined;
      const star = scene['starRenderer'] as { centerX: number; centerY: number } | undefined;
      const sprite = pm?.planetSprites.find((s) => s.planet.id === planetId);
      if (!phys || !sprite || !star) return null;
      return {
        distToPlanet: Math.hypot(phys.shipX - sprite.screenX, phys.shipY - sprite.screenY),
        distToStar: Math.hypot(phys.shipX - star.centerX, phys.shipY - star.centerY),
        planetDistToStar: Math.hypot(sprite.screenX - star.centerX, sprite.screenY - star.centerY),
        displayRadius: sprite.displayRadius,
      };
    }, landedPlanetId);
    expect(result).not.toBeNull();
    // Parked just outside the planet disc (take-off arc ends ~90px out): the ship
    // sits within the planet's disc + a generous margin, NOT a system-radius away.
    expect(result!.distToPlanet).toBeLessThanOrEqual(result!.displayRadius + 220);

    errorCollector.assertAndDetach();
  });

  test('smoke: game speed survives a SPACE_FLIGHT re-init (x4 stays x4) (playtest3 F3)', async ({ page }) => {
    // F3: the game-speed (1×/2×/4×) reset to 1× on every scene re-init because
    // each rebuild made a fresh ShipPhysics (timeScale=1) + FlightHud
    // (speedIndex=0). The HUD now persists the choice on the GameEngine and
    // restores it on (re)build. Click the REAL speed button (coords from scene
    // introspection — the e2e* seams would bypass the UiButton hit geometry), set
    // x4, then force a faithful re-init (the font-change path) and assert it sticks.
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    // Warm up the event boundary (rootTarget is set on the first mapped event).
    await page.mouse.move(5, 5);

    const speedBtn = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const hud = (engine.currentScene as Record<string, unknown>)?.['hud'] as Record<string, unknown>;
      const c = (hud?.['speedButton'] as {
        container?: { getGlobalPosition: () => { x: number; y: number }; width: number; height: number };
      })?.container;
      if (!c) return null;
      const p = c.getGlobalPosition();
      return { x: p.x + c.width / 2, y: p.y + c.height / 2 };
    });
    expect(speedBtn).not.toBeNull();

    // Two real clicks cycle 1× → 2× → 4×.
    await page.mouse.click(speedBtn!.x, speedBtn!.y);
    await page.mouse.click(speedBtn!.x, speedBtn!.y);
    await page.waitForFunction(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        gameSpeedMultiplier?: number;
        currentScene: Record<string, unknown> | null;
      };
      const phys = engine.currentScene?.['shipPhysics'] as { timeScale: number } | null;
      return engine.gameSpeedMultiplier === 4 && phys?.timeScale === 4;
    }, undefined, { timeout: 3_000 });

    // Force a faithful re-init (same path the font-size change takes): a brand new
    // SpaceFlightScene with a fresh ShipPhysics + FlightHud.
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      await engine.transitionTo('SPACE_FLIGHT', { gameEngine: engine });
    });
    await waitForScene(page, 'SpaceFlightScene', 20_000);

    // The chosen speed survives the rebuild instead of resetting to 1×.
    const after = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        gameSpeedMultiplier?: number;
        currentScene: Record<string, unknown> | null;
      };
      const phys = engine.currentScene?.['shipPhysics'] as { timeScale: number } | null;
      return { persisted: engine.gameSpeedMultiplier, timeScale: phys?.timeScale ?? null };
    });
    expect(after.persisted).toBe(4);
    expect(after.timeScale).toBe(4);

    errorCollector.assertAndDetach();
  });

  test('smoke: changing the font size keeps the ship in place (playtest4 A)', async ({ page }) => {
    // A: the ⚙ font-size buttons re-init SPACE_FLIGHT to re-apply the scale, but
    // used to pass no context so applyReentrySpawn flung the ship to the system
    // edge. The HUD now fans the change out (onFontScaleChange) and the scene
    // re-inits with preserveShipPos. Park the ship at a known interior point, then
    // click the REAL gear + "S" buttons (coords from scene introspection — the
    // e2e* seams would bypass the UiButton hit geometry) and assert it stays put.
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    // Warm up the event boundary (rootTarget is set on the first mapped event).
    await page.mouse.move(5, 5);

    // Park the ship at a clearly-interior point (star centre + offset), well away
    // from the boundary edge an errant re-spawn would snap it to.
    const parked = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const scene = engine.currentScene as Record<string, unknown>;
      const star = scene['starRenderer'] as { centerX: number; centerY: number };
      const phys = scene['shipPhysics'] as {
        teleport: (x: number, y: number) => void;
        shipX: number;
        shipY: number;
      };
      const x = star.centerX + 140;
      const y = star.centerY + 110;
      phys.teleport(x, y);
      return { x: phys.shipX, y: phys.shipY };
    });

    // Set game speed to x4 via the REAL speed button first: the font re-init must
    // preserve BOTH ship position AND the chosen speed (plan Task 2 acceptance).
    const speedBtn = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const hud = (engine.currentScene as Record<string, unknown>)?.['hud'] as Record<string, unknown>;
      const c = (hud?.['speedButton'] as {
        container?: { getGlobalPosition: () => { x: number; y: number }; width: number; height: number };
      })?.container;
      if (!c) return null;
      const p = c.getGlobalPosition();
      return { x: p.x + c.width / 2, y: p.y + c.height / 2 };
    });
    expect(speedBtn).not.toBeNull();
    await page.mouse.click(speedBtn!.x, speedBtn!.y); // 1× → 2×
    await page.mouse.click(speedBtn!.x, speedBtn!.y); // 2× → 4×
    await page.waitForFunction(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        gameSpeedMultiplier?: number;
      };
      return engine.gameSpeedMultiplier === 4;
    }, undefined, { timeout: 3_000 });

    // Open the font panel via the REAL gear button.
    const gear = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const hud = (engine.currentScene as Record<string, unknown>)?.['hud'] as Record<string, unknown>;
      const c = (hud?.['gearButton'] as {
        container?: { getGlobalPosition: () => { x: number; y: number }; width: number; height: number };
      })?.container;
      if (!c) return null;
      const p = c.getGlobalPosition();
      return { x: p.x + c.width / 2, y: p.y + c.height / 2 };
    });
    expect(gear).not.toBeNull();
    await page.mouse.click(gear!.x, gear!.y);

    // The "S" font button is the first hit-rect in the now-open panel (local
    // origin 8,6 + 30×32 → centre ≈ 23,22 from the panel's global position).
    const sBtn = await page.waitForFunction(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const hud = (engine.currentScene as Record<string, unknown>)?.['hud'] as Record<string, unknown>;
      const panel = hud?.['settingsPanel'] as {
        getGlobalPosition: () => { x: number; y: number };
      } | null;
      if (!panel) return null;
      const p = panel.getGlobalPosition();
      return { x: p.x + 23, y: p.y + 22 };
    }, undefined, { timeout: 3_000 });
    const s = (await sBtn.jsonValue()) as { x: number; y: number };
    await page.mouse.click(s.x, s.y);

    // The font change forces a faithful re-init; wait for the fresh scene.
    await waitForScene(page, 'SpaceFlightScene', 20_000);

    const after = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle & {
        gameSpeedMultiplier?: number;
      };
      const phys = (engine.currentScene as Record<string, unknown>)?.['shipPhysics'] as {
        shipX: number;
        shipY: number;
        timeScale: number;
      } | null;
      return {
        x: phys?.shipX ?? null,
        y: phys?.shipY ?? null,
        timeScale: phys?.timeScale ?? null,
        gameSpeedMultiplier: engine.gameSpeedMultiplier,
        fontScale: localStorage.getItem('fontScale'),
      };
    });

    // Font scale was applied, and the ship is exactly where it was — NOT edge-spawned.
    expect(after.fontScale).toBe('S');
    expect(after.x).not.toBeNull();
    expect(Math.hypot((after.x as number) - parked.x, (after.y as number) - parked.y)).toBeLessThan(5);
    // ...and the chosen game speed survived the font-change re-init (Task 2 acceptance).
    expect(after.gameSpeedMultiplier).toBe(4);
    expect(after.timeScale).toBe(4);

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

  test('regression: mouse wheel scrolls the equipment-shop list', async ({ page }) => {
    // The shop relied on a PixiJS federated `backdrop.on("wheel")` that the list
    // rows (eventMode "static") swallowed, so the wheel never reached the scroll
    // logic. The fix is a window-level wheel listener (attachWheelScroll). Drive
    // a REAL wheel event and assert the list scrolls down to the clamp and back.
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    // Land on a planet, then open the equipment shop.
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eLandOnPlanet?: () => Promise<void> } | null;
      };
      await engine.currentScene?.e2eLandOnPlanet?.();
    });
    await waitForScene(page, 'PlanetScene', 15_000);
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { planet?: unknown } | null;
        transitionTo: (s: string, ctx?: object) => Promise<void>;
      };
      const planet = engine.currentScene?.planet;
      await engine.transitionTo('EQUIPMENT_SHOP', { gameEngine: engine, planet });
    });
    await waitForScene(page, 'EquipmentShopScene', 15_000);

    // Precondition: the shop overflows its visible window (else nothing scrolls).
    const meta = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const scene = engine.currentScene;
      return {
        listings: (scene?.['listings'] as unknown[] | undefined)?.length ?? 0,
        visible: (scene?.['VISIBLE_ROWS'] as number | undefined) ?? 0,
        offset: (scene?.['scrollOffset'] as number | undefined) ?? -1,
      };
    });
    const maxScroll = Math.max(0, meta.listings - meta.visible);
    expect(maxScroll).toBeGreaterThan(0);
    expect(meta.offset).toBe(0);

    // Move the pointer over the canvas, then fire REAL wheel-down events past the
    // clamp — the window-level listener must scroll the list to maxScroll.
    const box = await page.locator('canvas').first().boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < meta.listings + 3; i++) await page.mouse.wheel(0, 120);
    const afterDown = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      return (engine.currentScene?.['scrollOffset'] as number | undefined) ?? -1;
    });
    expect(afterDown).toBe(maxScroll);

    // Real wheel-up events past the clamp must return the list to the top.
    for (let i = 0; i < meta.listings + 3; i++) await page.mouse.wheel(0, -120);
    const afterUp = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      return (engine.currentScene?.['scrollOffset'] as number | undefined) ?? -1;
    });
    expect(afterUp).toBe(0);

    errorCollector.assertAndDetach();
  });
});
