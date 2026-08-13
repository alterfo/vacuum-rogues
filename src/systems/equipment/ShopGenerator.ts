import { SeededRNG } from "@/utils/seededRNG";
import {
  GEAR_CATALOG,
  gearMarketPrice,
  isRareGear,
  type Gear,
} from "@/systems/equipment/GearCatalog";
import type { GearListing } from "@/systems/info/GalacticRegistry";
import { StationType } from "@/types";
import { getEconomyOverrides } from "@/config/economyOverrides";

export function stationSellsGear(type: StationType): boolean {
  return type === StationType.TRADE_POST || type === StationType.RESEARCH_LAB;
}

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
  readonly soldOutGear?: Readonly<Record<string, number>>;
}

function stockChance(gear: Gear): number {
  const byTech = Math.max(0.15, 0.95 - (gear.techLevel - 1) * 0.1);
  const rareStockFactor =
    getEconomyOverrides().rareStockFactor ?? RARE_STOCK_FACTOR;
  return isRareGear(gear) ? byTech * rareStockFactor : byTech;
}

export function soldOutKey(planetId: string, gearId: string): string {
  return `${planetId}|${gearId}`;
}

export function shopBucket(
  day: number,
  refreshEveryDays: number = SHOP_REFRESH_DAYS,
): number {
  const nonce = getEconomyOverrides().shopRerollNonce ?? 0;
  return Math.floor(day / Math.max(1, refreshEveryDays)) + nonce;
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
    soldOutGear,
  } = opts;
  const bucket = shopBucket(day, refreshEveryDays);
  const listings: GearListing[] = [];

  const minDayReduction = getEconomyOverrides().minDayReduction ?? 0;
  for (const gear of GEAR_CATALOG) {
    if (maxTechLevel !== undefined && gear.techLevel > maxTechLevel) continue;
    if (gear.minDay !== undefined && day < gear.minDay - minDayReduction)
      continue;
    if (
      isRareGear(gear) &&
      soldOutGear?.[soldOutKey(planetId, gear.id)] === bucket
    ) {
      continue;
    }
    const rng = new SeededRNG(`${seed}|shop|${planetId}|${bucket}|${gear.id}`);
    if (rng.next() > stockChance(gear)) continue;
    const jitter = rng.nextFloat(0.9, 1.15);
    const price = gearMarketPrice(gear, priceFactor * jitter);
    listings.push({ systemId, planetId, gear, price });
  }
  return listings;
}

export function generateGalaxyGear(
  planets: {
    systemId: string;
    planetId: string;
    priceFactor?: number;
    maxTechLevel?: number;
  }[],
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
        maxTechLevel: p.maxTechLevel,
      }),
    );
  }
  return all;
}

export type { Gear };
