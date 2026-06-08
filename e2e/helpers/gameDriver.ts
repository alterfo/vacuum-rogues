import type { Page } from '@playwright/test';

type EngineHandle = {
  currentScene: { constructor: { name: string } } | null;
  currentSceneType: string;
  player: {
    credits: number;
    hull: { hp: number; cargoCapacity: number };
    cargo: { totalWeight: number };
  } | null;
  isRunning?: boolean;
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
        hp: p.hull?.hp ?? 0,
        cargoCapacity: p.hull?.cargoCapacity ?? 0,
        cargoWeight: p.cargo?.totalWeight ?? 0,
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
      return engine?.player?.hull?.hp ?? 0;
    });
  }

  async isAlive(): Promise<boolean> {
    return this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, EngineHandle>).__gameEngine;
      if (!engine?.currentScene) return false;
      const hp = engine.player?.hull?.hp ?? 0;
      return hp > 0;
    });
  }

  async isRunning(): Promise<boolean> {
    return this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, EngineHandle>).__gameEngine;
      return engine?.isRunning ?? false;
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
        | { handlePlayPause?: () => void }
        | null;
      scene?.handlePlayPause?.();
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

  async landOnPlanet(index = 0): Promise<void> {
    await this.page.evaluate((idx) => {
      const engine = (window as unknown as Record<string, EngineHandle>).__gameEngine;
      const scene = engine?.currentScene as
        | { e2eLandOnPlanet?: (i: number) => void; onPlanetClick?: (planet: unknown) => void }
        | null;
      if (scene?.e2eLandOnPlanet) {
        scene.e2eLandOnPlanet(idx);
      }
    }, index);
  }

  async takeOff(): Promise<void> {
    await this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, EngineHandle>).__gameEngine;
      const scene = engine?.currentScene as
        | { handleTakeOff?: () => void; e2eTakeOff?: () => void }
        | null;
      scene?.e2eTakeOff?.() ?? scene?.handleTakeOff?.();
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
