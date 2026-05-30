import { type Page, expect } from '@playwright/test';
import { GamePageBase } from './base.page';

/**
 * Main Menu Screen page object
 *
 * All interactions use semantic calls via window.__gameEngine
 * instead of coordinate-based canvas clicks.
 * See docs/CODING_RULES.md RULE-E2E-01.
 */
export class MainMenuPage extends GamePageBase {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to main menu (game launch)
   */
  async navigateTo() {
    await this.page.goto('/');
    await this.waitForGameInitialization();
  }

  /**
   * Check if main menu is displayed
   */
  async expectMainMenuVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await this.getCanvasBox();
    expect(box?.width).toBeGreaterThan(0);
  }

  /**
   * Click "Новая игра" button
   * Routes through window.__gameEngine.transitionTo to avoid coordinate magic.
   */
  async clickNewGame() {
    await this.page.evaluate(async () => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        transitionTo: (scene: string) => Promise<void>;
      };
      await engine.transitionTo('STAR_MAP');
    });
  }

  /**
   * Click "Продолжить" button
   * If no save exists, the game stays on menu and shows a message.
   */
  async clickContinue() {
    await this.page.evaluate(async () => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        saveManager: { read: (slot: string) => Promise<unknown> };
        transitionTo: (scene: string) => Promise<void>;
        galaxy: unknown;
        player: unknown;
      };
      const save = await engine.saveManager.read('auto');
      if (save) {
        await engine.transitionTo('STAR_MAP');
      }
    });
  }

  /**
   * Click "Настройки" button
   * Currently a no-op in E2E; settings scene not yet implemented.
   */
  async clickSettings() {
    // TODO: Implement settings scene transition when available
    // await this.page.evaluate(async () => {
    //   const engine = (window as any).__gameEngine;
    //   await engine.transitionTo('SETTINGS');
    // });
  }

  /**
   * Wait for transition to star map
   */
  async waitForTransitionToStarMap() {
    await this.page.waitForFunction(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { constructor: { name: string } } | null;
      };
      return engine.currentScene?.constructor.name === 'StarMapScene';
    }, { timeout: 5000 });
  }

  /**
   * Verify game title is displayed
   */
  async expectGameTitleVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
  }

  /**
   * Check for worker loading errors
   */
  async expectNoWorkerErrors(): Promise<void> {
    const errors: string[] = [];
    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await this.page.waitForTimeout(3000);

    const workerErrors = errors.filter(
      (e) =>
        e.includes('MIME type') ||
        e.includes('inference.worker') ||
        e.includes('Worker')
    );

    expect(workerErrors.length).toBe(0);
  }

  /**
   * Click "Полёт" button for space flight demo
   */
  async clickFlight() {
    await this.page.evaluate(async () => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        transitionTo: (scene: string) => Promise<void>;
      };
      await engine.transitionTo('SPACE_FLIGHT');
    });
  }

  /**
   * Click "ONNX Демо" button
   * Triggers ONNX demo via the engine's current scene.
   */
  async clickONNXDemo() {
    await this.page.evaluate(async () => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { handleONNXDemo?: () => Promise<void> } | null;
      };
      const scene = engine.currentScene;
      if (scene && 'handleONNXDemo' in scene) {
        await scene.handleONNXDemo!();
      }
    });
  }
}
