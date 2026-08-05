import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
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
    explored: true,
  } as unknown as StarSystem;
}

describe("QuestGenerator: hostile-held systems are never quest targets (Task 6)", () => {
  const SYSTEMS = [
    sys("o", "Origin", ["s1", "s2", "h1", "h2"]),
    sys("s1", "Safe-1", ["o"]),
    sys("s2", "Safe-2", ["o"]),
    sys("h1", "PirateDen", ["o"]),
    sys("h2", "OvermindHeld", ["o"]),
  ];
  const HOSTILE = ["h1", "h2"];

  it("never assigns a routine/chain/elite quest target to a hostile-held system", () => {
    const board = generateQuestBoard({
      systems: SYSTEMS,
      originSystemId: "o",
      planetId: "o_p1",
      day: 0,
      seed: "hostile-exclusion",
      count: 40,
      textRatio: 0,
      hostileSystems: HOSTILE,
    });

    expect(board.length).toBe(40);
    const hostileSet = new Set(HOSTILE);
    for (const q of board) {
      expect(hostileSet.has(q.targetSystemId), q.template.title).toBe(false);
      for (const o of q.template.objectives)
        expect(
          o.targetSystemId == null || !hostileSet.has(o.targetSystemId),
          `${q.template.title}: objective → ${o.targetSystemId}`,
        ).toBe(true);
    }

    const crossSystem = board.filter((q) => q.jumps > 0);
    expect(crossSystem.length).toBeGreaterThan(0);
    for (const q of crossSystem) {
      expect(["s1", "s2"]).toContain(q.targetSystemId);
    }
  });

  it("omitting hostileSystems keeps the legacy board byte-identical (all spokes targetable)", () => {
    const opts = {
      systems: SYSTEMS,
      originSystemId: "o",
      planetId: "o_p1",
      day: 0,
      seed: "hostile-exclusion",
      count: 40,
      textRatio: 0,
    };
    const legacy = generateQuestBoard(opts);
    const explicitEmpty = generateQuestBoard({ ...opts, hostileSystems: [] });
    expect(explicitEmpty).toEqual(legacy);
    const targeted = new Set(legacy.map((q) => q.targetSystemId));
    expect(targeted.has("h1") || targeted.has("h2")).toBe(true);
  });

  it("DEFENSE frontier quests still work alongside the hostile exclusion", () => {
    const board = generateQuestBoard({
      systems: SYSTEMS,
      originSystemId: "o",
      planetId: "o_p1",
      day: 0,
      seed: "hostile-exclusion",
      count: 3,
      textRatio: 0,
      chainRatio: 0,
      eliteRatio: 0,
      hostileSystems: HOSTILE,
      overmindSystems: ["h2"],
      overmindAdjacentSystems: ["s1"],
    });

    const defense = board.filter((q) => q.template.type === QuestType.DEFENSE);
    expect(defense.length).toBe(1);
    expect(defense[0].targetSystemId).toBe("s1");
  });

  it("an all-hostile neighbourhood degrades to local/text quests, never a hostile target", () => {
    const board = generateQuestBoard({
      systems: SYSTEMS,
      originSystemId: "o",
      planetId: "o_p1",
      day: 0,
      seed: "hostile-exclusion",
      count: 10,
      textRatio: 0,
      hostileSystems: ["s1", "s2", "h1", "h2"],
    });

    const bad = new Set(["s1", "s2", "h1", "h2"]);
    for (const q of board) {
      expect(q.jumps === 0 || !bad.has(q.targetSystemId)).toBe(true);
    }
  });
});
