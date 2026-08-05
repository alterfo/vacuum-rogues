import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { Overmind } from "@/domain/Overmind";
import type { StarSystem } from "@/domain/StarSystem";

function makeGalaxy(): Galaxy {
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
  return new Galaxy("g_test", systems, new Overmind(), [], [], ["sys_0"], "");
}

describe("Galaxy.tryLiberate source tracking", () => {
  it("defaults to 'npc' — does not increment playerLiberations", () => {
    const galaxy = makeGalaxy();
    expect(galaxy.tryLiberate("sys_0")).toBe(true);
    expect(galaxy.overmindArc.playerLiberations ?? 0).toBe(0);
  });

  it("an explicit 'npc' source does not increment playerLiberations", () => {
    const galaxy = makeGalaxy();
    expect(galaxy.tryLiberate("sys_0", "npc")).toBe(true);
    expect(galaxy.overmindArc.playerLiberations ?? 0).toBe(0);
  });

  it("a 'player' source liberating an Overmind system increments playerLiberations", () => {
    const galaxy = makeGalaxy();
    expect(galaxy.tryLiberate("sys_0", "player")).toBe(true);
    expect(galaxy.overmindArc.playerLiberations).toBe(1);
  });

  it("multiple player liberations accumulate", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_1");
    galaxy.tryLiberate("sys_0", "player");
    galaxy.tryLiberate("sys_1", "player");
    expect(galaxy.overmindArc.playerLiberations).toBe(2);
  });

  it("a 'player' source liberating a PIRATE system does not touch playerLiberations", () => {
    const galaxy = makeGalaxy();
    galaxy.removeOvermindSystem("sys_0");
    galaxy.addPirateSystem("sys_0");
    expect(galaxy.tryLiberate("sys_0", "player")).toBe(true);
    expect(galaxy.overmindArc.playerLiberations ?? 0).toBe(0);
  });

  it("a no-op liberation (already faction-controlled) returns false regardless of source", () => {
    const galaxy = makeGalaxy();
    galaxy.removeOvermindSystem("sys_0");
    expect(galaxy.tryLiberate("sys_0", "player")).toBe(false);
    expect(galaxy.overmindArc.playerLiberations ?? 0).toBe(0);
  });

  it("still emits the SYSTEM_LIBERATED news event regardless of source", () => {
    const galaxy = makeGalaxy();
    galaxy.tryLiberate("sys_0", "player");
    expect(galaxy.newsFeed.some((e) => e.type === "SYSTEM_LIBERATED")).toBe(
      true,
    );
  });
});
