import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { WarpPath } from "@/domain/WarpPath";
import { NpcShip } from "@/domain/NpcShip";
import { NpcSimulator } from "@/systems/npc/NpcSimulator";
import { SeededRNG } from "@/utils/seededRNG";
import { StarType, NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";

/** sys_a ←→ sys_b, two-system chain. */
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
  return new Galaxy("galaxy_lib_detect", [sysA, sysB], new Overmind(), [], []);
}

/** A parked RANGER NPC — counts toward the wandering population, never as a
 *  garrison ship (faction != OVERMIND, role != PIRATE). */
function makeRanger(id: string, systemId: string): NpcShip {
  return new NpcShip({
    id,
    name: `Ranger ${id}`,
    race: FactionType.BASTIONS,
    faction: Faction.INDEPENDENT,
    role: NpcRole.RANGER,
    hullHP: 120,
    maxHull: 120,
    shields: 60,
    speed: 0.1,
    damage: 25,
    currentSystemId: systemId,
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

/** A live OVERMIND ship present in a system (a re-entering invader). */
function makeOvermind(id: string, systemId: string): NpcShip {
  return new NpcShip({
    id,
    name: `Жнец ${id}`,
    race: FactionType.PARADOXES,
    faction: Faction.OVERMIND,
    role: NpcRole.OVERMIND,
    hullHP: 140,
    maxHull: 140,
    shields: 70,
    speed: 0.1,
    damage: 30,
    currentSystemId: systemId,
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

/** Pad the wandering population up to the replenish target so tick() spawns no
 *  random pirates — a stray PIRATE-role ship landing in sys_a would otherwise
 *  read as garrison and falsely reset the liberation countdown. */
function padWanderers(galaxy: Galaxy): void {
  const target = galaxy.systems.length * 4; // NPCS_PER_SYSTEM
  for (let i = 0; i < target; i++) {
    galaxy.npcShips.push(makeRanger(`pad_${i}`, "sys_b"));
  }
}

/** Spawn then immediately destroy the standing garrison, leaving sys_a hostile
 *  with zero live garrison ships (the post-combat state). */
function wipeGarrison(galaxy: Galaxy, sim: NpcSimulator, seed: string): void {
  sim.ensureGarrison(galaxy, new SeededRNG(seed));
  for (const n of galaxy.npcShips) {
    if (n.faction === Faction.OVERMIND || n.role === NpcRole.PIRATE) {
      n.state = NpcState.DEAD;
    }
  }
}

describe("NpcSimulator liberation detection", () => {
  it("liberates a hostile system after 3 ticks with no garrison present", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    padWanderers(galaxy);

    const sim = new NpcSimulator();
    wipeGarrison(galaxy, sim, "establish");
    expect(galaxy.isHostileSystem("sys_a")).toBe(true);

    for (let i = 0; i < 3; i++) {
      sim.tick(galaxy, new SeededRNG(`lib_detect_${i}`));
    }

    expect(galaxy.isHostileSystem("sys_a")).toBe(false);
    expect(
      galaxy.newsFeed.some(
        (e) => e.type === "SYSTEM_LIBERATED" && e.systemId === "sys_a",
      ),
    ).toBe(true);
  });

  it("does not liberate before the 3-day countdown elapses", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    padWanderers(galaxy);

    const sim = new NpcSimulator();
    wipeGarrison(galaxy, sim, "establish_early");

    // Two clear days is not enough — liberation only fires on the third.
    sim.tick(galaxy, new SeededRNG("early_0"));
    sim.tick(galaxy, new SeededRNG("early_1"));
    expect(galaxy.isHostileSystem("sys_a")).toBe(true);
  });

  it("resets the countdown when a hostile ship re-enters mid-countdown", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    padWanderers(galaxy);

    const sim = new NpcSimulator();
    wipeGarrison(galaxy, sim, "establish_reset");

    // Two clear days (countdown one short of liberating).
    sim.tick(galaxy, new SeededRNG("reset_0"));
    sim.tick(galaxy, new SeededRNG("reset_1"));
    expect(galaxy.isHostileSystem("sys_a")).toBe(true);

    // A fresh invader arrives → presence resets the countdown.
    galaxy.npcShips.push(makeOvermind("reinforce_1", "sys_a"));
    sim.tick(galaxy, new SeededRNG("reset_2"));
    // Without the reset this third clear tick would have liberated; it didn't.
    expect(galaxy.isHostileSystem("sys_a")).toBe(true);
  });

  it("keeps an intact garrison's system hostile (no spurious liberation)", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    padWanderers(galaxy);

    const sim = new NpcSimulator();
    for (let i = 0; i < 5; i++) {
      sim.tick(galaxy, new SeededRNG(`intact_${i}`));
    }
    expect(galaxy.isHostileSystem("sys_a")).toBe(true);
  });
});
