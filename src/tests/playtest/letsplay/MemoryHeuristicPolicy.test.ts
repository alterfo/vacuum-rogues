import { describe, it, expect } from "vitest";
import { SceneType, ResourceType, FactionType, StationType } from "@/types";
import {
  legalActionsForScene,
  type Observation,
  type PlayerSnapshot,
  type SystemSnapshot,
  type CurrentPlanetSnapshot,
  type MarketGoodSnapshot,
  type NpcSnapshot,
  type QuestSnapshot,
} from "./observe";
import {
  createMemory,
  type AgentMemory,
  type PriceRecord,
} from "./AgentMemory";
import {
  MemoryHeuristicPolicy,
  decideWithMemory,
  BATTLE_READY_HULL_FRACTION,
} from "./MemoryHeuristicPolicy";

/**
 * Task 4 of the partial-observability plan: the memory-using heuristic teacher.
 *
 * The decision core {@link decideWithMemory} is **pure** — it reads an
 * {@link Observation} + an {@link AgentMemory} belief state and returns one legal
 * action — so the human-like, multi-step behaviours (buy-low@A, sell-for-profit@B,
 * route around a remembered-dangerous system, defer an unaffordable upgrade) are
 * tested in isolation over hand-built fixtures, exactly the scripted A/B/C
 * scenario the plan calls for. A second block exercises the stateful
 * {@link MemoryHeuristicPolicy} adapter: belief accumulates step over step and a
 * `reset()` starts the per-run notebook fresh.
 */

const M = ResourceType.METALS;

function playerFixture(over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    credits: 1000,
    hull: 100,
    maxHull: 100,
    hullFraction: 1,
    fuel: 50,
    maxFuel: 50,
    fuelFraction: 1,
    cargo: [],
    cargoUsed: 0,
    cargoCapacity: 20,
    systemId: "sysA",
    position: null,
    ...over,
  };
}

function landed(
  id: string,
  market: MarketGoodSnapshot[] = [],
  availableQuests = 0,
): CurrentPlanetSnapshot {
  return { id, name: id, availableQuests, market };
}

function hostile(id = "raider-1", hullHP = 80): NpcSnapshot {
  return {
    id,
    name: id,
    faction: FactionType.SYNDICATE,
    hostile: true,
    hullHP,
  };
}

interface ObsOpts {
  scene?: SceneType;
  player?: Partial<PlayerSnapshot>;
  planets?: { id: string; name: string; availableQuests: number }[];
  stations?: { id: string; name: string; type: StationType }[];
  connections?: number;
  currentPlanet?: CurrentPlanetSnapshot | null;
  hostiles?: NpcSnapshot[];
  quests?: QuestSnapshot[];
}

/**
 * Build a self-consistent observation whose `legalActions` come from the same
 * pure `legalActionsForScene` the real `observe` uses — so a policy decision over
 * a synthetic obs is filtered against the exact legal set the engine would emit.
 */
function obs(opts: ObsOpts = {}): Observation {
  const scene = opts.scene ?? SceneType.SPACE_FLIGHT;
  const planets = opts.planets ?? [];
  const stations = opts.stations ?? [];
  const connections = opts.connections ?? 0;
  const hostiles = opts.hostiles ?? [];
  const currentPlanet = opts.currentPlanet ?? null;

  const system: SystemSnapshot = {
    id: "sysA",
    name: "A",
    planets,
    stations,
    connections,
  };

  const availableQuestCount =
    currentPlanet?.availableQuests ??
    planets.reduce((max, p) => Math.max(max, p.availableQuests), 0);

  const legalActions = legalActionsForScene(scene, {
    hasPlayer: true,
    planetCount: planets.length,
    stationCount: stations.length,
    hostileCount: hostiles.length,
    connectionCount: connections,
    availableQuestCount,
  });

  return {
    scene,
    hasPlayer: true,
    player: playerFixture(opts.player),
    system,
    currentPlanet,
    npcs: hostiles,
    hostiles,
    quests: opts.quests ?? [],
    legalActions,
  };
}

const rec = (buy: number, sell: number): PriceRecord => ({
  buy,
  sell,
  seenAt: 1,
});

