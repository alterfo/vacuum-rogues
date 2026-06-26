import { describe, it, expect } from "vitest";
import { SceneType, ResourceType, FactionType } from "@/types";
import { createMemory, updateMemory, type AgentMemory } from "./AgentMemory";
import type {
  Observation,
  PlayerSnapshot,
  MarketGoodSnapshot,
  CurrentPlanetSnapshot,
  NpcSnapshot,
} from "./observe";

/**
 * Task 2 of the partial-observability plan: the structured belief state.
 *
 * `AgentMemory` + `updateMemory` are **pure**, so they are tested in isolation
 * over hand-built {@link Observation} fixtures (no engine/harness needed). The
 * contract under test: visiting a market records its prices, a buy records its
 * lot at the paid price, a sell drains lots, a hostile presence marks the system,
 * re-seeing a market bumps `seenAt`, and nothing the observation didn't contain is
 * ever stored.
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

function npc(id: string): NpcSnapshot {
  return {
    id,
    name: id,
    faction: FactionType.SYNDICATE,
    hostile: true,
    hullHP: 50,
  };
}

/** Build a minimal, well-formed Observation; override only what a test cares about. */
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

/** A market where one good has a known buy/sell spread. */
const METALS_MARKET: MarketGoodSnapshot[] = [
  { resource: ResourceType.METALS, buy: 100, sell: 80 },
];

describe("createMemory", () => {
  it("starts a fresh, empty notebook", () => {
    const mem = createMemory();
    expect(mem.priceBook.size).toBe(0);
    expect(mem.inventoryLots).toEqual([]);
    expect(mem.threatMap.size).toBe(0);
    expect(mem.knownOffers).toEqual([]);
    expect(mem.step).toBe(0);
  });
});

describe("updateMemory — price book", () => {
  it("visiting a market records its goods' prices with a seenAt stamp", () => {
    const mem = updateMemory(
      createMemory(),
      obs({
        scene: SceneType.PLANET,
        currentPlanet: landed("p1", METALS_MARKET),
      }),
    );

    const goods = mem.priceBook.get("p1");
    expect(goods).toBeDefined();
    const rec = goods!.get(ResourceType.METALS)!;
    expect(rec.buy).toBe(100);
    expect(rec.sell).toBe(80);
    expect(rec.seenAt).toBe(1);
  });

  it("re-seeing a market updates seenAt (and refreshes the price)", () => {
    let mem: AgentMemory = createMemory();
    mem = updateMemory(
      mem,
      obs({
        scene: SceneType.PLANET,
        currentPlanet: landed("p1", METALS_MARKET),
      }),
    );
    expect(mem.priceBook.get("p1")!.get(ResourceType.METALS)!.seenAt).toBe(1);

    // Visit the same planet again a step later, now at a different price.
    mem = updateMemory(
      mem,
      obs({
        scene: SceneType.PLANET,
        currentPlanet: landed("p1", [
          { resource: ResourceType.METALS, buy: 120, sell: 95 },
        ]),
      }),
    );
    const rec = mem.priceBook.get("p1")!.get(ResourceType.METALS)!;
    expect(rec.seenAt).toBe(2);
    expect(rec.buy).toBe(120);
    expect(rec.sell).toBe(95);
  });

  it("never records prices for unvisited planets or while in flight", () => {
    // In flight: a system listing other planets, but no landed market.
    const mem = updateMemory(
      createMemory(),
      obs({
        system: {
          id: "sysA",
          name: "A",
          planets: [
            { id: "p1", name: "p1", availableQuests: 0 },
            { id: "p2", name: "p2", availableQuests: 0 },
          ],
          stations: [],
          connections: 2,
        },
      }),
    );
    expect(mem.priceBook.size).toBe(0);
  });
});

