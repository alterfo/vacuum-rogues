import { describe, it, expect } from "vitest";
import {
  scanTradeRoutes,
  type ReferencePriceFn,
  type RouteCandidate,
} from "@/systems/trade/RouteScanner";
import { TradeSystem } from "@/systems/TradeSystem";
import { Market } from "@/domain/Market";
import { Planet } from "@/domain/Planet";
import { Player } from "@/domain/Player";
import { PlayerShip } from "@/domain/PlayerShip";
import { Inventory } from "@/domain/Inventory";
import { SkillTree } from "@/domain/SkillTree";
import type { Galaxy } from "@/domain/Galaxy";
import { FactionType, EconomyType, ResourceType, PlanetType } from "@/types";
import type { QuestLog, Journal } from "@/types";

const ALL_RESOURCES = Object.values(ResourceType) as ResourceType[];

function makePlanet(id: string, resources: ResourceType[]): Planet {
  const market = new Market(
    resources,
    resources.map(() => 1),
    resources.map(() => 1),
  );
  return new Planet(id, id, PlanetType.TERRESTRIAL, 150, market, [], []);
}

function makeGalaxy(
  systems: { id: string; planets: Planet[] }[],
  hostileIds?: string[],
): Galaxy {
  return {
    systems,
    isHostileSystem: (id: string) => (hostileIds ?? []).includes(id),
  } as unknown as Galaxy;
}

function priceTable(table: Record<string, number>): ReferencePriceFn {
  return (planet, resource) => {
    const key = `${planet.id}:${resource}`;
    const v = table[key];
    if (v === undefined) {
      throw new Error(`missing price for ${key}`);
    }
    return v;
  };
}

describe("scanTradeRoutes — cross-system arbitrage ranking", () => {
  it("computes margin as (sell − buy) / buy in percent", () => {
    const galaxy = makeGalaxy([
      { id: "S1", planets: [makePlanet("A", [ResourceType.METALS])] },
      { id: "S2", planets: [makePlanet("B", [ResourceType.METALS])] },
    ]);
    const prices = priceTable({
      "A:METALS": 100,
      "B:METALS": 150,
    });

    const routes = scanTradeRoutes(galaxy, prices, { maxRoutes: 10 });

    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      resource: ResourceType.METALS,
      fromSystemId: "S1",
      fromPlanetId: "A",
      toSystemId: "S2",
      toPlanetId: "B",
      fromPrice: 100,
      toPrice: 150,
      marginPct: 50,
    });
  });

  it("ranks routes by margin descending", () => {
    const galaxy = makeGalaxy([
      {
        id: "S1",
        planets: [makePlanet("A", [ResourceType.METALS, ResourceType.FUEL])],
      },
      {
        id: "S2",
        planets: [makePlanet("B", [ResourceType.METALS, ResourceType.FUEL])],
      },
    ]);
    const prices = priceTable({
      "A:METALS": 100,
      "B:METALS": 130,
      "A:FUEL": 100,
      "B:FUEL": 50,
    });

    const routes = scanTradeRoutes(galaxy, prices, { maxRoutes: 10 });

    expect(routes.map((r) => r.resource)).toEqual([
      ResourceType.FUEL,
      ResourceType.METALS,
    ]);
    expect(routes[0].marginPct).toBeGreaterThan(routes[1].marginPct);
  });

  it("excludes same-system pairs even when their spread is huge", () => {
    const galaxy = makeGalaxy([
      {
        id: "S1",
        planets: [
          makePlanet("A", [ResourceType.METALS]),
          makePlanet("B", [ResourceType.METALS]),
        ],
      },
    ]);
    const prices = priceTable({
      "A:METALS": 50,
      "B:METALS": 500,
    });

    const routes = scanTradeRoutes(galaxy, prices, { maxRoutes: 10 });
    expect(routes).toHaveLength(0);
  });

  it("picks the best cross-system pair when global min and max share a system", () => {
    const galaxy = makeGalaxy([
      {
        id: "S1",
        planets: [
          makePlanet("A", [ResourceType.METALS]),
          makePlanet("B", [ResourceType.METALS]),
        ],
      },
      { id: "S2", planets: [makePlanet("C", [ResourceType.METALS])] },
    ]);
    const prices = priceTable({
      "A:METALS": 50,
      "B:METALS": 500,
      "C:METALS": 200,
    });

    const routes = scanTradeRoutes(galaxy, prices, { maxRoutes: 10 });

    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      fromPlanetId: "A",
      toPlanetId: "C",
      fromPrice: 50,
      toPrice: 200,
      marginPct: 300,
    });
  });

  it("ignores non-positive-margin resources", () => {
    const galaxy = makeGalaxy([
      { id: "S1", planets: [makePlanet("A", [ResourceType.METALS])] },
      { id: "S2", planets: [makePlanet("B", [ResourceType.METALS])] },
    ]);
    const prices = priceTable({ "A:METALS": 100, "B:METALS": 100 });

    const routes = scanTradeRoutes(galaxy, prices, { maxRoutes: 10 });
    expect(routes).toHaveLength(0);
  });

  it("respects minMarginPct floor", () => {
    const galaxy = makeGalaxy([
      { id: "S1", planets: [makePlanet("A", [ResourceType.METALS])] },
      { id: "S2", planets: [makePlanet("B", [ResourceType.METALS])] },
    ]);
    const prices = priceTable({ "A:METALS": 100, "B:METALS": 110 });

    expect(
      scanTradeRoutes(galaxy, prices, { maxRoutes: 10, minMarginPct: 20 }),
    ).toHaveLength(0);
    expect(
      scanTradeRoutes(galaxy, prices, { maxRoutes: 10, minMarginPct: 5 }),
    ).toHaveLength(1);
  });

  it("caps the result to maxRoutes (keeping the most profitable)", () => {
    const galaxy = makeGalaxy([
      {
        id: "S1",
        planets: [
          makePlanet("A", [
            ResourceType.METALS,
            ResourceType.FUEL,
            ResourceType.CRYSTALS,
          ]),
        ],
      },
      {
        id: "S2",
        planets: [
          makePlanet("B", [
            ResourceType.METALS,
            ResourceType.FUEL,
            ResourceType.CRYSTALS,
          ]),
        ],
      },
    ]);
    const prices = priceTable({
      "A:METALS": 100, // +10%
      "B:METALS": 110,
      "A:FUEL": 100, // +50%
      "B:FUEL": 150,
      "A:CRYSTALS": 100, // +100%
      "B:CRYSTALS": 200,
    });

    const routes = scanTradeRoutes(galaxy, prices, { maxRoutes: 2 });
    expect(routes).toHaveLength(2);
    expect(routes.map((r) => r.resource)).toEqual([
      ResourceType.CRYSTALS,
      ResourceType.FUEL,
    ]);
  });

  it("excludes routes touching a hostile (captured) system", () => {
    const galaxy = makeGalaxy(
      [
        { id: "S1", planets: [makePlanet("A", [ResourceType.METALS])] },
        { id: "S2", planets: [makePlanet("B", [ResourceType.METALS])] },
      ],
      ["S2"],
    );
    const prices = priceTable({
      "A:METALS": 100,
      "B:METALS": 150,
    });

    const routes = scanTradeRoutes(galaxy, prices, { maxRoutes: 10 });
    expect(routes).toHaveLength(0);
  });

  it("leaves non-hostile routes unaffected by an unrelated hostile system", () => {
    const galaxy = makeGalaxy(
      [
        { id: "S1", planets: [makePlanet("A", [ResourceType.METALS])] },
        { id: "S2", planets: [makePlanet("B", [ResourceType.METALS])] },
        { id: "S3", planets: [makePlanet("C", [ResourceType.METALS])] },
      ],
      ["S3"],
    );
    const prices = priceTable({
      "A:METALS": 100,
      "B:METALS": 150,
      "C:METALS": 500,
    });

    const routes = scanTradeRoutes(galaxy, prices, { maxRoutes: 10 });
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      fromSystemId: "S1",
      toSystemId: "S2",
    });
  });

  it("is deterministic across runs (stable ordering and tie-break)", () => {
    const build = (): Galaxy =>
      makeGalaxy([
        {
          id: "S1",
          planets: [makePlanet("A", [ResourceType.METALS, ResourceType.FUEL])],
        },
        {
          id: "S2",
          planets: [makePlanet("B", [ResourceType.METALS, ResourceType.FUEL])],
        },
      ]);
    const prices = priceTable({
      "A:METALS": 100,
      "B:METALS": 150,
      "A:FUEL": 100,
      "B:FUEL": 150,
    });

    const run1 = scanTradeRoutes(build(), prices, { maxRoutes: 10 });
    const run2 = scanTradeRoutes(build(), prices, { maxRoutes: 10 });

    const key = (r: RouteCandidate) =>
      `${r.resource}|${r.fromPlanetId}->${r.toPlanetId}|${r.marginPct}`;
    expect(run1.map(key)).toEqual(run2.map(key));
    expect(run1.map((r) => r.resource)).toEqual([
      ResourceType.FUEL,
      ResourceType.METALS,
    ]);
  });
});