/** Belief that knows METALS is cheap@A (buy 100) and dear@B (sell 160). */
function abBook(): AgentMemory {
  const mem = createMemory();
  mem.priceBook.set("A", new Map([[M, rec(100, 80)]]));
  mem.priceBook.set("B", new Map([[M, rec(200, 160)]]));
  return mem;
}

const quest = (targetSystemId: string | null): QuestSnapshot => ({
  id: "q1",
  title: "q1",
  type: "DELIVERY" as QuestSnapshot["type"],
  targetSystemId,
});

describe("decideWithMemory (pure)", () => {
  it("buys low @A — trades on the cheapest known source for a profitable margin", () => {
    const here = obs({
      scene: SceneType.PLANET,
      currentPlanet: landed("A", [{ resource: M, buy: 100, sell: 80 }]),
    });
    const action = decideWithMemory(here, abBook());
    expect(action.kind).toBe("trade");
    expect(action.reason).toContain("buy-low");
  });

  it("a memoryless notebook on the same planet only inspects the market (no buy-low)", () => {
    const here = obs({
      scene: SceneType.PLANET,
      currentPlanet: landed("A", [{ resource: M, buy: 100, sell: 80 }]),
    });
    const action = decideWithMemory(here, createMemory());
    expect(action.kind).toBe("trade");
    expect(action.reason).not.toContain("buy-low");
  });

  it("does not buy-low when it can't afford a unit there", () => {
    const here = obs({
      scene: SceneType.PLANET,
      player: { credits: 50 }, // < buy price 100
      currentPlanet: landed("A", [{ resource: M, buy: 100, sell: 80 }]),
    });
    const action = decideWithMemory(here, abBook());
    expect(action.reason).not.toContain("buy-low");
  });

  it("sells for profit @B — trades held cargo where the remembered margin pays off", () => {
    const mem = abBook();
    mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
    const here = obs({
      scene: SceneType.PLANET,
      currentPlanet: landed("B", [{ resource: M, buy: 200, sell: 160 }]),
    });
    const action = decideWithMemory(here, mem);
    expect(action.kind).toBe("trade");
    expect(action.reason).toContain("sell-for-profit");
  });

  it("does not sell where the cargo would lose money vs. what it paid", () => {
    const mem = createMemory();
    mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
    const here = obs({
      scene: SceneType.PLANET,
      currentPlanet: landed("A", [{ resource: M, buy: 90, sell: 70 }]), // below cost
    });
    const action = decideWithMemory(here, mem);
    expect(action.reason).not.toContain("sell-for-profit");
  });

  it("in flight, returns to the remembered sell planet to realise a known margin", () => {
    const mem = abBook();
    mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
    const here = obs({
      planets: [
        { id: "A", name: "A", availableQuests: 0 },
        { id: "B", name: "B", availableQuests: 0 },
      ],
      connections: 2,
    });
    const action = decideWithMemory(here, mem);
    expect(action.kind).toBe("land");
    expect(action.targetId).toBe("B"); // the sell planet
    expect(action.reason).toContain("go-sell");
  });

  it("in flight with an empty hold, heads to the remembered cheap source to buy", () => {
    const here = obs({
      planets: [
        { id: "A", name: "A", availableQuests: 0 },
        { id: "B", name: "B", availableQuests: 0 },
      ],
      connections: 2,
    });
    const action = decideWithMemory(here, abBook());
    expect(action.kind).toBe("land");
    expect(action.targetId).toBe("A"); // the buy planet
    expect(action.reason).toContain("go-buy");
  });

  describe("routes around a remembered-dangerous goal", () => {
    const dangerMem = (): AgentMemory => {
      const mem = createMemory();
      mem.threatMap.set("sysC", 6);
      return mem;
    };

    it("hurt + goal known-dangerous ⇒ holds instead of warping deeper", () => {
      const here = obs({
        player: { hullFraction: 0.5 },
        connections: 2, // warp is legal…
        quests: [quest("sysC")], // …but the goal is remembered dangerous
      });
      const action = decideWithMemory(here, dangerMem());
      expect(action.kind).not.toBe("warp");
      expect(action.reason).toContain("avoid-danger");
    });

    it("with no remembered danger, the same state explores (warps)", () => {
      const here = obs({ connections: 2, quests: [quest("sysC")] });
      const action = decideWithMemory(here, createMemory());
      expect(action.kind).toBe("warp");
    });

    it("battle-ready hull presses on toward the dangerous goal", () => {
      const here = obs({
        player: { hullFraction: BATTLE_READY_HULL_FRACTION },
        connections: 2,
        quests: [quest("sysC")],
      });
      const action = decideWithMemory(here, dangerMem());
      expect(action.kind).toBe("warp");
    });
  });

  describe("defers vs. pursues a known upgrade by affordability", () => {
    const offerMem = (): AgentMemory => {
      const mem = createMemory();
      mem.knownOffers = [{ item: "hull_b", price: 12000, location: "A" }];
      return mem;
    };
    const flight = (credits: number): Observation =>
      obs({
        player: { credits },
        planets: [{ id: "A", name: "A", availableQuests: 0 }],
        connections: 1,
      });

    it("can't afford the offer ⇒ keeps earning, not heading to buy it", () => {
      const action = decideWithMemory(flight(1000), offerMem());
      expect(action.reason).not.toContain("go-upgrade");
      expect(action.kind).toBe("land"); // still earning toward it
    });

    it("affordable ⇒ routes to the offer's location to get it", () => {
      const action = decideWithMemory(flight(15000), offerMem());
      expect(action.kind).toBe("land");
      expect(action.targetId).toBe("A");
      expect(action.reason).toContain("go-upgrade");
    });
  });

  describe("survival still takes precedence", () => {
    it("a hostile with a healthy hull ⇒ attack it", () => {
      const action = decideWithMemory(
        obs({ hostiles: [hostile("rx")], player: { hullFraction: 0.9 } }),
        abBook(),
      );
      expect(action.kind).toBe("attack");
      expect(action.targetId).toBe("rx");
    });

    it("a hostile with a low hull ⇒ flee", () => {
      const action = decideWithMemory(
        obs({ hostiles: [hostile()], player: { hullFraction: 0.1 } }),
        abBook(),
      );
      expect(action.kind).toBe("flee");
    });

    it("a low hull at a repair base ⇒ repair", () => {
      const action = decideWithMemory(
        obs({ scene: SceneType.STATION, player: { hullFraction: 0.2 } }),
        abBook(),
      );
      expect(action.kind).toBe("repair");
    });

    it("a hostile mid-warp-transit ⇒ still attacks (survive beats warp-wait)", () => {
      const action = decideWithMemory(
        {
          ...obs({ hostiles: [hostile("rx")], player: { hullFraction: 0.9 } }),
          warpInTransit: true,
        },
        abBook(),
      );
      expect(action.kind).toBe("attack");
      expect(action.targetId).toBe("rx");
    });

    it("no hostile mid-warp-transit ⇒ waits (warp-wait still wins with nothing to survive)", () => {
      const action = decideWithMemory(
        { ...obs({ player: { hullFraction: 0.1 } }), warpInTransit: true },
        abBook(),
      );
      expect(action.kind).toBe("wait");
      expect(action.reason).toBe("mem:warp-in-transit");
    });
  });

  it("never returns an illegal action across a battery of states", () => {
    const states: [Observation, AgentMemory][] = [
      [obs(), createMemory()],
      [obs({ connections: 3 }), abBook()],
      [
        obs({
          scene: SceneType.PLANET,
          currentPlanet: landed("A", [{ resource: M, buy: 100, sell: 80 }]),
        }),
        abBook(),
      ],
      [obs({ scene: SceneType.TRADE }), abBook()],
      [obs({ scene: SceneType.STAR_MAP, connections: 4 }), abBook()],
      [obs({ scene: SceneType.WIN_SCREEN }), abBook()],
      [obs({ scene: SceneType.DIALOGUE }), abBook()],
      [obs({ hostiles: [hostile()] }), abBook()],
    ];
    for (const [o, mem] of states) {
      const action = decideWithMemory(o, mem);
      expect(o.legalActions).toContain(action.kind);
    }
  });

  it("is deterministic — same (obs, memory) ⇒ same action", () => {
    const o = obs({
      planets: [{ id: "A", name: "A", availableQuests: 0 }],
      connections: 2,
    });
    const mem = abBook();
    expect(decideWithMemory(o, mem)).toEqual(decideWithMemory(o, mem));
  });
});

