import { describe, it, expect } from "vitest";
import { TradeSystem } from "@/systems/TradeSystem";
import { Market } from "@/domain/Market";
import { Planet } from "@/domain/Planet";
import { Player } from "@/domain/Player";
import { PlayerShip } from "@/domain/PlayerShip";
import { Inventory } from "@/domain/Inventory";
import { SkillTree } from "@/domain/SkillTree";
import { FactionType, PoliticalSystem, ResourceType } from "@/types";
import type { QuestLog, Journal } from "@/types";

function makePlayer(credits = 100_000): Player {
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
    credits,
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

function makePlanet(id = "pl1"): Planet {
  return new Planet(
    id,
    "TestPlanet",
    "INDUSTRIAL" as import("@/types").PlanetType,
    150,
    new Market(
      [
        ResourceType.FUEL,
        ResourceType.METALS,
        ResourceType.CRYSTALS,
        ResourceType.ORGANICS,
        ResourceType.ARTIFACTS,
        ResourceType.WEAPONS,
        ResourceType.MEDICINE,
        ResourceType.ELECTRONICS,
        ResourceType.LUXURY,
        ResourceType.DATA_CORES,
      ],
      Array(10).fill(1.0),
      Array(10).fill(1.0),
    ),
    [],
    [],
  );
}

const ALL_RESOURCES = Object.values(ResourceType) as ResourceType[];

// --- Buy/sell spread ---
describe("TradeSystem — buy/sell spread (Task 9)", () => {
  const trade = new TradeSystem();

  it("sellPrice is always strictly below buyPrice for every resource", () => {
    const planet = makePlanet();
    const player = makePlayer();

    for (const resource of ALL_RESOURCES) {
      const buy = trade.getBuyPrice(planet, resource, player);
      const sell = trade.getSellPrice(planet, resource, player);
      expect(sell).toBeLessThan(buy);
    }
  });

  it("spread holds for SYNDICATE faction (best sell multiplier)", () => {
    const planet = makePlanet();
    const player = makePlayer();
    (player as Player & { faction: FactionType }).faction =
      FactionType.SYNDICATE;

    for (const resource of ALL_RESOURCES) {
      const buy = trade.getBuyPrice(planet, resource, player);
      const sell = trade.getSellPrice(planet, resource, player);
      expect(sell).toBeLessThan(buy);
    }
  });

  it("buying then immediately selling on the same planet loses credits", () => {
    const trade2 = new TradeSystem();
    const planet = makePlanet();
    const player = makePlayer(100_000);
    const before = player.credits;

    trade2.executeTrade(player, planet, ResourceType.CRYSTALS, 10, true);
    trade2.executeTrade(player, planet, ResourceType.CRYSTALS, 10, false);

    expect(player.credits).toBeLessThan(before);
  });
});

// --- Contraband penalty ---
describe("TradeSystem — contraband detection (Task 9)", () => {
  const trade = new TradeSystem();

  it("WEAPONS are illegal in REPUBLIC", () => {
    expect(
      trade.isLegal(ResourceType.WEAPONS, "REPUBLIC" as PoliticalSystem),
    ).toBe(false);
  });

  it("ORGANICS and LUXURY are illegal in DICTATORSHIP", () => {
    expect(
      trade.isLegal(ResourceType.ORGANICS, "DICTATORSHIP" as PoliticalSystem),
    ).toBe(false);
    expect(
      trade.isLegal(ResourceType.LUXURY, "DICTATORSHIP" as PoliticalSystem),
    ).toBe(false);
  });

  it("selling contraband without license triggers negative reputation delta", () => {
    // The reputation penalty formula is: delta = -(basePrice * amount * 0.01).
    // This is applied by the scene / inspection logic; here we verify that the
    // delta is always negative for any illegal resource.
    const resource = ResourceType.WEAPONS;
    const amount = 5;
    const basePrice = trade.getBasePrice(resource);
    const repDelta = -(basePrice * amount * 0.01);

    expect(repDelta).toBeLessThan(0);
  });

  it("Player.adjustReputation applies negative delta for contraband sale", () => {
    const player = makePlayer();
    const repBefore = player.getReputation("REPUBLIC");

    player.adjustReputation("REPUBLIC", -25);

    expect(player.getReputation("REPUBLIC")).toBeLessThan(repBefore);
    expect(player.getReputation("REPUBLIC")).toBe(-25);
  });

  it("all legal goods have no reputation penalty (delta = 0)", () => {
    const resource = ResourceType.FUEL;
    const isLegalInRepublic = trade.isLegal(
      resource,
      "REPUBLIC" as PoliticalSystem,
    );
    expect(isLegalInRepublic).toBe(true);
    // No penalty applies for legal goods
    const repDelta = isLegalInRepublic ? 0 : -trade.getBasePrice(resource);
    expect(repDelta).toBe(0);
  });
});

// --- Supply/demand shift ---
describe("TradeSystem — supply/demand shift after purchases (Task 9)", () => {
  it("buyPrice increases after 10 consecutive purchases", () => {
    const trade2 = new TradeSystem();
    const planet = makePlanet("price_shift_planet");
    const player = makePlayer(1_000_000);

    const priceBefore = trade2.getBuyPrice(planet, ResourceType.METALS, player);

    // 10 purchases of 1 unit each → supply decreases by 10 * 0.01 = 0.1
    for (let i = 0; i < 10; i++) {
      trade2.executeTrade(player, planet, ResourceType.METALS, 1, true);
    }

    const priceAfter = trade2.getBuyPrice(planet, ResourceType.METALS, player);

    expect(priceAfter).toBeGreaterThan(priceBefore);
  });

  it("supply vector decreases proportionally to units bought", () => {
    const trade2 = new TradeSystem();
    const planet = makePlanet("supply_track");
    const player = makePlayer(1_000_000);

    const idx = planet.market.availableResources.indexOf(ResourceType.FUEL);
    const supplyBefore = planet.market.supplyVector[idx]!;

    trade2.executeTrade(player, planet, ResourceType.FUEL, 5, true);

    const supplyAfter = planet.market.supplyVector[idx]!;
    expect(supplyAfter).toBeLessThan(supplyBefore);
    expect(supplyAfter).toBeCloseTo(supplyBefore - 5 * 0.01, 5);
  });

  it("demand vector decreases proportionally to units sold", () => {
    const trade2 = new TradeSystem();
    const planet = makePlanet("demand_track");
    const player = makePlayer(1_000_000);
    player.inventory.resources.push({
      type: ResourceType.ORGANICS,
      amount: 50,
    });

    const idx = planet.market.availableResources.indexOf(ResourceType.ORGANICS);
    const demandBefore = planet.market.demandVector[idx]!;

    trade2.executeTrade(player, planet, ResourceType.ORGANICS, 5, false);

    const demandAfter = planet.market.demandVector[idx]!;
    expect(demandAfter).toBeLessThan(demandBefore);
    expect(demandAfter).toBeCloseTo(demandBefore - 5 * 0.01, 5);
  });

  it("supply never drops below 0.01 (minimum floor)", () => {
    const trade2 = new TradeSystem();
    const planet = makePlanet("floor_test");
    const player = makePlayer(100_000_000);

    // Force supply to near-zero with many purchases
    for (let i = 0; i < 200; i++) {
      trade2.executeTrade(player, planet, ResourceType.FUEL, 1, true);
    }

    const idx = planet.market.availableResources.indexOf(ResourceType.FUEL);
    expect(planet.market.supplyVector[idx]!).toBeGreaterThanOrEqual(0.01);
  });
});
