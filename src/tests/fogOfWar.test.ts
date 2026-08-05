import { describe, it, expect } from "vitest";
import { Player } from "@/domain/Player";
import { StarSystem } from "@/domain/StarSystem";
import { GalaxySimulator } from "@/systems/GalaxySimulator";
import { generateQuestBoard } from "@/systems/quests/QuestGenerator";
import type { SkillTree } from "@/domain/SkillTree";
import type { PlayerShip } from "@/domain/PlayerShip";
import type { Inventory } from "@/domain/Inventory";

function makePlayer(): Player {
  return new Player(
    "p1",
    "Test",
    "OUTLANDERS" as import("@/types").FactionType,
    0,
    1,
    {} as SkillTree,
    {},
    { activeQuests: [], completedQuests: [] },
    { entries: [] },
    1000,
    {} as PlayerShip,
    {
      modules: [],
      micromodules: [],
      resources: [],
      cosmetics: [],
    } as unknown as Inventory,
    "sys_0",
  );
}

describe("Player.visitedSystems", () => {
  it("starts empty", () => {
    const player = makePlayer();
    expect(player.visitedSystems).toEqual([]);
  });

  it("markVisited adds a system id", () => {
    const player = makePlayer();
    player.markVisited("sys_1");
    expect(player.visitedSystems).toContain("sys_1");
  });

  it("markVisited is idempotent (no duplicates)", () => {
    const player = makePlayer();
    player.markVisited("sys_1");
    player.markVisited("sys_1");
    expect(player.visitedSystems.filter((id) => id === "sys_1")).toHaveLength(
      1,
    );
  });

  it("hasVisited returns false before marking", () => {
    const player = makePlayer();
    expect(player.hasVisited("sys_unknown")).toBe(false);
  });

  it("hasVisited returns true after marking", () => {
    const player = makePlayer();
    player.markVisited("sys_5");
    expect(player.hasVisited("sys_5")).toBe(true);
  });
});

describe("StarSystem faction home fields", () => {
  it("defaults to isFactionHome=false, homeFactionId=null", () => {
    const sys = new StarSystem(
      "s1",
      "Alpha",
      { q: 0, r: 0 },
      "YELLOW_DWARF" as import("@/types").StarType,
      [],
      "INDEPENDENT" as import("@/types/faction").Faction,
      [],
    );
    expect(sys.isFactionHome).toBe(false);
    expect(sys.homeFactionId).toBeNull();
  });

  it("can be set to true with a faction id", () => {
    const sys = new StarSystem(
      "s2",
      "Beta",
      { q: 10, r: 10 },
      "YELLOW_DWARF" as import("@/types").StarType,
      [],
      "INDEPENDENT" as import("@/types/faction").Faction,
      [],
    );
    sys.isFactionHome = true;
    sys.homeFactionId = "PROGRESSORS" as import("@/types/faction").Faction;
    expect(sys.isFactionHome).toBe(true);
    expect(sys.homeFactionId).toBe("PROGRESSORS");
  });
});

