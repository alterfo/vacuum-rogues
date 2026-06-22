import { describe, it, expect } from "vitest";
import { TradeSystem } from "@/systems/TradeSystem";
import { Market } from "@/domain/Market";
import { Planet } from "@/domain/Planet";
import { Player } from "@/domain/Player";
import { PlayerShip } from "@/domain/PlayerShip";
import { Inventory } from "@/domain/Inventory";
import { SkillTree } from "@/domain/SkillTree";
import { FactionType, EconomyType, ResourceType, PlanetType } from "@/types";
import type { QuestLog, Journal } from "@/types";

const RESOURCES = Object.values(ResourceType) as ResourceType[];

function makePlanet(id: string, economy: EconomyType): Planet {
  const market = new Market(
    RESOURCES,
    RESOURCES.map(() => 1.0),
    RESOURCES.map(() => 1.0),
  );
  market.economyType = economy;
  return new Planet(id, id, PlanetType.TERRESTRIAL, 150, market, [], []);
}

function makePlayer(faction: FactionType, credits = 10_000_000): Player {
  return new Player(
    "p1",
    "Pilot",
    faction,
    0,
    1,
    new SkillTree([]),
    {},
    { activeQuests: [], completedQuests: [] } as QuestLog,
    { entries: [] } as Journal,
    credits,
    new PlayerShip("ship1", "Ship", 100, 100, 50, 50, 100, 100, 10, 5, faction),
    new Inventory(),
  );
}

describe("Market dynamics — player trade impact (anti-arbitrage)", () => {
  it("buying raises the local BUY price (depletes stock)", () => {
    const trade = new TradeSystem();
    const planet = makePlanet("buy_raise", EconomyType.MIXED);
    const player = makePlayer(FactionType.BASTIONS);

    const before = trade.getBuyPrice(planet, ResourceType.METALS, player);
    trade.executeTrade(player, planet, ResourceType.METALS, 15, true);
    const after = trade.getBuyPrice(planet, ResourceType.METALS, player);

    expect(after).toBeGreaterThan(before);
  });

  it("selling lowers the local SELL price (gluts the market)", () => {
    const trade = new TradeSystem();
    const planet = makePlanet("sell_drop", EconomyType.MIXED);
    const player = makePlayer(FactionType.BASTIONS);
    player.inventory.resources.push({ type: ResourceType.METALS, amount: 100 });

    const before = trade.getSellPrice(planet, ResourceType.METALS, player);
    trade.executeTrade(player, planet, ResourceType.METALS, 15, false);
    const after = trade.getSellPrice(planet, ResourceType.METALS, player);

    expect(after).toBeLessThan(before);
  });

  it("repeated round-trip arbitrage profit shrinks each trip (self-correcting)", () => {
    const trade = new TradeSystem();
    // Two distinct planets so prices differ → an arbitrage spread exists.
    const cheap = makePlanet("cheap_src", EconomyType.AGRICULTURAL);
    const dear = makePlanet("dear_dst", EconomyType.INDUSTRIAL);
    const player = makePlayer(FactionType.BASTIONS);

    const good = ResourceType.ORGANICS;
    const qty = 20;

    const profitOfTrip = (): number => {
      const spend = trade.getBuyPrice(cheap, good, player) * qty;
      // Simulate a round trip: buy at cheap, carry, sell at dear.
      const buyAt = cheap;
      const sellAt = dear;
      const creditsBefore = player.credits;
      trade.executeTrade(player, buyAt, good, qty, true);
      trade.executeTrade(player, sellAt, good, qty, false);
      const net = player.credits - creditsBefore;
      void spend;
      return net;
    };

    const firstProfit = profitOfTrip();
    let lastProfit = firstProfit;
    for (let i = 0; i < 5; i++) {
      lastProfit = profitOfTrip();
    }

    // The market must move against the player: a later trip is worth strictly
    // less than the very first one. (Old code: trips were flat or widening.)
    expect(lastProfit).toBeLessThan(firstProfit);
  });

  it("same-planet buy→sell of a modest lot still loses credits even at the best sell faction", () => {
    // Guards the SELL_SPREAD no-money-printing invariant against the new trade
    // impact: a modest round trip on one planet must not profit, even for
    // SYNDICATE (the best 1.15 sell multiplier). 10 units keeps the nudge below
    // its cap, matching the regime the spread is designed to protect.
    const trade = new TradeSystem();
    const planet = makePlanet("invariant", EconomyType.MIXED);
    const player = makePlayer(FactionType.SYNDICATE);

    const before = player.credits;
    trade.executeTrade(player, planet, ResourceType.CRYSTALS, 10, true);
    trade.executeTrade(player, planet, ResourceType.CRYSTALS, 10, false);

    expect(player.credits).toBeLessThan(before);
  });
});

describe("Trade impact is resilient to method-less (deserialized) markets", () => {
  it("selling succeeds and applies impact even when the market has no prototype methods", () => {
    // Reproduces the 'Сделка не удалась хотя удалась' bug: SaveManager rehydrates
    // markets as PLAIN data objects (no class methods). The trade impact must not
    // depend on a Market method, or selling throws AFTER mutating credits/cargo.
    const trade = new TradeSystem();
    const plainMarket = {
      availableResources: RESOURCES,
      demandVector: RESOURCES.map(() => 1),
      supplyVector: RESOURCES.map(() => 1),
      priceMultipliers: RESOURCES.map(() => 1),
      economyType: "MIXED",
    };
    // Sanity: this stand-in really lacks the method, like a loaded save.
    expect(
      (plainMarket as unknown as { applyTradeImpact?: unknown })
        .applyTradeImpact,
    ).toBeUndefined();

    const planet = new Planet(
      "loaded",
      "Loaded",
      PlanetType.TERRESTRIAL,
      150,
      plainMarket as unknown as Market,
      [],
      [],
    );
    const player = makePlayer(FactionType.BASTIONS);
    player.inventory.resources.push({ type: ResourceType.METALS, amount: 20 });

    const before = player.credits;
    const result = trade.executeTrade(
      player,
      planet,
      ResourceType.METALS,
      10,
      false,
    );

    expect(result.success).toBe(true);
    expect(player.credits).toBeGreaterThan(before);
    // Impact still landed on the plain data field (selling lowers the multiplier).
    const idx = RESOURCES.indexOf(ResourceType.METALS);
    expect(plainMarket.priceMultipliers[idx]).toBeLessThan(1);
  });
});

describe("Market daily drift mean-reverts toward neutral (1.0), not the econ baseline", () => {
  it("an elevated multiplier on a CHEAP good drifts down toward ~1.0", () => {
    // AGRICULTURAL ORGANICS baseline is 0.7. Start the dynamic multiplier ABOVE
    // 1.0 — it must relax back toward 1.0 (the neutral value), NOT all the way
    // down to the 0.7 economy baseline (which getMarketPrice already applies
    // separately as econMult — double-applying it is the bug being fixed).
    const market = new Market([ResourceType.ORGANICS], [1], [1]);
    market.economyType = EconomyType.AGRICULTURAL;
    market.priceMultipliers = [0.5]; // start below neutral

    let i = 0;
    const rng = () => (i++ * 0.381) % 1.0;
    for (let day = 0; day < 100; day++) market.advanceMarketDay(rng);

    // Old behaviour would converge toward 0.7; new behaviour toward ~1.0.
    expect(market.priceMultipliers[0]).toBeGreaterThan(0.85);
  });
});
