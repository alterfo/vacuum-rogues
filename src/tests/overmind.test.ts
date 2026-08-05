import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { Overmind } from "@/domain/Overmind";
import { generateQuestBoard } from "@/systems/quests/QuestGenerator";
import type { StarSystem } from "@/domain/StarSystem";
import { QuestType } from "@/types";

function makeGalaxy(systemCount = 6): Galaxy {
  const systems: StarSystem[] = Array.from({ length: systemCount }, (_, i) => ({
    id: `sys_${i}`,
    name: `System ${i}`,
    coordinates: { q: i, r: 0 },
    planets: [],
    stations: [],
    connections:
      i < systemCount - 1
        ? [{ toSystemId: `sys_${i + 1}` }]
        : [{ toSystemId: `sys_${i - 1}` }],
    starType: "YELLOW_DWARF" as const,
    explored: true,
    fogOfWar: false,
    economyType: "MIXED" as const,
    politicalSystem: "REPUBLIC" as const,
    ownerFaction: "INDEPENDENT" as const,
    enter: () => {},
    lastVisitedDay: undefined,
  })) as unknown as StarSystem[];

  return new Galaxy(
    "g_test",
    systems,
    new Overmind(),
    [],
    [],
    [], // no OVERMIND systems initially
    "sys_5", // core = last system
  );
}

describe("Galaxy.isOvermindSystem / addOvermindSystem", () => {
  it("returns false for a system not in overmindSystems", () => {
    const galaxy = makeGalaxy();
    expect(galaxy.isOvermindSystem("sys_0")).toBe(false);
  });

  it("returns true after adding a system", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_0");
    expect(galaxy.isOvermindSystem("sys_0")).toBe(true);
  });

  it("addOvermindSystem is idempotent", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_0");
    galaxy.addOvermindSystem("sys_0");
    expect(galaxy.overmindSystems.length).toBe(1);
  });
});

describe("Galaxy.removeOvermindSystem", () => {
  it("removes a system from OVERMIND control", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_2");
    galaxy.removeOvermindSystem("sys_2");
    expect(galaxy.isOvermindSystem("sys_2")).toBe(false);
  });

  it("is a no-op for a non-controlled system", () => {
    const galaxy = makeGalaxy();
    expect(() => galaxy.removeOvermindSystem("sys_99")).not.toThrow();
  });
});

describe("Galaxy.isOvermindMajority", () => {
  it("returns false when OVERMIND controls ≤50%", () => {
    const galaxy = makeGalaxy(6); // 6 systems
    galaxy.addOvermindSystem("sys_0");
    galaxy.addOvermindSystem("sys_1");
    galaxy.addOvermindSystem("sys_2"); // 3/6 = exactly 50%
    expect(galaxy.isOvermindMajority()).toBe(false);
  });

  it("returns true when OVERMIND controls >50%", () => {
    const galaxy = makeGalaxy(6);
    galaxy.addOvermindSystem("sys_0");
    galaxy.addOvermindSystem("sys_1");
    galaxy.addOvermindSystem("sys_2");
    galaxy.addOvermindSystem("sys_3"); // 4/6 > 50%
    expect(galaxy.isOvermindMajority()).toBe(true);
  });
});

describe("Galaxy.getOvermindAdjacentSystems", () => {
  it("returns systems connected to an OVERMIND system but not themselves OVERMIND", () => {
    const galaxy = makeGalaxy(4);
    galaxy.addOvermindSystem("sys_0");
    const adjacent = galaxy.getOvermindAdjacentSystems();
    expect(adjacent.map((s) => s.id)).toContain("sys_1");
    expect(adjacent.map((s) => s.id)).not.toContain("sys_0");
  });

  it("excludes the player's current system from expansion targets", () => {
    const galaxy = makeGalaxy(4);
    galaxy.addOvermindSystem("sys_0");
    const adjacent = galaxy.getOvermindAdjacentSystems("sys_1");
    expect(adjacent.map((s) => s.id)).not.toContain("sys_1");
  });

  it("returns empty when no adjacent non-OVERMIND systems exist", () => {
    const galaxy = makeGalaxy(2);
    galaxy.addOvermindSystem("sys_0");
    galaxy.addOvermindSystem("sys_1");
    expect(galaxy.getOvermindAdjacentSystems()).toHaveLength(0);
  });
});

