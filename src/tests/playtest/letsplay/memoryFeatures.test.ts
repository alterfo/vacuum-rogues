import { describe, it, expect } from "vitest";
import { SceneType, ResourceType } from "@/types";
import {
  createMemory,
  type AgentMemory,
  type PriceRecord,
} from "./AgentMemory";
import type {
  Observation,
  PlayerSnapshot,
  CurrentPlanetSnapshot,
  MarketGoodSnapshot,
  QuestSnapshot,
} from "./observe";
import {
  bestKnownMargin,
  profitIfSoldHere,
  cheapestKnownOffer,
  goalSystemId,
  routeDangerToGoal,
  memoryFeatures,
  MEMORY_FEATURE_LENGTH,
} from "./memoryFeatures";
import { featurize, FEATURE_LENGTH, OBS_FEATURE_LENGTH } from "./NeuralPolicy";

/**
 * Task 3 of the partial-observability plan: belief-derived (memory) features.
 *
 * The memory features are **pure** projections of an {@link AgentMemory} (+ the
 * current {@link Observation}), so they're tested in isolation over hand-built
 * fixtures: each signal computes the right "best margin / profit-here /
 * affordability gap / route danger / goal progress", the vector is fixed-width and
 * `[0,1]`-normalised, and an empty notebook degrades every signal to a sane `0`.
 */

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
  market: MarketGoodSnapshot[],
): CurrentPlanetSnapshot {
  return { id, name: id, availableQuests: 0, market };
}

function obs(over: Partial<Observation> = {}): Observation {
  return {
    scene: SceneType.SPACE_FLIGHT,
    hasPlayer: true,
    player: playerFixture(),
    system: {
      id: "sysA",
      name: "A",
      planets: [],
      stations: [],
      connections: 2,
    },
    currentPlanet: null,
    npcs: [],
    hostiles: [],
    quests: [],
    legalActions: ["move", "wait"],
    ...over,
  };
}

/** A price-book entry helper (seenAt is irrelevant to the features). */
function rec(buy: number, sell: number): PriceRecord {
  return { buy, sell, seenAt: 1 };
}

/** A notebook with one good priced at two planets: cheap@p1, dear@p2. */
function twoPlanetBook(): AgentMemory {
  const mem = createMemory();
  mem.priceBook.set("p1", new Map([[ResourceType.METALS, rec(100, 80)]]));
  mem.priceBook.set("p2", new Map([[ResourceType.METALS, rec(200, 160)]]));
  return mem;
}

describe("bestKnownMargin", () => {
  it("finds the best cross-planet buy→sell arbitrage", () => {
    const best = bestKnownMargin(twoPlanetBook());
    // Buy METALS @ p1 (100), sell @ p2 (160) ⇒ 60 margin, 60/160 = 0.375.
    expect(best.good).toBe(ResourceType.METALS);
    expect(best.buyPlanet).toBe("p1");
    expect(best.sellPlanet).toBe("p2");
    expect(best.margin).toBe(60);
    expect(best.fraction).toBeCloseTo(60 / 160);
  });

  it("returns zero margin when a good is known at only one planet", () => {
    const mem = createMemory();
    mem.priceBook.set("p1", new Map([[ResourceType.METALS, rec(100, 80)]]));
    const best = bestKnownMargin(mem);
    expect(best.margin).toBe(0);
    expect(best.fraction).toBe(0);
    expect(best.buyPlanet).toBeNull();
  });

  it("returns zero margin for an empty notebook", () => {
    const best = bestKnownMargin(createMemory());
    expect(best.margin).toBe(0);
    expect(best.fraction).toBe(0);
  });

  it("picks the most profitable good across several", () => {
    const mem = createMemory();
    mem.priceBook.set(
      "p1",
      new Map([
        [ResourceType.METALS, rec(100, 80)],
        [ResourceType.ORGANICS, rec(50, 40)],
      ]),
    );
    mem.priceBook.set(
      "p2",
      new Map([
        [ResourceType.METALS, rec(120, 110)], // METALS margin 110-100 = 10
        [ResourceType.ORGANICS, rec(300, 250)], // ORGANICS margin 250-50 = 200
      ]),
    );
    const best = bestKnownMargin(mem);
    expect(best.good).toBe(ResourceType.ORGANICS);
    expect(best.margin).toBe(200);
  });
});

