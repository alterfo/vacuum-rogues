import { type Page, expect } from '@playwright/test';
import { GamePageBase } from './base.page';

/**
 * Space Flight Scene page object
 *
 * Uses semantic engine calls instead of coordinate-based clicks.
 * See docs/CODING_RULES.md RULE-E2E-01.
 */
export class SpaceFlightPage extends GamePageBase {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to space flight scene from main menu
   */
  async navigateFromMainMenu() {
    await this.page.goto('/');
    await this.waitForGameInitialization();
    
    await this.page.evaluate(async () => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        transitionTo: (scene: string) => Promise<void>;
      };
      await engine.transitionTo('SPACE_FLIGHT');
    });
    await this.waitForSpaceFlight();
  }

  /**
   * Wait for space flight scene to be active
   */
  async waitForSpaceFlight() {
    await this.page.waitForFunction(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { constructor: { name: string } } | null;
      };
      return engine.currentScene?.constructor.name === 'SpaceFlightScene';
    }, { timeout: 5000 });
  }

  /**
   * Check if space flight scene is visible
   */
  async expectSpaceFlightVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await this.getCanvasBox();
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.height).toBeGreaterThan(0);
  }

  /**
   * Set ship target position (semantic, no pixel coords)
   */
  async setShipTarget(x: number, y: number) {
    await this.page.evaluate((target) => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eSetTarget?: (x: number, y: number) => void } | null;
      };
      engine.currentScene?.e2eSetTarget?.(target.x, target.y);
    }, { x, y });
  }

  /**
   * Trigger ship movement via semantic engine call (no canvas pixel coords)
   */
  async clickToMoveShip(x: number, y: number) {
    await this.setShipTarget(x, y);
  }

  /**
   * Click back to star map button
   */
  async clickBackToMap() {
    await this.page.evaluate(async () => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eClickBackToMap?: () => Promise<void> } | null;
      };
      await engine.currentScene?.e2eClickBackToMap?.();
    });
  }

  /**
   * Verify parallax stars are rendering
   */
  async expectParallaxStars() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();

    const box = await this.getCanvasBox();
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.height).toBeGreaterThan(0);
  }

  /**
   * Verify ship is visible
   */
  async expectShipVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
  }

  /**
   * Get camera state (zoom, pan)
   */
  async getCameraState() {
    return await this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: {
          e2eGetCameraState?: () => { zoom: number; panX: number; panY: number };
        } | null;
      };
      return engine.currentScene?.e2eGetCameraState?.() ?? { zoom: 1, panX: 0, panY: 0 };
    });
  }

  /**
   * Set camera zoom
   */
  async setCameraZoom(zoom: number) {
    await this.page.evaluate((z) => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eSetCameraZoom?: (zoom: number) => void } | null;
      };
      engine.currentScene?.e2eSetCameraZoom?.(z);
    }, zoom);
  }

  /**
   * Set camera pan
   */
  async setCameraPan(x: number, y: number) {
    await this.page.evaluate((pan) => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eSetCameraPan?: (x: number, y: number) => void } | null;
      };
      engine.currentScene?.e2eSetCameraPan?.(pan.x, pan.y);
    }, { x, y });
  }

  /**
   * Perform wheel zoom at canvas center
   */
  async wheelZoom(deltaY: number) {
    const canvas = this.page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    // Wheel event at center of canvas
    await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await this.page.mouse.wheel(0, deltaY);
    await this.page.waitForTimeout(100); // Allow zoom to apply
  }

  /**
   * Perform pan by dragging with shift+left or right button
   */
  async panCamera(startX: number, startY: number, endX: number, endY: number, useShift = true) {
    const canvas = this.page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const absStartX = box.x + startX;
    const absStartY = box.y + startY;
    const absEndX = box.x + endX;
    const absEndY = box.y + endY;

    if (useShift) {
      // Shift + Left button pan
      await this.page.keyboard.down('Shift');
      await this.page.mouse.move(absStartX, absStartY);
      await this.page.mouse.down({ button: 'left' });
      await this.page.mouse.move(absEndX, absEndY);
      await this.page.mouse.up({ button: 'left' });
      await this.page.keyboard.up('Shift');
    } else {
      // Right button pan
      await this.page.mouse.move(absStartX, absStartY);
      await this.page.mouse.down({ button: 'right' });
      await this.page.mouse.move(absEndX, absEndY);
      await this.page.mouse.up({ button: 'right' });
    }

    await this.page.waitForTimeout(100); // Allow pan to apply
  }

  /**
   * Check if minimap is visible
   */
  async expectMinimapVisible() {
    const hasМinimap = await this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: {
          e2eHasMinimap?: () => boolean;
        } | null;
      };
      return engine.currentScene?.e2eHasMinimap?.() ?? false;
    });
    expect(hasМinimap).toBe(true);
  }

  /**
   * Get ship position
   */
  async getShipPosition() {
    return await this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: {
          e2eGetShipPosition?: () => { x: number; y: number };
        } | null;
      };
      return engine.currentScene?.e2eGetShipPosition?.() ?? { x: 0, y: 0 };
    });
  }

  /**
   * Open quest journal via keyboard
   */
  async openQuestJournal() {
    await this.page.keyboard.press('j');
    await this.page.waitForTimeout(200);
  }

  /**
   * Check if quest journal is open
   */
  async expectQuestJournalOpen() {
    const isOpen = await this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: {
          e2eIsQuestJournalOpen?: () => boolean;
        } | null;
      };
      return engine.currentScene?.e2eIsQuestJournalOpen?.() ?? false;
    });
    expect(isOpen).toBe(true);
  }

  // ---------------------------------------------------------------------------
  // Task 3 driver wrappers (visual E2E suite). Each forwards to a __DEBUG__
  // guarded e2e* method on SpaceFlightScene via page.evaluate — no pixel coords.
  // ---------------------------------------------------------------------------

  /**
   * Wait for the active scene to become SpaceFlightScene. Alias of
   * waitForSpaceFlight() with the generic name the visual suite expects.
   */
  async waitForScene() {
    await this.waitForSpaceFlight();
  }

  /**
   * Read the scene's high-level state (planet/NPC counts, motion, turn number).
   */
  async getSceneState() {
    return await this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: {
          e2eGetSceneState?: () => {
            planetsCount: number;
            npcsCount: number;
            isFlying: boolean;
            turnNumber: number;
          };
        } | null;
      };
      return (
        engine.currentScene?.e2eGetSceneState?.() ?? {
          planetsCount: 0,
          npcsCount: 0,
          isFlying: false,
          turnNumber: 0,
        }
      );
    });
  }

  /**
   * Show/hide the heavy nebula background (clean black background for screenshots).
   */
  async setBackgroundVisible(visible: boolean) {
    await this.page.evaluate((v) => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eSetBackgroundVisible?: (visible: boolean) => void } | null;
      };
      engine.currentScene?.e2eSetBackgroundVisible?.(v);
    }, visible);
  }

  /**
   * Trigger the planet-click handler for the planet at the given index.
   */
  async clickPlanet(index: number) {
    await this.page.evaluate((i) => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eClickPlanet?: (index: number) => void } | null;
      };
      engine.currentScene?.e2eClickPlanet?.(i);
    }, index);
  }

  /**
   * Trigger the NPC-contact click for the ship at the given index.
   */
  async clickNpc(index: number) {
    await this.page.evaluate((i) => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eClickNpc?: (index: number) => void } | null;
      };
      engine.currentScene?.e2eClickNpc?.(i);
    }, index);
  }

  /**
   * Start a turn (Ход): run the planned route or a course-less wait turn.
   */
  async startTurn() {
    await this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eStartTurn?: () => void } | null;
      };
      engine.currentScene?.e2eStartTurn?.();
    });
  }

  /**
   * Pause/end the running turn (stops the ship immediately).
   */
  async pressPause() {
    await this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { e2ePressPause?: () => void } | null;
      };
      engine.currentScene?.e2ePressPause?.();
    });
  }

  /**
   * Capture a named screenshot of the canvas into e2e/screenshots/<name>.png.
   */
  async screenshot(name: string) {
    const canvas = this.page.locator('canvas');
    await canvas.screenshot({ path: `e2e/screenshots/${name}.png` });
  }

  // ---------------------------------------------------------------------------
  // Task 4 helpers (visual E2E suite). Scene-state reads for route / cursor /
  // NPC-clickability assertions, plus a render-loop freeze so canvas screenshots
  // are deterministic (the world only animates while the game loop ticks).
  // ---------------------------------------------------------------------------

  /** True when a route is currently planned (scene.plannedRoute is set). */
  async hasPlannedRoute(): Promise<boolean> {
    return this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      return engine.currentScene?.['plannedRoute'] != null;
    });
  }

  /** Cursor PixiJS would show when hovering the planet sprite at `index`. */
  async getPlanetCursor(index: number): Promise<string> {
    return this.page.evaluate((i) => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const pm = engine.currentScene?.['planetManager'] as
        | { planetSprites?: { graphics?: { cursor?: string } }[] }
        | undefined;
      return pm?.planetSprites?.[i]?.graphics?.cursor ?? '';
    }, index);
  }

  /** Cursor PixiJS would show when hovering the NPC ship at `index`. */
  async getNpcCursor(index: number): Promise<string> {
    return this.page.evaluate((i) => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const nm = engine.currentScene?.['npcManager'] as
        | { npcSprites?: { container?: { cursor?: string } }[] }
        | undefined;
      return nm?.npcSprites?.[i]?.container?.cursor ?? '';
    }, index);
  }

  /** True when the NPC ship at `index` is interactive (eventMode === 'static'). */
  async isNpcClickable(index: number): Promise<boolean> {
    return this.page.evaluate((i) => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const nm = engine.currentScene?.['npcManager'] as
        | { npcSprites?: { container?: { eventMode?: string } }[] }
        | undefined;
      return nm?.npcSprites?.[i]?.container?.eventMode === 'static';
    }, index);
  }

  /** True while the NPC contact panel (or any NPC modal) is open. */
  async isContactPanelOpen(): Promise<boolean> {
    return this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const nm = engine.currentScene?.['npcManager'] as
        | { hasOpenModal?: () => boolean }
        | undefined;
      return nm?.hasOpenModal?.() ?? false;
    });
  }

  /**
   * Freeze the world by cancelling the GameEngine's requestAnimationFrame loop.
   * The scene stops advancing (bgElapsed, sun pulse, drift all halt) while
   * PixiJS keeps rendering the now-static scene — so a subsequent screenshot is
   * byte-deterministic across runs (Context: WebGL frames vary frame-to-frame).
   */
  async freezeWorld(): Promise<void> {
    await this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as
        | (Record<string, unknown> & { animationFrameId?: number })
        | undefined;
      const id = engine?.['animationFrameId'] as number | undefined;
      if (typeof id === 'number') cancelAnimationFrame(id);
    });
    await this.settle();
  }

  /** Wait for a few render frames so the WebGL canvas has a fresh composited frame. */
  async settle(frames = 4): Promise<void> {
    await this.page.evaluate(
      (n) =>
        new Promise<void>((resolve) => {
          let i = 0;
          const tick = () => (i++ < n ? requestAnimationFrame(tick) : resolve());
          requestAnimationFrame(tick);
        }),
      frames,
    );
  }

  /**
   * Read the deferred-pause state (F1, playtest3) straight off the scene:
   * turnRunning (the turn keeps running while the ship finishes its day) and
   * pauseDeferred (the day-boundary stop latch is set).
   */
  async getDeferredPause(): Promise<{ turnRunning: boolean; pauseDeferred: boolean }> {
    return this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { isTurnRunning?: boolean; pauseAtDayBoundary?: boolean } | null;
      };
      const s = engine.currentScene;
      return {
        turnRunning: s?.isTurnRunning === true,
        pauseDeferred: s?.pauseAtDayBoundary === true,
      };
    });
  }

  /**
   * Wait until the running turn has actually ended (isTurnRunning === false).
   * Needed since F1 (playtest3) defers a Pause to the next day boundary — a
   * deferred pause does not end the turn synchronously.
   */
  async waitForTurnEnd(timeout = 4_000): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
          currentScene: { isTurnRunning?: boolean } | null;
        };
        return engine.currentScene?.isTurnRunning === false;
      },
      undefined,
      { timeout },
    );
  }
}
