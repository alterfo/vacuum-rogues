import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { Overmind } from "@/domain/Overmind";
import type { StarSystem } from "@/domain/StarSystem";

function makeGalaxy(coreId: string): Galaxy {
  const systems: StarSystem[] = ["sys_0", "sys_1"].map((id, i) => ({
    id,
    name: id,
    coordinates: { q: i, r: 0 },
    planets: [],
    stations: [],
    connections: [],
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
    "g_core_guard",
    systems,
    new Overmind(),
    [],
    [],
    ["sys_0", "sys_1"],
    coreId,
  );
}

describe("Galaxy.tryLiberate — the Overmind core falls only to the player", () => {
  it("an NPC-sourced liberation of the core system is refused (the arc seed survives NPC churn)", () => {
    const galaxy = makeGalaxy("sys_0");
    expect(galaxy.tryLiberate("sys_0")).toBe(false);
    expect(galaxy.tryLiberate("sys_0", "npc")).toBe(false);
    expect(galaxy.isOvermindSystem("sys_0")).toBe(true);
  });

  it("a player-sourced liberation of the core still succeeds and counts", () => {
    const galaxy = makeGalaxy("sys_0");
    expect(galaxy.tryLiberate("sys_0", "player")).toBe(true);
    expect(galaxy.isOvermindSystem("sys_0")).toBe(false);
    expect(galaxy.overmindArc.playerLiberations).toBe(1);
  });

  it("NPC liberation of a NON-core system is unaffected", () => {
    const galaxy = makeGalaxy("sys_0");
    expect(galaxy.tryLiberate("sys_1", "npc")).toBe(true);
    expect(galaxy.isOvermindSystem("sys_1")).toBe(false);
  });
});
