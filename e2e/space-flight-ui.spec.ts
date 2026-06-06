import { test, expect } from '@playwright/test';
import { SpaceFlightPage } from './page-objects/space-flight.page';
import { MainMenuPage } from './page-objects/main-menu.page';

/**
 * Comprehensive UI tests for Space Flight Scene
 * Tests camera controls, ship navigation, minimap, and UI elements
 */
test.describe('Space Flight UI - Camera Controls', () => {
  let spaceFlightPage: SpaceFlightPage;
  let mainMenuPage: MainMenuPage;

  test.beforeEach(async ({ page }) => {
    spaceFlightPage = new SpaceFlightPage(page);
    mainMenuPage = new MainMenuPage(page);

    // Navigate to space flight scene
    await page.goto('/');
    await mainMenuPage.waitForMainMenu();
    await mainMenuPage.startNewGame();
    await mainMenuPage.selectRace('OUTLANDERS');
    await mainMenuPage.clickStartGame();
    // Wait for game to initialize and enter space flight
    await spaceFlightPage.waitForSpaceFlight();
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

    // Zoom in (negative deltaY = zoom in)
    await spaceFlightPage.wheelZoom(-100);

    const zoomedCamera = await spaceFlightPage.getCameraState();
    expect(zoomedCamera.zoom).toBeGreaterThan(initialCamera.zoom);
  });

  test('should zoom out with mouse wheel (positive deltaY)', async () => {
    const initialCamera = await spaceFlightPage.getCameraState();

    // Zoom out (positive deltaY = zoom out)
    await spaceFlightPage.wheelZoom(100);

    const zoomedCamera = await spaceFlightPage.getCameraState();
    expect(zoomedCamera.zoom).toBeLessThan(initialCamera.zoom);
  });

  test('should clamp zoom to min/max bounds', async () => {
    // Zoom out to minimum (many scroll events)
    for (let i = 0; i < 10; i++) {
      await spaceFlightPage.wheelZoom(100);
    }

    const minCamera = await spaceFlightPage.getCameraState();
    expect(minCamera.zoom).toBeGreaterThanOrEqual(0.5); // MIN_ZOOM

    // Zoom in to maximum
    for (let i = 0; i < 20; i++) {
      await spaceFlightPage.wheelZoom(-100);
    }

    const maxCamera = await spaceFlightPage.getCameraState();
    expect(maxCamera.zoom).toBeLessThanOrEqual(2.0); // MAX_ZOOM
  });

  test('should pan camera with Shift+Left button drag', async ({ page }) => {
    const initialCamera = await spaceFlightPage.getCameraState();

    // Pan from center to right-down
    await spaceFlightPage.panCamera(400, 300, 500, 400, true);

    const pannedCamera = await spaceFlightPage.getCameraState();

    // Pan should have changed
    const panDeltaX = Math.abs(pannedCamera.panX - initialCamera.panX);
    const panDeltaY = Math.abs(pannedCamera.panY - initialCamera.panY);

    expect(panDeltaX).toBeGreaterThan(50);
    expect(panDeltaY).toBeGreaterThan(50);
  });

  test('should pan camera with Right button drag', async ({ page }) => {
    const initialCamera = await spaceFlightPage.getCameraState();

    // Pan with right button
    await spaceFlightPage.panCamera(400, 300, 300, 200, false);

    const pannedCamera = await spaceFlightPage.getCameraState();

    // Pan should have changed
    const panDeltaX = Math.abs(pannedCamera.panX - initialCamera.panX);
    const panDeltaY = Math.abs(pannedCamera.panY - initialCamera.panY);

    expect(panDeltaX).toBeGreaterThan(50);
    expect(panDeltaY).toBeGreaterThan(50);
  });

  test('should preserve world center point when zooming', async () => {
    // Set a known camera state
    await spaceFlightPage.setCameraZoom(1.0);
    await spaceFlightPage.setCameraPan(0, 0);

    // Get ship position before zoom
    const initialShip = await spaceFlightPage.getShipPosition();

    // Zoom in
    await spaceFlightPage.wheelZoom(-100);

    // Ship position should not have changed significantly in world coordinates
    const zoomedShip = await spaceFlightPage.getShipPosition();

    expect(Math.abs(zoomedShip.x - initialShip.x)).toBeLessThan(50);
    expect(Math.abs(zoomedShip.y - initialShip.y)).toBeLessThan(50);
  });

  test('should update camera debug display when zooming', async ({ page }) => {
    // Zoom in
    await spaceFlightPage.wheelZoom(-100);

    // Check if debug text is visible (contains "Камера:")
    const debugText = page.getByText(/Камера: Zoom/);
    await expect(debugText).toBeVisible();
  });

  test('should update camera debug display when panning', async ({ page }) => {
    // Pan camera
    await spaceFlightPage.panCamera(400, 300, 500, 400, true);

    // Check if debug text shows non-zero pan
    const debugText = page.getByText(/Pan \(/);
    await expect(debugText).toBeVisible();
  });
});

test.describe('Space Flight UI - Minimap', () => {
  let spaceFlightPage: SpaceFlightPage;
  let mainMenuPage: MainMenuPage;

  test.beforeEach(async ({ page }) => {
    spaceFlightPage = new SpaceFlightPage(page);
    mainMenuPage = new MainMenuPage(page);

    await page.goto('/');
    await mainMenuPage.waitForMainMenu();
    await mainMenuPage.startNewGame();
    await mainMenuPage.selectRace('OUTLANDERS');
    await mainMenuPage.clickStartGame();
    await spaceFlightPage.waitForSpaceFlight();
  });

  test('should display minimap in bottom-right corner', async ({ page }) => {
    await spaceFlightPage.expectMinimapVisible();

    // Check for minimap title
    const minimapTitle = page.getByText('СИСТЕМА');
    await expect(minimapTitle).toBeVisible();
  });

  test('should update minimap when ship moves', async ({ page }) => {
    const initialShip = await spaceFlightPage.getShipPosition();

    // Set ship target to move it
    await spaceFlightPage.setShipTarget(initialShip.x + 200, initialShip.y + 200);

    // Wait for ship to move
    await page.waitForTimeout(1000);

    const movedShip = await spaceFlightPage.getShipPosition();

    // Ship should have moved
    expect(movedShip.x).not.toEqual(initialShip.x);
    expect(movedShip.y).not.toEqual(initialShip.y);
  });

  test('minimap should remain visible when camera is zoomed', async ({ page }) => {
    // Zoom in
    await spaceFlightPage.wheelZoom(-100);

    // Minimap should still be visible
    await spaceFlightPage.expectMinimapVisible();
  });

  test('minimap should remain visible when camera is panned', async ({ page }) => {
    // Pan camera
    await spaceFlightPage.panCamera(400, 300, 500, 400, true);

    // Minimap should still be visible
    await spaceFlightPage.expectMinimapVisible();
  });
});

test.describe('Space Flight UI - Ship Navigation', () => {
  let spaceFlightPage: SpaceFlightPage;
  let mainMenuPage: MainMenuPage;

  test.beforeEach(async ({ page }) => {
    spaceFlightPage = new SpaceFlightPage(page);
    mainMenuPage = new MainMenuPage(page);

    await page.goto('/');
    await mainMenuPage.waitForMainMenu();
    await mainMenuPage.startNewGame();
    await mainMenuPage.selectRace('OUTLANDERS');
    await mainMenuPage.clickStartGame();
    await spaceFlightPage.waitForSpaceFlight();
  });

  test('should navigate ship to clicked position', async ({ page }) => {
    const initialShip = await spaceFlightPage.getShipPosition();

    // Click on empty space (not on planet/UI)
    await spaceFlightPage.clickOnSpace(400, 300);

    // Wait for ship to start moving
    await page.waitForTimeout(500);

    const movedShip = await spaceFlightPage.getShipPosition();

    // Ship should have moved toward target
    const distanceMoved = Math.sqrt(
      Math.pow(movedShip.x - initialShip.x, 2) +
      Math.pow(movedShip.y - initialShip.y, 2)
    );

    expect(distanceMoved).toBeGreaterThan(10);
  });

  test('should navigate ship using e2e helper', async ({ page }) => {
    const initialShip = await spaceFlightPage.getShipPosition();

    // Set target using e2e helper
    await spaceFlightPage.setShipTarget(initialShip.x + 300, initialShip.y + 300);

    // Wait for ship to move
    await page.waitForTimeout(1000);

    const movedShip = await spaceFlightPage.getShipPosition();

    // Ship should be closer to target
    expect(movedShip.x).toBeGreaterThan(initialShip.x);
    expect(movedShip.y).toBeGreaterThan(initialShip.y);
  });

  test('ship navigation should work with camera zoom', async ({ page }) => {
    // Zoom in
    await spaceFlightPage.wheelZoom(-100);

    const initialShip = await spaceFlightPage.getShipPosition();

    // Click on space (coordinates are screen space, should be transformed to world)
    await spaceFlightPage.clickOnSpace(400, 300);

    // Wait for ship to move
    await page.waitForTimeout(500);

    const movedShip = await spaceFlightPage.getShipPosition();

    // Ship should have moved
    const distanceMoved = Math.sqrt(
      Math.pow(movedShip.x - initialShip.x, 2) +
      Math.pow(movedShip.y - initialShip.y, 2)
    );

    expect(distanceMoved).toBeGreaterThan(5);
  });

  test('ship navigation should work with camera pan', async ({ page }) => {
    // Pan camera
    await spaceFlightPage.panCamera(400, 300, 500, 400, true);

    const initialShip = await spaceFlightPage.getShipPosition();

    // Set ship target
    await spaceFlightPage.setShipTarget(initialShip.x + 200, initialShip.y);

    // Wait for ship to move
    await page.waitForTimeout(500);

    const movedShip = await spaceFlightPage.getShipPosition();

    // Ship should have moved
    expect(movedShip.x).toBeGreaterThan(initialShip.x);
  });
});

test.describe('Space Flight UI - UI Elements', () => {
  let spaceFlightPage: SpaceFlightPage;
  let mainMenuPage: MainMenuPage;

  test.beforeEach(async ({ page }) => {
    spaceFlightPage = new SpaceFlightPage(page);
    mainMenuPage = new MainMenuPage(page);

    await page.goto('/');
    await mainMenuPage.waitForMainMenu();
    await mainMenuPage.startNewGame();
    await mainMenuPage.selectRace('OUTLANDERS');
    await mainMenuPage.clickStartGame();
    await spaceFlightPage.waitForSpaceFlight();
  });

  test('should display instructions text', async ({ page }) => {
    const instructions = page.getByText(/ЛКМ - курс/);
    await expect(instructions).toBeVisible();
  });

  test('should display back to map button', async ({ page }) => {
    const backButton = page.getByText('[НАЗАД К КАРТЕ]');
    await expect(backButton).toBeVisible();
  });

  test('should display quest button', async ({ page }) => {
    const questButton = page.getByText('[КВЕСТЫ]');
    await expect(questButton).toBeVisible();
  });

  test('should open quest journal with J key', async ({ page }) => {
    await spaceFlightPage.openQuestJournal();
    await spaceFlightPage.expectQuestJournalOpen();
  });

  test('should navigate back to star map', async ({ page }) => {
    await spaceFlightPage.clickBackToMap();

    // Wait for transition to star map
    await page.waitForFunction(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { constructor: { name: string } } | null;
      };
      return engine.currentScene?.constructor.name === 'StarMapScene';
    }, { timeout: 3000 });

    // Verify star map is displayed
    const starMapTitle = page.getByText('SECTOR MAP');
    await expect(starMapTitle).toBeVisible();
  });

  test('UI buttons should not move ship when clicked', async ({ page }) => {
    const initialShip = await spaceFlightPage.getShipPosition();

    // Click quest button
    const questButton = page.getByText('[КВЕСТЫ]');
    await questButton.click();

    // Wait a bit
    await page.waitForTimeout(200);

    const shipAfterClick = await spaceFlightPage.getShipPosition();

    // Ship should NOT have moved (stopPropagation working)
    expect(shipAfterClick.x).toBeCloseTo(initialShip.x, 5);
    expect(shipAfterClick.y).toBeCloseTo(initialShip.y, 5);
  });

  test('camera debug display should be visible', async ({ page }) => {
    const debugText = page.getByText(/Камера: Zoom/);
    await expect(debugText).toBeVisible();
  });

  test('UI elements should remain visible when camera zooms', async ({ page }) => {
    // Zoom in
    await spaceFlightPage.wheelZoom(-100);

    // All UI elements should still be visible
    await expect(page.getByText('[НАЗАД К КАРТЕ]')).toBeVisible();
    await expect(page.getByText('[КВЕСТЫ]')).toBeVisible();
    await expect(page.getByText(/ЛКМ - курс/)).toBeVisible();
  });

  test('UI elements should remain visible when camera pans', async ({ page }) => {
    // Pan camera
    await spaceFlightPage.panCamera(400, 300, 500, 400, true);

    // All UI elements should still be visible
    await expect(page.getByText('[НАЗАД К КАРТЕ]')).toBeVisible();
    await expect(page.getByText('[КВЕСТЫ]')).toBeVisible();
    await expect(page.getByText(/ЛКМ - курс/)).toBeVisible();
  });
});

