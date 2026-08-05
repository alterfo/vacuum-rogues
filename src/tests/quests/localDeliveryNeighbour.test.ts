import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import { generateQuestBoard } from "@/systems/quests/QuestGenerator";
import { QuestType } from "@/types";

function boardFor(system: StarSystem) {
  return generateQuestBoard({
    systems: [system],
    originSystemId: system.id,
    planetId: "ISO_p1", // the issuing planet
    day: 0,
    seed: "neighbour-seed",
    count: 6,
    textRatio: 0,
  });
}

describe("Местный подряд targets a neighbouring planet (≠ issuer)", () => {
  it("multi-planet system → targetPlanetId is a different planet (habitable neighbour preferred)", () => {
    const system = {
      id: "ISO",
      name: "Захолустье",
      connections: [],
      planets: [
        { id: "ISO_p1", name: "Столица", isHabitable: true },
        { id: "ISO_p2", name: "Луна", isHabitable: false },
        { id: "ISO_p3", name: "Колония", isHabitable: true },
      ],
    } as unknown as StarSystem;

    const locals = boardFor(system).filter(
      (q) => q.template.title === "Местный подряд",
    );
    expect(locals.length).toBeGreaterThan(0);

    for (const local of locals) {
      expect(local.targetPlanetId).not.toBe("ISO_p1");
      expect(local.targetPlanetId).toBe("ISO_p3");
      expect(local.jumps).toBe(0);
      expect(local.targetSystemId).toBe("ISO");
    }
  });

  it("only non-habitable neighbours → demotes to a text quest (no dead-end barren delivery) [Task 9]", () => {
    const system = {
      id: "ISO",
      name: "Захолустье",
      connections: [],
      planets: [
        { id: "ISO_p1", name: "Столица", isHabitable: true },
        { id: "ISO_p2", name: "Луна", isHabitable: false },
      ],
    } as unknown as StarSystem;

    const board = boardFor(system);
    expect(
      board.find((q) => q.template.title === "Местный подряд"),
    ).toBeUndefined();
    expect(board.length).toBeGreaterThan(0);
    for (const q of board) {
      expect(q.template.type).toBe(QuestType.TEXT_ADVENTURE);
    }
  });

  it("single-planet system → the slot is a text quest, not «Местный подряд»", () => {
    const single = {
      id: "ISO",
      name: "Захолустье",
      connections: [],
      planets: [{ id: "ISO_p1", name: "Столица", isHabitable: true }],
    } as unknown as StarSystem;

    const board = boardFor(single);

    expect(
      board.find((q) => q.template.title === "Местный подряд"),
    ).toBeUndefined();
    expect(board.length).toBeGreaterThan(0);
    for (const q of board) {
      expect(q.template.type).toBe(QuestType.TEXT_ADVENTURE);
    }
  });
});
