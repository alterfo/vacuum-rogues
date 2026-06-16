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

/** Minimal shape needed to apply a trade-impact nudge — the data fields a
 *  deserialized (method-less) market still carries. */
interface MarketImpactTarget {
  readonly availableResources: ResourceType[];
  priceMultipliers: number[];
}

/**
 * Apply a persistent trade-impact nudge to one resource's dynamic price
 * multiplier, operating purely on the data fields. Works on both real
 * {@link Market} instances and the PLAIN objects SaveManager produces on load
 * (which have no prototype methods) — so a trade can never throw just because
 * the market lost its methods. Buy nudges positive (price up), sell negative.
 */
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
   * Resource-keyed seam so callers stop depending on the position of a resource
   * inside `availableResources`. True iff the market actually trades `resource`.
   */
  hasResource(resource: ResourceType): boolean {
    return this.availableResources.indexOf(resource) >= 0;
  }

  /**
   * The dynamic price multiplier for `resource`, resolved by key rather than by
   * array index. Returns the neutral default (1.0) when the resource is absent
   * (e.g. an empty stub market) or its multiplier slot is missing.
   */
  multiplierFor(resource: ResourceType): number {
    const idx = this.availableResources.indexOf(resource);
    if (idx < 0) return 1.0;
    return this.priceMultipliers[idx] ?? 1.0;
  }

  /**
   * Bring a freshly-generated stub market to life: replace the resource
   * catalogue and supply/demand vectors with deterministically-seeded data (see
   * `seedMarket` in `systems/galaxy/marketSeeding`) once the economy type is
   * known, and reset `priceMultipliers` to the neutral baseline so the dynamic
   * layer starts clean. Keeps the invariant
   * `priceMultipliers.length === availableResources.length` inside the domain.
   *
   * `availableResources` is a readonly *reference* but its contents are
   * replaceable, so it is rewritten in place. Accepts a structural shape rather
   * than importing from the systems layer, so the domain keeps no upward deps.
   */
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

  /**
   * Drift each resource's dynamic price multiplier ±2–8% back toward the
   * neutral value 1.0. Called once per game day from
   * GameEngine.advanceGalaxyDay(). Prices clamped to [0.4, 2.5] relative to base.
   *
   * The mean-reversion target is **1.0, not the economy-type baseline**: the
   * economy baseline (cheap food on agri worlds, dear tech, etc.) is already
   * applied separately by TradeSystem.getMarketPrice() as a static `econMult`.
   * Reverting the multiplier toward the baseline too would double-apply the
   * economy effect — cheap goods would keep getting cheaper and dear goods
   * dearer every day, which widened every arbitrage route instead of closing
   * it. `priceMultipliers` is purely the *dynamic* layer (player/NPC trade
   * impact + events) that relaxes back to neutral over a few days.
   */
  advanceMarketDay(rngFn: () => number): void {
    const target = 1.0;
    for (let i = 0; i < this.availableResources.length; i++) {
      const current = this.priceMultipliers[i] ?? target;
      const driftMag = 0.02 + rngFn() * 0.06; // 2–8%
      const direction = current < target ? 1 : -1;
      // Don't overshoot the neutral target (avoids day-to-day oscillation once
      // a route has relaxed back to balance).
      const next =
        direction > 0
          ? Math.min(target, current + driftMag)
          : Math.max(target, current - driftMag);
      this.priceMultipliers[i] = Math.max(0.4, Math.min(2.5, next));
    }
  }

  /**
   * Apply a persistent trade-impact nudge to one resource's dynamic price
   * multiplier. Buying depletes local stock (price up); selling gluts the
   * market (price down). The nudge persists in `priceMultipliers` and relaxes
   * back toward 1.0 via {@link advanceMarketDay}, so repeated arbitrage trips
   * progressively close the spread instead of leaving it untouched.
   *
   * Used by both the player ({@link import("@/systems/TradeSystem").TradeSystem})
   * and NPC traders so the same market reacts to everyone who trades on it.
   */
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
