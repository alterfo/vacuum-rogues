import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import { generateQuestBoard } from "@/systems/quests/QuestGenerator";
import { QuestType } from "@/types";

function isolatedSystem(): StarSystem {
  return {
    id: "ISO",
    name: "Захолустье",
    connections: [],
    planets: [
      { id: "ISO_p1", name: "Столица", isHabitable: true },
      { id: "ISO_p2", name: "Соседка", isHabitable: true },
    ],
  } as unknown as StarSystem;
}

describe("Местный подряд (local delivery) quest copy", () => {
  it("describes the real mechanic (buy on the market, deliver in-system) — not fictional orbital warehouses", () => {
    const board = generateQuestBoard({
      systems: [isolatedSystem()],
      originSystemId: "ISO",
      planetId: "ISO_p1",
      day: 0,
      seed: "seed",
      count: 5,
      textRatio: 0,
    });

    const local = board.find((q) => q.template.title === "Местный подряд");
    expect(local).toBeDefined();
    if (!local) return;

    const desc = local.template.description;
    expect(desc).not.toContain("орбитальн");
    expect(desc).not.toContain("развезти");
    expect(desc).toMatch(/рынк|закуп|купи/i);
    expect(desc).toContain("Захолустье");

    const collect = local.template.objectives.find(
      (o) => o.type === "COLLECT_ITEM",
    );
    expect(collect).toBeDefined();
    expect(collect!.targetAmount).toBeGreaterThanOrEqual(4);
    expect(local.jumps).toBe(0);
    expect(local.targetSystemId).toBe("ISO");
    expect(local.template.targetSystemId).toBe("ISO");

    expect(desc).toContain(String(collect!.targetAmount));
    const cargoHighlight = local.highlights.find((h) => h.label === "Груз");
    expect(cargoHighlight).toBeDefined();
    expect(desc).toContain(cargoHighlight!.value);

    expect(collect!.description).toContain(String(collect!.targetAmount));
  });

  it("names the in-system destination planet in the contract copy (no jumps)", () => {
    const system = {
      id: "ISO",
      name: "Захолустье",
      connections: [],
      planets: [
        { id: "ISO_p1", name: "Столица", isHabitable: true },
        { id: "ISO_p2", name: "Дальний Хутор", isHabitable: true },
      ],
    } as unknown as StarSystem;

    const board = generateQuestBoard({
      systems: [system],
      originSystemId: "ISO",
      planetId: "ISO_p1",
      day: 0,
      seed: "seed",
      count: 5,
      textRatio: 0,
    });

    const local = board.find((q) => q.template.title === "Местный подряд");
    expect(local).toBeDefined();
    if (!local) return;

    const desc = local.template.description;
    expect(desc).toContain("Дальний Хутор");
    expect(desc).toContain("без прыжков");
  });

  it("a system with exactly one habitable planet (+ a barren one) does NOT emit a local delivery — it falls back to a text quest", () => {
    const oneHabitable = {
      id: "ONE",
      name: "Одиночка",
      connections: [],
      planets: [
        { id: "ONE_p1", name: "Столица", isHabitable: true },
        { id: "ONE_p2", name: "Луна", isHabitable: false },
      ],
    } as unknown as StarSystem;

    const board = generateQuestBoard({
      systems: [oneHabitable],
      originSystemId: "ONE",
      planetId: "ONE_p1",
      day: 0,
      seed: "task9",
      count: 6,
      textRatio: 0,
    });

    expect(
      board.find((q) => q.template.title === "Местный подряд"),
    ).toBeUndefined();
    expect(board.length).toBeGreaterThan(0);
    for (const q of board) {
      expect(q.template.type).toBe(QuestType.TEXT_ADVENTURE);
    }
  });

  it("a system with ≥2 habitable planets DOES emit a local delivery", () => {
    const twoHabitable = {
      id: "TWO",
      name: "Двойняшки",
      connections: [],
      planets: [
        { id: "TWO_p1", name: "Столица", isHabitable: true },
        { id: "TWO_p2", name: "Колония", isHabitable: true },
        { id: "TWO_p3", name: "Луна", isHabitable: false },
      ],
    } as unknown as StarSystem;

    const board = generateQuestBoard({
      systems: [twoHabitable],
      originSystemId: "TWO",
      planetId: "TWO_p1",
      day: 0,
      seed: "task9",
      count: 6,
      textRatio: 0,
    });

    expect(
      board.find((q) => q.template.title === "Местный подряд"),
    ).toBeDefined();
  });

  it("when a local delivery IS generated, its destination is always habitable and ≠ the issuer planet (never barren)", () => {
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

    const board = generateQuestBoard({
      systems: [system],
      originSystemId: "ISO",
      planetId: "ISO_p1",
      day: 0,
      seed: "task9-dest",
      count: 6,
      textRatio: 0,
    });

    const locals = board.filter((q) => q.template.title === "Местный подряд");
    expect(locals.length).toBeGreaterThan(0);
    const habitableIds = new Set(
      system.planets.filter((p) => p.isHabitable).map((p) => p.id),
    );
    for (const local of locals) {
      expect(local.targetPlanetId).not.toBe("ISO_p1"); // not the issuer
      expect(local.targetPlanetId).not.toBe("ISO_p2"); // not the barren moon
      expect(habitableIds.has(local.targetPlanetId as string)).toBe(true);
    }
  });

  it("resolves a real SYSTEM id (origin's board system) even when origin is unknown — never a planet id", () => {
    const board = generateQuestBoard({
      systems: [isolatedSystem()],
      originSystemId: "GHOST_SYS",
      planetId: "ISO_p1",
      day: 0,
      seed: "seed",
      count: 5,
      textRatio: 0,
    });

    const local = board.find((q) => q.template.title === "Местный подряд");
    expect(local).toBeDefined();
    if (!local) return;

    expect(local.template.targetSystemId).toBe("GHOST_SYS");
    expect(local.targetSystemId).toBe("GHOST_SYS");
    expect(local.template.targetSystemId).not.toBe("ISO_p1");
  });
});
