import { test, expect, type Page } from '@playwright/test';
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
