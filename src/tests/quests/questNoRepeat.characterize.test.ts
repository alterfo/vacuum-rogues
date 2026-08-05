import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import {
  generateQuestBoard,
  questKey,
  type BoardOptions,
  type GeneratedQuest,
} from "@/systems/quests/QuestGenerator";

function sys(
  id: string,
  name: string,
  toIds: string[],
  planetIds: { id: string; isHabitable: boolean }[] = [
    { id: `${id}_p1`, isHabitable: true },
  ],
): StarSystem {
  return {
    id,
    name,
    connections: toIds.map((toSystemId) => ({
      fromSystemId: id,
      toSystemId,
      fuelCost: 5,
    })),
    planets: planetIds,
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
    seed: "galaxy-seed",
    ...over,
  };
}

describe("quest board no-repeat (characterization)", () => {
  it("questKey: same job → same key; the bucket-bearing slot id and reward are ignored", () => {
    const board = generateQuestBoard(baseOpts({ textRatio: 0, count: 40 }));
    expect(board.length).toBeGreaterThan(0);

    const distinct = new Set(board.map(questKey));
    expect(distinct.size).toBeGreaterThan(1);

    const q = board[0];
    const relabelled: GeneratedQuest = {
      ...q,
      template: {
        ...q.template,
        id: `${q.template.id}_RELABELLED`,
        reward: {
          ...q.template.reward,
          credits: q.template.reward.credits + 999,
        },
      },
    };
    expect(questKey(relabelled)).toBe(questKey(q));
  });

  it("questKey is distinct across different target systems and kinds", () => {
    const board = generateQuestBoard(baseOpts({ textRatio: 0, count: 60 }));
    const deliveries = board.filter((q) => q.template.type === "DELIVERY");
    const others = board.filter((q) => q.template.type !== "DELIVERY");
    expect(deliveries.length).toBeGreaterThan(0);
    expect(others.length).toBeGreaterThan(0);
    expect(questKey(deliveries[0])).not.toBe(questKey(others[0]));

    const byKind = board.filter(
      (q) => q.template.type === deliveries[0].template.type,
    );
    const differentTarget = byKind.find(
      (q) => q.targetSystemId !== deliveries[0].targetSystemId,
    );
    if (differentTarget) {
      expect(questKey(differentTarget)).not.toBe(questKey(deliveries[0]));
    }
  });

  it("regenerating the board with the taken quest excluded does not re-offer it", () => {
    const board1 = generateQuestBoard(baseOpts());
    expect(board1.length).toBeGreaterThan(0);
    const taken = board1[0];
    const takenKey = questKey(taken);

    const board2 = generateQuestBoard(baseOpts({ excludeKeys: [takenKey] }));

    expect(board2.map(questKey)).not.toContain(takenKey);
    expect(board2.length).toBe(board1.length);
  });
});
