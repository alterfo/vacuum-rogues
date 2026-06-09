import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import { QuestType } from "@/types";
import {
  generateQuestBoard,
  governorOfferLine,
  QUEST_TEXT_RATIO,
  type BoardOptions,
  type GeneratedQuest,
} from "@/systems/quests/QuestGenerator";

/**
 * Minimal star-system stub. The generator only reads id/name/connections/
 * planets[].{id,isHabitable}, so we avoid constructing real Markets etc.
 */
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

/** A linear chain A—B—C—D (origin A): B=1 jump, C=2, D=3. */
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

describe("QuestGenerator", () => {
  it("is deterministic for the same (seed, planet, day-bucket)", () => {
    const a = generateQuestBoard(baseOpts());
    const b = generateQuestBoard(baseOpts());
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("produces the requested number of quests", () => {
    expect(generateQuestBoard(baseOpts({ count: 5 }))).toHaveLength(5);
    expect(generateQuestBoard(baseOpts({ count: 8 }))).toHaveLength(8);
  });

  it("refreshes the board on a new day-bucket but is stable within one", () => {
    const day0 = generateQuestBoard(baseOpts({ day: 0 }));
    const day3 = generateQuestBoard(baseOpts({ day: 3 })); // same 5-day bucket
    const day7 = generateQuestBoard(baseOpts({ day: 7 })); // next bucket
    expect(JSON.stringify(day0)).toEqual(JSON.stringify(day3));
    expect(JSON.stringify(day0)).not.toEqual(JSON.stringify(day7));
  });

  it("sends routine quests to OTHER systems with correct jump distance", () => {
    const dist: Record<string, number> = { B: 1, C: 2, D: 3 };
    // Force routine-only by disabling text-quests.
    const board = generateQuestBoard(baseOpts({ count: 40, textRatio: 0 }));
    for (const q of board) {
      expect(q.targetSystemId).not.toEqual("A"); // galaxy reach (US-082)
      expect(q.jumps).toEqual(dist[q.targetSystemId]);
      expect(q.jumps).toBeGreaterThanOrEqual(1);
    }
  });

  it("scales reward with distance (farther pays more on average)", () => {
    const board = generateQuestBoard(baseOpts({ count: 200, textRatio: 0 }));
    const near = board
      .filter((q) => q.jumps === 1)
      .map((q) => q.template.reward.credits);
    const far = board
      .filter((q) => q.jumps === 3)
      .map((q) => q.template.reward.credits);
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(near.length).toBeGreaterThan(0);
    expect(far.length).toBeGreaterThan(0);
    expect(avg(far)).toBeGreaterThan(avg(near));
  });

  it("gives timed routine quests a positive deadline and reward", () => {
    const board = generateQuestBoard(baseOpts({ count: 40, textRatio: 0 }));
    for (const q of board) {
      expect(q.template.reward.credits).toBeGreaterThan(0);
      expect(q.template.deadline).toBeGreaterThan(0); // jumps>=1 → has a deadline
    }
  });

  it("mixes in text-quests at roughly the configured ratio (~1 in 5)", () => {
    let text = 0;
    let total = 0;
    // Vary planet/day to sample many independent boards.
    for (let p = 0; p < 60; p++) {
      for (let d = 0; d < 5; d++) {
        const board = generateQuestBoard(
          baseOpts({ planetId: `P${p}`, day: d * 5, count: 5 }),
        );
        for (const q of board) {
          total++;
          if (q.template.type === QuestType.TEXT_ADVENTURE) text++;
        }
      }
    }
    const ratio = text / total;
    expect(total).toBeGreaterThan(1000);
    expect(ratio).toBeGreaterThan(QUEST_TEXT_RATIO - 0.06);
    expect(ratio).toBeLessThan(QUEST_TEXT_RATIO + 0.06);
  });

  it("falls back to local quests when no other system is reachable", () => {
    const lone = [sys("A", "Альфа", [])]; // isolated origin
    const board = generateQuestBoard(baseOpts({ systems: lone, count: 5 }));
    for (const q of board) {
      expect(q.jumps).toEqual(0);
      expect(q.targetSystemId).toEqual("A");
    }
  });

  it("text-quests are local and have no deadline", () => {
    // textRatio=1 → every slot is a text-quest.
    const board = generateQuestBoard(baseOpts({ count: 6, textRatio: 1 }));
    for (const q of board) {
      expect(q.template.type).toEqual(QuestType.TEXT_ADVENTURE);
      expect(q.jumps).toEqual(0);
      expect(q.template.deadline).toEqual(0);
    }
  });

  it("all generated quests have a non-empty description", () => {
    const board = generateQuestBoard(baseOpts({ count: 40, textRatio: 0 }));
    for (const q of board) {
      expect(q.template.description).toBeTruthy();
      expect(q.template.description.length).toBeGreaterThan(10);
    }
  });

  it("every quest type produces a description of at least 50 characters", () => {
    const byType = new Map<QuestType, string[]>();
    const record = (board: GeneratedQuest[]): void => {
      for (const q of board) {
        const arr = byType.get(q.template.type) ?? [];
        arr.push(q.template.description);
        byType.set(q.template.type, arr);
      }
    };

    // Routine types (DELIVERY/BOUNTY/ESCORT/DIPLOMACY/EXPLORATION) over many slots.
    record(
      generateQuestBoard(
        baseOpts({ count: 200, textRatio: 0, eliteRatio: 0, chainRatio: 0 }),
      ),
    );
    // Text adventures.
    record(generateQuestBoard(baseOpts({ count: 10, textRatio: 1 })));
    // Local delivery (isolated origin → jumps=0 fallback).
    record(
      generateQuestBoard(
        baseOpts({ systems: [sys("A", "Альфа", [])], count: 5 }),
      ),
    );
    // DEFENSE quest (OVERMIND adjacent to a contestable system).
    const omGalaxy = [
      sys("A", "Альфа", ["B"]),
      sys("B", "Бета", ["A", "O"]),
      sys("O", "Овермайнд", ["B"]),
    ];
    record(
      generateQuestBoard(
        baseOpts({
          systems: omGalaxy,
          overmindSystems: ["O"],
          overmindAdjacentSystems: ["B"],
          count: 5,
        }),
      ),
    );

    const wantTypes = [
      QuestType.DELIVERY,
      QuestType.BOUNTY,
      QuestType.ESCORT,
      QuestType.DIPLOMACY,
      QuestType.EXPLORATION,
      QuestType.TEXT_ADVENTURE,
      QuestType.DEFENSE,
    ];
    for (const t of wantTypes) {
      const descs = byType.get(t) ?? [];
      expect(descs.length, `expected at least one ${t} quest`).toBeGreaterThan(
        0,
      );
      for (const d of descs) {
        expect(
          d.length,
          `${t} description too short: "${d}"`,
        ).toBeGreaterThanOrEqual(50);
      }
    }
  });

  it("every quest carries an issuer name and a fitting title", () => {
    const board = generateQuestBoard(baseOpts({ count: 40, textRatio: 0 }));
    for (const q of board) {
      expect(q.issuerName).toBeTruthy();
      expect(q.issuerTitle).toBeTruthy();
    }
  });

  it("governorOfferLine frames the quest as a first-person dialogue offer", () => {
    const board = generateQuestBoard(baseOpts({ count: 10, textRatio: 0 }));
    const q = board[0];
    const line = governorOfferLine(q);
    expect(line).toContain(q.issuerName);
    expect(line).toContain(q.issuerTitle);
    expect(line).toContain(q.template.description);
  });

  it("delivery descriptions mention target system name and reward", () => {
    const board = generateQuestBoard(
      baseOpts({ count: 40, textRatio: 0, eliteRatio: 0, chainRatio: 0 }),
    );
    const deliveries = board.filter(
      (q) => q.template.type === QuestType.DELIVERY,
    );
    expect(deliveries.length).toBeGreaterThan(0);
    for (const q of deliveries) {
      expect(q.template.description).toContain(
        q.targetSystemId === "B"
          ? "Бета"
          : q.targetSystemId === "C"
            ? "Гамма"
            : "Дельта",
      );
      expect(q.template.description).toMatch(/\d+ ₢/);
    }
  });
});
