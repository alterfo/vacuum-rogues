import { describe, it, expect } from "vitest";
import {
  evaluateDelivery,
  type DeliveryPlayerLike,
  type DeliveryQuestLike,
} from "@/systems/quests/deliveryCompletion";
import { QuestType } from "@/types";
import type { QuestObjective } from "@/types";

function collectObjective(
  overrides: Partial<QuestObjective> = {},
): QuestObjective {
  return {
    id: "obj1",
    description: "Загрузить 5 ед. Роскошь",
    type: "COLLECT_ITEM",
    targetAmount: 5,
    currentAmount: 0,
    completed: false,
    itemType: "LUXURY",
    ...overrides,
  } as QuestObjective;
}

function deliveryQuest(
  overrides: Partial<DeliveryQuestLike> = {},
): DeliveryQuestLike {
  return {
    type: QuestType.DELIVERY,
    isCompleted: false,
    isFailed: false,
    targetSystemId: "SYS",
    objectives: [collectObjective()],
    ...overrides,
  };
}

function playerWith(
  resources: { type: string; amount: number }[],
): DeliveryPlayerLike {
  return { inventory: { resources } };
}

describe("evaluateDelivery (pure on-landing completion helper)", () => {
  it("exact required amount → complete with stack + objective to deduct", () => {
    const quest = deliveryQuest();
    const player = playerWith([{ type: "LUXURY", amount: 5 }]);
    const result = evaluateDelivery(quest, player, "SYS");
    expect(result.kind).toBe("complete");
    if (result.kind !== "complete") return;
    expect(result.collectObj?.itemType).toBe("LUXURY");
    expect(result.stack).toEqual({ type: "LUXURY", amount: 5 });
  });

  it("more than required → complete (excess stays in the hold)", () => {
    const quest = deliveryQuest();
    const player = playerWith([{ type: "LUXURY", amount: 12 }]);
    const result = evaluateDelivery(quest, player, "SYS");
    expect(result.kind).toBe("complete");
    if (result.kind !== "complete") return;
    expect(result.stack?.amount).toBe(12);
  });

  it("below required → shortfall with carried/required counts", () => {
    const quest = deliveryQuest();
    const player = playerWith([{ type: "LUXURY", amount: 3 }]);
    const result = evaluateDelivery(quest, player, "SYS");
    expect(result.kind).toBe("shortfall");
    if (result.kind !== "shortfall") return;
    expect(result.cargo).toBe("LUXURY");
    expect(result.required).toBe(5);
    expect(result.carried).toBe(3);
  });

  it("cargo entirely missing → shortfall with carried 0", () => {
    const quest = deliveryQuest();
    const player = playerWith([{ type: "ORE", amount: 99 }]);
    const result = evaluateDelivery(quest, player, "SYS");
    expect(result.kind).toBe("shortfall");
    if (result.kind !== "shortfall") return;
    expect(result.cargo).toBe("LUXURY");
    expect(result.required).toBe(5);
    expect(result.carried).toBe(0);
  });

  it("wrong system → n/a (no toast, silent)", () => {
    const quest = deliveryQuest({ targetSystemId: "OTHER" });
    const player = playerWith([{ type: "LUXURY", amount: 99 }]);
    expect(evaluateDelivery(quest, player, "SYS").kind).toBe("n/a");
  });

  it("non-delivery quest → n/a", () => {
    const quest = deliveryQuest({ type: QuestType.BOUNTY });
    const player = playerWith([{ type: "LUXURY", amount: 5 }]);
    expect(evaluateDelivery(quest, player, "SYS").kind).toBe("n/a");
  });

  it("already completed or failed → n/a", () => {
    const player = playerWith([{ type: "LUXURY", amount: 5 }]);
    expect(
      evaluateDelivery(deliveryQuest({ isCompleted: true }), player, "SYS")
        .kind,
    ).toBe("n/a");
    expect(
      evaluateDelivery(deliveryQuest({ isFailed: true }), player, "SYS").kind,
    ).toBe("n/a");
  });

  it("delivery with no cargo requirement → complete on arrival (no stack)", () => {
    const quest = deliveryQuest({ objectives: [] });
    const player = playerWith([]);
    const result = evaluateDelivery(quest, player, "SYS");
    expect(result.kind).toBe("complete");
    if (result.kind !== "complete") return;
    expect(result.collectObj).toBeUndefined();
    expect(result.stack).toBeUndefined();
  });

  describe("target planet gating (Местный подряд neighbour)", () => {
    it("right system but wrong planet (the issuer) → n/a (silent)", () => {
      const quest = deliveryQuest({ targetPlanetId: "P_neighbour" });
      const player = playerWith([{ type: "LUXURY", amount: 99 }]);
      // Landing back on the issuer planet, holding the cargo, does NOT complete.
      expect(evaluateDelivery(quest, player, "SYS", "P_issuer").kind).toBe(
        "n/a",
      );
    });

    it("right system AND the named target planet with cargo → complete", () => {
      const quest = deliveryQuest({ targetPlanetId: "P_neighbour" });
      const player = playerWith([{ type: "LUXURY", amount: 5 }]);
      const result = evaluateDelivery(quest, player, "SYS", "P_neighbour");
      expect(result.kind).toBe("complete");
      if (result.kind !== "complete") return;
      expect(result.stack).toEqual({ type: "LUXURY", amount: 5 });
    });

    it("on the target planet but short on cargo → shortfall (not n/a)", () => {
      const quest = deliveryQuest({ targetPlanetId: "P_neighbour" });
      const player = playerWith([{ type: "LUXURY", amount: 2 }]);
      const result = evaluateDelivery(quest, player, "SYS", "P_neighbour");
      expect(result.kind).toBe("shortfall");
      if (result.kind !== "shortfall") return;
      expect(result.carried).toBe(2);
      expect(result.required).toBe(5);
    });

    it("legacy quest (null target planet) → completes system-level on any planet", () => {
      const quest = deliveryQuest({ targetPlanetId: null });
      const player = playerWith([{ type: "LUXURY", amount: 5 }]);
      // Even landing on an arbitrary planet completes it (back-compat).
      expect(evaluateDelivery(quest, player, "SYS", "P_anything").kind).toBe(
        "complete",
      );
    });

    it("target planet set but caller omits current planet → system-level (back-compat)", () => {
      const quest = deliveryQuest({ targetPlanetId: "P_neighbour" });
      const player = playerWith([{ type: "LUXURY", amount: 5 }]);
      // No planet id threaded → the planet gate does not fire.
      expect(evaluateDelivery(quest, player, "SYS").kind).toBe("complete");
    });
  });
});
