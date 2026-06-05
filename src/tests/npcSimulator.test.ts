import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { WarpPath } from "@/domain/WarpPath";
import { Overmind } from "@/domain/Overmind";
import { NpcSimulator, npcsPresentInSystem } from "@/systems/npc/NpcSimulator";
import { NpcShip } from "@/domain/NpcShip";
import { MigrationPipeline } from "@/data/MigrationPipeline";
import { SeededRNG } from "@/utils/seededRNG";
import { StarType, NpcState, NpcRole, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import type { SaveState } from "@/domain/SaveState";

function makeNpc(
  id: string,
  systemId: string,
  state: NpcState,
  role: NpcRole = NpcRole.RANGER,
  hullHP = 100,
  damage = 20,
): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role,
    hullHP,
    maxHull: hullHP,
    shields: 50,
    speed: 0.1,
    damage,
    currentSystemId: systemId,
    state,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

function makeSingleSystemGalaxy(): Galaxy {
  const sys = new StarSystem(
    "sys_x",
    "X",
    { q: 0, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
  );
  return new Galaxy("galaxy_combat", [sys], new Overmind(), [], []);
}

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
  return new Galaxy("galaxy_test", [sysA, sysB], new Overmind(), [], []);
}

describe("NpcSimulator", () => {
  it("spawns a population sized to the number of systems", () => {
    const galaxy = makeGalaxy();
    new NpcSimulator().spawnInitial(galaxy, new SeededRNG("seed"));

    // round(2 systems * 4 per system) = 8
    expect(galaxy.npcShips).toHaveLength(8);
    const systemIds = new Set(galaxy.systems.map((s) => s.id));
    for (const npc of galaxy.npcShips) {
      expect(systemIds.has(npc.currentSystemId)).toBe(true);
      expect(npc.state).toBe(NpcState.IDLE);
    }
  });

  it("spawns deterministically for the same seed", () => {
    const a = makeGalaxy();
    const b = makeGalaxy();
    new NpcSimulator().spawnInitial(a, new SeededRNG("same"));
    new NpcSimulator().spawnInitial(b, new SeededRNG("same"));

    const shape = (g: Galaxy) =>
      g.npcShips.map((n) => `${n.id}:${n.role}:${n.race}:${n.currentSystemId}`);
    expect(shape(a)).toEqual(shape(b));
  });

  it("moves an idle NPC between systems over several days", () => {
    const galaxy = makeGalaxy();
    const sim = new NpcSimulator();
    sim.spawnInitial(galaxy, new SeededRNG("seed"));
    const rng = new SeededRNG("ticks");
    const npc = galaxy.npcShips[0];
    const origin = npc.currentSystemId;

    // First tick: idle NPC picks a goal and departs.
    sim.tick(galaxy, rng);
    expect(npc.state).toBe(NpcState.TRAVELING);
    expect(npc.destinationSystemId).not.toBe(origin);
    expect(npc.daysToArrival).toBeGreaterThan(0);

    const destination = npc.destinationSystemId!;
    const days = npc.daysToArrival;

    // Advancing the remaining days lands the NPC in the destination system.
    for (let i = 0; i < days; i++) sim.tick(galaxy, rng);
    expect(npc.currentSystemId).toBe(destination);
    expect(npc.state).not.toBe(NpcState.TRAVELING);
  });

  it("lists only present (non-traveling, non-dead) NPCs in a system", () => {
    const galaxy = makeGalaxy();
    galaxy.npcShips.push(
      makeNpc("here_idle", "sys_a", NpcState.IDLE),
      makeNpc("here_trading", "sys_a", NpcState.TRADING),
      makeNpc("here_traveling", "sys_a", NpcState.TRAVELING),
      makeNpc("here_dead", "sys_a", NpcState.DEAD),
      makeNpc("elsewhere", "sys_b", NpcState.IDLE),
    );

    const present = npcsPresentInSystem(galaxy, "sys_a").map((n) => n.id);
    expect(present.sort()).toEqual(["here_idle", "here_trading"]);
  });

  describe("off-screen combat", () => {
    it("a pirate destroys a co-located victim away from the player", () => {
      const galaxy = makeSingleSystemGalaxy();
      const pirate = makeNpc(
        "pirate",
        "sys_x",
        NpcState.IDLE,
        NpcRole.PIRATE,
        110,
        30,
      );
      const victim = makeNpc(
        "victim",
        "sys_x",
        NpcState.IDLE,
        NpcRole.TRADER,
        100,
        10,
      );
      galaxy.npcShips.push(pirate, victim);

      const sim = new NpcSimulator();
      const rng = new SeededRNG("combat");
      for (let i = 0; i < 40 && victim.state !== NpcState.DEAD; i++) {
        sim.tick(galaxy, rng, "player_elsewhere");
      }

      expect(victim.state).toBe(NpcState.DEAD);
      expect(victim.hullHP).toBe(0);
    });

    it("does not fight in the player's own system (visible ships)", () => {
      const galaxy = makeSingleSystemGalaxy();
      const victim = makeNpc(
        "victim",
        "sys_x",
        NpcState.PATROLLING,
        NpcRole.TRADER,
        100,
        10,
      );
      galaxy.npcShips.push(
        makeNpc(
          "pirate",
          "sys_x",
          NpcState.PATROLLING,
          NpcRole.PIRATE,
          110,
          30,
        ),
        victim,
      );

      const sim = new NpcSimulator();
      const rng = new SeededRNG("safe");
      for (let i = 0; i < 10; i++) sim.tick(galaxy, rng, "sys_x");

      expect(victim.hullHP).toBe(100);
    });

    it("replenishes the population after losses", () => {
      const galaxy = makeSingleSystemGalaxy();
      galaxy.npcShips.push(
        makeNpc("pirate", "sys_x", NpcState.IDLE, NpcRole.PIRATE, 110, 30),
        makeNpc("victim", "sys_x", NpcState.IDLE, NpcRole.TRADER, 30, 5),
      );

      const sim = new NpcSimulator();
      const rng = new SeededRNG("replenish");
      for (let i = 0; i < 40; i++) sim.tick(galaxy, rng, "elsewhere");

      // round(1 system * 4) = 4 ships maintained despite losses
      expect(galaxy.npcShips.length).toBe(4);
    });
  });
});

describe("MigrationPipeline v1 -> v2", () => {
  it("adds an empty npcShips array to pre-NPC saves", () => {
    const state = {
      version: 1,
      galaxy: { id: "g", gameDays: 0, systems: [] },
      player: {},
      persistentDialogs: [],
      timestamp: 0,
    } as unknown as SaveState;

    MigrationPipeline.migrate(state);

    expect(state.version).toBe(MigrationPipeline.CURRENT_VERSION);
    expect(
      Array.isArray(
        (state.galaxy as unknown as { npcShips: unknown[] }).npcShips,
      ),
    ).toBe(true);
  });
});
