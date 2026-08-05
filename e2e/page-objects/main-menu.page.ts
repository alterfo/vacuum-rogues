import { type Page, expect } from '@playwright/test';
import { GamePageBase } from './base.page';

export class MainMenuPage extends GamePageBase {
  constructor(page: Page) {
    super(page);
  }

  async navigateTo() {
    await this.page.goto('/');
    await this.waitForGameInitialization();
  }

  async expectMainMenuVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await this.getCanvasBox();
    expect(box?.width).toBeGreaterThan(0);
  }

  async clickNewGame() {
    await this.page.evaluate(async () => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        transitionTo: (scene: string) => Promise<void>;
      };
      await engine.transitionTo('STAR_MAP');
    });
  }

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

  async clickSettings() {
  }

  async waitForTransitionToStarMap() {
    await this.page.waitForFunction(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { constructor: { name: string } } | null;
      };
      return engine.currentScene?.constructor.name === 'StarMapScene';
    }, { timeout: 5000 });
  }

  async expectGameTitleVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
  }

  async expectNoWorkerErrors(): Promise<void> {
    const errors: string[] = [];
    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await this.page.waitForFunction(() => {
      const w = window as unknown as Record<string, unknown>;
      return w.__gameEngine != null;
    }, { timeout: 10000 });

    const workerErrors = errors.filter(
      (e) =>
        e.includes('MIME type') ||
        e.includes('inference.worker') ||
        e.includes('Worker')
    );

    expect(workerErrors.length).toBe(0);
  }

  async clickFlight() {
    await this.page.evaluate(async () => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        transitionTo: (scene: string) => Promise<void>;
      };
      await engine.transitionTo('SPACE_FLIGHT');
    });
  }

  async waitForMainMenu() {
    await this.page.waitForFunction(
      () => {
        const engine = (window as unknown as Record<string, unknown>)
          .__gameEngine as {
          currentScene: { constructor: { name: string } } | null;
        };
        return engine?.currentScene?.constructor.name === 'MainMenuScene';
      },
      { timeout: 10000 },
    );
  }

  async startNewGame() {
    await this.page.evaluate(async () => {
      const engine = (window as unknown as Record<string, unknown>)
        .__gameEngine as {
        transitionTo: (scene: string, context?: object) => Promise<void>;
      };
      await engine.transitionTo('RACE_SELECTION', { gameEngine: engine });
    });
    await this.page.waitForFunction(
      () => {
        const engine = (window as unknown as Record<string, unknown>)
          .__gameEngine as {
          currentScene: { constructor: { name: string } } | null;
        };
        return engine?.currentScene?.constructor.name === 'RaceSelectionScene';
      },
      { timeout: 10000 },
    );
  }

  async selectRace(faction: string) {
    await this.page.evaluate((f) => {
      const engine = (window as unknown as Record<string, unknown>)
        .__gameEngine as {
        currentScene: { e2eSelectFaction?: (faction: string) => void } | null;
      };
      engine?.currentScene?.e2eSelectFaction?.(f);
    }, faction);
  }

  async clickStartGame() {
    await this.page.evaluate(async () => {
      const engine = (window as unknown as Record<string, unknown>)
        .__gameEngine as {
        currentScene: {
          e2eConfirmSelection?: () => void | Promise<void>;
        } | null;
      };
      await engine?.currentScene?.e2eConfirmSelection?.();
    });
  }

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
