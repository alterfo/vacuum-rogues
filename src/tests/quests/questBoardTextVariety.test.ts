import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import { QuestType } from "@/types";
import {
  generateQuestBoard,
  questKey,
  __questDescPickers,
  type BoardOptions,
  type GeneratedQuest,
} from "@/systems/quests/QuestGenerator";
import { SeededRNG } from "@/utils/seededRNG";

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

function chainGalaxy(): StarSystem[] {
  return [
    sys("A", "Альфа", ["B"]),
    sys("B", "Бета", ["A", "C"]),
    sys("C", "Гамма", ["B", "D"]),
    sys("D", "Дельта", ["C"]),
  ];
}

function frontierGalaxy(): StarSystem[] {
  return [
    sys("s0", "Хаб", ["s1"]),
    sys("s1", "Рубеж", ["s0", "s2"]),
    sys("s2", "Гнездо", ["s1"]),
  ];
}

function routineOpts(over: Partial<BoardOptions> = {}): BoardOptions {
  return {
    systems: chainGalaxy(),
    originSystemId: "A",
    planetId: "A_p1",
    day: 0,
    seed: "variety-seed",
    textRatio: 0,
    eliteRatio: 0,
    chainRatio: 0,
    count: 8,
    ...over,
  };
}

function assertNoBrokenInterpolation(desc: string): void {
  expect(desc).not.toContain("undefined");
  expect(desc).not.toContain("NaN");
  expect(desc).not.toContain("${"); // literal template token leaked through
  expect(desc).not.toContain("«»"); // empty-string interpolation inside guillemets
  expect(desc.trim().length).toBeGreaterThanOrEqual(40);
}

function sampleRoutine(): GeneratedQuest[] {
  const out: GeneratedQuest[] = [];
  for (let s = 0; s < 4; s++) {
    for (let p = 0; p < 60; p++) {
      for (let d = 0; d < 3; d++) {
        out.push(
          ...generateQuestBoard(
            routineOpts({
              seed: `variety-${s}`,
              planetId: `P${p}`,
              day: d * 5,
            }),
          ),
        );
      }
    }
  }
  return out;
}

describe("QuestGenerator board text variety (Task 16)", () => {
  it("offers ≥ 4 distinct phrasing variants per QuestType picker", () => {
    for (const [name, pick] of Object.entries(__questDescPickers)) {
      const seen = new Set<string>();
      for (let i = 0; i < 400; i++) {
        const desc = pick(new SeededRNG(`variant|${name}|${i}`));
        assertNoBrokenInterpolation(desc);
        seen.add(desc);
      }
      expect(
        seen.size,
        `expected ≥ 4 distinct ${name} phrasings, saw ${seen.size}`,
      ).toBeGreaterThanOrEqual(4);
    }
  });

  it("renders each picker deterministically for a fixed seed", () => {
    for (const [name, pick] of Object.entries(__questDescPickers)) {
      const a = pick(new SeededRNG(`det|${name}`));
      const b = pick(new SeededRNG(`det|${name}`));
      expect(a).toEqual(b);
    }
  });

  it("threads a credit reward into every routine + defense description", () => {
    const routine = sampleRoutine();
    expect(routine.length).toBeGreaterThan(0);
    for (const q of routine) {
      assertNoBrokenInterpolation(q.template.description);
      expect(q.template.description).toMatch(/\d+ ₢/);
    }
  });

  it("threads the target system name into every routine description", () => {
    const nameOf: Record<string, string> = {
      B: "Бета",
      C: "Гамма",
      D: "Дельта",
    };
    for (const q of sampleRoutine()) {
      const body = q.template.description.split("\nЦель:")[0];
      expect(body).toContain(nameOf[q.targetSystemId]);
    }
  });

  it("gives DEFENSE quests ≥ 4 distinct phrasings across seeds", () => {
    const descs = new Set<string>();
    for (let s = 0; s < 80; s++) {
      const board = generateQuestBoard({
        systems: frontierGalaxy(),
        originSystemId: "s0",
        planetId: "p0",
        day: 0,
        seed: `defense-${s}`,
        count: 3,
        textRatio: 0,
        eliteRatio: 0,
        chainRatio: 0,
        overmindSystems: ["s2"],
        overmindAdjacentSystems: ["s1"],
      });
      const def = board.find((q) => q.template.type === QuestType.DEFENSE);
      expect(def, `seed ${s} should inject a DEFENSE quest`).toBeDefined();
      const desc = def!.template.description;
      assertNoBrokenInterpolation(desc);
      expect(desc).toContain("Рубеж"); // target frontier system name threaded
      expect(desc).toMatch(/\d+ ₢/);
      descs.add(desc);
    }
    expect(
      descs.size,
      `expected ≥ 4 distinct DEFENSE phrasings, saw ${descs.size}`,
    ).toBeGreaterThanOrEqual(4);
  });

  it("stays byte-identical for the same (seed, planet, day)", () => {
    const a = generateQuestBoard(routineOpts());
    const b = generateQuestBoard(routineOpts());
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("keeps board dedupe intact — no duplicate quest keys on a board", () => {
    for (let p = 0; p < 40; p++) {
      const board = generateQuestBoard(
        routineOpts({ planetId: `D${p}`, excludeKeys: [] }),
      );
      const keys = board.map(questKey);
      expect(new Set(keys).size, `board D${p} had duplicate keys`).toBe(
        keys.length,
      );
    }
  });

  it("excludes the player's active quests from a refreshed board", () => {
    const first = generateQuestBoard(routineOpts({ excludeKeys: [] }));
    const excludeKeys = first.map(questKey);
    const second = generateQuestBoard(routineOpts({ excludeKeys }));
    const overlap = second.map(questKey).filter((k) => excludeKeys.includes(k));
    expect(overlap).toEqual([]);
  });
});
