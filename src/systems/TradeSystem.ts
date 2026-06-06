import type {
  ResourceType,
  TransactionResult,
  EconomyType,
  PoliticalSystem,
} from "@/types";
import type { Planet } from "@/domain/Planet";
import type { Player } from "@/domain/Player";
import { economyBaseline } from "@/domain/Market";
import { GameBusinessException } from "@/exceptions/GameBusinessException";
import { logger } from "@/utils/logger";
import {
  RANK_DISCOUNT_THRESHOLD,
  RANK_DISCOUNT_FACTOR,
} from "@/config/balance";

export interface PriceRegressorAdapter {
  predictModifier(features: number[]): number;
}

export class HeuristicPriceRegressor implements PriceRegressorAdapter {
  predictModifier(features: number[]): number {
    // Simple heuristic: average of features, clamped to ±0.3
    const avg = features.reduce((a, b) => a + b, 0) / features.length;
    return Math.max(-0.3, Math.min(0.3, avg));
  }
}

export class TradeSystem {
  /**
   * Fraction of the market reference price the player receives when *selling*.
   * Together with the hard `sell < buy` clamp in {@link getSellPrice}, this
   * guarantees a spread so the player can never profit by buying and instantly
   * reselling on the same planet (no money-printing arbitrage). Profit must
   * come from carrying goods to a *different* planet where prices differ.
   */
  private static readonly SELL_SPREAD = 0.8;

  private basePrices: Map<ResourceType, number>;
  private regressorAdapter: PriceRegressorAdapter;

  constructor() {
    this.basePrices = new Map<ResourceType, number>([
      ["FUEL" as ResourceType, 50],
      ["METALS" as ResourceType, 100],
      ["CRYSTALS" as ResourceType, 250],
      ["ORGANICS" as ResourceType, 75],
      ["ARTIFACTS" as ResourceType, 1000],
      ["WEAPONS" as ResourceType, 500],
      ["MEDICINE" as ResourceType, 150],
      ["ELECTRONICS" as ResourceType, 300],
      ["LUXURY" as ResourceType, 400],
      ["DATA_CORES" as ResourceType, 600],
    ]);
    this.regressorAdapter = new HeuristicPriceRegressor();
  }

  /**
   * Calculate price from base, demand, and supply using exact formula.
   * Exposed for testing: finalPrice = round(basePrice * demand / supply)
   */
  calculatePrice(basePrice: number, demand: number, supply: number): number {
    if (basePrice < 0) {
      throw new GameBusinessException(
        "INVALID_BASE_PRICE",
        "Base price must be non-negative.",
      );
    }
    const effectiveSupply = Math.max(supply, 0.01);
    return Math.round((basePrice * demand) / effectiveSupply);
  }

  getMarketPrice(
    planet: Planet,
    resource: ResourceType,
    player: Player,
  ): number {
    const basePrice = this.basePrices.get(resource) ?? 100;

    // Validate base price
    if (basePrice < 0) {
      throw new GameBusinessException(
        "INVALID_BASE_PRICE",
        "Base price must be non-negative.",
      );
    }

    const idx = planet.market.availableResources.indexOf(resource);
    const demand = idx >= 0 ? (planet.market.demandVector[idx] ?? 1) : 1;
    const supply =
      idx >= 0 ? Math.max(planet.market.supplyVector[idx] ?? 1, 0.01) : 1;
    const reputation =
      player.reputation[planet.market.planet?.id ?? planet.id] ?? 0;

    // Gather features for regressor
    const features = [
      demand / supply - 1, // supply/demand ratio deviation
      reputation / 100, // normalized reputation
      0, // active event flag placeholder
      0, // racial trade modifier placeholder
    ];

    const modifier = this.regressorAdapter.predictModifier(features);
    // Per-planet, per-resource variation so prices differ between planets (and
    // create real cross-planet arbitrage). Deterministic from the planet id, so
    // a planet's prices are stable across visits and save/load.
    let finalPrice =
      basePrice * (1 + modifier) * this.planetPriceFactor(planet.id, resource);

    // Economy type: static multiplier based on system economy (e.g. AGRICULTURAL
    // makes food cheap, tech expensive). Falls back to MIXED (1.0×) if unset.
    const econMult = economyBaseline(
      planet.market.economyType ?? ("MIXED" as EconomyType),
      resource,
    );
    finalPrice *= econMult;

    // Daily drift: dynamic multiplier accumulated by Market.advanceMarketDay().
    const driftIdx = planet.market.availableResources.indexOf(resource);
    if (driftIdx >= 0) {
      finalPrice *= planet.market.priceMultipliers[driftIdx] ?? 1.0;
    }

    // High-rank discount: rank ≥ RANK_DISCOUNT_THRESHOLD → 15% off.
    if ((player.rank ?? 0) >= RANK_DISCOUNT_THRESHOLD) {
      finalPrice *= RANK_DISCOUNT_FACTOR;
    }

    // Hard guardrails: [base × 0.3, base × 3.0]
    finalPrice = Math.max(
      basePrice * 0.3,
      Math.min(basePrice * 3.0, finalPrice),
    );

    return Math.round(finalPrice);
  }

  /**
   * Price the player pays to BUY one unit at this planet (reference market
   * price adjusted by the faction's buy modifier).
   */
  getBuyPrice(planet: Planet, resource: ResourceType, player: Player): number {
    const market = this.getMarketPrice(planet, resource, player);
    const factionBonus = this.getFactionTradeBonus(player.faction);
    const buyMult = factionBonus?.buyMultiplier ?? 1.0;
    return Math.max(1, Math.round(market * buyMult));
  }

