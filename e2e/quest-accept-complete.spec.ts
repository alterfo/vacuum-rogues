import { test, expect } from '@playwright/test';
import { applyMockHeavySystems } from './fixtures/mockHeavySystems';


type QuestObjective = {
  type: string;
  itemType?: string;
  targetAmount?: number;
};

type QuestTemplate = {
  id: string;
  type: string;
  reward?: { credits: number };
  minReputation?: number;
};

type GeneratedQuest = {
  id: string;
  template: QuestTemplate;
  targetSystemId: string;
};

type Quest = {
  id: string;
  type: string;
  targetSystemId?: string;
  objectives: QuestObjective[];
  isCompleted: boolean;
  isFailed: boolean;
  reward?: { credits: number };
};

type GalaxySystem = {
  id: string;
  planets?: Array<{ id: string; name: string }>;
};

type GameEngine = {
  player: {
    credits: number;
    currentSystemId: string;
    inventory: {
      resources: Array<{ type: string; amount: number }>;
      addResource: (type: string, amount: number) => void;
    };
  };
  galaxy: { systems: GalaxySystem[] } | null;
  currentSceneType: string;
  transitionTo: (scene: string, ctx?: unknown) => Promise<void>;
  getQuestBoard: (planetId: string) => GeneratedQuest[];
  acceptBoardQuest: (quest: GeneratedQuest, planetId: string) => Quest | null;
  questManager: {
    getActiveQuests: () => Quest[];
  };
};

declare global {
  interface Window {
    __gameEngine: GameEngine;
  }
}

