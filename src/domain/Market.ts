import type { EconomyType, ResourceType } from "@/types";
import type { Planet } from "./Planet";
import type { Inventory } from "./Inventory";

export interface TransactionResult {
  readonly success: boolean;
  readonly finalPrice: number;
  readonly remainingBalance: number;
  readonly message: string;
}

/**
 * Returns the economy-type baseline price multiplier for a given resource.
 * Exported so TradeSystem can use the same table for the static price tier.
 */
export function economyBaseline(
  economyType: EconomyType,
  resource: ResourceType,
): number {
  switch (economyType) {
    case "AGRICULTURAL":
      if (resource === "ORGANICS" || resource === "MEDICINE") return 0.7;
      if (
        resource === "ELECTRONICS" ||
        resource === "LUXURY" ||
        resource === "DATA_CORES"
      )
        return 1.4;
      return 1.0;
    case "INDUSTRIAL":
      if (
        resource === "ELECTRONICS" ||
        resource === "WEAPONS" ||
        resource === "DATA_CORES"
      )
        return 0.7;
      if (resource === "ORGANICS") return 1.3;
      return 1.0;
    default: // MIXED
      return 1.0;
  }
}

export class Market {
  /**
   * Per-resource dynamic price multipliers. Initialized to the economy-type
   * baseline and drifted daily by advanceMarketDay(). Parallel to
   * availableResources. Persisted in save via JSON.stringify(galaxy).
   */
  priceMultipliers: number[];

  /** Economy type of the owning star system, set after construction. */
  economyType: EconomyType = "MIXED" as EconomyType;

  constructor(
    public readonly availableResources: ResourceType[],
    public demandVector: number[],
    public supplyVector: number[],
    public readonly planet?: Planet,
  ) {
    this.priceMultipliers = availableResources.map(() => 1.0);
  }

  getPrice(resourceType: ResourceType): number {
    const idx = this.availableResources.indexOf(resourceType);
    if (idx < 0) return 0;
    const demand = this.demandVector[idx] ?? 1;
    const supply = Math.max(this.supplyVector[idx] ?? 1, 0.01);
    const mult = this.priceMultipliers[idx] ?? 1.0;
    return Math.round((demand / supply) * 100 * mult);
  }

  /**
   * Drift each resource's price multiplier ±2–8% toward the economy-type
   * baseline. Called once per game day from GameEngine.advanceGalaxyDay().
   * Prices clamped to [0.4, 2.5] relative to base.
   */
  advanceMarketDay(rngFn: () => number): void {
    for (let i = 0; i < this.availableResources.length; i++) {
      const resource = this.availableResources[i];
      const baseline = economyBaseline(this.economyType, resource);
      const current = this.priceMultipliers[i] ?? baseline;
      const driftMag = 0.02 + rngFn() * 0.06; // 2–8%
      const direction = current < baseline ? 1 : -1;
      this.priceMultipliers[i] = Math.max(
        0.4,
        Math.min(2.5, current + direction * driftMag),
      );
    }
  }

  trade(
    playerInventory: Inventory,
    playerCredits: { value: number },
    resourceType: ResourceType,
    amount: number,
    isBuy: boolean,
  ): TransactionResult {
    const price = this.getPrice(resourceType);
    const totalPrice = price * amount;

    if (isBuy) {
      if (playerCredits.value < totalPrice) {
        return {
          success: false,
          finalPrice: totalPrice,
          remainingBalance: playerCredits.value,
          message: "Insufficient credits.",
        };
      }
      playerCredits.value -= totalPrice;
      const stack = playerInventory.resources.find(
        (r) => r.type === resourceType,
      );
      if (stack) {
        stack.amount += amount;
      } else {
        playerInventory.resources.push({ type: resourceType, amount });
      }
    } else {
      const stack = playerInventory.resources.find(
        (r) => r.type === resourceType,
      );
      if (!stack || stack.amount < amount) {
        return {
          success: false,
          finalPrice: totalPrice,
          remainingBalance: playerCredits.value,
          message: "Not enough resources to sell.",
        };
      }
      stack.amount -= amount;
      playerCredits.value += totalPrice;
    }

    return {
      success: true,
      finalPrice: totalPrice,
      remainingBalance: playerCredits.value,
      message: "Transaction completed.",
    };
  }
}
