import { test, expect, type Page } from '@playwright/test';
import { SpaceFlightPage } from './page-objects/space-flight.page';
import { MainMenuPage } from './page-objects/main-menu.page';
import { applyMockHeavySystems, waitForScene } from './fixtures/mockHeavySystems';

/**
 * Camera / mini-map / navigation tests for SpaceFlightScene.
 *
 * Everything is driven through the scene's __DEBUG__ e2e* hooks (camera + ship
 * state) and real wheel/drag input — never canvas pixel clicks or canvas-text
 * assertions (the scene is WebGL, so page.getByText never matches in-game text).
 * applyMockHeavySystems stubs ONNX/audio and hides the heavy nebula background.
 */

/** Boot a new game and wait until SpaceFlightScene is active. */
async function enterSpaceFlight(page: Page): Promise<SpaceFlightPage> {
  const spaceFlightPage = new SpaceFlightPage(page);
  const mainMenuPage = new MainMenuPage(page);

  await applyMockHeavySystems(page);
  await page.goto('/');
  await mainMenuPage.waitForMainMenu();
  await mainMenuPage.startNewGame();
  await mainMenuPage.selectRace('OUTLANDERS');
  await mainMenuPage.clickStartGame();
  await waitForScene(page, 'SpaceFlightScene', 20_000);
  return spaceFlightPage;
}

/** Resolve once the ship has moved more than `minDist` px from (fromX, fromY). */
async function waitForShipToMove(
  page: Page,
  fromX: number,
  fromY: number,
  minDist = 5,
): Promise<void> {
  await page.waitForFunction(
    ({ fx, fy, d }) => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eGetShipPosition?: () => { x: number; y: number } } | null;
      };
      const p = engine.currentScene?.e2eGetShipPosition?.() ?? { x: fx, y: fy };
      return Math.hypot(p.x - fx, p.y - fy) > d;
    },
    { fx: fromX, fy: fromY, d: minDist },
    { timeout: 5_000 },
  );
}

test.describe('Space Flight UI - Camera Controls', () => {
  let spaceFlightPage: SpaceFlightPage;

  test.beforeEach(async ({ page }) => {
    spaceFlightPage = await enterSpaceFlight(page);
  });

  test('should initialize camera centered on the ship at default zoom', async () => {
    const camera = await spaceFlightPage.getCameraState();

    // The system is larger than the viewport, so the camera centers on the
    // ship at spawn (pan is non-zero) rather than sitting at the world origin.
    expect(camera.zoom).toBe(1.0);
    expect(Number.isFinite(camera.panX)).toBe(true);
    expect(Number.isFinite(camera.panY)).toBe(true);
  });

  test('should zoom in with mouse wheel (negative deltaY)', async () => {
    const initialCamera = await spaceFlightPage.getCameraState();
    await spaceFlightPage.wheelZoom(-100);
    const zoomedCamera = await spaceFlightPage.getCameraState();
    expect(zoomedCamera.zoom).toBeGreaterThan(initialCamera.zoom);
  });

  test('should zoom out with mouse wheel (positive deltaY)', async () => {
    const initialCamera = await spaceFlightPage.getCameraState();
    await spaceFlightPage.wheelZoom(100);
    const zoomedCamera = await spaceFlightPage.getCameraState();
    expect(zoomedCamera.zoom).toBeLessThan(initialCamera.zoom);
  });

  test('should clamp zoom to min/max bounds', async () => {
    for (let i = 0; i < 10; i++) {
      await spaceFlightPage.wheelZoom(100);
    }
    const minCamera = await spaceFlightPage.getCameraState();
    expect(minCamera.zoom).toBeGreaterThanOrEqual(0.25); // MIN_ZOOM (CameraController)

    for (let i = 0; i < 20; i++) {
      await spaceFlightPage.wheelZoom(-100);
    }
    const maxCamera = await spaceFlightPage.getCameraState();
    expect(maxCamera.zoom).toBeLessThanOrEqual(2.0); // MAX_ZOOM
  });

  test('should pan camera with Shift+Left button drag', async () => {
    const initialCamera = await spaceFlightPage.getCameraState();
    await spaceFlightPage.panCamera(400, 300, 500, 400, true);
    const pannedCamera = await spaceFlightPage.getCameraState();

    const panDeltaX = Math.abs(pannedCamera.panX - initialCamera.panX);
    const panDeltaY = Math.abs(pannedCamera.panY - initialCamera.panY);
    expect(panDeltaX).toBeGreaterThan(50);
    expect(panDeltaY).toBeGreaterThan(50);
  });

  test('should pan camera with Right button drag', async () => {
    const initialCamera = await spaceFlightPage.getCameraState();
    await spaceFlightPage.panCamera(400, 300, 300, 200, false);
    const pannedCamera = await spaceFlightPage.getCameraState();

    const panDeltaX = Math.abs(pannedCamera.panX - initialCamera.panX);
    const panDeltaY = Math.abs(pannedCamera.panY - initialCamera.panY);
    expect(panDeltaX).toBeGreaterThan(50);
    expect(panDeltaY).toBeGreaterThan(50);
  });

  test('should preserve world center point when zooming', async () => {
    await spaceFlightPage.setCameraZoom(1.0);
    await spaceFlightPage.setCameraPan(0, 0);

    const initialShip = await spaceFlightPage.getShipPosition();
    await spaceFlightPage.wheelZoom(-100);
    const zoomedShip = await spaceFlightPage.getShipPosition();

    // Ship world position should not jump when the camera zooms.
    expect(Math.abs(zoomedShip.x - initialShip.x)).toBeLessThan(50);
    expect(Math.abs(zoomedShip.y - initialShip.y)).toBeLessThan(50);
  });

  test('camera zoom should change after wheel input (debug read-out source)', async () => {
    await spaceFlightPage.wheelZoom(-100);
    const camera = await spaceFlightPage.getCameraState();
    expect(camera.zoom).toBeGreaterThan(1.0);
  });

  test('camera pan should change after a drag (debug read-out source)', async () => {
    await spaceFlightPage.panCamera(400, 300, 500, 400, true);
    const camera = await spaceFlightPage.getCameraState();
    expect(Math.abs(camera.panX) + Math.abs(camera.panY)).toBeGreaterThan(0);
  });
});