describe("profitIfSoldHere", () => {
  it("values held lots against the current planet's sell prices", () => {
    const mem = createMemory();
    mem.inventoryLots = [{ good: ResourceType.METALS, qty: 5, buyPrice: 100 }];
    const here = obs({
      scene: SceneType.PLANET,
      currentPlanet: landed("p2", [
        { resource: ResourceType.METALS, buy: 200, sell: 160 },
      ]),
    });
    // (160 - 100) * 5 = 300.
    expect(profitIfSoldHere(here, mem)).toBe(300);
  });

  it("ignores a lot that would sell at a loss (never sells below cost)", () => {
    const mem = createMemory();
    mem.inventoryLots = [{ good: ResourceType.METALS, qty: 5, buyPrice: 100 }];
    const here = obs({
      scene: SceneType.PLANET,
      currentPlanet: landed("p2", [
        { resource: ResourceType.METALS, buy: 90, sell: 70 }, // below cost
      ]),
    });
    expect(profitIfSoldHere(here, mem)).toBe(0);
  });

  it("is zero when not landed (no market) or holding nothing", () => {
    const mem = createMemory();
    mem.inventoryLots = [{ good: ResourceType.METALS, qty: 5, buyPrice: 100 }];
    expect(profitIfSoldHere(obs(), mem)).toBe(0); // in flight, no market
    expect(
      profitIfSoldHere(
        obs({
          scene: SceneType.PLANET,
          currentPlanet: landed("p2", [
            { resource: ResourceType.METALS, buy: 200, sell: 160 },
          ]),
        }),
        createMemory(),
      ),
    ).toBe(0); // landed but holding nothing
  });
});

describe("cheapestKnownOffer", () => {
  it("returns the cheapest of several known offers", () => {
    const mem = createMemory();
    mem.knownOffers = [
      { item: "hull_b", price: 12000, location: "p2" },
      { item: "shield_1", price: 4000, location: "p1" },
      { item: "engine_ii", price: 6000, location: "p3" },
    ];
    expect(cheapestKnownOffer(mem)?.item).toBe("shield_1");
  });

  it("is null with no known offers", () => {
    expect(cheapestKnownOffer(createMemory())).toBeNull();
  });
});

describe("goalSystemId / routeDangerToGoal", () => {
  const quest = (targetSystemId: string | null): QuestSnapshot => ({
    id: "q1",
    title: "q1",
    type: "DELIVERY" as QuestSnapshot["type"],
    targetSystemId,
  });

  it("uses the first active quest's target system as the goal", () => {
    const o = obs({ quests: [quest("sysZ")] });
    expect(goalSystemId(o)).toBe("sysZ");
  });

  it("falls back to the current system when no quest names a target", () => {
    expect(goalSystemId(obs())).toBe("sysA");
    expect(goalSystemId(obs({ quests: [quest(null)] }))).toBe("sysA");
  });

  it("reports remembered danger of the goal system (0 if unknown)", () => {
    const mem = createMemory();
    mem.threatMap.set("sysZ", 4);
    expect(routeDangerToGoal(obs({ quests: [quest("sysZ")] }), mem)).toBe(4);
    // Goal unknown to the threat map ⇒ 0.
    expect(routeDangerToGoal(obs(), mem)).toBe(0);
  });
});

