import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import { QuestType } from "@/types";
import { generateQuestBoard } from "@/systems/quests/QuestGenerator";

function sys(
  id: string,
  name: string,
  toIds: string[],
  explored: boolean,
): StarSystem {
  return {
    id,
    name,
    connections: toIds.map((toSystemId) => ({
      fromSystemId: id,
      toSystemId,
      fuelCost: 5,
    })),
    planets: [{ id: `${id}_p1`, isHabitable: true }],
    explored,
  } as unknown as StarSystem;
}

describe("QuestGenerator: known systems only (Task 2)", () => {
  const SYSTEMS = [
    sys("o", "Origin", ["e1", "e2", "u1", "u2", "u3"], true),
    sys("e1", "Explored-1", ["o"], true),
    sys("e2", "Explored-2", ["o"], true),
    sys("u1", "Unknown-1", ["o"], false),
    sys("u2", "Unknown-2", ["o"], false),
    sys("u3", "Unknown-3", ["o"], false),
  ];
  const UNEXPLORED = new Set(["u1", "u2", "u3"]);

  it("never assigns a quest target to an unexplored system", () => {
    const board = generateQuestBoard({
      systems: SYSTEMS,
      originSystemId: "o",
      planetId: "o_p1",
      day: 0,
      seed: "known-systems",
      count: 40,
      textRatio: 0,
      chainRatio: 0,
      eliteRatio: 0,
    });

    expect(board.length).toBe(40);
    for (const q of board) {
      expect(UNEXPLORED.has(q.targetSystemId)).toBe(false);
      expect(
        q.template.targetSystemId == null ||
          !UNEXPLORED.has(q.template.targetSystemId),
      ).toBe(true);
    }

    const crossSystem = board.filter((q) => q.jumps > 0);
    expect(crossSystem.length).toBeGreaterThan(0);
    for (const q of crossSystem) {
      expect(["e1", "e2"]).toContain(q.targetSystemId);
    }
  });

  it("does not inject a DEFENSE quest when the only adjacent system is unexplored", () => {
    const board = generateQuestBoard({
      systems: SYSTEMS,
      originSystemId: "o",
      planetId: "o_p1",
      day: 0,
      seed: "known-systems",
      count: 3,
      textRatio: 0,
      chainRatio: 0,
      eliteRatio: 0,
      overmindSystems: ["u2"],
      overmindAdjacentSystems: ["u1"], // u1 is unexplored → not a valid target
    });

    const defenseQuests = board.filter(
      (q) => q.template.type === QuestType.DEFENSE,
    );
    expect(defenseQuests.length).toBe(0);
  });

  it("injects a DEFENSE quest only for an explored adjacent system", () => {
    const board = generateQuestBoard({
      systems: SYSTEMS,
      originSystemId: "o",
      planetId: "o_p1",
      day: 0,
      seed: "known-systems",
      count: 3,
      textRatio: 0,
      chainRatio: 0,
      eliteRatio: 0,
      overmindSystems: ["u2"],
      overmindAdjacentSystems: ["u1", "e1"],
    });

    const defenseQuests = board.filter(
      (q) => q.template.type === QuestType.DEFENSE,
    );
    expect(defenseQuests.length).toBe(1);
    expect(defenseQuests[0].targetSystemId).toBe("e1");
    expect(UNEXPLORED.has(defenseQuests[0].targetSystemId)).toBe(false);
  });
});
