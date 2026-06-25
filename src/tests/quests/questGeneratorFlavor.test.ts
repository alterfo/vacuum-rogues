import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import { QuestType } from "@/types";
import {
  generateQuestBoard,
  type BoardOptions,
  type GeneratedQuest,
} from "@/systems/quests/QuestGenerator";

/**
 * Task 3 ("widen procedural quest flavor"): the routine ROUTINE_TYPES board must
 * read distinctly across repeated quests — more issuer titles + more flavor-text
 * templates — while staying fully deterministic for a fixed (seed, planet, day).
 * This suite asserts the *added* flavor is reachable and that no new variety
 * broke determinism or the per-type structural invariants other tests rely on.
 */

/** Minimal star-system stub (same shape the generator reads). */
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

/** A linear chain A—B—C—D (origin A): B=1 jump, C=2, D=3. */
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
    // Routine-only board: no text-quests / elites / chains, so every slot runs
    // the real per-type flavor functions we're widening.
    textRatio: 0,
    eliteRatio: 0,
    chainRatio: 0,
    count: 8,
    ...over,
  };
}

/** Sweep many deterministic boards across planet/day/seed → flat routine list. */
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
    // One distinctive *new* title from each routine type's widened pool.
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
    // A distinctive substring unique to one *new* template per routine type.
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
      // Every routine description stays substantial.
      expect(d.length).toBeGreaterThanOrEqual(50);
      switch (q.template.type) {
        case QuestType.DELIVERY:
          // Mentions destination system name + a credit reward.
          expect(d).toContain(nameOf[q.targetSystemId]);
          expect(d).toMatch(/\d+ ₢/);
          break;
        case QuestType.BOUNTY: {
          // Template body (before the appended "Цель:" line) names the ship.
          const ship = q.targetNpcName as string;
          const [body] = d.split("\nЦель:");
          expect(body).toContain(ship);
          break;
        }
        case QuestType.ESCORT:
          // Names a "Транспорт «…»" convoy.
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
