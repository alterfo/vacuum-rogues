import type { ResourceType, TransactionResult } from '@/types';
import type { Planet } from '@/domain/Planet';
import type { Player } from '@/domain/Player';
import { GameBusinessException } from '@/exceptions/GameBusinessException';
import { logger } from '@/utils/logger';

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
  private basePrices: Map<ResourceType, number>;
  private regressorAdapter: PriceRegressorAdapter;

  constructor() {
    this.basePrices = new Map<ResourceType, number>([
      ['FUEL' as ResourceType, 50],
      ['METALS' as ResourceType, 100],
      ['CRYSTALS' as ResourceType, 250],
      ['ORGANICS' as ResourceType, 75],
      ['ARTIFACTS' as ResourceType, 1000],
      ['WEAPONS' as ResourceType, 500],
      ['MEDICINE' as ResourceType, 150],
      ['ELECTRONICS' as ResourceType, 300],
      ['LUXURY' as ResourceType, 400],
      ['DATA_CORES' as ResourceType, 600],
    ]);
    this.regressorAdapter = new HeuristicPriceRegressor();
  }

  /**
   * Calculate price from base, demand, and supply using exact formula.
   * Exposed for testing: finalPrice = round(basePrice * demand / supply)
   */
  calculatePrice(basePrice: number, demand: number, supply: number): number {
    if (basePrice < 0) {
      throw new GameBusinessException('INVALID_BASE_PRICE', 'Base price must be non-negative.');
    }
    const effectiveSupply = Math.max(supply, 0.01);
    return Math.round(basePrice * demand / effectiveSupply);
  }

  getMarketPrice(planet: Planet, resource: ResourceType, player: Player): number {
    const basePrice = this.basePrices.get(resource) ?? 100;

    // Validate base price
    if (basePrice < 0) {
      throw new GameBusinessException('INVALID_BASE_PRICE', 'Base price must be non-negative.');
    }

    const idx = planet.market.availableResources.indexOf(resource);
    const demand = idx >= 0 ? planet.market.demandVector[idx] ?? 1 : 1;
    const supply = idx >= 0 ? Math.max(planet.market.supplyVector[idx] ?? 1, 0.01) : 1;
    const reputation = player.reputation[planet.market.planet?.id ?? planet.id] ?? 0;

    // Gather features for regressor
    const features = [
      demand / supply - 1, // supply/demand ratio deviation
      reputation / 100, // normalized reputation
      0, // active event flag placeholder
      0, // racial trade modifier placeholder
    ];

    const modifier = this.regressorAdapter.predictModifier(features);
    let finalPrice = basePrice * (1 + modifier);

    // Hard guardrails: [base × 0.3, base × 3.0]
    finalPrice = Math.max(basePrice * 0.3, Math.min(basePrice * 3.0, finalPrice));

    return Math.round(finalPrice);
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
        'INVALID_TRADE_AMOUNT',
        'Trade amount must be positive.',
        { amount },
      );
    }

    const price = this.getMarketPrice(planet, resource, player);
    const totalPrice = price * amount;

    if (isBuy) {
      if (player.credits < totalPrice) {
        return {
          success: false,
          finalPrice: totalPrice,
          remainingBalance: player.credits,
          message: 'Insufficient credits.',
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
        planet.market.supplyVector[idx] = Math.max(0.01, (planet.market.supplyVector[idx] ?? 1) - amount * 0.01);
      }
    } else {
      const stack = player.inventory.resources.find((r) => r.type === resource);
      if (!stack || stack.amount < amount) {
        return {
          success: false,
          finalPrice: totalPrice,
          remainingBalance: player.credits,
          message: 'Not enough resources to sell.',
        };
      }

      stack.amount -= amount;
      const sellMultiplier = player.race.tradeModifiers.sellMultiplier ?? 1.0;
      const finalSellPrice = Math.round(totalPrice * sellMultiplier);
      player.credits += finalSellPrice;

      // Update planet demand
      const idx = planet.market.availableResources.indexOf(resource);
      if (idx >= 0) {
        planet.market.demandVector[idx] = Math.max(0.01, (planet.market.demandVector[idx] ?? 1) - amount * 0.01);
      }

      logger.info(`Player sold ${amount} ${resource} for ${finalSellPrice} credits`);
      return {
        success: true,
        finalPrice: finalSellPrice,
        remainingBalance: player.credits,
        message: 'Transaction completed.',
      };
    }

    logger.info(`Player bought ${amount} ${resource} for ${totalPrice} credits`);
    return {
      success: true,
      finalPrice: totalPrice,
      remainingBalance: player.credits,
      message: 'Transaction completed.',
    };
  }
}
