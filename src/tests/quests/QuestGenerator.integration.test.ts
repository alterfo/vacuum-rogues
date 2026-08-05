import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import type { Player } from "@/domain/Player";
import { QuestManager } from "@/systems/QuestManager";
import { QuestType } from "@/types";
import { generateQuestBoard } from "@/systems/quests/QuestGenerator";

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

function playerStub(): Player {
  const reputation: Record<string, number> = {};
  return {
    credits: 0,
    experience: 0,
    inventory: { resources: [] },
    reputation,
    getReputation: (id: string) => reputation[id] ?? 0,
    adjustReputation: (id: string, delta: number) => {
      reputation[id] = Math.max(
        -100,
        Math.min(100, (reputation[id] ?? 0) + delta),
      );
    },
  } as unknown as Player;
}

describe("QuestGenerator ↔ QuestManager integration", () => {
  it("a generated delivery quest can be accepted and completed via existing events (US-086)", () => {
    const systems = [
      sys("A", "Альфа", ["B"]),
      sys("B", "Бета", ["A", "C"]),
      sys("C", "Гамма", ["B"]),
    ];
    const board = generateQuestBoard({
      systems,
      originSystemId: "A",
      planetId: "A_p1",
      day: 0,
      seed: "seed",
      count: 40,
      textRatio: 0,
    });

    const delivery = board.find(
      (q) =>
        q.template.type === QuestType.DELIVERY &&
        q.template.objectives.some((o) => o.type === "COLLECT_ITEM") &&
        q.template.objectives.some((o) => o.type === "VISIT_LOCATION"),
    );
    expect(delivery).toBeDefined();
    if (!delivery) return;

    const qm = new QuestManager();
    const quest = qm.acceptQuestFromTemplate(delivery.template, "A_p1", 0);
    expect(quest).not.toBeNull();
    if (!quest) return;

    const collect = delivery.template.objectives.find(
      (o) => o.type === "COLLECT_ITEM",
    )!;
    const visit = delivery.template.objectives.find(
      (o) => o.type === "VISIT_LOCATION",
    )!;

    qm.updateQuestProgress({
      type: "COLLECT_ITEM",
      itemType: collect.itemType,
      amount: collect.targetAmount,
    });
    qm.updateQuestProgress({
      type: "VISIT_LOCATION",
      locationId: visit.locationId,
      amount: 1,
    });

    expect(quest.isCompleted).toBe(true);

    const player = playerStub();
    const before = player.credits;
    expect(qm.completeQuest(quest.id, player)).toBe(true);
    expect(player.credits).toBe(before + delivery.template.reward.credits);
  });

  it("generated quests expose galaxy navigation markers via QuestManager", () => {
    const systems = [sys("A", "Альфа", ["B"]), sys("B", "Бета", ["A"])];
    const board = generateQuestBoard({
      systems,
      originSystemId: "A",
      planetId: "A_p1",
      day: 0,
      seed: "seed",
      count: 10,
      textRatio: 0,
    });
    const qm = new QuestManager();
    for (const q of board) qm.acceptQuestFromTemplate(q.template, "A_p1", 0);

    const locations = qm.getActiveQuestLocations();
    expect(locations).toContain("B_p1");
  });
});