describe("updateMemory — inventory lots", () => {
  it("a buy records a lot at the landed planet's buy price", () => {
    let mem = createMemory();
    // Land, see the market (cargo still empty).
    mem = updateMemory(
      mem,
      obs({
        scene: SceneType.PLANET,
        currentPlanet: landed("p1", METALS_MARKET),
      }),
    );
    expect(mem.inventoryLots).toEqual([]);

    // Next step: still landed, cargo has grown by 5 — a buy of 5 @ 100.
    mem = updateMemory(
      mem,
      obs({
        scene: SceneType.PLANET,
        currentPlanet: landed("p1", METALS_MARKET),
        player: playerFixture({
          cargo: [{ type: ResourceType.METALS, amount: 5 }],
          cargoUsed: 5,
        }),
      }),
    );
    expect(mem.inventoryLots).toEqual([
      { good: ResourceType.METALS, qty: 5, buyPrice: 100 },
    ]);
  });

  it("cargo gained without a visible market price records a zero-cost lot (loot)", () => {
    const mem = updateMemory(
      createMemory(),
      obs({
        // In flight: no landed market, but cargo appeared (e.g. combat loot).
        player: playerFixture({
          cargo: [{ type: ResourceType.WEAPONS, amount: 2 }],
          cargoUsed: 2,
        }),
      }),
    );
    expect(mem.inventoryLots).toEqual([
      { good: ResourceType.WEAPONS, qty: 2, buyPrice: 0 },
    ]);
  });

  it("a sell drains lots FIFO, keeping the buy-price of what remains", () => {
    let mem = createMemory();
    // Buy 5 @ 100 (after first seeing the market).
    mem = updateMemory(
      mem,
      obs({
        scene: SceneType.PLANET,
        currentPlanet: landed("p1", METALS_MARKET),
      }),
    );
    mem = updateMemory(
      mem,
      obs({
        scene: SceneType.PLANET,
        currentPlanet: landed("p1", METALS_MARKET),
        player: playerFixture({
          cargo: [{ type: ResourceType.METALS, amount: 5 }],
          cargoUsed: 5,
        }),
      }),
    );

    // Sell 3 — cargo drops to 2; the remaining lot keeps its 100 buy price.
    mem = updateMemory(
      mem,
      obs({
        player: playerFixture({
          cargo: [{ type: ResourceType.METALS, amount: 2 }],
          cargoUsed: 2,
        }),
      }),
    );
    expect(mem.inventoryLots).toEqual([
      { good: ResourceType.METALS, qty: 2, buyPrice: 100 },
    ]);

    // Sell the rest — no lots left.
    mem = updateMemory(
      mem,
      obs({ player: playerFixture({ cargo: [], cargoUsed: 0 }) }),
    );
    expect(mem.inventoryLots).toEqual([]);
  });
});

describe("updateMemory — threat map", () => {
  it("a hostile presence marks the current system with its danger level", () => {
    const mem = updateMemory(
      createMemory(),
      obs({
        system: {
          id: "sysC",
          name: "C",
          planets: [],
          stations: [],
          connections: 1,
        },
        npcs: [npc("h1"), npc("h2")],
        hostiles: [npc("h1"), npc("h2")],
      }),
    );
    expect(mem.threatMap.get("sysC")).toBe(2);
  });

  it("remembers the worst danger ever seen (a later calm visit does not erase it)", () => {
    let mem = createMemory();
    mem = updateMemory(
      mem,
      obs({
        system: {
          id: "sysC",
          name: "C",
          planets: [],
          stations: [],
          connections: 1,
        },
        npcs: [npc("h1"), npc("h2"), npc("h3")],
        hostiles: [npc("h1"), npc("h2"), npc("h3")],
      }),
    );
    expect(mem.threatMap.get("sysC")).toBe(3);

    // Revisit with fewer hostiles — the remembered danger stays at the worst seen.
    mem = updateMemory(
      mem,
      obs({
        system: {
          id: "sysC",
          name: "C",
          planets: [],
          stations: [],
          connections: 1,
        },
        npcs: [npc("h1")],
        hostiles: [npc("h1")],
      }),
    );
    expect(mem.threatMap.get("sysC")).toBe(3);
  });

  it("a system seen with no hostiles is never added to the threat map", () => {
    const mem = updateMemory(createMemory(), obs());
    expect(mem.threatMap.size).toBe(0);
  });
});

describe("updateMemory — purity & menus", () => {
  it("does not mutate the input memory", () => {
    const mem0 = createMemory();
    updateMemory(
      mem0,
      obs({
        scene: SceneType.PLANET,
        currentPlanet: landed("p1", METALS_MARKET),
      }),
    );
    // The original notebook is untouched — updateMemory returns a fresh one.
    expect(mem0.priceBook.size).toBe(0);
    expect(mem0.inventoryLots).toEqual([]);
    expect(mem0.step).toBe(0);
  });

  it("advances the step but stores nothing when there is no player", () => {
    const mem = updateMemory(
      createMemory(),
      obs({
        scene: SceneType.MAIN_MENU,
        hasPlayer: false,
        player: null,
        system: null,
      }),
    );
    expect(mem.step).toBe(1);
    expect(mem.priceBook.size).toBe(0);
    expect(mem.threatMap.size).toBe(0);
    expect(mem.inventoryLots).toEqual([]);
  });
});
