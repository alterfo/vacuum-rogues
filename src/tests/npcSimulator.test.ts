import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Planet } from "@/domain/Planet";
import { Market } from "@/domain/Market";
import { WarpPath } from "@/domain/WarpPath";
import { Overmind } from "@/domain/Overmind";
import { NpcSimulator, npcsPresentInSystem } from "@/systems/npc/NpcSimulator";
import { NpcShip } from "@/domain/NpcShip";
import { MigrationPipeline } from "@/data/MigrationPipeline";
import { SeededRNG } from "@/utils/seededRNG";
import {
  StarType,
  NpcState,
  NpcRole,
  NpcGoalKind,
  FactionType,
  ResourceType,
  PlanetType,
} from "@/types";
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

describe("NPC trader cargo", () => {
  function makeMarket(resources: ResourceType[], supply?: number[]): Market {
    return new Market(
      resources,
      resources.map(() => 1.0),
      supply ?? resources.map(() => 1.0),
    );
  }

  function makeSystemWithMarket(id: string, supply?: number[]): StarSystem {
    const market = makeMarket(
      [ResourceType.METALS, ResourceType.CRYSTALS, ResourceType.ORGANICS],
      supply,
    );
    const planet = new Planet(
      `planet_${id}`,
      `Planet ${id}`,
      PlanetType.TERRESTRIAL,
      800,
      market,
      [],
      [],
    );
    return new StarSystem(
      id,
      id.toUpperCase(),
      { q: 0, r: 0 },
      StarType.YELLOW_DWARF,
      [planet],
      Faction.INDEPENDENT,
      [],
    );
  }

  it("trader NPCs are spawned with cargo", () => {
    // Use 10 systems (40 NPCs) to make it near-certain at least one trader spawns.
    const systems = Array.from({ length: 10 }, (_, i) =>
      makeSystemWithMarket(`sys_t${i}`),
    );
    const galaxy = new Galaxy("g", systems, new Overmind(), [], []);
    new NpcSimulator().spawnInitial(galaxy, new SeededRNG("cargo_seed"));

    const traders = galaxy.npcShips.filter((n) => n.role === NpcRole.TRADER);
    expect(traders.length).toBeGreaterThan(0);
    for (const trader of traders) {
      expect(trader.cargo).toBeDefined();
      expect(trader.cargo.length).toBeGreaterThan(0);
      for (const item of trader.cargo) {
        expect(item.qty).toBeGreaterThanOrEqual(5);
        expect(item.qty).toBeLessThanOrEqual(20);
        expect(item.goodId.length).toBeGreaterThan(0);
      }
    }
  });

  it("non-trader NPCs spawn with empty cargo", () => {
    const sys = makeSystemWithMarket("sys_nt");
    const galaxy = new Galaxy("g", [sys], new Overmind(), [], []);
    new NpcSimulator().spawnInitial(galaxy, new SeededRNG("no_cargo"));

    const nonTraders = galaxy.npcShips.filter((n) => n.role !== NpcRole.TRADER);
    for (const npc of nonTraders) {
      expect(npc.cargo).toHaveLength(0);
    }
  });

  it("trader cargo increases supply of sold goods after arrival", () => {
    // sysB has CRYSTALS at high supply (price ≈ 20) and METALS at normal supply
    // (price ≈ 100). When the trader sells METALS and then buys goods, it will
    // prefer cheap CRYSTALS — leaving METALS supply higher than the initial value.
    const sysA = makeSystemWithMarket("sys_a2");
    const sysB = makeSystemWithMarket("sys_b2", [1.0, 5.0, 5.0]);
    sysA.connections.push(new WarpPath("sys_a2", "sys_b2", 2));
    sysB.connections.push(new WarpPath("sys_b2", "sys_a2", 2));
    const galaxy = new Galaxy("g2", [sysA, sysB], new Overmind(), [], []);

    const market = sysB.planets[0].market;
    const metalsIdx = market.availableResources.indexOf(ResourceType.METALS);
    const initialMetalsSupply = market.supplyVector[metalsIdx]; // 1.0

    // Large qty (50) so sell adds 1.0 to supply; even if buyer buys the same
    // good at max qty (20), net METALS supply is 2.0 - 0.4 = 1.6 > 1.0 initial.
    const trader = new NpcShip({
      id: "trader1",
      name: "Trader",
      race: FactionType.OUTLANDERS,
      faction: Faction.INDEPENDENT,
      role: NpcRole.TRADER,
      hullHP: 100,
      maxHull: 100,
      shields: 30,
      speed: 0.08,
      damage: 10,
      currentSystemId: "sys_a2",
      state: NpcState.TRAVELING,
      goal: { kind: NpcGoalKind.TRADE, targetSystemId: "sys_b2" },
      destinationSystemId: "sys_b2",
      daysToArrival: 1,
      credits: 500,
      reputation: 0,
      cargo: [{ goodId: ResourceType.METALS, qty: 50 }],
    });
    galaxy.npcShips.push(trader);

    new NpcSimulator().tick(galaxy, new SeededRNG("trade_tick"));

    // Sell adds 50*0.02=1.0; worst-case buy-back of 20 units removes only 0.4.
    expect(market.supplyVector[metalsIdx]).toBeGreaterThan(initialMetalsSupply);
  });

  it("price decreases when supply increases after NPC sells cargo", () => {
    // Market with CRYSTALS at high supply so buyer prefers CRYSTALS.
    const sys = makeSystemWithMarket("sys_price", [1.0, 5.0, 5.0]);
    const galaxy = new Galaxy("g3", [sys], new Overmind(), [], []);

    const market = sys.planets[0].market;
    const metalsIdx = market.availableResources.indexOf(ResourceType.METALS);
    const priceBefore = market.getPrice(ResourceType.METALS);

    // Large qty so sell effect (qty*0.02=1.0) dominates any buy-back.
    const trader = new NpcShip({
      id: "t2",
      name: "Trader2",
      race: FactionType.OUTLANDERS,
      faction: Faction.INDEPENDENT,
      role: NpcRole.TRADER,
      hullHP: 100,
      maxHull: 100,
      shields: 30,
      speed: 0.08,
      damage: 10,
      currentSystemId: "sys_price",
      state: NpcState.TRAVELING,
      goal: { kind: NpcGoalKind.TRADE, targetSystemId: "sys_price" },
      destinationSystemId: "sys_price",
      daysToArrival: 1,
      credits: 500,
      reputation: 0,
      cargo: [{ goodId: ResourceType.METALS, qty: 50 }],
    });
    galaxy.npcShips.push(trader);

    new NpcSimulator().tick(galaxy, new SeededRNG("price_check"));

    const priceAfter = market.getPrice(ResourceType.METALS);
    expect(market.supplyVector[metalsIdx]).toBeGreaterThan(1.0);
    expect(priceAfter).toBeLessThan(priceBefore);
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