test.describe('Quest accept and complete flow', () => {
  test.beforeEach(async ({ page }) => {
    await applyMockHeavySystems(page);
    await page.goto('/');
    await page.waitForFunction(
      () => !!(window as unknown as { __gameEngine?: unknown }).__gameEngine,
      { timeout: 15000 },
    );
    await page.evaluate(async () => {
      const engine = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      await engine.transitionTo('SPACE_FLIGHT');
    });
    await page.waitForFunction(
      () =>
        (window as unknown as { __gameEngine: GameEngine }).__gameEngine
          .currentSceneType === 'SPACE_FLIGHT',
      { timeout: 8000 },
    );
  });

  test('EXPLORATION quest completes when player enters target system', async ({ page }) => {
    const setupResult = await page.evaluate(() => {
      const engine = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      const galaxy = engine.galaxy;
      if (!galaxy || !engine.player) return null;

      const currentSys = galaxy.systems.find(
        (s) => s.id === engine.player.currentSystemId,
      );
      if (!currentSys?.planets?.length) return null;
      const planet = currentSys.planets[0];

      const board = engine.getQuestBoard(planet.id);
      const quest = board.find((q) =>
        ['EXPLORATION', 'ESCORT', 'DIPLOMACY'].includes(q.template.type),
      );
      if (!quest) return null;

      return { quest, planetId: planet.id };
    });

    if (!setupResult) {
      test.skip(true, 'No suitable quest available on board');
      return;
    }

    const acceptResult = await page.evaluate((sr) => {
      const engine = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      const accepted = engine.acceptBoardQuest(sr.quest, sr.planetId);
      return {
        accepted: !!accepted,
        targetSystemId: sr.quest.targetSystemId,
        reward: sr.quest.template.reward?.credits ?? 0,
        questType: sr.quest.template.type,
      };
    }, setupResult);

    expect(acceptResult.accepted).toBe(true);

    const activeCount = await page.evaluate(() => {
      return (window as unknown as { __gameEngine: GameEngine }).__gameEngine
        .questManager.getActiveQuests().length;
    });
    expect(activeCount).toBeGreaterThan(0);

    const creditsBefore = await page.evaluate(() => {
      return (window as unknown as { __gameEngine: GameEngine }).__gameEngine.player.credits;
    });

    await page.evaluate((targetSystemId) => {
      (window as unknown as { __gameEngine: GameEngine }).__gameEngine
        .player.currentSystemId = targetSystemId;
    }, acceptResult.targetSystemId);

    await page.evaluate(async () => {
      const engine = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      await engine.transitionTo('SPACE_FLIGHT');
    });
    await page.waitForFunction(
      () =>
        (window as unknown as { __gameEngine: GameEngine }).__gameEngine
          .currentSceneType === 'SPACE_FLIGHT',
      { timeout: 8000 },
    );

    const creditsAfter = await page.evaluate(() => {
      return (window as unknown as { __gameEngine: GameEngine }).__gameEngine.player.credits;
    });
    expect(creditsAfter).toBeGreaterThanOrEqual(creditsBefore + acceptResult.reward);
  });

  test('DELIVERY quest completes when player lands on target planet with cargo', async ({ page }) => {
    const setupResult = await page.evaluate(() => {
      const engine = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      const galaxy = engine.galaxy;
      if (!galaxy || !engine.player) return null;

      const currentSys = galaxy.systems.find(
        (s) => s.id === engine.player.currentSystemId,
      );
      if (!currentSys?.planets?.length) return null;
      const planet = currentSys.planets[0];

      const board = engine.getQuestBoard(planet.id);
      const quest = board.find((q) => q.template.type === 'DELIVERY');
      if (!quest) return null;

      return { quest, planetId: planet.id };
    });

    if (!setupResult) {
      test.skip(true, 'No DELIVERY quest available on board');
      return;
    }

    const acceptResult = await page.evaluate((sr) => {
      const engine = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      const accepted = engine.acceptBoardQuest(sr.quest, sr.planetId);
      if (!accepted) return null;

      const collectObj = accepted.objectives.find(
        (o) => o.type === 'COLLECT_ITEM',
      );
      return {
        questId: accepted.id,
        targetSystemId: sr.quest.targetSystemId,
        reward: sr.quest.template.reward?.credits ?? 0,
        cargoType: collectObj?.itemType ?? null,
        cargoAmount: collectObj?.targetAmount ?? 0,
      };
    }, setupResult);

    if (!acceptResult) {
      test.skip(true, 'Could not accept delivery quest');
      return;
    }

    if (acceptResult.cargoType) {
      await page.evaluate((info) => {
        const engine = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
        engine.player.inventory.addResource(info.cargoType!, info.cargoAmount);
      }, { cargoType: acceptResult.cargoType, cargoAmount: acceptResult.cargoAmount });
    }

    const creditsBefore = await page.evaluate(() => {
      return (window as unknown as { __gameEngine: GameEngine }).__gameEngine.player.credits;
    });

    await page.evaluate((targetSystemId) => {
      (window as unknown as { __gameEngine: GameEngine }).__gameEngine
        .player.currentSystemId = targetSystemId;
    }, acceptResult.targetSystemId);

    const targetPlanetId = await page.evaluate((targetSystemId) => {
      const engine = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      const galaxy = engine.galaxy;
      const sys = galaxy?.systems.find((s) => s.id === targetSystemId);
      return sys?.planets?.[0]?.id ?? null;
    }, acceptResult.targetSystemId);

    if (!targetPlanetId) {
      test.skip(true, 'Target system has no planets');
      return;
    }

    await page.evaluate(async (planetId) => {
      const engine = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      await engine.transitionTo('PLANET', {
        gameEngine: engine,
        planet: (engine.galaxy?.systems
          .flatMap((s) => s.planets ?? [])
          .find((p) => p.id === planetId) ?? null),
      } as unknown as string);
    }, targetPlanetId);

    await page.waitForFunction(
      () =>
        (window as unknown as { __gameEngine: GameEngine }).__gameEngine
          .currentSceneType === 'PLANET',
      { timeout: 8000 },
    );

    const creditsAfter = await page.evaluate(() => {
      return (window as unknown as { __gameEngine: GameEngine }).__gameEngine.player.credits;
    });
    expect(creditsAfter).toBeGreaterThanOrEqual(creditsBefore + acceptResult.reward);
  });
});
