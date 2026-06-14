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
  } as unknown as StarSystem;
}

function twoSystemGalaxy(): StarSystem[] {
  return [sys("A", "Альфа", ["B"]), sys("B", "Бета", ["A"])];
}

function fullBoard(seed: string) {
  return generateQuestBoard({
    systems: twoSystemGalaxy(),
    originSystemId: "A",
    planetId: "A_p1",
    day: 0,
    seed,
    count: 30,
    textRatio: 0,
    eliteRatio: 0,
    chainRatio: 0,
  });
}

describe("GeneratedQuest highlights", () => {
  it("BOUNTY quest has highlights with label 'Цель' containing the ship name", () => {
    const board = fullBoard("hl-bounty-1");
    const bounty = board.find((q) => q.template.type === QuestType.BOUNTY);
    expect(bounty).toBeDefined();
    const shipName = bounty!.targetNpcName as string;
    const target = bounty!.highlights.find((h) => h.label === "Цель");
    expect(target).toBeDefined();
    expect(target!.value).toContain(shipName);
  });

  it("BOUNTY quest has highlight label 'Система' with the target system name", () => {
    const board = fullBoard("hl-bounty-2");
    const bounty = board.find((q) => q.template.type === QuestType.BOUNTY);
    expect(bounty).toBeDefined();
    const sysHighlight = bounty!.highlights.find((h) => h.label === "Система");
    expect(sysHighlight).toBeDefined();
    expect(sysHighlight!.value).toBe("Бета");
  });

  it("BOUNTY Цель highlight uses color 0xff6666", () => {
    const board = fullBoard("hl-bounty-3");
    const bounty = board.find((q) => q.template.type === QuestType.BOUNTY);
    expect(bounty).toBeDefined();
    const target = bounty!.highlights.find((h) => h.label === "Цель");
    expect(target).toBeDefined();
    expect(target!.color).toBe(0xff6666);
  });

  it("DELIVERY quest has highlight label 'Груз' with cargo description", () => {
    const board = fullBoard("hl-delivery-1");
    const delivery = board.find((q) => q.template.type === QuestType.DELIVERY);
    expect(delivery).toBeDefined();
    const cargoHighlight = delivery!.highlights.find((h) => h.label === "Груз");
    expect(cargoHighlight).toBeDefined();
    expect(cargoHighlight!.value.length).toBeGreaterThan(0);
  });

  it("DELIVERY quest has highlight label 'Система' with target system name", () => {
    const board = fullBoard("hl-delivery-2");
    const delivery = board.find((q) => q.template.type === QuestType.DELIVERY);
    expect(delivery).toBeDefined();
    const sysHighlight = delivery!.highlights.find(
      (h) => h.label === "Система",
    );
    expect(sysHighlight).toBeDefined();
    expect(sysHighlight!.value).toBe("Бета");
  });

  it("every quest has issuerPlanetId set to the origin planet", () => {
    const board = fullBoard("hl-issuer-1");
    for (const q of board) {
      expect(q.issuerPlanetId).toBe("A_p1");
    }
  });

  it("every quest has a non-empty highlights array", () => {
    const board = fullBoard("hl-nonempty-1");
    for (const q of board) {
      expect(q.highlights.length).toBeGreaterThan(0);
    }
  });

  it("every quest has a 'Выдан' highlight with the issuer planet", () => {
    const board = fullBoard("hl-issued-1");
    for (const q of board) {
      const issued = q.highlights.find((h) => h.label === "Выдан");
      expect(issued).toBeDefined();
      expect(issued!.value).toBe("A_p1");
    }
  });

  // Find the first quest of a given type across many seeds. Returns undefined
  // only if the generator never emits the type — which must FAIL the test rather
  // than pass silently (the old `if (!x) return` versions were vacuous).
  function findQuestOfType(type: QuestType, prefix: string) {
    for (let s = 0; s < 40; s++) {
      const board = fullBoard(`${prefix}-${s}`);
      const found = board.find((q) => q.template.type === type);
      if (found) return found;
    }
    return undefined;
  }

  it("ESCORT quest has a 'Конвой' highlight", () => {
    const escort = findQuestOfType(QuestType.ESCORT, "hl-escort");
    expect(escort).toBeDefined();
    const convoyHighlight = escort!.highlights.find(
      (h) => h.label === "Конвой",
    );
    expect(convoyHighlight).toBeDefined();
    expect(convoyHighlight!.value.length).toBeGreaterThan(0);
  });

  it("DIPLOMACY quest has a 'Планета' highlight", () => {
    const diplomacy = findQuestOfType(QuestType.DIPLOMACY, "hl-diplomacy");
    expect(diplomacy).toBeDefined();
    const planetHighlight = diplomacy!.highlights.find(
      (h) => h.label === "Планета",
    );
    expect(planetHighlight).toBeDefined();
  });

  it("EXPLORATION quest has a 'Система' highlight", () => {
    const explore = findQuestOfType(QuestType.EXPLORATION, "hl-explore");
    expect(explore).toBeDefined();
    const sysHighlight = explore!.highlights.find((h) => h.label === "Система");
    expect(sysHighlight).toBeDefined();
    expect(sysHighlight!.value).toBe("Бета");
  });
});
