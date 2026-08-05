import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import { generateQuestBoard } from "@/systems/quests/QuestGenerator";
import {
  RESOURCE_BASE_PRICES,
  LOCAL_DELIVERY_REWARD_MARGIN,
} from "@/config/balance";
import type { ResourceType } from "@/types";

function isolatedSystem(): StarSystem {
  return {
    id: "ISO",
    name: "Захолустье",
    connections: [],
    planets: [
      { id: "ISO_p1", isHabitable: true },
      { id: "ISO_p2", isHabitable: true },
    ],
  } as unknown as StarSystem;
}

function localDeliveries(seed: string) {
  return generateQuestBoard({
    systems: [isolatedSystem()],
    originSystemId: "ISO",
    planetId: "ISO_p1",
    day: 0,
    seed,
    count: 5,
    textRatio: 0,
  }).filter((q) => q.template.title === "Местный подряд");
}

describe("Местный подряд (local delivery) reward economics", () => {
  it("never pays less than the goods' base cost, and matches base × amount × margin", () => {
    const seenCargo = new Set<ResourceType>();

    for (let s = 0; s < 60; s++) {
      for (const quest of localDeliveries(`reward-seed-${s}`)) {
        const collect = quest.template.objectives.find(
          (o) => o.type === "COLLECT_ITEM",
        );
        expect(collect).toBeDefined();
        if (!collect) continue;

        const resource = collect.itemType as ResourceType;
        const amount = collect.targetAmount;
        const basePrice = RESOURCE_BASE_PRICES[resource];
        expect(basePrice).toBeGreaterThan(0);

        const goodsCost = basePrice * amount;
        const reward = quest.template.reward.credits;

        expect(reward).toBeGreaterThan(goodsCost);
        expect(reward).toBe(
          Math.round(goodsCost * LOCAL_DELIVERY_REWARD_MARGIN),
        );

        seenCargo.add(resource);
      }
    }

    expect(seenCargo.size).toBe(5);
  });
});