const SYSTEMS: StarSystem[] = [
  {
    id: "s0",
    name: "Alpha",
    coordinates: { q: 0, r: 0 },
    planets: [],
    stations: [],
    connections: [{ toSystemId: "s1" }],
    starType: "YELLOW_DWARF" as const,
    explored: true,
    fogOfWar: false,
    economyType: "MIXED" as const,
    politicalSystem: "REPUBLIC" as const,
    ownerFaction: "INDEPENDENT" as const,
    enter: () => {},
    lastVisitedDay: undefined,
  },
  {
    id: "s1",
    name: "Beta",
    coordinates: { q: 1, r: 0 },
    planets: [],
    stations: [],
    connections: [{ toSystemId: "s0" }, { toSystemId: "s2" }],
    starType: "RED_DWARF" as const,
    explored: true,
    fogOfWar: false,
    economyType: "MIXED" as const,
    politicalSystem: "REPUBLIC" as const,
    ownerFaction: "INDEPENDENT" as const,
    enter: () => {},
    lastVisitedDay: undefined,
  },
  {
    id: "s2",
    name: "Gamma",
    coordinates: { q: 2, r: 0 },
    planets: [],
    stations: [],
    connections: [{ toSystemId: "s1" }],
    starType: "BLUE_GIANT" as const,
    explored: true,
    fogOfWar: false,
    economyType: "MIXED" as const,
    politicalSystem: "REPUBLIC" as const,
    ownerFaction: "INDEPENDENT" as const,
    enter: () => {},
    lastVisitedDay: undefined,
  },
] as unknown as StarSystem[];

describe("QuestGenerator DEFENSE quests", () => {
  it("injects a DEFENSE quest when overmindAdjacentSystems is non-empty", () => {
    const board = generateQuestBoard({
      systems: SYSTEMS,
      originSystemId: "s0",
      planetId: "p0",
      day: 0,
      seed: "test",
      count: 3,
      textRatio: 0,
      chainRatio: 0,
      eliteRatio: 0,
      overmindSystems: ["s2"],
      overmindAdjacentSystems: ["s1"], // s1 is adjacent to OVERMIND s2
    });

    const defenseQuests = board.filter(
      (q) => q.template.type === QuestType.DEFENSE,
    );
    expect(defenseQuests.length).toBe(1);
    expect(defenseQuests[0].targetSystemId).toBe("s1");
    expect(defenseQuests[0].template.targetObjectId).toBe("s2");
  });

  it("does not inject a DEFENSE quest when overmindAdjacentSystems is empty", () => {
    const board = generateQuestBoard({
      systems: SYSTEMS,
      originSystemId: "s0",
      planetId: "p0",
      day: 0,
      seed: "test",
      count: 3,
      textRatio: 0,
      chainRatio: 0,
      eliteRatio: 0,
      overmindSystems: [],
      overmindAdjacentSystems: [],
    });

    const defenseQuests = board.filter(
      (q) => q.template.type === QuestType.DEFENSE,
    );
    expect(defenseQuests.length).toBe(0);
  });

  it("DEFENSE quest has non-zero reward and a deadline", () => {
    const board = generateQuestBoard({
      systems: SYSTEMS,
      originSystemId: "s0",
      planetId: "p0",
      day: 0,
      seed: "test",
      count: 3,
      textRatio: 0,
      chainRatio: 0,
      eliteRatio: 0,
      overmindSystems: ["s2"],
      overmindAdjacentSystems: ["s1"],
    });

    const defQuest = board.find((q) => q.template.type === QuestType.DEFENSE);
    expect(defQuest).toBeDefined();
    expect(defQuest!.template.reward.credits).toBeGreaterThan(0);
    expect(defQuest!.template.deadline).toBeGreaterThan(0);
  });
});
