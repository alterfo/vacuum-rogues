import { SeededRNG } from "@/utils/seededRNG";
import {
  GEAR_CATALOG,
  gearMarketPrice,
  isRareGear,
  type Gear,
} from "@/systems/equipment/GearCatalog";
import type { GearListing } from "@/systems/info/GalacticRegistry";

export const SHOP_REFRESH_DAYS = 7;

export const RARE_STOCK_FACTOR = 0.5;

export interface ShopOptions {
  readonly systemId: string;
  readonly planetId: string;
  readonly seed: string;
  readonly day: number;
  readonly refreshEveryDays?: number;
  readonly priceFactor?: number;
  readonly maxTechLevel?: number;
}

function stockChance(gear: Gear): number {
  const byTech = Math.max(0.15, 0.95 - (gear.techLevel - 1) * 0.1);
  return isRareGear(gear) ? byTech * RARE_STOCK_FACTOR : byTech;
}

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
    if (maxTechLevel !== undefined && gear.techLevel > maxTechLevel) continue;
    if (gear.minDay !== undefined && day < gear.minDay) continue;
    const rng = new SeededRNG(`${seed}|shop|${planetId}|${bucket}|${gear.id}`);
    if (rng.next() > stockChance(gear)) continue;
    const jitter = rng.nextFloat(0.9, 1.15);
    const price = gearMarketPrice(gear, priceFactor * jitter);
    listings.push({ systemId, planetId, gear, price });
  }
  return listings;
}

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

export type { Gear };
