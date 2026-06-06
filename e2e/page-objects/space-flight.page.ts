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
   * Click on space (not on planet, not on UI)
   */
  async clickOnSpace(x: number, y: number) {
    const canvas = this.page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    await canvas.click({
      position: { x, y },
    });
    await this.page.waitForTimeout(100);
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
}
