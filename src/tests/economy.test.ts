import { describe, it, expect } from "vitest";
import { TradeSystem } from "@/systems/TradeSystem";
import { Market, economyBaseline } from "@/domain/Market";
import { Planet } from "@/domain/Planet";
import { Player } from "@/domain/Player";
import { PlayerShip } from "@/domain/PlayerShip";
import { Inventory } from "@/domain/Inventory";
import { SkillTree } from "@/domain/SkillTree";
import {
  FactionType,
  EconomyType,
  PoliticalSystem,
  ResourceType,
  PlanetType,
} from "@/types";
import type { QuestLog, Journal } from "@/types";

function makePlanet(
  economyType: EconomyType,
  resources: ResourceType[] = [],
): Planet {
  const market = new Market(
    resources,
    resources.map(() => 1.0),
    resources.map(() => 1.0),
  );
  market.economyType = economyType;
  return new Planet(
    "pl1",
    "TestPlanet",
    PlanetType.TERRESTRIAL,
    150,
    market,
    [],
    [],
  );
}

function makePlayer(): Player {
  return new Player(
    "p1",
    "Pilot",
    FactionType.PROGRESSORS,
    0,
    1,
    new SkillTree([]),
    {},
    { activeQuests: [], completedQuests: [] } as QuestLog,
    { entries: [] } as Journal,
    100000,
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
      FactionType.PROGRESSORS,
    ),
    new Inventory(),
  );
}

describe("Economy type price tiers", () => {
  const trade = new TradeSystem();
  const player = makePlayer();

  it("AGRICULTURAL: ORGANICS and MEDICINE cost 0.7× compared to MIXED", () => {
    const agri = makePlanet(EconomyType.AGRICULTURAL);
    const mixed = makePlanet(EconomyType.MIXED);

    const organicsAgri = trade.getMarketPrice(
      agri,
      ResourceType.ORGANICS,
      player,
    );
    const organicsMixed = trade.getMarketPrice(
      mixed,
      ResourceType.ORGANICS,
      player,
    );
    expect(organicsAgri).toBeLessThan(organicsMixed);

    const medAgri = trade.getMarketPrice(agri, ResourceType.MEDICINE, player);
    const medMixed = trade.getMarketPrice(mixed, ResourceType.MEDICINE, player);
    expect(medAgri).toBeLessThan(medMixed);
  });

  it("AGRICULTURAL: ELECTRONICS and LUXURY cost 1.4× compared to MIXED", () => {
    const agri = makePlanet(EconomyType.AGRICULTURAL);
    const mixed = makePlanet(EconomyType.MIXED);

    const elecAgri = trade.getMarketPrice(
      agri,
      ResourceType.ELECTRONICS,
      player,
    );
    const elecMixed = trade.getMarketPrice(
      mixed,
      ResourceType.ELECTRONICS,
      player,
    );
    expect(elecAgri).toBeGreaterThan(elecMixed);

    const luxAgri = trade.getMarketPrice(agri, ResourceType.LUXURY, player);
    const luxMixed = trade.getMarketPrice(mixed, ResourceType.LUXURY, player);
    expect(luxAgri).toBeGreaterThan(luxMixed);
  });

  it("INDUSTRIAL: ELECTRONICS and WEAPONS cost 0.7× compared to MIXED", () => {
    const ind = makePlanet(EconomyType.INDUSTRIAL);
    const mixed = makePlanet(EconomyType.MIXED);

    const elecInd = trade.getMarketPrice(ind, ResourceType.ELECTRONICS, player);
    const elecMixed = trade.getMarketPrice(
      mixed,
      ResourceType.ELECTRONICS,
      player,
    );
    expect(elecInd).toBeLessThan(elecMixed);

    const wpnInd = trade.getMarketPrice(ind, ResourceType.WEAPONS, player);
    const wpnMixed = trade.getMarketPrice(mixed, ResourceType.WEAPONS, player);
    expect(wpnInd).toBeLessThan(wpnMixed);
  });

  it("INDUSTRIAL: ORGANICS cost 1.3× compared to MIXED", () => {
    const ind = makePlanet(EconomyType.INDUSTRIAL);
    const mixed = makePlanet(EconomyType.MIXED);

    const orgInd = trade.getMarketPrice(ind, ResourceType.ORGANICS, player);
    const orgMixed = trade.getMarketPrice(mixed, ResourceType.ORGANICS, player);
    expect(orgInd).toBeGreaterThan(orgMixed);
  });

  it("MIXED: all multipliers are 1.0 (neutral baselines)", () => {
    for (const resource of Object.values(ResourceType)) {
      expect(economyBaseline(EconomyType.MIXED, resource)).toBe(1.0);
    }
  });
});

