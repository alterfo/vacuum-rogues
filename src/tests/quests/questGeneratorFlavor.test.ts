import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import { QuestType } from "@/types";
import {
  generateQuestBoard,
  type BoardOptions,
  type GeneratedQuest,
} from "@/systems/quests/QuestGenerator";

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

function routineOpts(over: Partial<BoardOptions> = {}): BoardOptions {
  return {
    systems: chainGalaxy(),
    originSystemId: "A",
    planetId: "A_p1",
    day: 0,
    seed: "galaxy-seed",
    textRatio: 0,
    eliteRatio: 0,
    chainRatio: 0,
    count: 8,
    ...over,
  };
}

function sampleRoutine(): GeneratedQuest[] {
  const out: GeneratedQuest[] = [];
  for (let s = 0; s < 4; s++) {
    for (let p = 0; p < 80; p++) {
      for (let d = 0; d < 3; d++) {
        const board = generateQuestBoard(
          routineOpts({
            seed: `flavor-seed-${s}`,
            planetId: `P${p}`,
            day: d * 5,
          }),
        );
        out.push(...board);
      }
    }
  }
  return out;
}

describe("QuestGenerator routine flavor variety", () => {
  it("stays deterministic for the same (seed, planet, day-bucket)", () => {
    const a = generateQuestBoard(routineOpts());
    const b = generateQuestBoard(routineOpts());
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("surfaces the newly added issuer titles per routine type", () => {
    const sample = sampleRoutine();
    const titlesByType = new Map<QuestType, Set<string>>();
    for (const q of sample) {
      const set = titlesByType.get(q.template.type) ?? new Set<string>();
      set.add(q.issuerTitle);
      titlesByType.set(q.template.type, set);
    }
    const wantNew: Array<[QuestType, string]> = [
      [QuestType.DELIVERY, "Логист"],
      [QuestType.BOUNTY, "Егерь"],
      [QuestType.ESCORT, "Обозный"],
      [QuestType.DIPLOMACY, "Эмиссар"],
      [QuestType.EXPLORATION, "Изыскатель"],
    ];
    for (const [type, title] of wantNew) {
      const titles = titlesByType.get(type) ?? new Set<string>();
      expect(
        titles.has(title),
        `expected new ${type} title "${title}" to be reachable`,
      ).toBe(true);
    }
  });

  it("surfaces the newly added flavor-text templates per routine type", () => {
    const descs = sampleRoutine().map((q) => q.template.description);
    const newFragments = [
      "Холодильник в трюме", // DELIVERY
      "крепкую ненависть", // BOUNTY
      "барахлит двигатель", // ESCORT
      "кивнуть нужным людям", // DIPLOMACY
      "Брошенная станция", // EXPLORATION
    ];
    for (const frag of newFragments) {
      expect(
        descs.some((d) => d.includes(frag)),
        `expected new flavor fragment "${frag}" to be reachable`,
      ).toBe(true);
    }
  });

  it("keeps the per-type structural invariants intact across all variety", () => {
    const sample = sampleRoutine();
    const nameOf: Record<string, string> = {
      B: "Бета",
      C: "Гамма",
      D: "Дельта",
    };
    for (const q of sample) {
      const d = q.template.description;
      expect(d.length).toBeGreaterThanOrEqual(50);
      switch (q.template.type) {
        case QuestType.DELIVERY:
          expect(d).toContain(nameOf[q.targetSystemId]);
          expect(d).toMatch(/\d+ ₢/);
          break;
        case QuestType.BOUNTY: {
          const ship = q.targetNpcName as string;
          const [body] = d.split("\nЦель:");
          expect(body).toContain(ship);
          break;
        }
        case QuestType.ESCORT:
          expect(d).toMatch(/Транспорт\s+«[^»]+»/);
          break;
        case QuestType.DIPLOMACY:
        case QuestType.EXPLORATION:
          expect(d).toContain(nameOf[q.targetSystemId]);
          expect(d).toMatch(/\d+ ₢/);
          break;
        default:
          break;
      }
    }
  });
});
