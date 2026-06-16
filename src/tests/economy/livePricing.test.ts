import { describe, it, expect } from "vitest";
import { GalaxySimulator } from "@/systems/GalaxySimulator";
import { TradeSystem } from "@/systems/TradeSystem";
import { Player } from "@/domain/Player";
import { PlayerShip } from "@/domain/PlayerShip";
import { Inventory } from "@/domain/Inventory";
import { SkillTree } from "@/domain/SkillTree";
import { FactionType, ResourceType } from "@/types";
import type { QuestLog, Journal } from "@/types";

/**
 * Task 4 (EPIC-001): prove the already-shipped dynamic-pricing layer finally
 * engages on PRODUCTION markets. Earlier economy tests
 * (`economy/marketDynamics.test.ts`) construct markets by hand with
 * `new Market(RESOURCES, …)`; this suite instead runs the real
 * `GalaxySimulator.generateGalaxy` path so the markets under test are the ones
 * the game actually ships — non-empty because of `seedMarket`. If population
 * regressed to empty stubs (`new Market([], [], [])`), `advanceMarketDay` would
 * loop zero times and `applyMarketTradeImpact` would early-return, so these
 * assertions would all fail.
 */

const RESOURCES = Object.values(ResourceType) as ResourceType[];

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

describe("Live pricing — generated production markets drive the dynamic layer", () => {
  it("a generated planet responds to executeTrade, then advanceMarketDay relaxes the nudge", async () => {
    const trade = new TradeSystem();
    const galaxy = await new GalaxySimulator().generateGalaxy("live-single", 8);
    const planet = galaxy.systems.flatMap((s) => s.planets)[0]!;
    const player = makePlayer(FactionType.BASTIONS);
    const good = ResourceType.METALS;

    // Precondition: this is a real, populated market (not the old empty stub).
    expect(planet.market.hasResource(good)).toBe(true);
    expect(planet.market.multiplierFor(good)).toBe(1.0);

    // executeTrade must shift the live price via applyMarketTradeImpact:
    // buying depletes stock, so the next BUY price is strictly higher.
    const buyBefore = trade.getBuyPrice(planet, good, player);
    trade.executeTrade(player, planet, good, 15, true);
    const buyAfter = trade.getBuyPrice(planet, good, player);
    expect(buyAfter).toBeGreaterThan(buyBefore);

    // The persistent nudge lives in priceMultipliers (resolved by key, not idx).
    const multAfterTrade = planet.market.multiplierFor(good);
    expect(multAfterTrade).toBeGreaterThan(1.0);

    // advanceMarketDay must MOVE that multiplier back toward the neutral 1.0
    // (the whole point of populating the market — the drift loop now iterates).
    let i = 0;
    const rng = () => (i++ * 0.381) % 1.0;
    for (let day = 0; day < 10; day++) planet.market.advanceMarketDay(rng);
    const multAfterDrift = planet.market.multiplierFor(good);
    expect(multAfterDrift).toBeLessThan(multAfterTrade); // moved
    expect(multAfterDrift).toBeGreaterThanOrEqual(1.0); // never overshoots neutral
  });

  it("repeated cross-planet round-trips narrow the arbitrage spread (self-correcting)", async () => {
    const trade = new TradeSystem();
    const galaxy = await new GalaxySimulator().generateGalaxy("live-arb", 16);
    const player = makePlayer(FactionType.BASTIONS);
    const planets = galaxy.systems.flatMap((s) => s.planets);

    // Find the best real arbitrage route the production galaxy actually offers:
    // buy `good` at `src`, carry it to `dst`, sell for more. Deterministic scan.
    let best = {
      profit: -Infinity,
      good: ResourceType.METALS,
      src: planets[0]!,
      dst: planets[0]!,
    };
    for (const src of planets) {
      for (const dst of planets) {
        if (src.id === dst.id) continue;
        for (const good of RESOURCES) {
          const profit =
            trade.getSellPrice(dst, good, player) -
            trade.getBuyPrice(src, good, player);
          if (profit > best.profit) best = { profit, good, src, dst };
        }
      }
    }

    // Populated production markets must expose a real spread to exploit; with
    // empty stubs every price is 0 and no route is profitable.
    expect(best.profit).toBeGreaterThan(0);

    const { good, src, dst } = best;
    const qty = 15; // fits CORVETTE cargo (20) and caps the per-trade nudge
    const roundTrip = (): number => {
      const before = player.credits;
      trade.executeTrade(player, src, good, qty, true); // buy at source
      trade.executeTrade(player, dst, good, qty, false); // sell at destination
      return player.credits - before;
    };

    const firstProfit = roundTrip();
    expect(firstProfit).toBeGreaterThan(0); // the route really pays at first
    let lastProfit = firstProfit;
    for (let i = 0; i < 5; i++) lastProfit = roundTrip();

    // Buying at `src` pushes its price up and selling at `dst` pushes its price
    // down (applyMarketTradeImpact, the same lever NPC traders use), so the
    // route is worth strictly less by the last trip than it was on the first.
    expect(lastProfit).toBeLessThan(firstProfit);
  });

  it("regression: same-planet buy→sell still loses credits on a populated market (SELL_SPREAD intact)", async () => {
    // Populating production markets must NOT reopen the money-printing hole the
    // SELL_SPREAD closes: a same-planet round trip must still lose money, even
    // for SYNDICATE (the best 1.15 sell multiplier).
    const trade = new TradeSystem();
    const galaxy = await new GalaxySimulator().generateGalaxy("live-spread", 8);
    const planet = galaxy.systems.flatMap((s) => s.planets)[0]!;
    const player = makePlayer(FactionType.SYNDICATE);

    const before = player.credits;
    trade.executeTrade(player, planet, ResourceType.CRYSTALS, 10, true);
    trade.executeTrade(player, planet, ResourceType.CRYSTALS, 10, false);

    expect(player.credits).toBeLessThan(before);
  });
});
