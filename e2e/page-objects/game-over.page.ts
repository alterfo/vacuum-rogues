import { type Page } from '@playwright/test';
import { GamePageBase } from './base.page';

type GameOverSceneHandle = {
  e2eActions?: () => string[];
  e2eRunAction?: (label: string) => void;
};

export class GameOverPage extends GamePageBase {
  constructor(page: Page) {
    super(page);
  }

  async open(): Promise<void> {
    await this.page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        transitionTo: (s: string, ctx?: object) => Promise<void>;
      };
      await engine.transitionTo('GAME_OVER', { gameEngine: engine });
    });
    await this.waitForActive();
  }

  async waitForActive(): Promise<void> {
    await this.page.waitForFunction(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { constructor: { name: string } } | null;
      };
      return engine?.currentScene?.constructor.name === 'GameOverScene';
    });
  }

  async actions(): Promise<string[]> {
    return this.page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: GameOverSceneHandle | null;
      };
      return engine.currentScene?.e2eActions?.() ?? [];
    });
  }

  async runAction(label: string): Promise<void> {
    await this.page.evaluate((lbl) => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: GameOverSceneHandle | null;
      };
      engine.currentScene?.e2eRunAction?.(lbl as string);
    }, label);
  }
}
