import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { WarpPath } from "@/domain/WarpPath";
import { NpcSimulator, npcsPresentInSystem } from "@/systems/npc/NpcSimulator";
import { SeededRNG } from "@/utils/seededRNG";
import { StarType, NpcRole, NpcState } from "@/types";
import { Faction } from "@/types/faction";

function makeGalaxy(): Galaxy {
  const sysA = new StarSystem(
    "sys_a",
    "Alpha",
    { q: 0, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
  );
  const sysB = new StarSystem(
    "sys_b",
    "Beta",
    { q: 10, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
  );
  sysA.connections.push(new WarpPath("sys_a", "sys_b", 3));
  sysB.connections.push(new WarpPath("sys_b", "sys_a", 3));
  return new Galaxy("galaxy_garrison", [sysA, sysB], new Overmind(), [], []);
}

describe("NpcSimulator.ensureGarrison", () => {
  it("garrisons an Overmind system with 5-10 hostile-role ships", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");

    const sim = new NpcSimulator();
    sim.ensureGarrison(galaxy, new SeededRNG("garrison_seed"));

    const present = npcsPresentInSystem(galaxy, "sys_a");
    const hostile = present.filter(
      (n) => n.faction === Faction.OVERMIND || n.role === NpcRole.PIRATE,
    );
    expect(hostile.length).toBeGreaterThanOrEqual(5);
    expect(hostile.length).toBeLessThanOrEqual(10);
  });

  it("spawns Overmind garrison ships of the correct faction and role", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");

    const sim = new NpcSimulator();
    sim.ensureGarrison(galaxy, new SeededRNG("ov_seed"));

    const present = npcsPresentInSystem(galaxy, "sys_a");
    expect(present.length).toBeGreaterThan(0);
    for (const ship of present) {
      expect(ship.faction).toBe(Faction.OVERMIND);
      expect(ship.role).toBe(NpcRole.PATROL);
      expect(ship.state).not.toBe(NpcState.DEAD);
    }
  });

  it("garrisons a pirate system with PIRATE-role ships", () => {
    const galaxy = makeGalaxy();
    galaxy.addPirateSystem("sys_b");

    const sim = new NpcSimulator();
    sim.ensureGarrison(galaxy, new SeededRNG("pi_seed"));

    const present = npcsPresentInSystem(galaxy, "sys_b");
    const hostile = present.filter((n) => n.role === NpcRole.PIRATE);
    expect(hostile.length).toBeGreaterThanOrEqual(5);
    expect(hostile.length).toBeLessThanOrEqual(10);
    for (const ship of hostile) {
      expect(ship.role).toBe(NpcRole.PIRATE);
    }
  });

  it("does not over-spawn once the minimum garrison is met (idempotent)", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");

    const sim = new NpcSimulator();
    sim.ensureGarrison(galaxy, new SeededRNG("idem_seed"));
    const afterFirst = npcsPresentInSystem(galaxy, "sys_a").length;

    sim.ensureGarrison(galaxy, new SeededRNG("idem_seed_2"));
    const afterSecond = npcsPresentInSystem(galaxy, "sys_a").length;

    expect(afterSecond).toBe(afterFirst);
  });

  it("leaves friendly systems ungarrisoned", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");

    const sim = new NpcSimulator();
    sim.ensureGarrison(galaxy, new SeededRNG("friendly_seed"));

    expect(npcsPresentInSystem(galaxy, "sys_b")).toHaveLength(0);
  });

  it("tick() keeps hostile systems garrisoned", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");

    const sim = new NpcSimulator();
    sim.tick(galaxy, new SeededRNG("tick_seed"));

    // The captured system holds a full hostile garrison (Overmind PATROL ships,
    // plus any wandering pirate that happens to be co-located counts as hostile).
    const hostile = npcsPresentInSystem(galaxy, "sys_a").filter(
      (n) => n.faction === Faction.OVERMIND || n.role === NpcRole.PIRATE,
    );
    expect(hostile.length).toBeGreaterThanOrEqual(5);
  });
});
