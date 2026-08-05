import type { EconomyType, ResourceType } from "@/types";
import type { Planet } from "./Planet";
import type { Inventory } from "./Inventory";

export interface TransactionResult {
  readonly success: boolean;
  readonly finalPrice: number;
  readonly remainingBalance: number;
  readonly message: string;
}

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

interface MarketImpactTarget {
  readonly availableResources: ResourceType[];
  priceMultipliers: number[];
}

export function applyMarketTradeImpact(
  market: MarketImpactTarget,
  resourceType: ResourceType,
  signedDelta: number,
): void {
  const idx = market.availableResources.indexOf(resourceType);
  if (idx < 0) return;
  const current = market.priceMultipliers[idx] ?? 1.0;
  market.priceMultipliers[idx] = Math.max(
    0.4,
    Math.min(2.5, current + signedDelta),
  );
}

export class Market {
  priceMultipliers: number[];

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

  hasResource(resource: ResourceType): boolean {
    return this.availableResources.indexOf(resource) >= 0;
  }

  multiplierFor(resource: ResourceType): number {
    const idx = this.availableResources.indexOf(resource);
    if (idx < 0) return 1.0;
    return this.priceMultipliers[idx] ?? 1.0;
  }

  populate(vectors: {
    readonly availableResources: readonly ResourceType[];
    readonly supplyVector: readonly number[];
    readonly demandVector: readonly number[];
  }): void {
    this.availableResources.length = 0;
    this.availableResources.push(...vectors.availableResources);
    this.supplyVector = [...vectors.supplyVector];
    this.demandVector = [...vectors.demandVector];
    this.priceMultipliers = this.availableResources.map(() => 1.0);
  }

  advanceMarketDay(rngFn: () => number): void {
    const target = 1.0;
    for (let i = 0; i < this.availableResources.length; i++) {
      const current = this.priceMultipliers[i] ?? target;
      const driftMag = 0.02 + rngFn() * 0.06; // 2–8%
      const direction = current < target ? 1 : -1;
      const next =
        direction > 0
          ? Math.min(target, current + driftMag)
          : Math.max(target, current - driftMag);
      this.priceMultipliers[i] = Math.max(0.4, Math.min(2.5, next));
    }
  }

  applyTradeImpact(resourceType: ResourceType, signedDelta: number): void {
    applyMarketTradeImpact(this, resourceType, signedDelta);
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