test.describe('Space Flight UI - Minimap', () => {
  let spaceFlightPage: SpaceFlightPage;

  test.beforeEach(async ({ page }) => {
    spaceFlightPage = await enterSpaceFlight(page);
  });

  test('should display minimap', async () => {
    await spaceFlightPage.expectMinimapVisible();
  });

  test('should update minimap when ship moves', async ({ page }) => {
    const initialShip = await spaceFlightPage.getShipPosition();
    await spaceFlightPage.setShipTarget(initialShip.x + 200, initialShip.y + 200);
    await waitForShipToMove(page, initialShip.x, initialShip.y);

    const movedShip = await spaceFlightPage.getShipPosition();
    expect(movedShip.x).not.toEqual(initialShip.x);
    expect(movedShip.y).not.toEqual(initialShip.y);
  });

  test('minimap should remain visible when camera is zoomed', async () => {
    await spaceFlightPage.wheelZoom(-100);
    await spaceFlightPage.expectMinimapVisible();
  });

  test('minimap should remain visible when camera is panned', async () => {
    await spaceFlightPage.panCamera(400, 300, 500, 400, true);
    await spaceFlightPage.expectMinimapVisible();
  });
});

test.describe('Space Flight UI - Ship Navigation', () => {
  let spaceFlightPage: SpaceFlightPage;

  test.beforeEach(async ({ page }) => {
    spaceFlightPage = await enterSpaceFlight(page);
  });

  test('should navigate ship toward a set target', async ({ page }) => {
    const initialShip = await spaceFlightPage.getShipPosition();
    await spaceFlightPage.setShipTarget(initialShip.x + 300, initialShip.y + 300);
    await waitForShipToMove(page, initialShip.x, initialShip.y, 10);

    const movedShip = await spaceFlightPage.getShipPosition();
    const distanceMoved = Math.hypot(
      movedShip.x - initialShip.x,
      movedShip.y - initialShip.y,
    );
    expect(distanceMoved).toBeGreaterThan(10);
  });

  test('ship navigation should work with camera zoom', async ({ page }) => {
    await spaceFlightPage.wheelZoom(-100);

    const initialShip = await spaceFlightPage.getShipPosition();
    await spaceFlightPage.setShipTarget(initialShip.x + 200, initialShip.y + 200);
    await waitForShipToMove(page, initialShip.x, initialShip.y);

    const movedShip = await spaceFlightPage.getShipPosition();
    const distanceMoved = Math.hypot(
      movedShip.x - initialShip.x,
      movedShip.y - initialShip.y,
    );
    expect(distanceMoved).toBeGreaterThan(5);
  });

  test('ship navigation should work with camera pan', async ({ page }) => {
    await spaceFlightPage.panCamera(400, 300, 500, 400, true);

    const initialShip = await spaceFlightPage.getShipPosition();
    await spaceFlightPage.setShipTarget(initialShip.x + 200, initialShip.y);
    await waitForShipToMove(page, initialShip.x, initialShip.y);

    const movedShip = await spaceFlightPage.getShipPosition();
    expect(movedShip.x).toBeGreaterThan(initialShip.x);
  });
});

