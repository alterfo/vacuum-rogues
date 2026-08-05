import { describe, it, expect } from "vitest";
import { GEAR_CATALOG } from "@/systems/equipment/GearCatalog";
import { QUEST_BASE_REWARD, QUEST_REWARD_PER_JUMP } from "@/config/balance";
import {
  generateQuestBoard,
  type BoardOptions,
} from "@/systems/quests/QuestGenerator";
import type { StarSystem } from "@/domain/StarSystem";

function sys(id: string, name: string, toIds: string[]): StarSystem {
  return {
    id,
    name,
    connections: toIds.map((toSystemId) => ({
      fromSystemId: id,
      toSystemId,
      fuelCost: 5,
    })),
    planets: [{ id: `${id}_p1`, isHabitable: true }],
  } as unknown as StarSystem;
}

function chainGalaxy(): StarSystem[] {
  return [
    sys("A", "Альфа", ["B"]),
    sys("B", "Бета", ["A", "C"]),
    sys("C", "Гамма", ["B", "D"]),
    sys("D", "Дельта", ["C"]),
  ];
}

function baseOpts(over: Partial<BoardOptions> = {}): BoardOptions {
  return {
    systems: chainGalaxy(),
    originSystemId: "A",
    planetId: "A_p1",
    day: 0,
    seed: "economy-test-seed",
    textRatio: 0,
    eliteRatio: 0,
    chainRatio: 0,
    ...over,
  };
}

describe("Economy re-balance — Task 3", () => {
  describe("Quest reward constants", () => {
    it("QUEST_BASE_REWARD is 400", () => {
      expect(QUEST_BASE_REWARD).toBe(400);
    });

    it("QUEST_REWARD_PER_JUMP is 220", () => {
      expect(QUEST_REWARD_PER_JUMP).toBe(220);
    });
  });

  describe("Quest reward curve", () => {
    it("mean credit reward across 40 mixed quests (1-3 jumps) is in 500-1400", () => {
      const quests = generateQuestBoard(baseOpts({ count: 40 }));
      const mean =
        quests.reduce((s, q) => s + q.template.reward.credits, 0) /
        quests.length;
      expect(mean).toBeGreaterThan(500);
      expect(mean).toBeLessThan(1400);
    });

    it("rewards are substantially higher than the old formula (base=120, perJump=70)", () => {
      const quests = generateQuestBoard(baseOpts({ count: 20 }));
      const mean =
        quests.reduce((s, q) => s + q.template.reward.credits, 0) /
        quests.length;
      expect(mean).toBeGreaterThan(600);
    });

    it("all generated quests have positive credit rewards", () => {
      const quests = generateQuestBoard(baseOpts({ count: 30 }));
      for (const q of quests) {
        expect(q.template.reward.credits).toBeGreaterThan(0);
      }
    });
  });

  describe("Gear price bands", () => {
    it("all tech-1 gear has basePrice ≤ 1500", () => {
      const tech1 = GEAR_CATALOG.filter((g) => g.techLevel === 1);
      expect(tech1.length).toBeGreaterThan(0);
      for (const g of tech1) {
        expect(
          g.basePrice,
          `${g.id} (tech 1) basePrice out of band`,
        ).toBeLessThanOrEqual(1500);
      }
    });

    it("all always-available tech-7/8 gear has basePrice ≤ 14000", () => {
      const top = GEAR_CATALOG.filter(
        (g) => g.techLevel >= 7 && g.minDay === undefined,
      );
      expect(top.length).toBeGreaterThan(0);
      for (const g of top) {
        expect(
          g.basePrice,
          `${g.id} (tech ${g.techLevel}) basePrice out of band`,
        ).toBeLessThanOrEqual(14000);
      }
    });

    it("tech 1-2 gear prices fall in 500-1500", () => {
      const items = GEAR_CATALOG.filter((g) => g.techLevel <= 2);
      expect(items.length).toBeGreaterThan(0);
      for (const g of items) {
        expect(
          g.basePrice,
          `${g.id} tech=${g.techLevel}`,
        ).toBeGreaterThanOrEqual(500);
        expect(g.basePrice, `${g.id} tech=${g.techLevel}`).toBeLessThanOrEqual(
          1500,
        );
      }
    });

    it("tech 3-4 gear prices fall in 2000-5000", () => {
      const items = GEAR_CATALOG.filter(
        (g) => g.techLevel === 3 || g.techLevel === 4,
      );
      expect(items.length).toBeGreaterThan(0);
      for (const g of items) {
        expect(
          g.basePrice,
          `${g.id} tech=${g.techLevel}`,
        ).toBeGreaterThanOrEqual(2000);
        expect(g.basePrice, `${g.id} tech=${g.techLevel}`).toBeLessThanOrEqual(
          5000,
        );
      }
    });

    it("tech 5-6 gear prices fall in 5500-9000", () => {
      const items = GEAR_CATALOG.filter(
        (g) => g.techLevel === 5 || g.techLevel === 6,
      );
      expect(items.length).toBeGreaterThan(0);
      for (const g of items) {
        expect(
          g.basePrice,
          `${g.id} tech=${g.techLevel}`,
        ).toBeGreaterThanOrEqual(5500);
        expect(g.basePrice, `${g.id} tech=${g.techLevel}`).toBeLessThanOrEqual(
          9000,
        );
      }
    });

    it("always-available tech 7-8 gear prices fall in 10000-14000", () => {
      const items = GEAR_CATALOG.filter(
        (g) => g.techLevel >= 7 && g.minDay === undefined,
      );
      expect(items.length).toBeGreaterThan(0);
      for (const g of items) {
        expect(
          g.basePrice,
          `${g.id} tech=${g.techLevel}`,
        ).toBeGreaterThanOrEqual(10000);
        expect(g.basePrice, `${g.id} tech=${g.techLevel}`).toBeLessThanOrEqual(
          14000,
        );
      }
    });

    it("day-gated endgame gear prices fall in 36000-240000", () => {
      const items = GEAR_CATALOG.filter(
        (g) => g.minDay !== undefined && g.id !== "eq_engine_v",
      );
      expect(items.length).toBeGreaterThan(0);
      for (const g of items) {
        expect(
          g.basePrice,
          `${g.id} tech=${g.techLevel}`,
        ).toBeGreaterThanOrEqual(36000);
        expect(g.basePrice, `${g.id} tech=${g.techLevel}`).toBeLessThanOrEqual(
          240000,
        );
      }
    });
  });
});
