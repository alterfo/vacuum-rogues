import { type Page } from '@playwright/test';
import { GamePageBase } from './base.page';

type GameOverSceneHandle = {
  e2eActions?: () => string[];
  e2eRunAction?: (label: string) => void;
};

/**
 * Page Object for the GAME_OVER screen (GameOverScene, plan 20260619 player
 * death). Drives the scene through its e2e seams rather than pixel clicks
 * (CLAUDE.md / e2e rules) so tests can assert the two recovery actions are
 * present and trigger them without coordinate math.
 */
export class GameOverPage extends GamePageBase {
  constructor(page: Page) {
    super(page);
  }

  /** Navigate to the game-over screen via engine routing. */
  async open(): Promise<void> {
    await this.page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        transitionTo: (s: string, ctx?: object) => Promise<void>;
      };
      await engine.transitionTo('GAME_OVER', { gameEngine: engine });
    });
    await this.waitForActive();
  }

  /** Wait until GameOverScene is the active scene. */
  async waitForActive(): Promise<void> {
    await this.page.waitForFunction(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { constructor: { name: string } } | null;
      };
      return engine?.currentScene?.constructor.name === 'GameOverScene';
    });
  }

  /** The recovery action labels shown on the screen, in display order. */
  async actions(): Promise<string[]> {
    return this.page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: GameOverSceneHandle | null;
      };
      return engine.currentScene?.e2eActions?.() ?? [];
    });
  }

  /** Trigger a recovery action by its label. */
  async runAction(label: string): Promise<void> {
    await this.page.evaluate((lbl) => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: GameOverSceneHandle | null;
      };
      engine.currentScene?.e2eRunAction?.(lbl as string);
    }, label);
  }
}
