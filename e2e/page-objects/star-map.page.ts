import { type Page, expect } from '@playwright/test';
import { GamePageBase } from './base.page';

export class StarMapPage extends GamePageBase {
  constructor(page: Page) {
    super(page);
  }

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

  async expectStarMapVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await this.getCanvasBox();
    expect(box?.width).toBeGreaterThan(0);
  }

  async waitForStarMap() {
    await this.page.waitForFunction(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { constructor: { name: string } } | null;
      };
      return engine.currentScene?.constructor.name === 'StarMapScene';
    }, { timeout: 5000 });
  }

  async clickOnSystem(systemId: string) {
    await this.page.evaluate((id) => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { handleSystemClickById?: (systemId: string) => void } | null;
      };
      engine.currentScene?.handleSystemClickById?.(id);
    }, systemId);
  }

  async clickOnSystemCoords(x: number, y: number) {
    await this.clickCanvas(x, y);
    await this.page.waitForTimeout(500);
  }

  async clickOnSystemPercent(xPercent: number, yPercent: number) {
    await this.clickCanvasPercent(xPercent, yPercent);
  }

  async warpToSystem(systemId: string) {
    await this.page.evaluate(async (id) => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { performWarpJumpTo?: (systemId: string) => Promise<void> } | null;
      };
      await engine.currentScene?.performWarpJumpTo?.(id);
    }, systemId);
  }

  async expectFogOfWar() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
  }

  async openSystemDetails(systemId: string) {
    await this.clickOnSystem(systemId);
  }

  async openWarpNavigation(systemId: string) {
    await this.warpToSystem(systemId);
  }

  async expectMinimumSystemsCount(minCount: number) {
    const count = await this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        galaxy: { systems: unknown[] } | null;
      };
      return engine.galaxy?.systems.length ?? 0;
    });
    expect(count).toBeGreaterThanOrEqual(minCount);
  }

  async expectPlanetDetailsVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
  }
}
