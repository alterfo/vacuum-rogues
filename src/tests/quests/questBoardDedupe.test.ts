import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import { QuestType } from "@/types";
import {
  generateQuestBoard,
  questKey,
  questKeyForQuest,
  type BoardOptions,
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

function wideGalaxy(): StarSystem[] {
  return [
    sys("A", "Альфа", ["B", "C"]),
    sys("B", "Бета", ["A", "C", "D"]),
    sys("C", "Гамма", ["A", "B", "E"]),
    sys("D", "Дельта", ["B", "F"]),
    sys("E", "Эпсилон", ["C", "F"]),
    sys("F", "Фи", ["D", "E"]),
  ];
}

function narrowGalaxy(): StarSystem[] {
  return [sys("A", "Альфа", ["B"]), sys("B", "Бета", ["A"])];
}

function baseOpts(over: Partial<BoardOptions> = {}): BoardOptions {
  return {
    systems: wideGalaxy(),
    originSystemId: "A",
    planetId: "A_p1",
    day: 0,
    seed: "galaxy-seed",
    textRatio: 0,
    ...over,
  };
}

describe("quest board dedupe (Task 2)", () => {
  it("never emits a quest whose key is in excludeKeys", () => {
    const board1 = generateQuestBoard(baseOpts({ count: 5 }));
    const excluded = board1.slice(0, 2).map(questKey);

    const board2 = generateQuestBoard(
      baseOpts({ count: 5, excludeKeys: excluded }),
    );

    const board2Keys = board2.map(questKey);
    for (const key of excluded) {
      expect(board2Keys).not.toContain(key);
    }
  });

  it("still fills to the requested size from the remaining pool", () => {
    const board1 = generateQuestBoard(baseOpts({ count: 5 }));
    const excluded = board1.slice(0, 3).map(questKey);

    const board2 = generateQuestBoard(
      baseOpts({ count: 5, excludeKeys: excluded }),
    );

    expect(board2).toHaveLength(5);
  });

  it("dedupes within the board itself when excludeKeys is present (even empty)", () => {
    const legacy = generateQuestBoard(
      baseOpts({ systems: narrowGalaxy(), count: 8 }),
    );
    const legacyKeys = legacy.map(questKey);
    expect(new Set(legacyKeys).size).toBeLessThan(legacyKeys.length);

    const deduped = generateQuestBoard(
      baseOpts({ systems: narrowGalaxy(), count: 8, excludeKeys: [] }),
    );
    const dedupedKeys = deduped.map(questKey);
    expect(new Set(dedupedKeys).size).toBe(dedupedKeys.length);
  });

  it("never leaves an orphaned chain part on the board when an earlier part is excluded", () => {
    const legacy = generateQuestBoard(baseOpts({ count: 8 }));
    const part0 = legacy.find(
      (q) => q.template.chainId && q.template.chainPart === 0,
    );
    expect(part0).toBeDefined();

    const board = generateQuestBoard(
      baseOpts({ count: 8, excludeKeys: [questKey(part0!)] }),
    );

    const partsByChain = new Map<string, Set<number>>();
    for (const q of board) {
      if (!q.template.chainId) continue;
      const parts = partsByChain.get(q.template.chainId) ?? new Set<number>();
      parts.add(q.template.chainPart ?? -1);
      partsByChain.set(q.template.chainId, parts);
    }
    for (const parts of partsByChain.values()) {
      const max = Math.max(...parts);
      for (let p = 0; p <= max; p++) {
        expect(parts.has(p)).toBe(true);
      }
    }
  });

  it("is deterministic for a fixed seed and the same exclusions", () => {
    const excluded = generateQuestBoard(baseOpts({ count: 5 }))
      .slice(0, 2)
      .map(questKey);
    const a = generateQuestBoard(baseOpts({ count: 5, excludeKeys: excluded }));
    const b = generateQuestBoard(baseOpts({ count: 5, excludeKeys: excluded }));
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("excluding everything reachable terminates and returns fewer (best effort)", () => {
    const big = generateQuestBoard(baseOpts({ count: 200 }));
    const allKeys = [...new Set(big.map(questKey))];
    const board = generateQuestBoard(
      baseOpts({ count: 5, excludeKeys: allKeys }),
    );
    expect(board.length).toBeLessThanOrEqual(5);
    for (const q of board) {
      expect(allKeys).not.toContain(questKey(q));
    }
  });

  it("questKeyForQuest matches questKey for an accepted copy of the same job", () => {
    const board = generateQuestBoard(baseOpts({ count: 40 }));
    const delivery = board.find((q) => q.template.type === QuestType.DELIVERY);
    expect(delivery).toBeDefined();
    const t = delivery!.template;

    const acceptedLike = {
      type: t.type,
      targetSystemId: t.targetSystemId ?? null,
      targetObjectId: t.targetObjectId ?? null,
      id: `${t.id}_ACCEPTED`,
      objectives: t.objectives,
      chainId: t.chainId ?? null,
      chainPart: t.chainPart ?? -1,
    };
    expect(questKeyForQuest(acceptedLike)).toBe(questKey(delivery!));
  });

  it("leaves the board unchanged when excludeKeys is absent (legacy path)", () => {
    expect(generateQuestBoard(baseOpts({ count: 5 }))).toHaveLength(5);
    expect(generateQuestBoard(baseOpts({ count: 8 }))).toHaveLength(8);
    const a = generateQuestBoard(baseOpts({ count: 6 }));
    const b = generateQuestBoard(baseOpts({ count: 6 }));
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});
