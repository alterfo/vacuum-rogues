import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import { generateQuestBoard } from "@/systems/quests/QuestGenerator";
import { RESOURCE_BASE_PRICES } from "@/config/balance";
import type { ResourceType } from "@/types";

/**
 * "Местный подряд" makes the player BUY the cargo on the market and deliver it
 * in-system, consuming it from the hold on completion. The reward must always
 * beat the *worst-case* market purchase cost, otherwise the contract is a hidden
 * loss in a hot market.
 *
 * Worst-case buy cost is bounded by the market price clamp in
 * `TradeSystem.getMarketPrice` (`finalPrice ≤ basePrice × 3.0`) times the maximum
 * faction buy multiplier in `getBuyPrice` (every faction's `buyMultiplier ≤ 1.0`).
 * So the realistic worst-case purchase cost per unit is `basePrice × 3.0`.
 *
 * buildLocalDelivery only fires as the fallback when no other system is reachable
 * (reachable.length === 0). An isolated single-system galaxy makes every non-text
 * board slot a local delivery, so a sweep of seeds covers all five cargo types.
 */
const WORST_CASE_BUY_MARKUP = 3.0;

function isolatedSystem(): StarSystem {
  return {
    id: "ISO",
    name: "Захолустье",
    connections: [],
    planets: [{ id: "ISO_p1", isHabitable: true }],
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

describe("Местный подряд (local delivery) profitability", () => {
  it("reward strictly exceeds the worst-case market buy cost for every cargo type", () => {
    const seenCargo = new Set<ResourceType>();

    for (let s = 0; s < 60; s++) {
      for (const quest of localDeliveries(`profit-seed-${s}`)) {
        const collect = quest.template.objectives.find(
          (o) => o.type === "COLLECT_ITEM",
        );
        expect(collect).toBeDefined();
        if (!collect) continue;

        const resource = collect.itemType as ResourceType;
        const amount = collect.targetAmount;
        const basePrice = RESOURCE_BASE_PRICES[resource];
        expect(basePrice).toBeGreaterThan(0);

        // The most the player can be charged to BUY the whole shipment: the
        // market price ceiling (base × 3.0) at the best faction buy multiplier (1.0).
        const worstCaseBuyCost = basePrice * amount * WORST_CASE_BUY_MARKUP;
        const reward = quest.template.reward.credits;

        // Never a loss, even when the market sits at its absolute ceiling.
        expect(reward).toBeGreaterThan(worstCaseBuyCost);

        seenCargo.add(resource);
      }
    }

    // The sweep must actually exercise every cargo type pickCargo can return,
    // otherwise the profitability guarantee is untested for some goods.
    expect(seenCargo.size).toBe(5);
  });
});