describe("memoryFeatures (the belief vector)", () => {
  it("is fixed-width with every component in [0, 1]", () => {
    const cases: [Observation, AgentMemory][] = [
      [obs(), createMemory()],
      [obs(), twoPlanetBook()],
      [
        obs({
          scene: SceneType.PLANET,
          currentPlanet: landed("p2", [
            { resource: ResourceType.METALS, buy: 200, sell: 160 },
          ]),
        }),
        twoPlanetBook(),
      ],
    ];
    for (const [o, mem] of cases) {
      const v = memoryFeatures(o, mem);
      expect(v).toHaveLength(MEMORY_FEATURE_LENGTH);
      for (const x of v) {
        expect(Number.isFinite(x)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
      }
    }
  });

  it("an empty notebook degrades every signal to zero", () => {
    expect(memoryFeatures(obs(), createMemory())).toEqual(
      new Array(MEMORY_FEATURE_LENGTH).fill(0),
    );
  });

  it("flags 'direction' when standing on the best-margin buy planet", () => {
    const mem = twoPlanetBook(); // buy@p1, sell@p2
    const atBuy = memoryFeatures(
      obs({ scene: SceneType.PLANET, currentPlanet: landed("p1", []) }),
      mem,
    );
    const atSell = memoryFeatures(
      obs({ scene: SceneType.PLANET, currentPlanet: landed("p2", []) }),
      mem,
    );
    expect(atBuy[1]).toBe(1); // at the buy planet ⇒ "buy here now"
    expect(atSell[1]).toBe(0); // at the sell planet ⇒ not the buy direction
    expect(memoryFeatures(obs(), mem)[1]).toBe(0); // in flight ⇒ 0
  });

  it("encodes the affordability gap and saving progress for a known upgrade", () => {
    const mem = createMemory();
    mem.knownOffers = [{ item: "hull_b", price: 4000, location: "p2" }];
    // Credits 1000 vs price 4000 ⇒ gap 3000/4000 = 0.75, progress 1000/4000 = 0.25.
    const v = memoryFeatures(
      obs({ player: playerFixture({ credits: 1000 }) }),
      mem,
    );
    expect(v[3]).toBeCloseTo(0.75); // gap to afford
    expect(v[5]).toBeCloseTo(0.25); // saving progress

    // Already affordable ⇒ no gap, full progress.
    const rich = memoryFeatures(
      obs({ player: playerFixture({ credits: 5000 }) }),
      mem,
    );
    expect(rich[3]).toBe(0);
    expect(rich[5]).toBe(1);
  });

  it("encodes remembered route danger to the goal system", () => {
    const mem = createMemory();
    mem.threatMap.set("sysA", 8); // current system is the default goal
    const v = memoryFeatures(obs(), mem);
    expect(v[4]).toBe(1); // 8 / DANGER_SCALE(8) ⇒ saturated
  });

  it("sets slot 6 to 1 when holding cargo whose sell planet is in another system", () => {
    // twoPlanetBook: buy@p1 (100), sell@p2 (160); default system has no planets
    const mem = twoPlanetBook();
    mem.inventoryLots = [{ good: ResourceType.METALS, qty: 3, buyPrice: 100 }];

    // Sell planet (p2) is not in the current system → holdingForOtherSystem = 1
    expect(memoryFeatures(obs(), mem)[6]).toBe(1);

    // When the sell planet IS present in the current system → 0
    const inSystem = obs({
      system: {
        id: "sysA",
        name: "A",
        planets: [{ id: "p2", name: "p2", availableQuests: 0 }],
        stations: [],
        connections: 2,
      },
    });
    expect(memoryFeatures(inSystem, mem)[6]).toBe(0);

    // No inventory lots → 0 even though sell planet is elsewhere
    const noLots = twoPlanetBook();
    expect(memoryFeatures(obs(), noLots)[6]).toBe(0);
  });

  it("sets slot 6 to 1 when holding cargo but NO sell planet is known yet (early-game cycle-breaker)", () => {
    // Only one planet recorded in the price book ⇒ bestKnownMargin can't find a
    // cross-planet pair, so best.sellPlanet stays null. The BC teacher
    // (MemoryHeuristicPolicy's holdingForOtherSystem) still treats this as
    // "go warp to find a sell destination" — slot 6 must agree, or the net is
    // trained against the very feature meant to explain that "warp" label.
    const mem = createMemory();
    mem.priceBook.set("p1", new Map([[ResourceType.METALS, rec(100, 80)]]));
    mem.inventoryLots = [{ good: ResourceType.METALS, qty: 3, buyPrice: 100 }];

    expect(bestKnownMargin(mem).sellPlanet).toBeNull();
    expect(memoryFeatures(obs(), mem)[6]).toBe(1);
  });

  it("wires best-margin into slot 0 and profit-here into slot 2 (no slot swap)", () => {
    const mem = twoPlanetBook(); // METALS: buy@p1 100, sell@p2 160
    mem.inventoryLots = [{ good: ResourceType.METALS, qty: 5, buyPrice: 100 }];
    const v = memoryFeatures(
      obs({
        scene: SceneType.PLANET,
        currentPlanet: landed("p2", [
          { resource: ResourceType.METALS, buy: 200, sell: 160 },
        ]),
      }),
      mem,
    );
    // slot 0 = best margin fraction (160-100)/160 = 0.375; distinct from slot 2 so
    // a swap of the two would fail this assertion.
    expect(v[0]).toBeCloseTo(0.375);
    // slot 2 = profitIfSoldHere / CREDIT_SCALE = (160-100)*5 / 10000 = 0.03.
    expect(v[2]).toBeCloseTo(0.03);
  });
});

describe("featurize (observation + memory blocks)", () => {
  it("appends the memory block after the observation block", () => {
    const mem = twoPlanetBook();
    const o = obs({
      scene: SceneType.PLANET,
      currentPlanet: landed("p1", []),
    });
    const full = featurize(o, mem);
    expect(full).toHaveLength(FEATURE_LENGTH);
    expect(FEATURE_LENGTH).toBe(OBS_FEATURE_LENGTH + MEMORY_FEATURE_LENGTH);
    // The tail equals the standalone memory block.
    expect(full.slice(OBS_FEATURE_LENGTH)).toEqual(memoryFeatures(o, mem));
  });

  it("works with no memory — the belief block is the zero default", () => {
    const o = obs();
    const full = featurize(o);
    expect(full).toHaveLength(FEATURE_LENGTH);
    expect(full.slice(OBS_FEATURE_LENGTH)).toEqual(
      new Array(MEMORY_FEATURE_LENGTH).fill(0),
    );
  });

  it("is deterministic — same (obs, memory) ⇒ same vector", () => {
    const mem = twoPlanetBook();
    const o = obs({ scene: SceneType.PLANET, currentPlanet: landed("p1", []) });
    expect(featurize(o, mem)).toEqual(featurize(o, mem));
  });

  it("pins the concrete feature widths (lockstep with the trained weights JSON)", () => {
    // These literals are a contract: the trained `*.weights.json` input width and
    // `tools/ai/train_player.py`'s NUM_ACTIONS must match. Changing a width here is
    // a deliberate act that forces a retrain + re-export — so pin the numbers, not
    // just their sum (which is tautological). Bumped 16/7/23 → 30/20/50 by the
    // Task 5 widening (20260701-letsplay-action-expansion-and-neural-scale.md) —
    // deliberately updated in lockstep with that widening, not a weakened pin.
    expect(OBS_FEATURE_LENGTH).toBe(30);
    expect(MEMORY_FEATURE_LENGTH).toBe(20);
    expect(FEATURE_LENGTH).toBe(50);
  });
});