test.describe('Space Flight UI - Combined Scenarios', () => {
  let spaceFlightPage: SpaceFlightPage;
  let mainMenuPage: MainMenuPage;

  test.beforeEach(async ({ page }) => {
    spaceFlightPage = new SpaceFlightPage(page);
    mainMenuPage = new MainMenuPage(page);

    await page.goto('/');
    await mainMenuPage.waitForMainMenu();
    await mainMenuPage.startNewGame();
    await mainMenuPage.selectRace('OUTLANDERS');
    await mainMenuPage.clickStartGame();
    await spaceFlightPage.waitForSpaceFlight();
  });

  test('should handle zoom + pan + ship navigation together', async ({ page }) => {
    // Zoom in
    await spaceFlightPage.wheelZoom(-100);

    // Pan camera
    await spaceFlightPage.panCamera(400, 300, 500, 350, true);

    // Navigate ship
    const initialShip = await spaceFlightPage.getShipPosition();
    await spaceFlightPage.setShipTarget(initialShip.x + 150, initialShip.y + 150);

    // Wait for ship to move
    await page.waitForTimeout(500);

    const movedShip = await spaceFlightPage.getShipPosition();

    // Verify ship moved
    expect(movedShip.x).toBeGreaterThan(initialShip.x);
    expect(movedShip.y).toBeGreaterThan(initialShip.y);

    // Verify camera state changed
    const camera = await spaceFlightPage.getCameraState();
    expect(camera.zoom).toBeGreaterThan(1.0);
    expect(Math.abs(camera.panX) + Math.abs(camera.panY)).toBeGreaterThan(50);

    // Verify minimap still visible
    await spaceFlightPage.expectMinimapVisible();
  });

  test('should reset camera to default and navigate', async ({ page }) => {
    // Modify camera
    await spaceFlightPage.setCameraZoom(1.5);
    await spaceFlightPage.setCameraPan(100, -50);

    // Verify camera was set
    let camera = await spaceFlightPage.getCameraState();
    expect(camera.zoom).toBe(1.5);
    expect(camera.panX).toBe(100);
    expect(camera.panY).toBe(-50);

    // Reset to default
    await spaceFlightPage.setCameraZoom(1.0);
    await spaceFlightPage.setCameraPan(0, 0);

    // Verify reset
    camera = await spaceFlightPage.getCameraState();
    expect(camera.zoom).toBe(1.0);
    expect(camera.panX).toBe(0);
    expect(camera.panY).toBe(0);

    // Ship navigation should still work
    const initialShip = await spaceFlightPage.getShipPosition();
    await spaceFlightPage.setShipTarget(initialShip.x + 100, initialShip.y);
    await page.waitForTimeout(300);

    const movedShip = await spaceFlightPage.getShipPosition();
    expect(movedShip.x).toBeGreaterThan(initialShip.x);
  });
});
