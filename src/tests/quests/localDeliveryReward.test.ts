import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import { generateQuestBoard } from "@/systems/quests/QuestGenerator";
import {
  RESOURCE_BASE_PRICES,
  LOCAL_DELIVERY_REWARD_MARGIN,
} from "@/config/balance";
import type { ResourceType } from "@/types";

/**
 * "Местный подряд" tells the player to *buy* the cargo on the market and deliver
 * it in-system; the goods are consumed from the hold on completion. A flat
 * 120–220 reward made the contract a guaranteed loss (e.g. 8 crystals at 250 base
 * = 2000 spent for a ~241 payout). The reward now anchors to the goods' base cost
 * × a profit margin, so the contract is always worth taking.
 *
 * buildLocalDelivery only fires as the fallback when no other system is reachable
 * (reachable.length === 0). An isolated single-system galaxy makes every non-text
 * board slot a local delivery, so a sweep of seeds covers all five cargo types.
 *
 * Feature update (neighbour delivery): the contract targets a *different* planet
 * in the same system, so the origin needs ≥2 planets (a single-planet origin now
 * falls back to a text quest). The fixture grows a 2nd planet so a local delivery
 * still generates — the reward economics under test are unchanged.
 */
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

        // Profitable at base price: the payout strictly exceeds what the cargo costs.
        expect(reward).toBeGreaterThan(goodsCost);
        // Exact, deterministic formula — no leftover flat 120–220 randomness.
        expect(reward).toBe(
          Math.round(goodsCost * LOCAL_DELIVERY_REWARD_MARGIN),
        );

        seenCargo.add(resource);
      }
    }

    // The sweep must actually exercise every cargo type pickCargo can return,
    // otherwise the profitability guarantee is untested for some goods.
    expect(seenCargo.size).toBe(5);
  });
});
