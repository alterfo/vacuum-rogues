import type { Page } from '@playwright/test';

type EngineHandle = {
  currentScene: { constructor: { name: string } } | null;
  currentSceneType: string;
  player: {
    credits: number;
    ship: { hullHP: number; cargoCapacity: number };
  } | null;
  transitionTo: (scene: string, ctx?: object) => Promise<void>;
  acceptBoardQuest: (questId: string) => unknown;
  startTextQuest: (scriptId: string, seed?: number) => Promise<void>;
};

export class GameDriver {
  constructor(private page: Page) {}

  private engine() {
    return (window as unknown as Record<string, EngineHandle>).__gameEngine;
  }

  async waitForScene(sceneName: string, timeout = 30_000): Promise<void> {
    await this.page.waitForFunction(
      (name) => {
        const engine = (window as unknown as Record<string, EngineHandle>).__gameEngine;
        return engine?.currentScene?.constructor.name === name;
      },
      sceneName,
      { timeout }
    );
  }

  async getSceneName(): Promise<string> {
    return this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, EngineHandle>).__gameEngine;
      return engine?.currentScene?.constructor.name ?? '';
    });
  }

  async getPlayer() {
    return this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, EngineHandle>).__gameEngine;
      if (!engine?.player) return null;
      const p = engine.player;
      return {
        credits: p.credits,
        hp: p.ship?.hullHP ?? 0,
        cargoCapacity: p.ship?.cargoCapacity ?? 0,
      };
    });
  }

  async getCredits(): Promise<number> {
    return this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, EngineHandle>).__gameEngine;
      return engine?.player?.credits ?? 0;
    });
  }

  async getHP(): Promise<number> {
    return this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, EngineHandle>).__gameEngine;
      return engine?.player?.ship?.hullHP ?? 0;
    });
  }

  async isAlive(): Promise<boolean> {
    return this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, EngineHandle>).__gameEngine;
      if (!engine?.currentScene) return false;
      const hp = engine.player?.ship?.hullHP ?? 0;
      return hp > 0;
    });
  }

  async startNewGame(): Promise<void> {
    await this.page.evaluate(async () => {
      const engine = (window as unknown as Record<string, EngineHandle>).__gameEngine;
      await engine.transitionTo('STAR_MAP', { gameEngine: engine });
    });
    await this.waitForScene('StarMapScene', 15_000);
  }

  async goToSpaceFlight(): Promise<void> {
    await this.page.evaluate(async () => {
      const engine = (window as unknown as Record<string, EngineHandle>).__gameEngine;
      await engine.transitionTo('SPACE_FLIGHT', { gameEngine: engine });
    });
    await this.waitForScene('SpaceFlightScene', 15_000);
  }

  async playTurn(): Promise<void> {
    await this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, EngineHandle>).__gameEngine;
      const scene = engine?.currentScene as
        | { e2ePlayPause?: () => void }
        | null;
      scene?.e2ePlayPause?.();
    });
    await this.page.waitForFunction(
      () => {
        const engine = (window as unknown as Record<string, EngineHandle>).__gameEngine;
        const scene = engine?.currentScene as
          | { isTurnRunning?: boolean }
          | null;
        return scene && !scene.isTurnRunning;
      },
      { timeout: 60_000 }
    );
  }

  async landOnPlanet(): Promise<void> {
    await this.page.evaluate(async () => {
      const engine = (window as unknown as Record<string, EngineHandle>).__gameEngine;
      const scene = engine?.currentScene as
        | { e2eLandOnPlanet?: () => Promise<void> }
        | null;
      await scene?.e2eLandOnPlanet?.();
    });
    await this.waitForScene('PlanetScene', 15_000);
  }

  async takeOff(): Promise<void> {
    await this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, EngineHandle>).__gameEngine;
      const scene = engine?.currentScene as
        | { handleTakeOff?: () => void; e2eTakeOff?: () => void }
        | null;
      if (scene?.e2eTakeOff) {
        scene.e2eTakeOff();
      } else {
        scene?.handleTakeOff?.();
      }
    });
    await this.waitForScene('SpaceFlightScene', 15_000);
  }

  async acceptQuest(questId: string): Promise<unknown> {
    return this.page.evaluate((id) => {
      const engine = (window as unknown as Record<string, EngineHandle>).__gameEngine;
      return engine.acceptBoardQuest(id);
    }, questId);
  }

  async transitionTo(sceneType: string, ctx: Record<string, unknown> = {}): Promise<void> {
    await this.page.evaluate(
      async ({ scene, context }) => {
        const engine = (window as unknown as Record<string, EngineHandle>).__gameEngine;
        await engine.transitionTo(scene, { gameEngine: engine, ...context });
      },
      { scene: sceneType, context: ctx }
    );
  }

  async startTextQuest(scriptId: string, seed?: number): Promise<void> {
    await this.page.evaluate(
      async ({ id, s }) => {
        const engine = (window as unknown as Record<string, EngineHandle>).__gameEngine;
        await engine.startTextQuest(id, s);
      },
      { id: scriptId, s: seed }
    );
  }

  async getCanvasBounds(): Promise<{ w: number; h: number }> {
    return this.page.evaluate(() => {
      const app = (window as unknown as Record<string, { screen?: { width: number; height: number } }>).__pixiApp;
      if (app?.screen) return { w: app.screen.width, h: app.screen.height };
      const canvas = document.querySelector('canvas');
      if (canvas) return { w: canvas.width, h: canvas.height };
      return { w: 800, h: 600 };
    });
  }
}
