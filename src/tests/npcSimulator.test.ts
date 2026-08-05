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
import type { NewsEvent } from "@/types";
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

    expect(galaxy.npcShips).toHaveLength(8);
    const systemIds = new Set(galaxy.systems.map((s) => s.id));
    for (const npc of galaxy.npcShips) {
      expect(systemIds.has(npc.currentSystemId)).toBe(true);
      expect(npc.state).toBe(NpcState.PATROLLING);
    }
  });

  it("does not mass-depart the freshly spawned population on the first tick (playtest2 ②)", () => {
    const galaxy = makeGalaxy();
    const sim = new NpcSimulator();
    sim.spawnInitial(galaxy, new SeededRNG("dwell_seed"));
    const total = galaxy.npcShips.length;
    expect(total).toBeGreaterThan(0);

    sim.tick(galaxy, new SeededRNG("dwell_tick"));

    const traveling = galaxy.npcShips.filter(
      (n) => n.state === NpcState.TRAVELING,
    ).length;
    expect(traveling / total).toBeLessThan(0.5);
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
    npc.state = NpcState.IDLE;
    const origin = npc.currentSystemId;

    sim.tick(galaxy, rng);
    expect(npc.state).toBe(NpcState.TRAVELING);
    expect(npc.destinationSystemId).not.toBe(origin);
    expect(npc.daysToArrival).toBeGreaterThan(0);

    const destination = npc.destinationSystemId!;
    const days = npc.daysToArrival;

    for (let i = 0; i < days; i++) sim.tick(galaxy, rng);
    expect(npc.currentSystemId).toBe(destination);
    expect(npc.state).not.toBe(NpcState.TRAVELING);
  });

  it("a freshly arrived NPC does not depart the day after arrival (flyby regression)", () => {
    const galaxy = makeGalaxy();
    const sim = new NpcSimulator();

    const arrivalIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      const id = `arr_${i}`;
      arrivalIds.push(id);
      const npc = makeNpc(id, "sys_b", NpcState.TRAVELING);
      npc.destinationSystemId = "sys_a";
      npc.daysToArrival = 1;
      galaxy.npcShips.push(npc);
    }

    sim.tick(galaxy, new SeededRNG("arr_t1"));
    const justArrived = arrivalIds.map(
      (id) => galaxy.npcShips.find((n) => n.id === id)!,
    );
    expect(
      justArrived.every(
        (n) => n.currentSystemId === "sys_a" && n.state !== NpcState.TRAVELING,
      ),
    ).toBe(true);

    sim.tick(galaxy, new SeededRNG("arr_t2"));
    const departedDay1 = justArrived.filter(
      (n) => n.state === NpcState.TRAVELING,
    );
    expect(departedDay1).toHaveLength(0);
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
    const sysA = makeSystemWithMarket("sys_a2");
    const sysB = makeSystemWithMarket("sys_b2", [1.0, 5.0, 5.0]);
    sysA.connections.push(new WarpPath("sys_a2", "sys_b2", 2));
    sysB.connections.push(new WarpPath("sys_b2", "sys_a2", 2));
    const galaxy = new Galaxy("g2", [sysA, sysB], new Overmind(), [], []);

    const market = sysB.planets[0].market;
    const metalsIdx = market.availableResources.indexOf(ResourceType.METALS);
    const initialMetalsSupply = market.supplyVector[metalsIdx]; // 1.0

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

    expect(market.supplyVector[metalsIdx]).toBeGreaterThan(initialMetalsSupply);
  });

  it("price decreases when supply increases after NPC sells cargo", () => {
    const sys = makeSystemWithMarket("sys_price", [1.0, 5.0, 5.0]);
    const galaxy = new Galaxy("g3", [sys], new Overmind(), [], []);

    const market = sys.planets[0].market;
    const metalsIdx = market.availableResources.indexOf(ResourceType.METALS);
    const priceBefore = market.getPrice(ResourceType.METALS);

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

describe("NPC off-screen questing (Task 13)", () => {
  function makeGalaxy2(): Galaxy {
    const sysA = new StarSystem(
      "sys_q_a",
      "QAlpha",
      { q: 0, r: 0 },
      StarType.YELLOW_DWARF,
      [],
      Faction.INDEPENDENT,
      [],
    );
    const sysB = new StarSystem(
      "sys_q_b",
      "QBeta",
      { q: 5, r: 0 },
      StarType.YELLOW_DWARF,
      [],
      Faction.INDEPENDENT,
      [],
    );
    sysA.connections.push(new WarpPath("sys_q_a", "sys_q_b", 1));
    sysB.connections.push(new WarpPath("sys_q_b", "sys_q_a", 1));
    return new Galaxy("galaxy_quest", [sysA, sysB], new Overmind(), [], []);
  }

  it("ranger quest completion emits NPC_QUEST_COMPLETE news event", () => {
    const galaxy = makeGalaxy2();
    const ranger = new NpcShip({
      id: "ranger1",
      name: "Ranger",
      race: FactionType.OUTLANDERS,
      faction: Faction.INDEPENDENT,
      role: NpcRole.RANGER,
      hullHP: 120,
      maxHull: 120,
      shields: 60,
      speed: 0.1,
      damage: 25,
      currentSystemId: "sys_q_a",
      state: NpcState.TRAVELING,
      goal: { kind: NpcGoalKind.QUEST, targetSystemId: "sys_q_b" },
      destinationSystemId: "sys_q_b",
      daysToArrival: 1,
      credits: 200,
      reputation: 0,
      activeQuestTarget: "sys_q_b",
    });
    galaxy.npcShips.push(ranger);

    const sim = new NpcSimulator();
    const events = sim.tick(galaxy, new SeededRNG("quest_test"));

    expect(ranger.currentSystemId).toBe("sys_q_b");
    const questEvent = events.find((e) => e.type === "NPC_QUEST_COMPLETE");
    expect(questEvent).toBeDefined();
    expect(questEvent!.npcId).toBe("ranger1");
    expect(questEvent!.systemId).toBe("sys_q_b");
    expect(ranger.reputation).toBe(10);
    expect(ranger.activeQuestTarget).toBeNull();
  });

  it("pirate cargo raid clears trader cargo and emits PIRATE_ATTACK event", () => {
    const galaxy = new Galaxy(
      "g_raid",
      [
        new StarSystem(
          "sys_raid",
          "Raid",
          { q: 0, r: 0 },
          StarType.YELLOW_DWARF,
          [],
          Faction.INDEPENDENT,
          [],
        ),
      ],
      new Overmind(),
      [],
      [],
    );

    const trader = new NpcShip({
      id: "trader_raid",
      name: "Trader",
      race: FactionType.OUTLANDERS,
      faction: Faction.INDEPENDENT,
      role: NpcRole.TRADER,
      hullHP: 100,
      maxHull: 100,
      shields: 30,
      speed: 0.08,
      damage: 10,
      currentSystemId: "sys_raid",
      state: NpcState.PATROLLING,
      goal: null,
      destinationSystemId: null,
      daysToArrival: 0,
      credits: 200,
      reputation: 0,
      cargo: [{ goodId: ResourceType.METALS, qty: 10 }],
    });
    const pirate = new NpcShip({
      id: "pirate_raid",
      name: "Pirate",
      race: FactionType.OUTLANDERS,
      faction: Faction.INDEPENDENT,
      role: NpcRole.PIRATE,
      hullHP: 110,
      maxHull: 110,
      shields: 40,
      speed: 0.12,
      damage: 30,
      currentSystemId: "sys_raid",
      state: NpcState.PATROLLING,
      goal: null,
      destinationSystemId: null,
      daysToArrival: 0,
      credits: 100,
      reputation: 0,
    });
    const pad1 = new NpcShip({
      id: "pad1",
      name: "Pad1",
      race: FactionType.OUTLANDERS,
      faction: Faction.INDEPENDENT,
      role: NpcRole.RANGER,
      hullHP: 100,
      maxHull: 100,
      shields: 50,
      speed: 0.1,
      damage: 20,
      currentSystemId: "sys_raid",
      state: NpcState.PATROLLING,
      goal: null,
      destinationSystemId: null,
      daysToArrival: 0,
      credits: 0,
      reputation: 0,
    });
    const pad2 = new NpcShip({
      id: "pad2",
      name: "Pad2",
      race: FactionType.OUTLANDERS,
      faction: Faction.INDEPENDENT,
      role: NpcRole.RANGER,
      hullHP: 100,
      maxHull: 100,
      shields: 50,
      speed: 0.1,
      damage: 20,
      currentSystemId: "sys_raid",
      state: NpcState.PATROLLING,
      goal: null,
      destinationSystemId: null,
      daysToArrival: 0,
      credits: 0,
      reputation: 0,
    });
    galaxy.npcShips.push(trader, pirate, pad1, pad2);

    const sim = new NpcSimulator();
    let raidEvents: NewsEvent[] = [];
    for (let i = 0; i < 200 && trader.cargo.length > 0; i++) {
      const evts = sim.tick(galaxy, new SeededRNG(`raidC_${i}`), "elsewhere");
      const hits = evts.filter((e) => e.type === "PIRATE_ATTACK");
      if (hits.length > 0) raidEvents = hits;
    }

    expect(raidEvents.length).toBeGreaterThan(0);
    expect(raidEvents[0].systemId).toBe("sys_raid");
    expect(trader.cargo).toHaveLength(0);
  });

  it("migration 6→7 adds newsFeed and activeQuestTarget to old saves", () => {
    const state = {
      version: 6,
      galaxy: {
        id: "g",
        gameDays: 0,
        systems: [],
        npcShips: [{ id: "n1", role: "RANGER" }],
      },
      player: {},
      persistentDialogs: [],
      timestamp: 0,
    } as unknown as SaveState;

    MigrationPipeline.migrate(state);

    const galaxy = state.galaxy as unknown as {
      newsFeed: unknown[];
      npcShips: Array<{ activeQuestTarget: unknown }>;
    };
    expect(Array.isArray(galaxy.newsFeed)).toBe(true);
    expect(galaxy.npcShips[0].activeQuestTarget).toBeNull();
  });
});