  /**
   * Price the player receives to SELL one unit at this planet. Always strictly
   * less than {@link getBuyPrice} on the same planet (enforced by clamp), so
   * same-planet buy→sell can never turn a profit.
   */
  getSellPrice(planet: Planet, resource: ResourceType, player: Player): number {
    const buy = this.getBuyPrice(planet, resource, player);
    const factionBonus = this.getFactionTradeBonus(player.faction);
    const sellMult = factionBonus?.sellMultiplier ?? 1.0;
    // Anchor the haircut to the BUY price (not the raw market) so the spread is
    // structural and can't be eroded by faction multipliers. This keeps a robust
    // margin (>= ~8% even for the best trader faction), so a single purchase's
    // supply-driven price bump can never make an instant resale break even.
    const raw = Math.round(buy * TradeSystem.SELL_SPREAD * sellMult);
    // Invariant: sell price is always strictly below the buy price on the same planet.
    return Math.max(1, Math.min(raw, buy - 1));
  }

  /** Get faction trade bonus modifiers */
  private getFactionTradeBonus(
    faction: import("@/types").FactionType,
  ): { buyMultiplier: number; sellMultiplier: number } | null {
    switch (faction) {
      case "OUTLANDERS":
        return { buyMultiplier: 0.95, sellMultiplier: 1.05 };
      case "BASTIONS":
        return { buyMultiplier: 1.0, sellMultiplier: 1.0 };
      case "SYNDICATE":
        return { buyMultiplier: 0.85, sellMultiplier: 1.15 };
      case "PARADOXES":
        return { buyMultiplier: 1.0, sellMultiplier: 1.0 };
      case "PROGRESSORS":
        return { buyMultiplier: 0.9, sellMultiplier: 1.1 };
      default:
        return { buyMultiplier: 1.0, sellMultiplier: 1.0 };
    }
  }

  /**
   * Returns true when `good` is legal under the given political system.
   * ANARCHY / DEMOCRACY / MONARCHY: all goods legal.
   * DICTATORSHIP: bans ORGANICS (alcohol) and LUXURY (narcotics).
   * REPUBLIC: bans WEAPONS.
   */
  isLegal(good: ResourceType, politicalSystem: PoliticalSystem): boolean {
    switch (politicalSystem) {
      case "DICTATORSHIP" as PoliticalSystem:
        return (
          good !== ("ORGANICS" as ResourceType) &&
          good !== ("LUXURY" as ResourceType)
        );
      case "REPUBLIC" as PoliticalSystem:
        return good !== ("WEAPONS" as ResourceType);
      default:
        return true;
    }
  }

  /** Base price for a resource (used for penalty/fine calculations). */
  getBasePrice(resource: ResourceType): number {
    return this.basePrices.get(resource) ?? 100;
  }

  /** Deterministic per-planet/per-resource price multiplier in [0.7, 1.3). */
  private planetPriceFactor(planetId: string, resource: ResourceType): number {
    const s = `${planetId}:${resource}`;
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
    }
    return 0.7 + ((h % 1000) / 1000) * 0.6;
  }

  executeTrade(
    player: Player,
    planet: Planet,
    resource: ResourceType,
    amount: number,
    isBuy: boolean,
  ): TransactionResult {
    if (amount <= 0) {
      throw new GameBusinessException(
        "INVALID_TRADE_AMOUNT",
        "Trade amount must be positive.",
        { amount },
      );
    }

    // Buy and sell are priced separately; sell is always below buy on the same
    // planet (see getSellPrice), preventing same-planet arbitrage.
    const unitPrice = isBuy
      ? this.getBuyPrice(planet, resource, player)
      : this.getSellPrice(planet, resource, player);
    const totalPrice = unitPrice * amount;

    if (isBuy) {
      if (player.credits < totalPrice) {
        return {
          success: false,
          finalPrice: totalPrice,
          remainingBalance: player.credits,
          message: "Insufficient credits.",
        };
      }

      player.credits -= totalPrice;
      const stack = player.inventory.resources.find((r) => r.type === resource);
      if (stack) {
        stack.amount += amount;
      } else {
        player.inventory.resources.push({ type: resource, amount });
      }

      // Update planet supply
      const idx = planet.market.availableResources.indexOf(resource);
      if (idx >= 0) {
        planet.market.supplyVector[idx] = Math.max(
          0.01,
          (planet.market.supplyVector[idx] ?? 1) - amount * 0.01,
        );
      }
    } else {
      const stack = player.inventory.resources.find((r) => r.type === resource);
      if (!stack || stack.amount < amount) {
        return {
          success: false,
          finalPrice: totalPrice,
          remainingBalance: player.credits,
          message: "Not enough resources to sell.",
        };
      }

      stack.amount -= amount;
      player.credits += totalPrice;

      // Update planet demand
      const idx = planet.market.availableResources.indexOf(resource);
      if (idx >= 0) {
        planet.market.demandVector[idx] = Math.max(
          0.01,
          (planet.market.demandVector[idx] ?? 1) - amount * 0.01,
        );
      }

      logger.info(
        `Player sold ${amount} ${resource} for ${totalPrice} credits`,
      );
      return {
        success: true,
        finalPrice: totalPrice,
        remainingBalance: player.credits,
        message: "Transaction completed.",
      };
    }

    logger.info(
      `Player bought ${amount} ${resource} for ${totalPrice} credits`,
    );
    return {
      success: true,
      finalPrice: totalPrice,
      remainingBalance: player.credits,
      message: "Transaction completed.",
    };
  }
}
