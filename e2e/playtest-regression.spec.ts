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
  // Mark the one-time onboarding intros as already seen BEFORE the page loads, so
  // the auto-shown welcome/scene HelpPanel (a full-screen modal backdrop mounted
  // on the stage) never pops over the live scene. A real player dismisses that
  // intro before doing anything; without this seed its backdrop swallows every
  // REAL mouse click in flight, mouse-deadening the HUD/combat-pause buttons the
  // real-pointer regressions exist to guard (same suppression the planet-«?» test
  // applies locally, here applied pre-load so it also covers in-flight tests).
  await page.addInitScript(() => {
    try {
      // Every onboarding HelpKey (helpContent.ts) — including the one-shot
      // 'combat' hint that fires on first in-flight engagement and the
      // per-scene keys — so no auto-help backdrop ever covers a live scene.
      localStorage.setItem(
        'sr_help_seen',
        JSON.stringify([
          'welcome', 'RACE_SELECTION', 'SPACE_FLIGHT', 'STAR_MAP', 'PLANET',
          'TRADE', 'STATION', 'EQUIPMENT_SHOP', 'GOVERNMENT', 'INFO_CENTER',
          'BANK', 'INVENTORY', 'TEXT_QUEST', 'quest-journal', 'combat',
          // 'refuel' is the first-time PLANET intro (PlanetScene mounts it via
          // mountSceneHelp firstTimeKey). It was missing here, so its full-screen
          // backdrop auto-showed on first landing and swallowed the REAL hover the
          // «⑥ PlanetScene menu buttons» test needs — cursor stayed default. Seed
          // it like every other onboarding key so the live service menu is
          // hover-testable (Task 17 visual/e2e sweep).
          'refuel',
        ]),
      );
    } catch {
      /* storage unavailable — onboarding degrades to "nothing seen" */
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

  test('regression: a hostile NPC engages, orbits and trades fire in auto-mode (Task 4 dogfight)', async ({ page }) => {
    // Task 4 acceptance: an aggressive NPC closes/orbits the player and both ships
    // auto-fire each ход. Stage a deterministic fight (fit a weapon, drop the first
    // NPC just inside weapon range as a hostile aggressor, engage it in the
    // real-time CombatModule), run the turn, then prove the dogfight: combat stays
    // engaged, the aggressor maneuvers (its position moves) and BOTH hulls drop.
    // The combat guard freezes the wait-day calendar while a fight is active, so
    // no day-tick refresh() can de-aggro the staged NPC mid-test.
    await setupNewGame(page);
    const sf = new SpaceFlightPage(page);
    const errorCollector = new ErrorCollector(page);

    expect((await sf.getSceneState()).npcsCount).toBeGreaterThan(0);

    const staged = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
        playerLoadout?: {
          derivedStats: () => { weaponCount: number };
          install: (id: string) => unknown;
        } | null;
        player?: { ship?: { hullHP: number } } | null;
      };
      const scene = engine.currentScene;
      if (!scene) return null;
      // A weaponless player can't fight (CombatModule guards on it) — fit a pulse.
      const loadout = engine.playerLoadout;
      if (loadout && loadout.derivedStats().weaponCount === 0) {
        loadout.install('wpn_pulse');
      }
      const npcManager = scene['npcManager'] as
        | {
            e2eForceAggressorInRange: (
              range: number,
            ) => { npc: { hullHP: number }; x: number; y: number } | null;
          }
        | undefined;
      const combat = scene['combatModule'] as
        | { addCombatant: (s: unknown) => void; isActive: boolean }
        | undefined;
      const sprite = npcManager?.e2eForceAggressorInRange(240);
      if (!sprite || !combat) return null;
      combat.addCombatant(sprite);
      return {
        engaged: combat.isActive,
        npcHull0: sprite.npc.hullHP,
        playerHull0: engine.player?.ship?.hullHP ?? 0,
        npcX0: sprite.x,
        npcY0: sprite.y,
      };
    });
    expect(staged).not.toBeNull();
    expect(staged!.engaged).toBe(true); // engages on contact

    // Run the turn so the real-time fight advances (NPC orbits + both auto-fire).
    await sf.startTurn();

    // Poll until the dogfight is unmistakable: still engaged, the aggressor has
    // maneuvered away from its spawn point (it orbits rather than sitting still),
    // and BOTH hulls have dropped (each side fired at least one ход).
    await page.waitForFunction(
      (s0) => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: Record<string, unknown> | null;
          player?: { ship?: { hullHP: number } } | null;
        };
        const combat = engine.currentScene?.['combatModule'] as
          | {
              isActive: boolean;
              selectedTarget: { npc: { hullHP: number }; x: number; y: number } | null;
            }
          | undefined;
        const target = combat?.selectedTarget;
        if (!combat?.isActive || !target) return false;
        const playerHull = engine.player?.ship?.hullHP ?? 0;
        const moved = Math.hypot(target.x - s0.npcX0, target.y - s0.npcY0) > 5;
        return playerHull < s0.playerHull0 && target.npc.hullHP < s0.npcHull0 && moved;
      },
      staged!,
      { timeout: 20_000 },
    );

    // Screenshot the live dogfight (range ring, reticles, fire flashes, hull bars).
    await sf.screenshot('dogfight-task4');

    errorCollector.assertAndDetach();
  });

  test('regression: an incoming attack auto-pauses and shows the target/weapon overlay; firing resumes (active-pause Task 3)', async ({ page }) => {
    // Active-pause acceptance: when a hostile opens fire the game pauses and a
    // centred target/weapon overlay appears; clicking Огонь! fires one shot and
    // resumes real time. Stage a deterministic fight (fit a weapon, drop the
    // first NPC just inside range as a hostile, engage it), run the turn until
    // the first incoming shot lands, then assert the pause + overlay, screenshot
    // it, and REAL-click the fire button (UiButton hit-geometry must work).
    await setupNewGame(page);
    const sf = new SpaceFlightPage(page);
    const errorCollector = new ErrorCollector(page);

    const staged = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
        playerLoadout?: {
          derivedStats: () => { weaponCount: number };
          install: (id: string) => unknown;
        } | null;
      };
      const scene = engine.currentScene;
      if (!scene) return false;
      const loadout = engine.playerLoadout;
      if (loadout && loadout.derivedStats().weaponCount === 0) {
        loadout.install('wpn_pulse');
      }
      const npcManager = scene['npcManager'] as
        | { e2eForceAggressorInRange: (range: number) => { npc: { hullHP: number } } | null }
        | undefined;
      const combat = scene['combatModule'] as
        | { addCombatant: (s: unknown) => void; isActive: boolean }
        | undefined;
      const sprite = npcManager?.e2eForceAggressorInRange(240);
      if (!sprite || !combat) return false;
      combat.addCombatant(sprite);
      return combat.isActive;
    });
    expect(staged).toBe(true);

    // Run the turn so the NPC's first shot lands → onPlayerUnderAttack → pause.
    await sf.startTurn();
    await page.waitForFunction(
      () => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: Record<string, unknown> | null;
        };
        const cp = engine.currentScene?.['combatPause'] as { paused: boolean } | undefined;
        return cp?.paused === true;
      },
      undefined,
      { timeout: 20_000 },
    );

    // The overlay modal must be mounted on the UI layer (labelled handle), and
    // the enemy hull at the moment of pause (the first exchange already landed).
    const opened = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const scene = engine.currentScene;
      const uiLayer = (scene?.['renderer'] as { uiLayer: { getChildByLabel: (l: string, deep?: boolean) => unknown } }).uiLayer;
      const overlay = uiLayer.getChildByLabel('combat-pause-overlay', true);
      const combat = scene?.['combatModule'] as { selectedTarget: { npc: { hullHP: number } } | null } | undefined;
      return { hasOverlay: overlay != null, enemyHull: combat?.selectedTarget?.npc.hullHP ?? null };
    });
    expect(opened.hasOverlay).toBe(true);
    expect(opened.enemyHull).not.toBeNull();

    // Visual verification: the centred overlay with target + weapon lists.
    await sf.screenshot('combat-pause-overlay');

    // REAL-click the fire button (warm up the event boundary first; e2e* seams
    // bypass hit-testing, so only a real click can catch a mouse-dead button).
    await page.mouse.move(5, 5);
    const fire = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const scene = engine.currentScene;
      const uiLayer = (scene?.['renderer'] as { uiLayer: { getChildByLabel: (l: string, deep?: boolean) => unknown } }).uiLayer;
      const btn = uiLayer.getChildByLabel('combat-pause-overlay', true) as
        | { getChildByLabel: (l: string, deep?: boolean) => { getGlobalPosition: () => { x: number; y: number }; width: number; height: number } | null }
        | null;
      const c = btn?.getChildByLabel('cp-fire', true);
      if (!c) return null;
      const p = c.getGlobalPosition();
      return { x: p.x + c.width / 2, y: p.y + c.height / 2 };
    });
    expect(fire).not.toBeNull();
    await page.mouse.click(fire!.x, fire!.y);

    // Firing resumes time (paused → false) and lands one more shot on the enemy.
    await page.waitForFunction(
      (hull0) => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: Record<string, unknown> | null;
        };
        const scene = engine.currentScene;
        const cp = scene?.['combatPause'] as { paused: boolean } | undefined;
        const combat = scene?.['combatModule'] as { selectedTarget: { npc: { hullHP: number } } | null } | undefined;
        const hull = combat?.selectedTarget?.npc.hullHP ?? 0;
        return cp?.paused === false && hull < hull0;
      },
      opened.enemyHull as number,
      { timeout: 10_000 },
    );

    errorCollector.assertAndDetach();
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

  for (const width of [1024, 1920]) {
    test(`star-map icon button never overlaps the help corner at width ${width} (Bug 1)`, async ({ page }) => {
      // Before the fix the star-map control was a wide "[МЕЖЗВЕЗДНАЯ КАРТА]" text
      // button anchored at x = w-220 — at common widths its live bounds reached
      // into the top-right «?» help corner. Set the viewport BEFORE the scene
      // mounts so the real «?» button (mountSceneHelp, which does not track a
      // later resize) is placed for this exact width — then compare both
      // buttons' REAL measured bounds, not a re-derived formula.
      await page.setViewportSize({ width, height: 800 });
      await setupNewGame(page);
      const errorCollector = new ErrorCollector(page);
      await page.mouse.move(5, 5);

      const rects = await page.evaluate(() => {
        type BoundsHolder = {
          container?: {
            getGlobalPosition: () => { x: number; y: number };
            width: number;
            height: number;
          };
        };
        const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
        const scene = engine.currentScene as Record<string, unknown>;
        const hud = scene?.['hud'] as Record<string, unknown>;
        const starMapC = (hud?.['backButton'] as BoundsHolder)?.container;
        if (!starMapC) return null;

        // The onboarding «?» button lives directly on renderer.stage (mounted by
        // mountSceneHelp) — find it by its icon glyph rather than any formula.
        const renderer = scene?.['renderer'] as {
          stage: { children: Array<{ children?: Array<{ text?: string }> }> };
        };
        const helpContainer = renderer.stage.children.find((c) =>
          c.children?.some((gc) => gc.text === "?"),
        ) as unknown as BoundsHolder['container'];
        if (!helpContainer) return null;

        const sp = starMapC.getGlobalPosition();
        const hp = helpContainer.getGlobalPosition();
        return {
          starMap: { x: sp.x, y: sp.y, w: starMapC.width, h: starMapC.height },
          help: { x: hp.x, y: hp.y, w: helpContainer.width, h: helpContainer.height },
        };
      });
      expect(rects, 'both buttons must be found').not.toBeNull();

      const { starMap, help } = rects!;
      const intersects =
        starMap.x < help.x + help.w &&
        starMap.x + starMap.w > help.x &&
        starMap.y < help.y + help.h &&
        starMap.y + starMap.h > help.y;
      expect(intersects, `overlap at width=${width}: starMap=${JSON.stringify(starMap)} help=${JSON.stringify(help)}`).toBe(false);

      errorCollector.assertAndDetach();
    });
  }

  test('real-pointer click on the star-map icon button opens StarMapScene (Bug 1)', async ({ page }) => {
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);
    await page.mouse.move(5, 5);

    const btn = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const hud = (engine.currentScene as Record<string, unknown>)?.['hud'] as Record<string, unknown>;
      const c = (hud?.['backButton'] as {
        container?: { getGlobalPosition: () => { x: number; y: number }; width: number; height: number };
      })?.container;
      if (!c) return null;
      const p = c.getGlobalPosition();
      return { x: p.x + c.width / 2, y: p.y + c.height / 2 };
    });
    expect(btn).not.toBeNull();

    await page.mouse.click(btn!.x, btn!.y);
    await waitForScene(page, 'StarMapScene', 10_000);

    const sceneName = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      return engine?.currentScene?.constructor?.name ?? null;
    });
    expect(sceneName).toBe('StarMapScene');

    errorCollector.assertAndDetach();
  });

  test('real-pointer install + jettison in the inventory scene work (Bug 2)', async ({ page }) => {
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);
    await page.mouse.move(5, 5);

    // Seed one owned-but-uninstalled gear item and one cargo stack so both the
    // warehouse and resources rows render an action button.
    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle & {
        player: { inventory: { addOwnedGear: (id: string) => void; addResource: (t: string, n: number) => void } } | null;
      };
      engine.player?.inventory.addOwnedGear('eq_radar');
      engine.player?.inventory.addResource('METALS', 5);
      void engine.transitionTo('INVENTORY', { gameEngine: engine });
    });
    await waitForScene(page, 'InventoryScene');

    type TextButtonQuery = { label: string };
    const findButtonCenter = async (label: string) =>
      page.evaluate(({ label }: TextButtonQuery) => {
        const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
        const scene = engine.currentScene as unknown as {
          mainContainer: { children: Array<Record<string, unknown>> } | null;
        };
        const node = scene.mainContainer?.children.find(
          (c) => (c as { text?: string }).text === label,
        ) as
          | { getGlobalPosition: () => { x: number; y: number }; width: number; height: number }
          | undefined;
        if (!node) return null;
        // Row buttons are anchored (1, 0.5) — getGlobalPosition() already
        // returns the right-middle point, so the center is width/2 to the
        // LEFT of it (y is already vertically centered).
        const p = node.getGlobalPosition();
        return { x: p.x - node.width / 2, y: p.y };
      }, { label });

    // Install the seeded warehouse item into the real loadout.
    const installBtn = await findButtonCenter('[Установить]');
    expect(installBtn, 'install button must be found').not.toBeNull();
    await page.mouse.click(installBtn!.x, installBtn!.y);

    await page.waitForFunction(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle & {
        player: { inventory: { ownedGearIds: string[] } } | null;
      };
      return !(engine.player?.inventory.ownedGearIds ?? []).includes('eq_radar');
    }, undefined, { timeout: 5_000 });

    // Jettison the metals stack (two-step confirm) — no credit refund.
    const creditsBefore = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      return engine.player?.credits ?? 0;
    });

    const jettisonBtn = await findButtonCenter('[Выбросить]');
    expect(jettisonBtn, 'jettison button must be found').not.toBeNull();
    await page.mouse.click(jettisonBtn!.x, jettisonBtn!.y);

    const confirmBtn = await findButtonCenter('Точно?');
    expect(confirmBtn, 'confirm button must be found').not.toBeNull();
    await page.mouse.click(confirmBtn!.x, confirmBtn!.y);

    await page.waitForFunction(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle & {
        player: {
          inventory: { resources: Array<{ type: string; amount: number }> };
        } | null;
      };
      const metals = engine.player?.inventory.resources.find((r) => r.type === 'METALS');
      return (metals?.amount ?? 0) === 0;
    }, undefined, { timeout: 5_000 });

    const creditsAfter = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      return engine.player?.credits ?? 0;
    });
    expect(creditsAfter, 'jettison must not grant credits').toBe(creditsBefore);

    errorCollector.assertAndDetach();
  });

  test('no camera debug text on the flight HUD (Bug 3)', async ({ page }) => {
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    const hasCameraDebugText = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const hud = (engine.currentScene as Record<string, unknown>)?.['hud'] as Record<string, unknown>;
      const uiContainer = hud?.['uiContainer'] as
        | { children: Array<{ text?: string }> }
        | undefined;
      return (uiContainer?.children ?? []).some(
        (c) => typeof c.text === 'string' && c.text.startsWith('Камера:'),
      );
    });
    expect(hasCameraDebugText, 'the removed "Камера:" debug read-out must not exist').toBe(false);

    errorCollector.assertAndDetach();
  });

  for (const width of [1024, 1920]) {
    test(`[МЕНЮ] sits bottom-left clear of the radar at width ${width} (Bug 3)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await setupNewGame(page);
      const errorCollector = new ErrorCollector(page);

      const rect = await page.evaluate(() => {
        const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
        const hud = (engine.currentScene as Record<string, unknown>)?.['hud'] as Record<string, unknown>;
        const uiContainer = hud?.['uiContainer'] as
          | {
              children: Array<{
                text?: string;
                getGlobalPosition: () => { x: number; y: number };
              }>;
            }
          | undefined;
        const menuNode = uiContainer?.children.find((c) => c.text === '[МЕНЮ]');
        if (!menuNode) return null;
        const p = menuNode.getGlobalPosition();
        return { x: p.x, y: p.y, viewportH: window.innerHeight };
      });
      expect(rect, '[МЕНЮ] text node must be found').not.toBeNull();
      expect(rect!.y, 'МЕНЮ must sit in the bottom half of the screen').toBeGreaterThan(
        rect!.viewportH / 2,
      );

      errorCollector.assertAndDetach();
    });
  }

  test('real-pointer click on [МЕНЮ] opens the system menu from its bottom-left position (Bug 3)', async ({ page }) => {
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);
    await page.mouse.move(5, 5);

    const btn = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const hud = (engine.currentScene as Record<string, unknown>)?.['hud'] as Record<string, unknown>;
      const uiContainer = hud?.['uiContainer'] as
        | {
            children: Array<{
              text?: string;
              getGlobalPosition: () => { x: number; y: number };
              width: number;
              height: number;
            }>;
          }
        | undefined;
      const node = uiContainer?.children.find((c) => c.text === '[МЕНЮ]');
      if (!node) return null;
      const p = node.getGlobalPosition();
      return { x: p.x + node.width / 2, y: p.y + node.height / 2 };
    });
    expect(btn, '[МЕНЮ] text node must be found').not.toBeNull();

    await page.mouse.click(btn!.x, btn!.y);
    await page.waitForFunction(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as EngineHandle;
      const hud = (engine.currentScene as Record<string, unknown>)?.['hud'] as {
        isSystemMenuOpen?: () => boolean;
      };
      return hud?.isSystemMenuOpen?.() === true;
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

  test('smoke: quest journal with >2 active quests scrolls to reveal them all (no dead "+N ещё")', async ({ page }) => {
    // Plan 20260618 Task 2: the journal used to slice(0, ~2) the active quests
    // and print the rest as a non-interactive "+N ещё..." stub you could never
    // open. Now every active quest renders into a wheel-scrollable region. Seed
    // 4 quests so the section overflows (only ~2 fit), open the journal, and
    // assert: no "+N ещё" stub, every title is present (no truncation), and a
    // real wheel scroll advances the active list so the lower quests are reached.
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    const seeded = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        questManager: {
          acceptQuestFromTemplate: (
            t: unknown,
            p?: string,
            d?: number,
            f?: string,
          ) => unknown;
          getActiveQuests: () => { id: string }[];
        };
      };
      const qm = engine.questManager;
      for (let n = 1; n <= 4; n++) {
        qm.acceptQuestFromTemplate(
          {
            id: `e2e-scroll-${n}`,
            title: `E2E Свиток ${n}`,
            description: 'scroll test',
            type: 'EXPLORATION',
            objectives: [
              {
                id: `e2e-scroll-${n}-o`,
                description: 'Разведать',
                type: 'VISIT_SYSTEM',
                targetAmount: 1,
                targetSystemId: 'sys-x',
              },
            ],
            reward: { credits: 100 * n, experience: 10 * n, items: [] },
            dialogueAnchors: [],
            deadline: 0,
            failurePenalty: null,
          },
          'unknown',
          0,
          '',
        );
      }
      return qm.getActiveQuests().length;
    });
    expect(seeded).toBeGreaterThanOrEqual(4);

    // Open the journal via the HUD.
    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const hud = engine.currentScene?.['hud'] as
        | { toggleQuestJournal: () => void }
        | undefined;
      hud?.toggleQuestJournal();
    });

    // Probe the rendered journal: collect every Text string and read the active
    // list's scroll state straight off the Pixi tree (private fields are plain
    // runtime props).
    const probe = (): Promise<{
      texts: string[];
      offset: number | null;
      maxOffset: number | null;
      overflows: boolean;
    } | null> =>
      page.evaluate(() => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: Record<string, unknown> | null;
        };
        const hud = engine.currentScene?.['hud'] as
          | {
              questJournalUI: {
                container: { text?: unknown; children?: unknown[] };
                activeList: {
                  offset: number;
                  maxOffset: number;
                  overflows: boolean;
                } | null;
              } | null;
            }
          | undefined;
        const ui = hud?.questJournalUI ?? null;
        if (!ui) return null;
        const texts: string[] = [];
        const walk = (node: { text?: unknown; children?: unknown[] }): void => {
          if (typeof node.text === 'string' && node.text) texts.push(node.text);
          for (const c of (node.children as {
            text?: unknown;
            children?: unknown[];
          }[]) ?? [])
            walk(c);
        };
        walk(ui.container);
        return {
          texts,
          offset: ui.activeList?.offset ?? null,
          maxOffset: ui.activeList?.maxOffset ?? null,
          overflows: ui.activeList?.overflows ?? false,
        };
      });

    const before = await probe();
    expect(before).not.toBeNull();
    // The dead "+N ещё" overflow stub is gone.
    expect(before!.texts.some((t) => /\+\d+\s*ещё/.test(t))).toBe(false);
    // Every active quest title is rendered (no slice/truncation).
    for (let n = 1; n <= 4; n++) {
      expect(before!.texts).toContain(`E2E Свиток ${n}`);
    }
    // The active section overflows and starts parked at the top.
    expect(before!.overflows).toBe(true);
    expect(before!.maxOffset!).toBeGreaterThan(0);
    expect(before!.offset).toBe(0);

    // A real wheel scroll over the journal advances the offset (reveals the rest)
    // WITHOUT zooming the camera underneath it. The journal's scrollable list and
    // the scene's camera both listen on window 'wheel'; the scene must suppress
    // the zoom while a blocking modal is open (else the map zooms behind the
    // open journal as you scroll it).
    const readZoom = (): Promise<number | null> =>
      page.evaluate(() => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: Record<string, unknown> | null;
        };
        const camera = engine.currentScene?.['camera'] as
          | { zoom: number }
          | undefined;
        return camera?.zoom ?? null;
      });
    const screen = await page.evaluate(() => {
      const c = document.querySelector('canvas') as HTMLCanvasElement;
      return { w: c.clientWidth, h: c.clientHeight };
    });
    const zoomBefore = await readZoom();
    expect(zoomBefore).not.toBeNull();
    await page.mouse.move(screen.w / 2, screen.h / 2);
    await page.mouse.wheel(0, 300);
    const after = await probe();
    expect(after!.offset!).toBeGreaterThan(0);
    // The camera zoom must be untouched — scrolling the journal did not zoom.
    expect(await readZoom()).toBeCloseTo(zoomBefore!, 5);

    errorCollector.assertAndDetach();
  });

  test('smoke: a quest with a long title + long objective wraps inside its card (no overflow)', async ({ page }) => {
    // Plan 20260627 Task 1: quest-card text used to carry no wordWrapWidth, so a
    // long title / long objective ran off the card's right edge and a tall card
    // bled into the next. The card now word-wraps and its box height tracks the
    // wrapped content. Seed one quest with a deliberately long title + long
    // objective, open the journal, and assert every Text node in the card stays
    // within the card box (right edge AND bottom) — i.e. nothing overflows.
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    const longTitle =
      'Доставить крупную партию редких медикаментов на дальнюю орбитальную станцию системы Эпсилон';
    const longObjective =
      'Загрузить и доставить тридцать единиц редких медикаментов на удалённую орбитальную станцию в соседней системе';

    await page.evaluate(
      ({ longTitle, longObjective }) => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          questManager: {
            acceptQuestFromTemplate: (
              t: unknown,
              p?: string,
              d?: number,
              f?: string,
            ) => unknown;
          };
        };
        engine.questManager.acceptQuestFromTemplate(
          {
            id: 'e2e-long-card',
            title: longTitle,
            description: 'long card test',
            type: 'EXPLORATION',
            objectives: [
              {
                id: 'e2e-long-card-o',
                description: longObjective,
                type: 'VISIT_SYSTEM',
                targetAmount: 1,
                targetSystemId: 'sys-x',
              },
            ],
            reward: { credits: 500, experience: 100, items: [] },
            dialogueAnchors: [],
            deadline: 0,
            failurePenalty: null,
          },
          'unknown',
          0,
          '',
        );
      },
      { longTitle, longObjective },
    );

    // Open the journal via the HUD.
    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const hud = engine.currentScene?.['hud'] as
        | { toggleQuestJournal: () => void }
        | undefined;
      hud?.toggleQuestJournal();
    });

    // Probe the rendered card: find the card holding the long title, read its
    // background box height, and every Text node's local right/bottom edge.
    const overflow = await page.evaluate(
      ({ longTitle }) => {
        type Node = {
          text?: unknown;
          x?: number;
          y?: number;
          width?: number;
          height?: number;
          children?: Node[];
        };
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: Record<string, unknown> | null;
        };
        const hud = engine.currentScene?.['hud'] as
          | { questJournalUI: { container: Node } | null }
          | undefined;
        const root = hud?.questJournalUI?.container;
        if (!root) return null;

        const hasText = (n: Node, needle: string): boolean => {
          if (typeof n.text === 'string' && n.text.includes(needle)) return true;
          return (n.children ?? []).some((c) => hasText(c, needle));
        };
        // The card is a direct child container of the journal root that contains
        // the long title text somewhere in its subtree.
        const card = (root.children ?? []).find(
          (c) => (c.children?.length ?? 0) > 1 && hasText(c, longTitle.slice(0, 12)),
        );
        if (!card) return null;

        // The card background Graphics is the first child; its height is the box.
        const boxHeight = card.children?.[0]?.height ?? 0;

        // Inner right edge of the box: bg rect is (20, 0, panelWidth-40, h) and
        // panelWidth is 600 → right edge at x=580 in card-local coords.
        const innerRight = 580;
        let maxRight = 0;
        let maxBottom = 0;
        const texts: string[] = [];
        const walk = (n: Node): void => {
          if (typeof n.text === 'string' && n.text) {
            texts.push(n.text);
            const right = (n.x ?? 0) + (n.width ?? 0);
            const bottom = (n.y ?? 0) + (n.height ?? 0);
            if (right > maxRight) maxRight = right;
            if (bottom > maxBottom) maxBottom = bottom;
          }
          for (const c of n.children ?? []) walk(c);
        };
        walk(card);

        return { boxHeight, innerRight, maxRight, maxBottom, texts };
      },
      { longTitle },
    );

    expect(overflow).not.toBeNull();
    // The long title + long objective actually rendered into the card.
    expect(overflow!.texts.some((t) => t.includes(longTitle.slice(0, 12)))).toBe(
      true,
    );
    // No Text node spills past the card's right edge (a few px tolerance for the
    // text resolution rounding).
    expect(overflow!.maxRight).toBeLessThanOrEqual(overflow!.innerRight + 4);
    // The box grew to contain all the wrapped text — nothing bleeds out the bottom.
    expect(overflow!.boxHeight).toBeGreaterThan(0);
    expect(overflow!.maxBottom).toBeLessThanOrEqual(overflow!.boxHeight + 4);

    await page.screenshot({ path: 'test-results/quest-card-long-text.png' });
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

  test('regression: shop stat lines carry no float noise and the status column stays inside the panel (Task 17 visual audit)', async ({ page }) => {
    // Two visual bugs found in the Task 17 sweep, both in the СНАРЯЖЕНИЕ list:
    //   1. the replace-delta leaked a raw IEEE-754 tail — «+0.4999999999999999 vs …»
    //      (1.4 − 0.9). Fixed via utils/formatStat (rounds to ≤ 2 dp).
    //   2. the right-hand status label («Установлено»/«Мало₡») was left-anchored at
    //      0.89·PW and sliced by the scroll-mask clip at PW − 30. Fixed by
    //      right-anchoring it to the clip edge.
    // Introspect every Text node in the live listContainer and assert neither
    // recurs: no long fractional tail anywhere, and every label's right edge sits
    // within the list clip.
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    await page.mouse.move(5, 5);
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

    const audit = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const scene = engine.currentScene;
      if (!scene) return null;

      // Panel geometry mirrors EquipmentShopScene.render (PW = min(820, sw−40)).
      const renderer = scene['renderer'] as { app: { screen: { width: number } } };
      const sw = renderer.app.screen.width;
      const PW = Math.min(820, sw - 40);
      const PX = (sw - PW) / 2;
      const clipRight = PX + PW - 30;

      const list = scene['listContainer'] as
        | { children: Array<Record<string, unknown>> }
        | undefined;
      const texts: Array<{ text: string; maxX: number }> = [];
      for (const child of list?.children ?? []) {
        const text = child['text'];
        if (typeof text !== 'string' || text.length === 0) continue;
        const getBounds = child['getBounds'] as (() => { maxX?: number; x: number; width: number }) | undefined;
        const b = getBounds ? getBounds.call(child) : { x: 0, width: 0 };
        const maxX = b.maxX ?? b.x + b.width;
        texts.push({ text, maxX });
      }
      return { clipRight, texts };
    });

    expect(audit).not.toBeNull();
    expect(audit!.texts.length).toBeGreaterThan(0);

    // (1) No player-facing stat string may carry a 5+-digit run (float noise like
    // 0.4999999999999999 / 0.30000000000000004). Clean integers/decimals pass.
    for (const t of audit!.texts) {
      expect(t.text, `float-noise leak in "${t.text}"`).not.toMatch(/\d\.\d{5,}/);
    }

    // (2) Every list label's right edge must sit within the scroll-mask clip — a
    // 2 px tolerance for sub-pixel rounding. Regression for the sliced status word.
    for (const t of audit!.texts) {
      expect(t.maxX, `label "${t.text}" overflows the list clip`).toBeLessThanOrEqual(
        audit!.clipRight + 2,
      );
    }

    errorCollector.assertAndDetach();
  });

  test('regression: owned-uninstalled gear shows in the ТРЮМ and sells for the trade-in refund', async ({ page }) => {
    // Task 4: gear the player owns but hasn't installed lives in the canonical
    // `inventory.ownedGearIds` store. The equipment shop renders it in the ТРЮМ
    // strip with a «Продать» button that refunds basePrice × 0.4 and removes the
    // copy. Drive a REAL click on that button and assert the credit refund + the
    // item disappearing from the hold.
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    // Warm the event boundary, land on a planet, then seed an owned-uninstalled
    // item BEFORE opening the shop so the ТРЮМ strip renders it on init.
    await page.mouse.move(5, 5);
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eLandOnPlanet?: () => Promise<void> } | null;
      };
      await engine.currentScene?.e2eLandOnPlanet?.();
    });
    await waitForScene(page, 'PlanetScene', 15_000);

    const before = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        player: { credits: number; inventory: { ownedGearIds: string[] } } | null;
      };
      const player = engine.player!;
      player.inventory.ownedGearIds = player.inventory.ownedGearIds ?? [];
      player.inventory.ownedGearIds.push('eq_radar'); // basePrice 2800 → refund 1120
      return { credits: player.credits, owned: player.inventory.ownedGearIds.length };
    });

    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { planet?: unknown } | null;
        transitionTo: (s: string, ctx?: object) => Promise<void>;
      };
      const planet = engine.currentScene?.planet;
      await engine.transitionTo('EQUIPMENT_SHOP', { gameEngine: engine, planet });
    });
    await waitForScene(page, 'EquipmentShopScene', 15_000);

    // Bug guard (rebuild): switching tabs rebuilds the shop, destroying
    // `mainContainer` and its child `holdContainer`. The ТРЮМ must re-render
    // afterwards — regression for `holdContainer` being left as a destroyed
    // reference (so `render()` skips re-creating it and `renderHold()` runs on a
    // dead container). Drive the same `rebuild()` a tab switch triggers.
    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { rebuild?: () => void } | null;
      };
      engine.currentScene?.rebuild?.();
    });

    // The «Продать» button is the only pointer child of the hold container; read
    // its on-screen centre (top-left + half-extent — the label has no anchor).
    const sellBtn = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const hold = engine.currentScene?.['holdContainer'] as
        | {
            children: Array<{
              cursor?: string;
              width: number;
              height: number;
              text?: string;
              getGlobalPosition: () => { x: number; y: number };
            }>;
          }
        | undefined;
      const btn = hold?.children.find((c) => c.cursor === 'pointer');
      if (!btn) return null;
      const p = btn.getGlobalPosition();
      return { x: p.x + btn.width / 2, y: p.y + btn.height / 2, text: btn.text ?? '' };
    });
    expect(sellBtn).not.toBeNull();
    expect(sellBtn!.text).toContain('Продать');
    expect(sellBtn!.text).toContain('1120'); // floor(2800 * 0.4)

    // REAL click on «Продать» → credits rise by the refund and the hold empties.
    await page.mouse.click(sellBtn!.x, sellBtn!.y);
    const after = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        player: { credits: number; inventory: { ownedGearIds: string[] } } | null;
      };
      const player = engine.player!;
      return {
        credits: player.credits,
        ownsRadar: player.inventory.ownedGearIds.includes('eq_radar'),
      };
    });
    expect(after.credits).toBe(before.credits + 1120);
    expect(after.ownsRadar).toBe(false);

    errorCollector.assertAndDetach();
  });

  test('regression: a TRADE_OPPORTUNITY rumor renders in the Info Center news tab', async ({ page }) => {
    // Task 7 (living-trade-economy-rumors): active trade-route rumors are
    // surfaced to the player as a "Торговые возможности" band atop the news
    // tab. Seed one rumor on the galaxy, open the Info Center on a planet, and
    // assert both the section header and the formatted rumor line render.
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    // Seed a single active rumor between the first two systems.
    const seeded = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        galaxy: {
          gameDays: number;
          systems: Array<{ id: string; name: string; planets: Array<{ id: string }> }>;
          activeRumors: unknown[];
        } | null;
      };
      const sys = engine.galaxy?.systems ?? [];
      if (sys.length < 2) return null;
      const a = sys[0];
      const b = sys[1];
      const rumor = {
        id: `FUEL:${a.id}->${b.id}`,
        resource: 'FUEL',
        fromSystemId: a.id,
        fromPlanetId: a.planets[0]?.id ?? `${a.id}p`,
        toSystemId: b.id,
        toPlanetId: b.planets[0]?.id ?? `${b.id}p`,
        fromPrice: 100,
        toPrice: 160,
        marginPct: 60,
        createdDay: engine.galaxy!.gameDays,
        lastMarginPct: 60,
      };
      engine.galaxy!.activeRumors = [rumor];
      return { fromName: a.name, toName: b.name };
    });
    expect(seeded).not.toBeNull();

    // Open the Info Center on a planet in the current (or first) system.
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        galaxy: { systems: Array<{ id: string; planets: Array<{ id: string }> }> } | null;
        player: { currentSystemId: string } | null;
        transitionTo: (scene: string, ctx?: object) => Promise<void>;
      };
      const systems = engine.galaxy?.systems ?? [];
      const here =
        systems.find((s) => s.id === engine.player?.currentSystemId) ?? systems[0];
      const planet = here?.planets[0];
      await engine.transitionTo('INFO_CENTER', { gameEngine: engine, planet });
    });
    await waitForScene(page, 'InfoCenterScene', 15_000);

    // Collect every rendered text node under the scene's mainContainer.
    const texts = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const out: string[] = [];
      const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        const n = node as { text?: unknown; children?: unknown[] };
        if (typeof n.text === 'string' && n.text) out.push(n.text);
        for (const c of n.children ?? []) walk(c);
      };
      walk(engine.currentScene?.['mainContainer']);
      return out;
    });

    // The section header and a formatted rumor row both render.
    expect(texts.some((t) => t.includes('ТОРГОВЫЕ ВОЗМОЖНОСТИ'))).toBe(true);
    expect(
      texts.some((t) => t.includes('Везите') && t.includes('маржа')),
    ).toBe(true);

    errorCollector.assertAndDetach();
  });

  test('regression: Job Board text scales with the S/M/L font setting (font-scale plan Task 3)', async ({
    page,
  }) => {
    // Plan 20260618 Task 3: the Job Board hardcoded `fontSize:` so the S/M/L
    // setting never reached it (and its body/footer rendered dim sub-AA
    // blue-grays). Now every label routes through `scaledText`. Open the board
    // at S and at L and assert the «ДОСКА ЗАДАНИЙ» header font size grows with
    // the setting (proving the setting reaches the panel); screenshot each.
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    // Land on a planet so PlanetScene.openJobBoard() is the live scene method.
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        galaxy: {
          systems: Array<{
            id: string;
            planets: Array<{ id: string; isHabitable: boolean }>;
          }>;
        } | null;
        player: { currentSystemId: string } | null;
        transitionTo: (scene: string, ctx?: object) => Promise<void>;
      };
      const systems = engine.galaxy?.systems ?? [];
      const here = systems.find((s) => s.id === engine.player?.currentSystemId);
      const planet =
        here?.planets.find((p) => p.isHabitable) ??
        systems.flatMap((s) => s.planets).find((p) => p.isHabitable) ??
        systems.flatMap((s) => s.planets)[0];
      if (!planet) return;
      await engine.transitionTo('PLANET', { gameEngine: engine, planet });
    });
    await waitForScene(page, 'PlanetScene', 15_000);

    // The lazy faction-panorama load shows a loading overlay and rebuilds the
    // scene UI once; wait until it has settled so the opened board is not torn
    // down/covered by that rebuild (otherwise the first screenshot is blank).
    await page.waitForFunction(
      () => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          loadingOverlayObjects?: unknown[];
        };
        return (engine.loadingOverlayObjects?.length ?? 0) === 0;
      },
      undefined,
      { timeout: 15_000 },
    );

    // Open the board at a font-scale key and read the «ДОСКА ЗАДАНИЙ» header's
    // rendered font size straight off the Pixi tree (scaledFont reads the
    // localStorage-backed setting at text-creation, so no reload is needed).
    const openAndMeasure = (key: 'S' | 'L'): Promise<number | null> =>
      page.evaluate((k) => {
        localStorage.setItem('fontScale', k);
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: Record<string, unknown> | null;
        };
        const scene = engine.currentScene as Record<string, unknown> | null;
        const open = scene?.['openJobBoard'] as (() => void) | undefined;
        if (!open) return null;
        open.call(scene);
        const panel = scene?.['jobBoardPanel'] as {
          container: unknown;
        } | null;
        if (!panel) return null;
        let headerSize: number | null = null;
        const walk = (node: {
          text?: unknown;
          style?: { fontSize?: unknown };
          children?: unknown[];
        }): void => {
          if (node.text === 'ДОСКА ЗАДАНИЙ') {
            const fs = node.style?.fontSize;
            headerSize =
              typeof fs === 'number' ? fs : parseFloat(String(fs ?? ''));
          }
          for (const c of (node.children as (typeof node)[]) ?? []) walk(c);
        };
        walk(panel.container as never);
        return headerSize;
      }, key);

    const smallSize = await openAndMeasure('S');
    await page.waitForTimeout(300); // let the newly-added panel render a frame
    await page.screenshot({ path: 'e2e/screenshots/jobboard-fontscale-S.png' });
    const largeSize = await openAndMeasure('L');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/jobboard-fontscale-L.png' });

    expect(smallSize).not.toBeNull();
    expect(largeSize).not.toBeNull();
    expect(Number.isFinite(smallSize!)).toBe(true);
    // The S/M/L setting reaches the board: L renders strictly larger than S.
    expect(largeSize!).toBeGreaterThan(smallSize!);

    errorCollector.assertAndDetach();
  });

  test('regression: planet-screen «?» help button never covers the credit balance', async ({ page }) => {
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    // Suppress the one-shot auto-help panel so the screenshot shows a clean
    // planet screen (the «?» button + balance are what we assert on).
    await page.evaluate(() => {
      localStorage.setItem(
        'sr_help_seen',
        JSON.stringify(['PLANET', 'welcome', 'SPACE_FLIGHT']),
      );
    });

    // Land on a planet via engine navigation (the same seam the bank/trade
    // regressions use). Any planet shows the top-right credit-balance HUD.
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        transitionTo: (s: string, ctx?: object) => Promise<void>;
        galaxy: { systems: { planets: unknown[] }[] } | null;
      };
      const planet = engine.galaxy?.systems?.flatMap((s) => s.planets)?.[0];
      await engine.transitionTo('PLANET', { gameEngine: engine, planet });
    });
    await waitForScene(page, 'PlanetScene');
    // Let the (possibly lazy) backdrop swap-in settle so the final UI is mounted.
    await page.waitForTimeout(600);

    // Read the rendered global bounds of the «?» help button (the only stage
    // child that is neither the game nor UI layer) and the top-most credit
    // read-out (a top-right Text containing «₡»), then assert they don't overlap.
    const rects = await page.evaluate(() => {
      type Bounds = {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
      };
      type Node = {
        text?: unknown;
        children?: Node[];
        getBounds: () => Bounds;
      };
      const boundsOf = (n: Node) => {
        const b = n.getBounds();
        return {
          x: typeof b.x === 'number' ? b.x : b.minX,
          y: typeof b.y === 'number' ? b.y : b.minY,
          w: typeof b.width === 'number' ? b.width : b.maxX - b.minX,
          h: typeof b.height === 'number' ? b.height : b.maxY - b.minY,
        };
      };
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const scene = engine.currentScene as Record<string, unknown> | null;
      if (!scene) return null;
      const renderer = scene['renderer'] as {
        stage: { children: Node[] };
        gameLayer: Node;
        uiLayer: Node;
      };
      const { stage, gameLayer, uiLayer } = renderer;
      const helpContainer = stage.children.find(
        (c) => c !== gameLayer && c !== uiLayer,
      );
      if (!helpContainer) return null;

      const credits: ReturnType<typeof boundsOf>[] = [];
      const walk = (n: Node): void => {
        if (typeof n.text === 'string' && n.text.includes('₡')) {
          credits.push(boundsOf(n));
        }
        for (const c of n.children ?? []) walk(c);
      };
      walk(uiLayer);
      if (credits.length === 0) return null;
      // The top-right balance read-out is the highest «₡» text on screen.
      credits.sort((a, b) => a.y - b.y);
      return { help: boundsOf(helpContainer), balance: credits[0] };
    });

    await page.screenshot({ path: 'e2e/screenshots/planet-help-balance.png' });

    expect(rects).not.toBeNull();
    const { help, balance } = rects!;
    const intersect =
      help.x < balance.x + balance.w &&
      help.x + help.w > balance.x &&
      help.y < balance.y + balance.h &&
      help.y + help.h > balance.y;
    expect(
      intersect,
      `«?» ${JSON.stringify(help)} overlaps balance ${JSON.stringify(balance)}`,
    ).toBe(false);

    errorCollector.assertAndDetach();
  });

  test('regression: English build — faction-selection screen renders no Russian (i18n Task 6)', async ({ page }) => {
    await applyMockHeavySystems(page);
    await page.goto('/');
    await waitForEngine(page);
    const errorCollector = new ErrorCollector(page);

    // Switch the UI language to English BEFORE the scene renders (the scene reads
    // `t()` live at render). The faction-selection screen was the explicitly
    // user-reported still-Russian surface.
    await page.evaluate(async () => {
      localStorage.setItem('language', 'en');
      const engine = (window as Record<string, unknown>).__gameEngine as {
        transitionTo: (s: string, ctx?: object) => Promise<void>;
      };
      await engine.transitionTo('RACE_SELECTION', { gameEngine: engine });
    });
    await waitForScene(page, 'RaceSelectionScene');
    await page.waitForTimeout(300);

    // Collect every rendered Text under the scene's UI layer; assert the heading
    // is English and NO label contains a Cyrillic character.
    const texts = await page.evaluate(() => {
      type Node = { text?: unknown; children?: Node[] };
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const scene = engine.currentScene as Record<string, unknown> | null;
      if (!scene) return null;
      const renderer = scene['renderer'] as { uiLayer: Node };
      const out: string[] = [];
      const walk = (n: Node): void => {
        if (typeof n.text === 'string' && n.text.length > 0) out.push(n.text);
        for (const c of n.children ?? []) walk(c);
      };
      walk(renderer.uiLayer);
      return out;
    });

    await page.screenshot({ path: 'e2e/screenshots/race-selection-en.png' });

    expect(texts).not.toBeNull();
    expect(texts!).toContain('CHOOSE YOUR FACTION');
    const cyrillic = texts!.filter((s) => /[А-Яа-яЁё]/.test(s));
    expect(
      cyrillic,
      `Russian leaked into the English faction-selection screen:\n${cyrillic.join('\n')}`,
    ).toEqual([]);

    errorCollector.assertAndDetach();
  });

  test('regression: Galactic Bank opens, a trade shows as a balanced posting (АБС Task 7)', async ({ page }) => {
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    // Open the bank via engine navigation (a planet is threaded so "Назад"
    // returns there, but the bank renders straight from the ledger).
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        transitionTo: (s: string, ctx?: object) => Promise<void>;
        galaxy: { systems: { planets: unknown[] }[] } | null;
      };
      const planet = engine.galaxy?.systems?.flatMap((s) => s.planets)?.[0];
      await engine.transitionTo('BANK', { gameEngine: engine, planet });
    });
    await waitForScene(page, 'BankScene');

    // Book a trade through the REAL production credit facade (adjustPlayerCredits
    // → bus → ledger) via the scene's debug seam, then assert it appears as a
    // posting on the current-account statement AND the books stay balanced.
    const result = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: {
          e2eSimulateTrade?: (amt: number, reason?: string) => void;
          e2eStatement?: () => Array<{ reason: string; delta: number }>;
        } | null;
        bankingService: { getLedger: () => { totalBalance: () => number } };
      };
      const scene = engine.currentScene;
      scene?.e2eSimulateTrade?.(750, 'Продажа: Металлы');
      const statement = scene?.e2eStatement?.() ?? [];
      const tradeRow = statement.find((r) => r.reason === 'Продажа: Металлы');
      return {
        hasTrade: tradeRow?.delta === 750,
        totalBalance: engine.bankingService.getLedger().totalBalance(),
      };
    });

    expect(result.hasTrade).toBe(true);
    // Double-entry invariant: Σ all postings == 0 after the trade.
    expect(Math.abs(result.totalBalance)).toBeLessThan(1e-6);

    await page.waitForTimeout(200); // let the statement row render a frame
    await page.screenshot({ path: 'e2e/screenshots/bank-task7.png' });

    errorCollector.assertAndDetach();
  });

  test('regression: player death routes to GAME_OVER with both recovery actions (player-death plan Task 4)', async ({
    page,
  }) => {
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    // Establish the take-off checkpoint the death rolls back to. A real planet
    // take-off writes the "auto" slot (player-death plan Task 1); the player
    // starts straight in flight here, so write the same checkpoint directly.
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        saveGame: (slot: string) => Promise<void>;
      };
      await engine.saveGame('auto');
    });

    // Kill the player through the REAL production death seam: triggerPlayerDeath
    // is what SpaceFlightScene's CombatModule.onPlayerDestroyed calls when the
    // hull hits 0. It must route to the terminal GAME_OVER scene (Task 4 wiring).
    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        triggerPlayerDeath: () => void;
      };
      engine.triggerPlayerDeath();
    });
    await waitForScene(page, 'GameOverScene');

    // The screen offers exactly the two non-destructive recoveries, in order.
    const actions = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eActions?: () => string[] } | null;
      };
      return engine.currentScene?.e2eActions?.() ?? [];
    });
    expect(actions).toEqual(['Загрузить сохранение', 'Начать заново']);

    await page.waitForTimeout(200); // let the terminal screen paint a frame
    await page.screenshot({ path: 'e2e/screenshots/gameover-deathflow.png' });

    // Linger on the death screen (a real player reads it before acting). This is
    // the regression that mattered: the GAME_OVER transition must NOT autosave
    // over the "auto" takeoff checkpoint — otherwise the slot would now hold the
    // GAME_OVER state and «Загрузить» would re-enter the death screen instead of
    // returning to flight. Loading immediately used to race ahead of that buggy
    // autosave; the wait forces the autosave-clobber path if it ever returns.
    await page.waitForTimeout(1500);

    // «Загрузить сохранение» rolls back to the last takeoff autosave: the "auto"
    // slot was written on takeoff and death left it untouched, so the load
    // restores the saved SPACE_FLIGHT state (off GAME_OVER, back into flight).
    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eRunAction?: (label: string) => void } | null;
      };
      engine.currentScene?.e2eRunAction?.('Загрузить сохранение');
    });
    await waitForScene(page, 'SpaceFlightScene', 15_000);

    errorCollector.assertAndDetach();
  });

  test('regression: an NPC stays hit-testable across zoom AND once a fight is engaged (20260625 Task 2)', async ({ page }) => {
    // The reported bug: NPC ships "stop responding to clicks at some point" —
    // the hit-area collapsing at certain zoom/combat states. A headless unit
    // can't see hit geometry, so this is a REAL-pointer proof: it engages a
    // fight, then for several camera zooms centres the camera on the aggressor,
    // moves the real mouse over it, and asks the live PixiJS event boundary
    // (`rootBoundary.hitTest`) what is under the cursor — it must be the NPC's
    // own container (eventMode='static' with a finite hit-circle). A NaN-radius
    // circle (the collapse bug) fails to contain even its own centre, and a
    // clobbered eventMode drops the container from the boundary, so either
    // regression turns this red.
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    // Warm the event boundary (rootTarget is set on the first mapped event).
    await page.mouse.move(5, 5);

    // Fit a weapon and stage an aggressor in range, then ENGAGE combat so the
    // hit-area is exercised in the exact state the bug report describes.
    const engaged = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
        playerLoadout?: {
          derivedStats: () => { weaponCount: number };
          install: (id: string) => unknown;
        } | null;
      };
      const scene = engine.currentScene;
      if (!scene) return false;
      const loadout = engine.playerLoadout;
      if (loadout && loadout.derivedStats().weaponCount === 0) {
        loadout.install('wpn_pulse');
      }
      const npcManager = scene['npcManager'] as
        | { e2eForceAggressorInRange: (range: number) => { npc: { id: string } } | null }
        | undefined;
      const combat = scene['combatModule'] as
        | { addCombatant: (s: unknown) => void; isActive: boolean }
        | undefined;
      const sprite = npcManager?.e2eForceAggressorInRange(240);
      if (!sprite || !combat) return false;
      combat.addCombatant(sprite);
      return combat.isActive;
    });
    expect(engaged).toBe(true);

    // Probe the engaged aggressor at a zoomed-OUT, neutral, and zoomed-IN camera.
    for (const zoom of [0.4, 1, 2.2]) {
      // Centre the camera on the aggressor at this zoom and read its on-screen
      // position (the camera transform also refreshes NPC hit-areas).
      const pos = await page.evaluate((z) => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: Record<string, unknown> | null;
        };
        const scene = engine.currentScene as
          | ({
              e2eSetCameraZoom?: (z: number) => void;
              e2eSetCameraPan?: (x: number, y: number) => void;
              e2eGetCameraState?: () => { zoom: number };
            } & Record<string, unknown>)
          | null;
        const combat = scene?.['combatModule'] as
          | { selectedTarget: { x: number; y: number; container: { getGlobalPosition: () => { x: number; y: number } } } | null }
          | undefined;
        const sprite = combat?.selectedTarget;
        if (!scene || !sprite) return null;
        scene.e2eSetCameraZoom?.(z);
        const zoomNow = scene.e2eGetCameraState?.().zoom ?? z;
        scene.e2eSetCameraPan?.(
          window.innerWidth / 2 - sprite.x * zoomNow,
          window.innerHeight / 2 - sprite.y * zoomNow,
        );
        const p = sprite.container.getGlobalPosition();
        return { x: p.x, y: p.y };
      }, zoom);
      expect(pos, `aggressor position at zoom ${zoom}`).not.toBeNull();

      // Move the REAL mouse over the ship (sets the boundary's rootTarget).
      await page.mouse.move(pos!.x, pos!.y, { steps: 2 });

      // Ask the live event boundary what is under the cursor — it must be the
      // NPC's own container, proving the hit-area survived this zoom + combat.
      const hit = await page.evaluate((p) => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: Record<string, unknown> | null;
        };
        const scene = engine.currentScene as Record<string, unknown> | null;
        const combat = scene?.['combatModule'] as
          | { selectedTarget: { container: unknown } | null }
          | undefined;
        const renderer = scene?.['renderer'] as
          | { app: { renderer: { events: { rootBoundary: { hitTest: (x: number, y: number) => unknown } } } } }
          | undefined;
        const target = combat?.selectedTarget;
        if (!renderer || !target) return { ok: false, reason: 'no renderer/target' };
        const boundary = renderer.app.renderer.events.rootBoundary;
        const found = boundary.hitTest(p.x, p.y);
        // The hit must BE the NPC container (or one of its descendants).
        let node = found as { parent?: unknown } | null;
        let isNpc = false;
        for (let i = 0; node && i < 8; i++) {
          if (node === target.container) {
            isNpc = true;
            break;
          }
          node = (node as { parent?: { parent?: unknown } }).parent as { parent?: unknown } | null;
        }
        return { ok: isNpc, reason: found ? 'hit-not-npc' : 'nothing-hit' };
      }, pos!);

      expect(hit.ok, `hit-test on aggressor at zoom ${zoom} (${hit.reason})`).toBe(true);
    }

    await new SpaceFlightPage(page).screenshot('npc-clickable-task2');
    errorCollector.assertAndDetach();
  });

  test('regression: campaign escalation warning surfaces in the info feed (three-year-campaign Task 5)', async ({
    page,
  }) => {
    // Task 5: adaptive difficulty must be *felt* — crossing the Overmind-share
    // warning band emits a one-shot CAMPAIGN_ESCALATION news event that the
    // Info Center feed renders. Drive the REAL EOD pipeline: tick once at the
    // fresh-game baseline (seeds the fire-once tracker), push the share past
    // OVERMIND_WARNING_THRESHOLD, tick again, then read the feed on screen.
    await setupNewGame(page);
    const errorCollector = new ErrorCollector(page);

    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        advanceGalaxyDay: () => void;
      };
      engine.advanceGalaxyDay();
    });

    const seeded = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        galaxy: {
          systems: Array<{ id: string }>;
          addOvermindSystem: (id: string) => void;
          newsFeed: Array<{ type: string; description: string }>;
        } | null;
        player: { currentSystemId: string } | null;
        advanceGalaxyDay: () => void;
      };
      const galaxy = engine.galaxy;
      if (!galaxy) return null;
      // Capture ~45% of systems (past the 0.35 warning band, far below the
      // 0.85 loss share), sparing the player's own system.
      const spare = engine.player?.currentSystemId ?? '';
      const targets = galaxy.systems.filter((s) => s.id !== spare);
      const need = Math.ceil(galaxy.systems.length * 0.45);
      for (const s of targets.slice(0, need)) galaxy.addOvermindSystem(s.id);
      engine.advanceGalaxyDay();
      const event = galaxy.newsFeed.find(
        (e) => e.type === 'CAMPAIGN_ESCALATION',
      );
      return event ? { description: event.description } : null;
    });
    expect(seeded, 'HARDENING escalation event emitted into newsFeed').not.toBeNull();
    expect(seeded!.description.length).toBeGreaterThan(0);

    // Open the Info Center on a planet in the current (or first) system.
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        galaxy: { systems: Array<{ id: string; planets: Array<{ id: string }> }> } | null;
        player: { currentSystemId: string } | null;
        transitionTo: (scene: string, ctx?: object) => Promise<void>;
      };
      const systems = engine.galaxy?.systems ?? [];
      const here =
        systems.find((s) => s.id === engine.player?.currentSystemId) ?? systems[0];
      const planet = here?.planets[0];
      await engine.transitionTo('INFO_CENTER', { gameEngine: engine, planet });
    });
    await waitForScene(page, 'InfoCenterScene', 15_000);

    // Collect every rendered text node under the scene's mainContainer and
    // assert the escalation warning actually surfaced in the feed.
    const texts = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const out: string[] = [];
      const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        const n = node as { text?: unknown; children?: unknown[] };
        if (typeof n.text === 'string' && n.text) out.push(n.text);
        for (const c of n.children ?? []) walk(c);
      };
      walk(engine.currentScene?.['mainContainer']);
      return out;
    });

    const fragment = seeded!.description.slice(0, 24);
    expect(
      texts.some((txt) => txt.includes(fragment)),
      `info feed shows the escalation warning (looking for "${fragment}")`,
    ).toBe(true);

    errorCollector.assertAndDetach();
  });
});
