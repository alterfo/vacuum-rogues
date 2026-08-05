import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import { QuestType } from "@/types";
import { generateQuestBoard } from "@/systems/quests/QuestGenerator";

function sys(id: string, name: string, toIds: string[]): StarSystem {
  return {
    id,
    name,
    connections: toIds.map((t) => ({
      fromSystemId: id,
      toSystemId: t,
      fuelCost: 5,
    })),
    planets: [{ id: `${id}_p1`, isHabitable: true }],
  } as unknown as StarSystem;
}

const TWO_SYSTEM_GALAXY = [sys("A", "Альфа", ["B"]), sys("B", "Бета", ["A"])];

describe("ESCORT quest details (Task 5)", () => {
  it("ESCORT quest description contains a convoy ship identifier", () => {
    const board = generateQuestBoard({
      systems: TWO_SYSTEM_GALAXY,
      originSystemId: "A",
      planetId: "A_p1",
      day: 0,
      seed: "escort-desc-test",
      count: 80,
      textRatio: 0,
    });
    const escorts = board.filter((q) => q.template.type === QuestType.ESCORT);
    expect(escorts.length).toBeGreaterThan(0);
    for (const q of escorts) {
      expect(q.template.description).toMatch(/Транспорт\s+«[^»]+»/);
    }
  });

  it("ESCORT objective type is VISIT_SYSTEM, not VISIT_LOCATION", () => {
    const board = generateQuestBoard({
      systems: TWO_SYSTEM_GALAXY,
      originSystemId: "A",
      planetId: "A_p1",
      day: 0,
      seed: "escort-obj-test",
      count: 80,
      textRatio: 0,
    });
    const escorts = board.filter((q) => q.template.type === QuestType.ESCORT);
    expect(escorts.length).toBeGreaterThan(0);
    for (const q of escorts) {
      const escortObj = q.template.objectives.find((o) =>
        o.id.includes("escort"),
      );
      expect(escortObj).toBeDefined();
      expect(escortObj!.type).toBe("VISIT_SYSTEM");
      expect(escortObj!.targetSystemId).toBe(q.targetSystemId);
      expect(escortObj!.locationId).toBeUndefined();
    }
  });
});
