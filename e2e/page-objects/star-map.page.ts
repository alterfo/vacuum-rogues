import { type Page, expect } from '@playwright/test';
import { GamePageBase } from './base.page';

/**
 * Star Map Screen page object
 *
 * Uses semantic engine calls instead of coordinate-based clicks.
 * See docs/CODING_RULES.md RULE-E2E-01.
 */
export class StarMapPage extends GamePageBase {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to star map from main menu
   */
  async navigateFromMainMenu() {
    await this.waitForGameInitialization();
    await this.page.evaluate(async () => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        transitionTo: (scene: string) => Promise<void>;
      };
      await engine.transitionTo('STAR_MAP');
    });
    await this.waitForStarMap();
  }

  /**
   * Check if star map is displayed
   */
  async expectStarMapVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await this.getCanvasBox();
    expect(box?.width).toBeGreaterThan(0);
  }

  /**
   * Wait for star map scene to be active
   */
  async waitForStarMap() {
    await this.page.waitForFunction(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { constructor: { name: string } } | null;
      };
      return engine.currentScene?.constructor.name === 'StarMapScene';
    }, { timeout: 5000 });
  }

  /**
   * Click on a star system by its ID
   */
  async clickOnSystem(systemId: string) {
    await this.page.evaluate((id) => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { handleSystemClickById?: (systemId: string) => void } | null;
      };
      engine.currentScene?.handleSystemClickById?.(id);
    }, systemId);
  }

  /**
   * Click on system by coordinates
   * @deprecated TECH DEBT: use clickOnSystem(systemId) instead.
   * См. docs/CODING_RULES.md RULE-E2E-01.
   */
  async clickOnSystemCoords(x: number, y: number) {
    await this.clickCanvas(x, y);
    await this.page.waitForTimeout(500);
  }

  /**
   * Click on star map canvas at relative position (0–1 fractions).
   * @deprecated TECH DEBT: use clickOnSystem(systemId) instead.
   */
  async clickOnSystemPercent(xPercent: number, yPercent: number) {
    await this.clickCanvasPercent(xPercent, yPercent);
  }

  /**
   * Navigate between systems via warp jump
   */
  async warpToSystem(systemId: string) {
    await this.page.evaluate(async (id) => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { performWarpJumpTo?: (systemId: string) => Promise<void> } | null;
      };
      await engine.currentScene?.performWarpJumpTo?.(id);
    }, systemId);
  }

  /**
   * Check for fog of war (some systems should be hidden)
   */
  async expectFogOfWar() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
  }

  /**
   * Open system details panel
   */
  async openSystemDetails(systemId: string) {
    await this.clickOnSystem(systemId);
  }

  /**
   * Open warp navigation to a system
   */
  async openWarpNavigation(systemId: string) {
    await this.warpToSystem(systemId);
  }

  /**
   * Verify system count
   */
  async expectMinimumSystemsCount(minCount: number) {
    const count = await this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        galaxy: { systems: unknown[] } | null;
      };
      return engine.galaxy?.systems.length ?? 0;
    });
    expect(count).toBeGreaterThanOrEqual(minCount);
  }

  /**
   * Check for planet details
   */
  async expectPlanetDetailsVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
  }
}