describe("Daily market drift", () => {
  it("prices stay in [0.4, 2.5] after 200 drift calls", () => {
    const resources = [
      ResourceType.FUEL,
      ResourceType.ORGANICS,
      ResourceType.ELECTRONICS,
    ];
    const market = new Market(resources, [1, 1, 1], [1, 1, 1]);
    market.economyType = EconomyType.AGRICULTURAL;
    market.priceMultipliers = resources.map((r) =>
      economyBaseline(EconomyType.AGRICULTURAL, r),
    );

    let callCount = 0;
    const fakeRng = () => {
      callCount++;
      return (callCount * 0.618) % 1.0; // deterministic pseudo-random
    };

    for (let day = 0; day < 200; day++) {
      market.advanceMarketDay(fakeRng);
    }

    for (const mult of market.priceMultipliers) {
      expect(mult).toBeGreaterThanOrEqual(0.4);
      expect(mult).toBeLessThanOrEqual(2.5);
    }
  });

  it("prices drift toward the economy-type baseline over time", () => {
    const resources = [ResourceType.ORGANICS]; // AGRICULTURAL baseline = 0.7
    const market = new Market(resources, [1], [1]);
    market.economyType = EconomyType.AGRICULTURAL;
    market.priceMultipliers = [2.4]; // far above baseline 0.7

    let i = 0;
    const deterministicRng = () => (i++ * 0.381) % 1.0;

    for (let day = 0; day < 100; day++) {
      market.advanceMarketDay(deterministicRng);
    }

    expect(market.priceMultipliers[0]).toBeLessThan(2.0);
  });
});

describe("Legality map (TradeSystem.isLegal)", () => {
  const trade = new TradeSystem();

  it("ANARCHY: all goods are legal", () => {
    for (const resource of Object.values(ResourceType)) {
      expect(trade.isLegal(resource, PoliticalSystem.ANARCHY)).toBe(true);
    }
  });

  it("DEMOCRACY: all goods are legal", () => {
    for (const resource of Object.values(ResourceType)) {
      expect(trade.isLegal(resource, PoliticalSystem.DEMOCRACY)).toBe(true);
    }
  });

  it("MONARCHY: all goods are legal", () => {
    for (const resource of Object.values(ResourceType)) {
      expect(trade.isLegal(resource, PoliticalSystem.MONARCHY)).toBe(true);
    }
  });

  it("DICTATORSHIP: bans ORGANICS and LUXURY", () => {
    expect(
      trade.isLegal(ResourceType.ORGANICS, PoliticalSystem.DICTATORSHIP),
    ).toBe(false);
    expect(
      trade.isLegal(ResourceType.LUXURY, PoliticalSystem.DICTATORSHIP),
    ).toBe(false);
    expect(trade.isLegal(ResourceType.FUEL, PoliticalSystem.DICTATORSHIP)).toBe(
      true,
    );
    expect(
      trade.isLegal(ResourceType.WEAPONS, PoliticalSystem.DICTATORSHIP),
    ).toBe(true);
    expect(
      trade.isLegal(ResourceType.ELECTRONICS, PoliticalSystem.DICTATORSHIP),
    ).toBe(true);
  });

  it("REPUBLIC: bans WEAPONS only", () => {
    expect(trade.isLegal(ResourceType.WEAPONS, PoliticalSystem.REPUBLIC)).toBe(
      false,
    );
    expect(trade.isLegal(ResourceType.ORGANICS, PoliticalSystem.REPUBLIC)).toBe(
      true,
    );
    expect(trade.isLegal(ResourceType.LUXURY, PoliticalSystem.REPUBLIC)).toBe(
      true,
    );
    expect(trade.isLegal(ResourceType.FUEL, PoliticalSystem.REPUBLIC)).toBe(
      true,
    );
    expect(
      trade.isLegal(ResourceType.ELECTRONICS, PoliticalSystem.REPUBLIC),
    ).toBe(true);
  });
});