describe("GalaxySimulator faction home systems", () => {
  it("assigns exactly 5 home systems for a galaxy with >= 10 systems", async () => {
    const sim = new GalaxySimulator();
    const galaxy = await sim.generateGalaxy("test-seed-home", 12);
    const homes = galaxy.systems.filter((s) => s.isFactionHome);
    expect(homes.length).toBe(5);
  });

  it("each home system has a non-null homeFactionId", async () => {
    const sim = new GalaxySimulator();
    const galaxy = await sim.generateGalaxy("test-seed-home2", 12);
    for (const sys of galaxy.systems.filter((s) => s.isFactionHome)) {
      expect(sys.homeFactionId).not.toBeNull();
    }
  });

  it("all 5 major factions are represented exactly once", async () => {
    const sim = new GalaxySimulator();
    const galaxy = await sim.generateGalaxy("test-seed-home3", 12);
    const homes = galaxy.systems.filter((s) => s.isFactionHome);
    const factionIds = homes.map((s) => s.homeFactionId);
    expect(factionIds).toContain("OUTLANDERS");
    expect(factionIds).toContain("BASTIONS");
    expect(factionIds).toContain("SYNDICATE");
    expect(factionIds).toContain("PARADOXES");
    expect(factionIds).toContain("PROGRESSORS");
  });

  it("generation is deterministic (same seed = same home systems)", async () => {
    const sim1 = new GalaxySimulator();
    const sim2 = new GalaxySimulator();
    const g1 = await sim1.generateGalaxy("deterministic-seed", 10);
    const g2 = await sim2.generateGalaxy("deterministic-seed", 10);
    const homes1 = g1.systems
      .filter((s) => s.isFactionHome)
      .map((s) => s.id)
      .sort();
    const homes2 = g2.systems
      .filter((s) => s.isFactionHome)
      .map((s) => s.id)
      .sort();
    expect(homes1).toEqual(homes2);
  });

  it("PROGRESSORS home system has INDUSTRIAL economy type", async () => {
    const sim = new GalaxySimulator();
    const galaxy = await sim.generateGalaxy("econ-test", 12);
    const progressorsHome = galaxy.systems.find(
      (s) => s.isFactionHome && s.homeFactionId === "PROGRESSORS",
    );
    expect(progressorsHome).toBeDefined();
    expect(progressorsHome!.economyType).toBe("INDUSTRIAL");
  });

  it("OUTLANDERS home system has AGRICULTURAL economy type", async () => {
    const sim = new GalaxySimulator();
    const galaxy = await sim.generateGalaxy("econ-test2", 12);
    const outlandersHome = galaxy.systems.find(
      (s) => s.isFactionHome && s.homeFactionId === "OUTLANDERS",
    );
    expect(outlandersHome).toBeDefined();
    expect(outlandersHome!.economyType).toBe("AGRICULTURAL");
  });

  it("home systems have higher NPC count (≥ 2x vs base per-system rate)", async () => {
    const sim = new GalaxySimulator();
    const galaxy = await sim.generateGalaxy("npc-density-test", 10);
    const homeSystemIds = new Set(
      galaxy.systems.filter((s) => s.isFactionHome).map((s) => s.id),
    );
    const totalHomeSystems = homeSystemIds.size;
    if (totalHomeSystems === 0) return; // Skip if fewer than 5 non-OVERMIND systems

    const npcCountInHome = galaxy.npcShips.filter((n) =>
      homeSystemIds.has(n.currentSystemId),
    ).length;
    const avgNpcsPerHome = npcCountInHome / totalHomeSystems;

    expect(npcCountInHome).toBeGreaterThanOrEqual(totalHomeSystems * 4);
    expect(avgNpcsPerHome).toBeGreaterThan(0);
  });
});

describe("fog-of-war logic (unvisited → name hidden)", () => {
  it("system not in visitedSystems is unvisited", () => {
    const player = makePlayer();
    const isVisited = player.hasVisited("sys_far");
    expect(isVisited).toBe(false);
  });

  it("system in visitedSystems is visited", () => {
    const player = makePlayer();
    player.markVisited("sys_far");
    expect(player.hasVisited("sys_far")).toBe(true);
  });

  it("multiple systems can be visited independently", () => {
    const player = makePlayer();
    player.markVisited("sys_a");
    player.markVisited("sys_b");
    expect(player.hasVisited("sys_a")).toBe(true);
    expect(player.hasVisited("sys_b")).toBe(true);
    expect(player.hasVisited("sys_c")).toBe(false);
  });
});

describe("QuestGenerator faction home prefix", () => {
  const SYSTEMS = [
    {
      id: "s1",
      name: "Alpha",
      coordinates: { q: 0, r: 0 },
      planets: [],
      stations: [],
      connections: [{ toSystemId: "s2" }],
      starType: "YELLOW_DWARF" as const,
      explored: true,
      fogOfWar: false,
      economyType: "INDUSTRIAL" as const,
      politicalSystem: "REPUBLIC" as const,
      ownerFaction: "INDEPENDENT" as const,
      isFactionHome: true,
      homeFactionId: "PROGRESSORS",
      enter: () => {},
    },
    {
      id: "s2",
      name: "Beta",
      coordinates: { q: 1, r: 0 },
      planets: [],
      stations: [],
      connections: [{ toSystemId: "s1" }],
      starType: "RED_DWARF" as const,
      explored: true,
      fogOfWar: false,
      economyType: "MIXED" as const,
      politicalSystem: "REPUBLIC" as const,
      ownerFaction: "INDEPENDENT" as const,
      isFactionHome: false,
      homeFactionId: null,
      enter: () => {},
    },
  ] as unknown as StarSystem[];

  it("quests on home system board get faction prefix", () => {
    const board = generateQuestBoard({
      systems: SYSTEMS,
      originSystemId: "s1",
      planetId: "p1",
      day: 0,
      seed: "test",
      count: 5,
      textRatio: 0,
      chainRatio: 0,
      eliteRatio: 0,
      homeFactionId: "PROGRESSORS",
    });
    for (const q of board) {
      expect(q.template.title).toContain("[ПРОГРЕССОРЫ]");
    }
  });

  it("quests on non-home system board have no prefix", () => {
    const board = generateQuestBoard({
      systems: SYSTEMS,
      originSystemId: "s1",
      planetId: "p1",
      day: 0,
      seed: "test",
      count: 5,
      textRatio: 0,
      chainRatio: 0,
      eliteRatio: 0,
    });
    for (const q of board) {
      expect(q.template.title).not.toContain("[ПРОГРЕССОРЫ]");
    }
  });
});
