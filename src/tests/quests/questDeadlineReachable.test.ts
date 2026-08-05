import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import { generateQuestBoard } from "@/systems/quests/QuestGenerator";
import { jumpDistances } from "@/systems/galaxy/jumpDistance";
import {
  QUEST_DEADLINE_BASE_DAYS,
  QUEST_DEADLINE_PER_JUMP_DAYS,
  QUEST_DEADLINE_BUFFER_MIN_DAYS,
  QUEST_DEADLINE_BUFFER_MAX_DAYS,
} from "@/config/balance";

function sys(id: string, toIds: string[]): StarSystem {
  return {
    id,
    name: id,
    explored: true,
    connections: toIds.map((t) => ({
      fromSystemId: id,
      toSystemId: t,
      fuelCost: 5,
    })),
    planets: [{ id: `${id}_p1`, isHabitable: true, name: `${id} I` }],
  } as unknown as StarSystem;
}

describe("jumpDistances — undirected nav metric", () => {
  it("undirected reaches a system across a one-way edge in EITHER direction", () => {
    const systems = [sys("O", ["A"]), sys("A", ["T"]), sys("T", ["O"])];
    const directed = jumpDistances(systems, "O");
    const undirected = jumpDistances(systems, "O", { undirected: true });
    expect(directed.get("T")).toBe(2); // directed: O→A→T
    expect(undirected.get("T")).toBe(1); // nav: O↔T directly (T→O edge)
  });

  it("undirected reaches a system reachable ONLY by an incoming one-way edge", () => {
    const systems = [sys("O", []), sys("T", ["O"])];
    expect(jumpDistances(systems, "O").has("T")).toBe(false);
    expect(jumpDistances(systems, "O", { undirected: true }).get("T")).toBe(1);
  });

  it("defaults to the legacy directed behaviour (no options)", () => {
    const systems = [sys("O", ["A"]), sys("A", ["B"]), sys("B", [])];
    const d = jumpDistances(systems, "O");
    expect(d.get("O")).toBe(0);
    expect(d.get("A")).toBe(1);
    expect(d.get("B")).toBe(2);
  });
});

describe("QuestGenerator deadline is base + jumps × perJump (bounded)", () => {
  const systems = [
    sys("A", ["B"]),
    sys("B", ["A", "C"]),
    sys("C", ["B", "D"]),
    sys("D", ["C"]),
  ];

  it("every routine deadline equals BASE + jumps×PER_JUMP + buffer∈[MIN,MAX]", () => {
    for (let s = 0; s < 6; s++) {
      const board = generateQuestBoard({
        systems,
        originSystemId: "A",
        planetId: "A_p1",
        day: s * 7,
        seed: `reach-${s}`,
        count: 40,
        textRatio: 0,
        eliteRatio: 0,
        chainRatio: 0,
      });
      const timed = board.filter((q) => q.template.deadline > 0);
      expect(timed.length).toBeGreaterThan(0);
      for (const q of timed) {
        const budget =
          QUEST_DEADLINE_BASE_DAYS + q.jumps * QUEST_DEADLINE_PER_JUMP_DAYS;
        expect(q.template.deadline).toBeGreaterThanOrEqual(
          budget + QUEST_DEADLINE_BUFFER_MIN_DAYS,
        );
        expect(q.template.deadline).toBeLessThanOrEqual(
          budget + QUEST_DEADLINE_BUFFER_MAX_DAYS,
        );
      }
    }
  });

  it("deadline grows with distance (a 2-jump job gets strictly more time than a 1-jump)", () => {
    const board = generateQuestBoard({
      systems,
      originSystemId: "A",
      planetId: "A_p1",
      day: 0,
      seed: "reach-grow",
      count: 60,
      textRatio: 0,
      eliteRatio: 0,
      chainRatio: 0,
    });
    const oneJump = board.filter(
      (q) => q.jumps === 1 && q.template.deadline > 0,
    );
    const twoJump = board.filter(
      (q) => q.jumps === 2 && q.template.deadline > 0,
    );
    expect(oneJump.length).toBeGreaterThan(0);
    expect(twoJump.length).toBeGreaterThan(0);
    const maxOne = Math.max(...oneJump.map((q) => q.template.deadline));
    const minTwo = Math.min(...twoJump.map((q) => q.template.deadline));
    expect(minTwo).toBeGreaterThan(maxOne);
  });
});

describe("QuestGenerator advertises the nav (undirected) jump distance", () => {
  it("advertised jumps == undirected warp-graph distance for every routine quest", () => {
    const systems = [sys("O", ["A"]), sys("A", ["T"]), sys("T", ["O"])];
    const navDist = jumpDistances(systems, "O", { undirected: true });

    let sawDifferingTarget = false;
    for (let s = 0; s < 8; s++) {
      const board = generateQuestBoard({
        systems,
        originSystemId: "O",
        planetId: "O_p1",
        day: s * 5,
        seed: `nav-${s}`,
        count: 30,
        textRatio: 0,
        eliteRatio: 0,
        chainRatio: 0,
      });
      for (const q of board) {
        if (q.template.deadline <= 0) continue; // local/text quests carry no jump
        const nav = navDist.get(q.targetSystemId);
        expect(nav).toBeDefined();
        expect(q.jumps).toBe(nav);
        if (q.targetSystemId === "T") {
          sawDifferingTarget = true;
          expect(q.jumps).toBe(1);
        }
      }
    }
    expect(sawDifferingTarget).toBe(true);
  });
});