describe("TradeSystem.referenceMarketPrice — player-neutral pricing", () => {
  function makePlayer(rank: number): Player {
    const player = new Player(
      "p1",
      "Pilot",
      FactionType.BASTIONS,
      0,
      1,
      new SkillTree([]),
      {},
      { activeQuests: [], completedQuests: [] } as QuestLog,
      { entries: [] } as Journal,
      10_000,
      new PlayerShip(
        "ship1",
        "Ship",
        100,
        100,
        50,
        50,
        100,
        100,
        10,
        5,
        FactionType.BASTIONS,
      ),
      new Inventory(),
    );
    player.rank = rank;
    return player;
  }

  function makeMarketPlanet(id: string): Planet {
    const market = new Market(
      ALL_RESOURCES,
      ALL_RESOURCES.map(() => 1),
      ALL_RESOURCES.map(() => 1),
    );
    market.economyType = EconomyType.MIXED;
    return new Planet(id, id, PlanetType.TERRESTRIAL, 150, market, [], []);
  }

  it("returns a positive price with no Player", () => {
    const trade = new TradeSystem();
    const planet = makeMarketPlanet("ref");
    expect(
      trade.referenceMarketPrice(planet, ResourceType.METALS),
    ).toBeGreaterThan(0);
  });

  it("matches getMarketPrice for a zero-rep, low-rank player", () => {
    const trade = new TradeSystem();
    const planet = makeMarketPlanet("match");
    const player = makePlayer(0);
    for (const resource of ALL_RESOURCES) {
      expect(trade.referenceMarketPrice(planet, resource)).toBe(
        trade.getMarketPrice(planet, resource, player),
      );
    }
  });

  it("ignores the high-rank discount that getMarketPrice applies", () => {
    const trade = new TradeSystem();
    const planet = makeMarketPlanet("rank");
    const highRank = makePlayer(100);
    const discounted = trade.getMarketPrice(
      planet,
      ResourceType.ARTIFACTS,
      highRank,
    );
    const reference = trade.referenceMarketPrice(
      planet,
      ResourceType.ARTIFACTS,
    );
    expect(reference).toBeGreaterThan(discounted);
  });
});
