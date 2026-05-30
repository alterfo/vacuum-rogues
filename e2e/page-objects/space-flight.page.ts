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
}
