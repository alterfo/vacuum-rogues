import type {
  ResourceType,
  TransactionResult,
  EconomyType,
  PoliticalSystem,
} from "@/types";
import type { Faction } from "@/types/faction";
import type { Planet } from "@/domain/Planet";
import type { Player } from "@/domain/Player";
import { economyBaseline, applyMarketTradeImpact } from "@/domain/Market";
import { resourceLabelRu } from "@/domain/RouteRumor";
import { GameBusinessException } from "@/exceptions/GameBusinessException";
import { logger } from "@/utils/logger";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
  type BankAccess,
} from "@/systems/banking/economy";
import {
  RANK_DISCOUNT_THRESHOLD,
  RANK_DISCOUNT_FACTOR,
  GAME_BALANCE,
  RESOURCE_BASE_PRICES,
} from "@/config/balance";

export interface PriceRegressorAdapter {
  predictModifier(features: number[]): number;
}

export class HeuristicPriceRegressor implements PriceRegressorAdapter {
  predictModifier(features: number[]): number {
    const avg = features.reduce((a, b) => a + b, 0) / features.length;
    return Math.max(-0.3, Math.min(0.3, avg));
  }
}

export class TradeSystem {
  private static readonly SELL_SPREAD = 0.8;

  private basePrices: Map<ResourceType, number>;
  private regressorAdapter: PriceRegressorAdapter;

  constructor() {
    this.basePrices = new Map<ResourceType, number>(
      Object.entries(RESOURCE_BASE_PRICES) as [ResourceType, number][],
    );
    this.regressorAdapter = new HeuristicPriceRegressor();
  }

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
    planetFaction?: Faction,
  ): number {
    const basePrice = this.basePrices.get(resource) ?? 100;

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
      planetFaction != null ? (player.reputation[planetFaction] ?? 0) : 0;

    const features = [
      demand / supply - 1, // supply/demand ratio deviation
      reputation / 100, // normalized reputation
      0, // active event flag placeholder
      0, // racial trade modifier placeholder
    ];

    const modifier = this.regressorAdapter.predictModifier(features);
    let finalPrice =
      basePrice * (1 + modifier) * this.planetPriceFactor(planet.id, resource);

    const econMult = economyBaseline(
      planet.market.economyType ?? ("MIXED" as EconomyType),
      resource,
    );
    finalPrice *= econMult;

    const driftIdx = planet.market.availableResources.indexOf(resource);
    if (driftIdx >= 0) {
      finalPrice *= planet.market.priceMultipliers[driftIdx] ?? 1.0;
    }

    if ((player.rank ?? 0) >= RANK_DISCOUNT_THRESHOLD) {
      finalPrice *= RANK_DISCOUNT_FACTOR;
    }

    finalPrice = Math.max(
      basePrice * 0.3,
      Math.min(basePrice * 3.0, finalPrice),
    );

    return Math.round(finalPrice);
  }

  referenceMarketPrice(planet: Planet, resource: ResourceType): number {
    const basePrice = this.basePrices.get(resource) ?? 100;

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

    const features = [demand / supply - 1, 0, 0, 0];
    const modifier = this.regressorAdapter.predictModifier(features);

    let finalPrice =
      basePrice * (1 + modifier) * this.planetPriceFactor(planet.id, resource);

    const econMult = economyBaseline(
      planet.market.economyType ?? ("MIXED" as EconomyType),
      resource,
    );
    finalPrice *= econMult;

    const driftIdx = planet.market.availableResources.indexOf(resource);
    if (driftIdx >= 0) {
      finalPrice *= planet.market.priceMultipliers[driftIdx] ?? 1.0;
    }

    finalPrice = Math.max(
      basePrice * 0.3,
      Math.min(basePrice * 3.0, finalPrice),
    );

    return Math.round(finalPrice);
  }

  getBuyPrice(
    planet: Planet,
    resource: ResourceType,
    player: Player,
    planetFaction?: Faction,
  ): number {
    const market = this.getMarketPrice(planet, resource, player, planetFaction);
    const factionBonus = this.getFactionTradeBonus(player.faction);
    const buyMult = factionBonus?.buyMultiplier ?? 1.0;
    return Math.max(1, Math.round(market * buyMult));
  }

  getSellPrice(
    planet: Planet,
    resource: ResourceType,
    player: Player,
    planetFaction?: Faction,
  ): number {
    const buy = this.getBuyPrice(planet, resource, player, planetFaction);
    const factionBonus = this.getFactionTradeBonus(player.faction);
    const sellMult = factionBonus?.sellMultiplier ?? 1.0;
    const raw = Math.round(buy * TradeSystem.SELL_SPREAD * sellMult);
    return Math.max(1, Math.min(raw, buy - 1));
  }

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

  getBasePrice(resource: ResourceType): number {
    return this.basePrices.get(resource) ?? 100;
  }

  static tradeImpact(amount: number): number {
    return Math.min(
      amount * GAME_BALANCE.marketImpactPerUnit,
      GAME_BALANCE.marketImpactMaxPerTrade,
    );
  }

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
    cargoCapacity: number = Infinity,
    bank?: BankAccess | null,
    planetFaction?: Faction,
  ): TransactionResult {
    if (amount <= 0) {
      throw new GameBusinessException(
        "INVALID_TRADE_AMOUNT",
        "Trade amount must be positive.",
        { amount },
      );
    }

    const unitPrice = isBuy
      ? this.getBuyPrice(planet, resource, player, planetFaction)
      : this.getSellPrice(planet, resource, player, planetFaction);
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

      const totalCargo = player.inventory.resources.reduce(
        (sum, r) => sum + r.amount,
        0,
      );
      if (totalCargo + amount > cargoCapacity) {
        return {
          success: false,
          finalPrice: totalPrice,
          remainingBalance: player.credits,
          message: "Not enough cargo space.",
        };
      }

      adjustPlayerCredits(
        bank,
        player,
        -totalPrice,
        GL_COUNTERPARTY.MARKET,
        `Покупка: ${resourceLabelRu(resource)}`,
      );
      const stack = player.inventory.resources.find((r) => r.type === resource);
      if (stack) {
        stack.amount += amount;
      } else {
        player.inventory.resources.push({ type: resource, amount });
      }

      const idx = planet.market.availableResources.indexOf(resource);
      if (idx >= 0) {
        planet.market.supplyVector[idx] = Math.max(
          0.01,
          (planet.market.supplyVector[idx] ?? 1) - amount * 0.01,
        );
      }
      applyMarketTradeImpact(
        planet.market,
        resource,
        TradeSystem.tradeImpact(amount),
      );
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
      adjustPlayerCredits(
        bank,
        player,
        totalPrice,
        GL_COUNTERPARTY.MARKET,
        `Продажа: ${resourceLabelRu(resource)}`,
      );

      const idx = planet.market.availableResources.indexOf(resource);
      if (idx >= 0) {
        planet.market.demandVector[idx] = Math.max(
          0.01,
          (planet.market.demandVector[idx] ?? 1) - amount * 0.01,
        );
      }
      applyMarketTradeImpact(
        planet.market,
        resource,
        -TradeSystem.tradeImpact(amount),
      );

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
