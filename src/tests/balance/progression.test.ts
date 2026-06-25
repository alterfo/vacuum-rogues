import { describe, it, expect } from "vitest";
import {
  GEAR_CATALOG,
  GearKind,
  EquipmentClass,
  isRareGear,
  type HullSpec,
  type EquipmentSpec,
} from "@/systems/equipment/GearCatalog";
import { modelledDaysToAfford, QUEST_INTERVAL_DAYS } from "@/config/balance";
import {
  generateQuestBoard,
  type BoardOptions,
} from "@/systems/quests/QuestGenerator";
import type { StarSystem } from "@/domain/StarSystem";

// ---------------------------------------------------------------------------
// Task 3: reaching the rare apex tech must be a LONG, earned climb — far longer
// than the old ~2-week trade buy of the (then cheap, ubiquitous) top hull. We
// model the player's quest income against the now-steep apex prices and assert
// the *relationship* (days-to-top-tech ≫ a fortnight), not an exact day count,
// so future income/price tuning doesn't churn the test.
// ---------------------------------------------------------------------------

/** The old "I can field the most expensive hull almost immediately" buy: ~2 weeks. */
const OLD_TOP_TECH_BUY_DAYS = 14;

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

function board(count: number): BoardOptions {
  return {
    systems: chainGalaxy(),
    originSystemId: "A",
    planetId: "A_p1",
    day: 0,
    seed: "progression-test-seed",
    textRatio: 0,
    eliteRatio: 0,
    chainRatio: 0,
    count,
  };
}

function meanQuestReward(count: number): number {
  const quests = generateQuestBoard(board(count));
  return (
    quests.reduce((s, q) => s + q.template.reward.credits, 0) / quests.length
  );
}

const HULLS = GEAR_CATALOG.filter(
  (g): g is HullSpec => g.kind === GearKind.HULL,
);
const ENGINES = GEAR_CATALOG.filter(
  (g): g is EquipmentSpec =>
    g.kind === GearKind.EQUIPMENT && g.equipmentClass === EquipmentClass.ENGINE,
);

function apex<T extends { basePrice: number }>(items: readonly T[]): T {
  return items.reduce((best, g) => (g.basePrice > best.basePrice ? g : best));
}

describe("progression: top tech is a long climb (Task 3)", () => {
  const apexHull = apex(HULLS);
  const apexEngine = apex(ENGINES);

  it("the apex hull and apex engine are the rare, high-end goal", () => {
    expect(isRareGear(apexHull)).toBe(true);
    expect(isRareGear(apexEngine)).toBe(true);
  });

  it("modelledDaysToAfford grows with price and uses the documented cadence", () => {
    expect(QUEST_INTERVAL_DAYS).toBeGreaterThan(0);
    const reward = 680; // documented mean-mix reward
    expect(modelledDaysToAfford(2000, reward)).toBeLessThan(
      modelledDaysToAfford(12000, reward),
    );
    // One quest per QUEST_INTERVAL_DAYS days at `reward`/quest ⇒ reward/day rate.
    expect(modelledDaysToAfford(reward, reward)).toBe(QUEST_INTERVAL_DAYS);
  });

  it("affording the apex hull takes many in-game months (≫ the old ~2-week buy)", () => {
    const reward = meanQuestReward(60);
    // Sanity: the board's mean reward is in the documented mid band.
    expect(reward).toBeGreaterThan(400);
    const days = modelledDaysToAfford(apexHull.basePrice, reward);
    // A long earned climb — at least several times the old fortnight buy.
    expect(days).toBeGreaterThan(OLD_TOP_TECH_BUY_DAYS * 5);
    expect(days).toBeGreaterThan(80);
  });

  it("the full apex loadout (hull + engine) is an order of magnitude beyond the old buy", () => {
    const reward = meanQuestReward(60);
    const pairDays = modelledDaysToAfford(
      apexHull.basePrice + apexEngine.basePrice,
      reward,
    );
    const hullDays = modelledDaysToAfford(apexHull.basePrice, reward);
    // The pair costs strictly more time than the hull alone…
    expect(pairDays).toBeGreaterThan(hullDays);
    // …and lands far beyond the old ~2-week top-tech buy (≥ 10× a fortnight).
    expect(pairDays).toBeGreaterThan(OLD_TOP_TECH_BUY_DAYS * 10);
  });
});
