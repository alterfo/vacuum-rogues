import { test, expect } from '@playwright/test';

/**
 * E2E: Quest accept and complete flow
 *
 * Validates the critical loop:
 *   accept DELIVERY/EXPLORATION quest from job board
 *   → fly to target system
 *   → quest auto-completes
 *   → credits increase by reward amount
 *
 * All interaction driven via window.__gameEngine. No coordinate-based canvas clicks.
 */

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
    // Find a planet in the starting system to get the quest board
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
      // Prefer EXPLORATION (no cargo needed); fall back to ESCORT/DIPLOMACY
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

    // Accept the quest
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

    // Confirm quest appears in active quests
    const activeCount = await page.evaluate(() => {
      return (window as unknown as { __gameEngine: GameEngine }).__gameEngine
        .questManager.getActiveQuests().length;
    });
    expect(activeCount).toBeGreaterThan(0);

    const creditsBefore = await page.evaluate(() => {
      return (window as unknown as { __gameEngine: GameEngine }).__gameEngine.player.credits;
    });

    // Teleport player to target system (warp jump)
    await page.evaluate((targetSystemId) => {
      (window as unknown as { __gameEngine: GameEngine }).__gameEngine
        .player.currentSystemId = targetSystemId;
    }, acceptResult.targetSystemId);

    // Transitioning to SPACE_FLIGHT triggers completeExplorationQuestsBySystemEntry()
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

    // Verify credits increased by the quest reward
    const creditsAfter = await page.evaluate(() => {
      return (window as unknown as { __gameEngine: GameEngine }).__gameEngine.player.credits;
    });
    expect(creditsAfter).toBeGreaterThanOrEqual(creditsBefore + acceptResult.reward);
  });

  test('DELIVERY quest completes when player lands on target planet with cargo', async ({ page }) => {
    // Find a DELIVERY quest on the board
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

    // Accept delivery quest
    const acceptResult = await page.evaluate((sr) => {
      const engine = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      const accepted = engine.acceptBoardQuest(sr.quest, sr.planetId);
      if (!accepted) return null;

      // Find the COLLECT_ITEM objective to know what cargo to load
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

    // Load the required cargo into inventory via the addResource API
    if (acceptResult.cargoType) {
      await page.evaluate((info) => {
        const engine = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
        engine.player.inventory.addResource(info.cargoType!, info.cargoAmount);
      }, { cargoType: acceptResult.cargoType, cargoAmount: acceptResult.cargoAmount });
    }

    const creditsBefore = await page.evaluate(() => {
      return (window as unknown as { __gameEngine: GameEngine }).__gameEngine.player.credits;
    });

    // Travel to target system
    await page.evaluate((targetSystemId) => {
      (window as unknown as { __gameEngine: GameEngine }).__gameEngine
        .player.currentSystemId = targetSystemId;
    }, acceptResult.targetSystemId);

    // Land on target planet (PlanetScene.initialize triggers checkDeliveryQuestCompletion)
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

    // Verify credits increased
    const creditsAfter = await page.evaluate(() => {
      return (window as unknown as { __gameEngine: GameEngine }).__gameEngine.player.credits;
    });
    expect(creditsAfter).toBeGreaterThanOrEqual(creditsBefore + acceptResult.reward);
  });
});
