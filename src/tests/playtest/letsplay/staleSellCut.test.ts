import { describe, it, expect } from "vitest";
import { SceneType, ResourceType } from "@/types";
import {
  legalActionsForScene,
  type Observation,
  type PlayerSnapshot,
  type CurrentPlanetSnapshot,
  type MarketGoodSnapshot,
} from "./observe";
import { createMemory, type AgentMemory } from "./AgentMemory";
import {
  decideWithMemory,
  MAX_CONSECUTIVE_NOOP_LANDS,
} from "./MemoryHeuristicPolicy";

const M = ResourceType.METALS;

function player(over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    credits: 1000,
    hull: 100,
    maxHull: 100,
    hullFraction: 1,
    fuel: 50,
    maxFuel: 50,
    fuelFraction: 1,
    cargo: [{ type: M, amount: 5 }],
    cargoUsed: 5,
    cargoCapacity: 20,
    systemId: "sysA",
    position: null,
    ...over,
  };
}

function landedAt(id: string, market: MarketGoodSnapshot[]): Observation {
  const currentPlanet: CurrentPlanetSnapshot = {
    id,
    name: id,
    availableQuests: 0,
    market,
  };
  return {
    scene: SceneType.PLANET,
    hasPlayer: true,
    player: player(),
    system: {
      id: "sysA",
      name: "A",
      planets: [],
      stations: [],
      connections: 0,
    },
    currentPlanet,
    npcs: [],
    hostiles: [],
    quests: [],
    legalActions: legalActionsForScene(SceneType.PLANET, {
      hasPlayer: true,
      planetCount: 0,
      stationCount: 0,
      hostileCount: 0,
      connectionCount: 0,
      availableQuestCount: 0,
    }),
  };
}

function bookHeldAtLossVenue(): AgentMemory {
  const mem = createMemory();
  mem.priceBook.set("A", new Map([[M, { buy: 90, sell: 90, seenAt: 1 }]]));
  mem.priceBook.set("B", new Map([[M, { buy: 50, sell: 40, seenAt: 1 }]]));
  mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
  return mem;
}

describe("stale-sell cut — break the go-sell↔take-off loop at the best sell venue", () => {
  it("takes off (does not dump) on the first barren sell-landing", () => {
    const mem = bookHeldAtLossVenue();
    const action = decideWithMemory(
      landedAt("A", [{ resource: M, buy: 90, sell: 90 }]),
      mem,
    );
    expect(action.reason).not.toContain("cut-stale-loss");
    expect(action.kind).toBe("move");
  });

  it("cuts the stale position once the sell-landing loop trips the no-op streak", () => {
    const mem = bookHeldAtLossVenue();
    mem.noopLandPlanetId = "A";
    mem.noopLandStreak = MAX_CONSECUTIVE_NOOP_LANDS;
    const action = decideWithMemory(
      landedAt("A", [{ resource: M, buy: 90, sell: 90 }]),
      mem,
    );
    expect(action.kind).toBe("trade");
    expect(action.reason).toContain("cut-stale-loss");
  });

  it("still sells for profit (never merely cuts) when the venue actually pays off", () => {
    const mem = bookHeldAtLossVenue();
    mem.noopLandPlanetId = "A";
    mem.noopLandStreak = MAX_CONSECUTIVE_NOOP_LANDS;
    const action = decideWithMemory(
      landedAt("A", [{ resource: M, buy: 200, sell: 160 }]),
      mem,
    );
    expect(action.kind).toBe("trade");
    expect(action.reason).toContain("sell-for-profit");
  });
});
