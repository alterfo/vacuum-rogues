/**
 * Deterministic equipment-shop generator (EPIC-006 shop × EPIC-007 gear).
 *
 * Given a planet (and a stable seed + day bucket), decides which catalog gear is
 * in stock and at what price — so the same shop reappears on reload and refreshes
 * over time, like the quest board. Lower-tech gear is common everywhere; high-tech
 * gear is rarer and pricier. The produced {@link GearListing}s feed the galactic
 * registry's gear search (EPIC-009), powering "where can I buy the best hull/
 * weapon" across the galaxy.
 *
 * Pure logic: deterministic from its inputs, no PixiJS/DOM.
 */
import { SeededRNG } from "@/utils/seededRNG";
import {
  GEAR_CATALOG,
  gearMarketPrice,
  type Gear,
} from "@/systems/equipment/GearCatalog";
import type { GearListing } from "@/systems/info/GalacticRegistry";

export const SHOP_REFRESH_DAYS = 7;

export interface ShopOptions {
  readonly systemId: string;
  readonly planetId: string;
  readonly seed: string;
  readonly day: number;
  readonly refreshEveryDays?: number;
  /** Faction/economy price modifier (e.g. trade hubs cheaper); default ~1. */
  readonly priceFactor?: number;
  /**
   * Maximum gear tech level this shop will stock. Items with techLevel above
   * this cap are excluded entirely (they don't exist yet in-world). When
   * omitted, no tech ceiling is enforced (legacy / test behaviour).
   */
  readonly maxTechLevel?: number;
}

/**
 * Probability that a given gear item is stocked, by tech level: ubiquitous at
 * low tech, rare at high tech (so the best gear is worth hunting across systems).
 */
function stockChance(techLevel: number): number {
  // T1 ≈ 0.9 → T8 ≈ 0.2
  return Math.max(0.15, 0.95 - (techLevel - 1) * 0.1);
}

/** Generate a planet's gear shop inventory (deterministic). */
export function generateShop(opts: ShopOptions): GearListing[] {
  const {
    systemId,
    planetId,
    seed,
    day,
    refreshEveryDays = SHOP_REFRESH_DAYS,
    priceFactor = 1,
    maxTechLevel,
  } = opts;
  const bucket = Math.floor(day / Math.max(1, refreshEveryDays));
  const listings: GearListing[] = [];

  for (const gear of GEAR_CATALOG) {
    // Exclude gear whose tech level exceeds the system's current research level.
    if (maxTechLevel !== undefined && gear.techLevel > maxTechLevel) continue;
    // One independent RNG per (shop, item) → stable stock + price per item.
    const rng = new SeededRNG(`${seed}|shop|${planetId}|${bucket}|${gear.id}`);
    if (rng.next() > stockChance(gear.techLevel)) continue;
    // Per-shop price jitter on top of the faction/economy factor.
    const jitter = rng.nextFloat(0.9, 1.15);
    const price = gearMarketPrice(gear, priceFactor * jitter);
    listings.push({ systemId, planetId, gear, price });
  }
  return listings;
}

/** Generate shops for many planets and flatten into one listing array. */
export function generateGalaxyGear(
  planets: { systemId: string; planetId: string; priceFactor?: number }[],
  seed: string,
  day: number,
): GearListing[] {
  const all: GearListing[] = [];
  for (const p of planets) {
    all.push(
      ...generateShop({
        systemId: p.systemId,
        planetId: p.planetId,
        seed,
        day,
        priceFactor: p.priceFactor,
      }),
    );
  }
  return all;
}

/** Re-export for convenience in callers composing a shop. */
export type { Gear };
