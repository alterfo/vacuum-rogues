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
  MAX_FOLDS_WITHOUT_DAY_ADVANCE,
} from "./MemoryHeuristicPolicy";

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

function hostile(id = "raider-1", hullHP = 80, damage?: number): NpcSnapshot {
  return {
    id,
    name: id,
    faction: FactionType.SYNDICATE,
    hostile: true,
    hullHP,
    damage,
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

  describe("earn-land suppressed once quests are structurally unavailable (win-rate-100pct plan)", () => {
    const singlePlanet = (): Observation =>
      obs({ planets: [{ id: "A", name: "A", availableQuests: 0 }] });

    it("overmindShare below the take-quest ceiling ⇒ still lands to earn even with prices already known", () => {
      const mem = createMemory();
      mem.priceBook.set("A", new Map([[M, rec(100, 100)]]));
      const action = decideWithMemory(
        { ...singlePlanet(), overmindShare: 0.3 },
        mem,
      );
      expect(action.kind).toBe("land");
      expect(action.reason).toBe("mem:earn");
    });

    it("prices not yet known here ⇒ still lands to earn even with overmindShare above the ceiling", () => {
      const action = decideWithMemory(
        { ...singlePlanet(), overmindShare: 0.8 },
        createMemory(),
      );
      expect(action.kind).toBe("land");
      expect(action.reason).toBe("mem:earn");
    });

    it("overmindShare above the ceiling AND prices already known here ⇒ does not land to earn", () => {
      const mem = createMemory();
      mem.priceBook.set("A", new Map([[M, rec(100, 100)]]));
      const action = decideWithMemory(
        { ...singlePlanet(), overmindShare: 0.8 },
        mem,
      );
      expect(action.kind).not.toBe("land");
      expect(action.reason).not.toBe("mem:earn");
    });

    it("holding sellable cargo it can't act on right here ⇒ does not land to earn", () => {
      const mem = createMemory();
      mem.priceBook.set("A", new Map([[M, rec(100, 100)]]));
      mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
      mem.consecutiveWarpsWithoutLanding = 99;
      const action = decideWithMemory(
        { ...singlePlanet(), overmindShare: 0.3 },
        mem,
      );
      expect(action.kind).not.toBe("land");
      expect(action.reason).not.toBe("mem:earn");
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

    it("an over-HP'd hostile (capture fleet) ⇒ flee even at full hull", () => {
      const action = decideWithMemory(
        obs({
          hostiles: [hostile("capture_1", 300)],
          player: { hull: 100, maxHull: 100, hullFraction: 1 },
        }),
        abBook(),
      );
      expect(action.kind).toBe("flee");
      expect(action.reason).toContain("outmatched");
      expect(action.targetId).toBe("capture_1");
    });

    it("a weaker hostile (HP below the player's hull) ⇒ still fight", () => {
      const action = decideWithMemory(
        obs({
          hostiles: [hostile("raider", 60)],
          player: { hull: 100, maxHull: 100, hullFraction: 1 },
        }),
        abBook(),
      );
      expect(action.kind).toBe("attack");
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

    policy.decide(
      obs({
        scene: SceneType.PLANET,
        currentPlanet: landed("A", [{ resource: M, buy: 100, sell: 80 }]),
        player: { systemId: "sysA" },
      }),
    );
    expect(policy.belief.priceBook.has("A")).toBe(true);

    policy.decide(
      obs({
        scene: SceneType.PLANET,
        currentPlanet: landed("B", [{ resource: M, buy: 200, sell: 160 }]),
      }),
    );
    expect(policy.belief.priceBook.has("B")).toBe(true);

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
    const mem = abBook();
    mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
    const action = decideWithMemory(
      obs({ connections: 2 }), // connections > 0 makes warp legal
      mem,
    );
    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("find-sell-destination");
  });

  it("does NOT fly the sell route while hostiles are live here and the ship is hurt", () => {
    const mem = abBook();
    mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
    mem.threatMap.set("sysA", 4);
    const action = decideWithMemory(
      obs({
        connections: 2,
        hostiles: [hostile("raider-1", 300)],
        player: { hullFraction: 0.5 },
      }),
      mem,
    );
    expect(action.reason).not.toContain("find-sell-destination");
  });

  it("a remembered (stale) threat alone no longer pins the sell route (Task 7)", () => {
    const mem = abBook();
    mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
    mem.threatMap.set("sysA", 4); // remembered, but no live hostile in sight
    const action = decideWithMemory(
      obs({ connections: 2, player: { hullFraction: 0.5 } }),
      mem,
    );
    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("find-sell-destination");
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

describe("flee escape jump (campaign wedge regression)", () => {
  function fleeMapObs(over: ObsOpts = {}): Observation {
    return obs({
      scene: SceneType.STAR_MAP,
      connections: 2,
      hostiles: [hostile("garrison-1", 300)],
      player: { hull: 104, maxHull: 130, hullFraction: 104 / 130 },
      ...over,
    });
  }

  function dangerHere(): AgentMemory {
    const mem = createMemory();
    mem.threatMap.set("sysA", 3);
    return mem;
  }

  it("fleeing an outmatched live fight ⇒ the escape jump outranks avoid-danger-back", () => {
    const action = decideWithMemory(fleeMapObs(), dangerHere());
    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("flee-escape-jump");
  });

  it("the escape jump overrides the anti-consecutive-warp cadence (escape > loop prevention)", () => {
    const mem = dangerHere();
    mem.consecutiveWarpsWithoutLanding = 99;
    const action = decideWithMemory(fleeMapObs(), mem);
    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("flee-escape-jump");
  });

  it("no live hostile ⇒ remembered danger still backs out (avoid-danger-back preserved)", () => {
    const action = decideWithMemory(fleeMapObs({ hostiles: [] }), dangerHere());
    expect(action.kind).toBe("move");
    expect(action.reason).toContain("avoid-danger-back");
  });

  it("a live hostile the ship OUTGUNS at healthy hull does not escape-jump", () => {
    const action = decideWithMemory(
      fleeMapObs({
        hostiles: [hostile("weak-1", 20)],
        player: { hull: 130, maxHull: 130, hullFraction: 1 },
      }),
      dangerHere(),
    );
    expect(action.reason).not.toContain("flee-escape-jump");
  });

  it("never escape-jumps fuel-critical (the refuel tier owns an empty tank)", () => {
    const action = decideWithMemory(
      fleeMapObs({
        player: {
          hull: 104,
          maxHull: 130,
          hullFraction: 104 / 130,
          fuel: 5,
          maxFuel: 50,
          fuelFraction: 0.1,
        },
      }),
      dangerHere(),
    );
    expect(action.kind).not.toBe("warp");
  });

  it("fires even with a poisoned warpRejectFolds (the conflated counter must not veto the only exit)", () => {
    const mem = dangerHere();
    mem.warpRejectFolds = 99;
    const action = decideWithMemory(fleeMapObs(), mem);
    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("flee-escape-jump");
  });

  it("the escape jump picks the least-dangerous neighbour (danger-aware targeting)", () => {
    const mem = dangerHere();
    mem.threatMap.set("sysB", 2); // remembered-dangerous neighbour
    const o = fleeMapObs();
    o.system!.neighbors = [
      { systemId: "sysB", visited: false, overmindHeld: false },
      { systemId: "sysC", visited: false, overmindHeld: false },
    ];
    const action = decideWithMemory(o, mem);
    expect(action.kind).toBe("warp");
    expect(action.targetId).toBe("sysC");
  });
});

describe("SPACE_FLIGHT flee stagnation escalation (live-observed deadlock)", () => {
  function outmatchedFlightObs(connections = 2): Observation {
    return obs({
      connections,
      hostiles: [hostile("patrol-1", 60)],
      player: { hull: 40, maxHull: 140, hullFraction: 40 / 140 },
    });
  }

  it("keeps physically fleeing (no escalation) while the standoff is still fresh", () => {
    const mem = createMemory();
    mem.foldsSinceDayAdvance = MAX_FOLDS_WITHOUT_DAY_ADVANCE - 1;
    const action = decideWithMemory(outmatchedFlightObs(), mem);
    expect(action.kind).toBe("flee");
    expect(action.reason).toContain("flee-outmatched");
  });

  it("escalates to a hyperjump once the standoff has outlasted the stagnation valve", () => {
    const mem = createMemory();
    mem.foldsSinceDayAdvance = MAX_FOLDS_WITHOUT_DAY_ADVANCE;
    const action = decideWithMemory(outmatchedFlightObs(), mem);
    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("flee-stagnant-jump");
  });

  it("falls back to flee when no warp connection is legal (nothing to jump to)", () => {
    const mem = createMemory();
    mem.foldsSinceDayAdvance = MAX_FOLDS_WITHOUT_DAY_ADVANCE + 50;
    const action = decideWithMemory(outmatchedFlightObs(0), mem);
    expect(action.kind).toBe("flee");
    expect(action.reason).toContain("flee-outmatched");
  });
});

describe("SPACE_FLIGHT strategic disengage (weak ship stuck in an inert standoff)", () => {
  function weakStandoffObs(connections = 2): Observation {
    return obs({
      connections,
      hostiles: [hostile("wanderer-1", 60)],
      player: { hull: 100, maxHull: 100, hullFraction: 1 },
    });
  }

  it("keeps fighting (no disengage) while the standoff is still fresh", () => {
    const mem = createMemory();
    mem.foldsSinceDayAdvance = MAX_FOLDS_WITHOUT_DAY_ADVANCE - 1;
    const action = decideWithMemory(weakStandoffObs(), mem);
    expect(action.kind).toBe("attack");
  });

  it("disengages (warp) once a below-battle-ready standoff has outlasted the stagnation valve", () => {
    const mem = createMemory();
    mem.foldsSinceDayAdvance = MAX_FOLDS_WITHOUT_DAY_ADVANCE;
    const action = decideWithMemory(weakStandoffObs(), mem);
    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("flee-weak-inert-standoff");
  });

  it("falls back to attack when no warp connection is legal (nothing to jump to)", () => {
    const mem = createMemory();
    mem.foldsSinceDayAdvance = MAX_FOLDS_WITHOUT_DAY_ADVANCE + 50;
    const action = decideWithMemory(weakStandoffObs(0), mem);
    expect(action.kind).toBe("attack");
  });
});

describe("kill-time calculus (flee-outgunned, Task 6)", () => {
  it("flees pre-contact when losing the damage trade at full hull (130hp/14dmg vs 130hp/27dmg)", () => {
    const action = decideWithMemory(
      obs({
        hostiles: [hostile("pirate-1", 130, 27)],
        player: {
          hull: 130,
          maxHull: 130,
          hullFraction: 1,
          weaponDamage: 14,
        },
        connections: 2,
      }),
      createMemory(),
    );
    expect(action.kind).toBe("flee");
    expect(action.reason).toContain("flee-outgunned");
  });

  it("fights when winning the trade (weak low-damage hostile)", () => {
    const action = decideWithMemory(
      obs({
        hostiles: [hostile("scav-1", 20, 5)],
        player: {
          hull: 130,
          maxHull: 130,
          hullFraction: 1,
          weaponDamage: 14,
        },
      }),
      createMemory(),
    );
    expect(action.kind).toBe("attack");
    expect(action.reason).toContain("fight");
  });

  it("a damage-less legacy fixture keeps the pre-Task-6 decision (fight a weaker hull)", () => {
    const action = decideWithMemory(
      obs({
        hostiles: [hostile("raider-1", 80)],
        player: { hull: 100, maxHull: 100, hullFraction: 1 },
      }),
      createMemory(),
    );
    expect(action.kind).toBe("attack");
  });

  it("a hostile PACK is summed — several individually-weaker ships still outgun", () => {
    const action = decideWithMemory(
      obs({
        hostiles: [
          hostile("g1", 60, 15),
          hostile("g2", 60, 15),
          hostile("g3", 60, 15),
        ],
        player: {
          hull: 130,
          maxHull: 130,
          hullFraction: 1,
          weaponDamage: 14,
        },
        connections: 2,
      }),
      createMemory(),
    );
    expect(action.kind).toBe("flee");
    expect(action.reason).toContain("flee-outgunned");
  });

  it("outgunned triggers the STAR_MAP escape jump (fleeingLiveFight parity)", () => {
    const o = obs({
      scene: SceneType.STAR_MAP,
      connections: 2,
      hostiles: [hostile("pirate-1", 130, 27)],
      player: { hull: 130, maxHull: 130, hullFraction: 1, weaponDamage: 14 },
    });
    const mem = createMemory();
    mem.threatMap.set("sysA", 3); // remembered danger here must not veto the escape
    const action = decideWithMemory(o, mem);
    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("flee-escape-jump");
  });
});

describe("pirate-den warp avoidance (Task 6)", () => {
  it("the warp picker avoids a pirateHeld neighbour when a clean one exists", () => {
    const o = obs({ scene: SceneType.STAR_MAP, connections: 2 });
    o.system!.neighbors = [
      {
        systemId: "den",
        visited: false,
        overmindHeld: false,
        pirateHeld: true,
      },
      { systemId: "calm", visited: false, overmindHeld: false },
    ];
    const action = decideWithMemory(o, createMemory());
    expect(action.kind).toBe("warp");
    expect(action.targetId).toBe("calm");
  });
});

describe("downed ship (GOD floor, Task 6)", () => {
  it("does not fight or flee while downed even with hostiles present", () => {
    const action = decideWithMemory(
      obs({
        hostiles: [hostile("garrison-1", 300, 30)],
        player: {
          hull: 7,
          maxHull: 130,
          hullFraction: 7 / 130,
          weaponDamage: 14,
          downed: true,
        },
        connections: 2,
        planets: [{ id: "p1", name: "P1", availableQuests: 0 }],
      }),
      createMemory(),
    );
    expect(action.kind).not.toBe("flee");
    expect(action.kind).not.toBe("attack");
    expect(action.kind).not.toBe("warp");
  });

  it("does not escape-jump from the STAR_MAP while downed", () => {
    const action = decideWithMemory(
      obs({
        scene: SceneType.STAR_MAP,
        connections: 2,
        hostiles: [hostile("garrison-1", 300, 30)],
        player: {
          hull: 7,
          maxHull: 130,
          hullFraction: 7 / 130,
          weaponDamage: 14,
          downed: true,
        },
      }),
      createMemory(),
    );
    expect(action.reason).not.toContain("flee-escape-jump");
  });
});