describe("MemoryHeuristicPolicy (stateful adapter)", () => {
  it("accumulates belief across steps, then trades on it (scripted A/B/C)", () => {
    const policy = new MemoryHeuristicPolicy();

    // 1) Visit A, see its market — recorded into the price book.
    policy.decide(
      obs({
        scene: SceneType.PLANET,
        currentPlanet: landed("A", [{ resource: M, buy: 100, sell: 80 }]),
        player: { systemId: "sysA" },
      }),
    );
    expect(policy.belief.priceBook.has("A")).toBe(true);

    // 2) Visit B, see its (higher) market — now a cross-planet margin is known.
    policy.decide(
      obs({
        scene: SceneType.PLANET,
        currentPlanet: landed("B", [{ resource: M, buy: 200, sell: 160 }]),
      }),
    );
    expect(policy.belief.priceBook.has("B")).toBe(true);

    // 3) Back in flight with both planets reachable and an empty hold, the agent
    //    now heads to the remembered cheap source A to buy — a decision the
    //    memoryless baseline can't make.
    const action = policy.decide(
      obs({
        planets: [
          { id: "A", name: "A", availableQuests: 0 },
          { id: "B", name: "B", availableQuests: 0 },
        ],
        connections: 2,
      }),
    );
    expect(action.kind).toBe("land");
    expect(action.targetId).toBe("A");
    expect(action.reason).toContain("go-buy");
  });

  it("warps to find a sell destination when holding cargo for another system", () => {
    // abBook: buy@A, sell@B; current system is sysA (no B planet) → must warp
    const mem = abBook();
    mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
    const action = decideWithMemory(
      obs({ connections: 2 }), // connections > 0 makes warp legal
      mem,
    );
    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("find-sell-destination");
  });

  it("does NOT warp to sell destination when the route is remembered as dangerous", () => {
    const mem = abBook();
    mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
    mem.threatMap.set("sysA", 4); // current system remembered as dangerous
    const action = decideWithMemory(
      obs({ connections: 2, player: { hullFraction: 0.5 } }), // hurt + warp legal
      mem,
    );
    // avoidDanger (danger > 0 && hull < BATTLE_READY_HULL_FRACTION) suppresses warp
    expect(action.kind).not.toBe("warp");
  });

  it("decide(obs, memory) uses the supplied notebook without double-folding", () => {
    const policy = new MemoryHeuristicPolicy();
    const mem = abBook();
    mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
    const action = policy.decide(
      obs({
        planets: [
          { id: "A", name: "A", availableQuests: 0 },
          { id: "B", name: "B", availableQuests: 0 },
        ],
        connections: 2,
      }),
      mem,
    );
    expect(action.kind).toBe("land");
    expect(action.targetId).toBe("B"); // go sell where the margin pays
    // The supplied memory was not mutated and the owned notebook stays empty.
    expect(policy.belief.priceBook.size).toBe(0);
  });

  it("reset() starts a fresh per-run notebook", () => {
    const policy = new MemoryHeuristicPolicy();
    policy.decide(
      obs({
        scene: SceneType.PLANET,
        currentPlanet: landed("A", [{ resource: M, buy: 100, sell: 80 }]),
      }),
    );
    expect(policy.belief.priceBook.size).toBeGreaterThan(0);
    policy.reset();
    expect(policy.belief.priceBook.size).toBe(0);
    expect(policy.belief.inventoryLots).toEqual([]);
  });

  it("never throws and stays legal as a drop-in policy", () => {
    const policy = new MemoryHeuristicPolicy();
    const states = [
      obs(),
      obs({ scene: SceneType.PLANET, currentPlanet: landed("A") }),
      obs({ scene: SceneType.STAR_MAP, connections: 2 }),
      obs({ hostiles: [hostile()] }),
    ];
    for (const o of states) {
      let action!: ReturnType<MemoryHeuristicPolicy["decide"]>;
      expect(() => (action = policy.decide(o))).not.toThrow();
      expect(o.legalActions).toContain(action.kind);
    }
  });
});