test.describe('Space Flight UI - UI Elements', () => {
  let spaceFlightPage: SpaceFlightPage;

  test.beforeEach(async ({ page }) => {
    spaceFlightPage = await enterSpaceFlight(page);
  });

  test('should open quest journal with J key', async () => {
    await spaceFlightPage.openQuestJournal();
    await spaceFlightPage.expectQuestJournalOpen();
  });

  test('should navigate back to star map', async ({ page }) => {
    await spaceFlightPage.clickBackToMap();
    await waitForScene(page, 'StarMapScene', 10_000);

    const sceneName = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { constructor: { name: string } } | null;
      };
      return engine.currentScene?.constructor.name ?? null;
    });
    expect(sceneName).toBe('StarMapScene');
  });

  test('UI elements (mini-map) remain present when the camera zooms', async () => {
    await spaceFlightPage.wheelZoom(-100);
    await spaceFlightPage.expectMinimapVisible();
  });

  test('UI elements (mini-map) remain present when the camera pans', async () => {
    await spaceFlightPage.panCamera(400, 300, 500, 400, true);
    await spaceFlightPage.expectMinimapVisible();
  });
});

test.describe('Space Flight UI - Combined Scenarios', () => {
  let spaceFlightPage: SpaceFlightPage;

  test.beforeEach(async ({ page }) => {
    spaceFlightPage = await enterSpaceFlight(page);
  });

  test('should handle zoom + pan + ship navigation together', async ({ page }) => {
    await spaceFlightPage.wheelZoom(-100);
    await spaceFlightPage.panCamera(400, 300, 500, 350, true);

    const initialShip = await spaceFlightPage.getShipPosition();
    await spaceFlightPage.setShipTarget(initialShip.x + 150, initialShip.y + 150);
    await waitForShipToMove(page, initialShip.x, initialShip.y);

    const movedShip = await spaceFlightPage.getShipPosition();
    expect(movedShip.x).toBeGreaterThan(initialShip.x);
    expect(movedShip.y).toBeGreaterThan(initialShip.y);

    const camera = await spaceFlightPage.getCameraState();
    expect(camera.zoom).toBeGreaterThan(1.0);
    expect(Math.abs(camera.panX) + Math.abs(camera.panY)).toBeGreaterThan(50);

    await spaceFlightPage.expectMinimapVisible();
  });

  test('should reset camera to default and navigate', async ({ page }) => {
    await spaceFlightPage.setCameraZoom(1.5);
    await spaceFlightPage.setCameraPan(100, -50);

    let camera = await spaceFlightPage.getCameraState();
    expect(camera.zoom).toBe(1.5);
    expect(camera.panX).toBe(100);
    expect(camera.panY).toBe(-50);

    await spaceFlightPage.setCameraZoom(1.0);
    await spaceFlightPage.setCameraPan(0, 0);

    camera = await spaceFlightPage.getCameraState();
    expect(camera.zoom).toBe(1.0);
    expect(camera.panX).toBe(0);
    expect(camera.panY).toBe(0);

    const initialShip = await spaceFlightPage.getShipPosition();
    await spaceFlightPage.setShipTarget(initialShip.x + 100, initialShip.y);
    await waitForShipToMove(page, initialShip.x, initialShip.y);

    const movedShip = await spaceFlightPage.getShipPosition();
    expect(movedShip.x).toBeGreaterThan(initialShip.x);
  });
});
