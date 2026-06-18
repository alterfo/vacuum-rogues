import type { Galaxy } from "@/domain/Galaxy";
import type { Planet } from "@/domain/Planet";
import type { ResourceType } from "@/types";

/**
 * A discoverable buy-low → sell-high arbitrage opportunity between two planets
 * in *different* star systems. Produced by {@link scanTradeRoutes} and later
 * published to the player as a TRADE_OPPORTUNITY rumor.
 */
export interface RouteCandidate {
  resource: ResourceType;
  fromSystemId: string;
  fromPlanetId: string;
  toSystemId: string;
  toPlanetId: string;
  /** Neutral reference buy price at the source planet. */
  fromPrice: number;
  /** Neutral reference sell price at the destination planet. */
  toPrice: number;
  /** (toPrice − fromPrice) / fromPrice as a percentage (e.g. 35 = +35%). */
  marginPct: number;
}

/**
 * Faction/rank-neutral price lookup. Decoupled from `Player` so the scanner can
 * read the *true* galaxy spread (see `TradeSystem.referenceMarketPrice`).
 */
export type ReferencePriceFn = (
  planet: Planet,
  resource: ResourceType,
) => number;

export interface ScanOptions {
  /** Maximum number of ranked routes to return. */
  maxRoutes: number;
  /**
   * Minimum margin percentage a route must *exceed* to be included. Defaults to
   * 0, so only routes with a real positive spread are returned.
   */
  minMarginPct?: number;
}

interface PricePoint {
  systemId: string;
  planetId: string;
  price: number;
}

/**
 * Scan the galaxy for the best cross-system trade routes. For each resource the
 * scanner finds the single most profitable buy→sell pair whose two planets sit
 * in *different* systems (same-system arbitrage is excluded — the trade system
 * guarantees a same-planet loss via SELL_SPREAD), then ranks all per-resource
 * routes by margin descending. Deterministic: ties break by ids, so the same
 * galaxy + price function always yields the same ordering.
 */
export function scanTradeRoutes(
  galaxy: Galaxy,
  priceFn: ReferencePriceFn,
  opts: ScanOptions,
): RouteCandidate[] {
  const minMargin = opts.minMarginPct ?? 0;

  // Bucket every market's price points by resource.
  const byResource = new Map<ResourceType, PricePoint[]>();
  for (const system of galaxy.systems) {
    for (const planet of system.planets) {
      const market = planet.market;
      if (!market) continue;
      for (const resource of market.availableResources) {
        const price = priceFn(planet, resource);
        if (!(price > 0)) continue;
        let list = byResource.get(resource);
        if (!list) {
          list = [];
          byResource.set(resource, list);
        }
        list.push({ systemId: system.id, planetId: planet.id, price });
      }
    }
  }

  const candidates: RouteCandidate[] = [];
  for (const [resource, points] of byResource) {
    const route = bestCrossSystemRoute(resource, points, minMargin);
    if (route) candidates.push(route);
  }

  candidates.sort(compareRoutes);
  return candidates.slice(0, Math.max(0, opts.maxRoutes));
}

/** Margin percentage of buying at `buy` and selling at `sell`. */
function marginOf(buy: number, sell: number): number {
  if (!(buy > 0)) return Number.NEGATIVE_INFINITY;
  return ((sell - buy) / buy) * 100;
}

/** Lowest price wins; deterministic tie-break by ids ascending. */
function cheaper(a: PricePoint, b: PricePoint): boolean {
  if (a.price !== b.price) return a.price < b.price;
  if (a.systemId !== b.systemId) return a.systemId < b.systemId;
  return a.planetId < b.planetId;
}

/** Highest price wins; deterministic tie-break by ids ascending. */
function dearer(a: PricePoint, b: PricePoint): boolean {
  if (a.price !== b.price) return a.price > b.price;
  if (a.systemId !== b.systemId) return a.systemId < b.systemId;
  return a.planetId < b.planetId;
}

function cheapest(
  points: PricePoint[],
  pred?: (p: PricePoint) => boolean,
): PricePoint | null {
  let best: PricePoint | null = null;
  for (const p of points) {
    if (pred && !pred(p)) continue;
    if (best === null || cheaper(p, best)) best = p;
  }
  return best;
}

function dearest(
  points: PricePoint[],
  pred?: (p: PricePoint) => boolean,
): PricePoint | null {
  let best: PricePoint | null = null;
  for (const p of points) {
    if (pred && !pred(p)) continue;
    if (best === null || dearer(p, best)) best = p;
  }
  return best;
}

/**
 * The single best cross-system buy→sell pair for one resource. The optimal pair
 * is the global cheapest buy and global dearest sell; if those land in the same
 * system, the best cross-system pair is provably one of (global cheapest →
 * dearest-elsewhere) or (cheapest-elsewhere → global dearest), so only those two
 * fallbacks need checking.
 */
function bestCrossSystemRoute(
  resource: ResourceType,
  points: PricePoint[],
  minMargin: number,
): RouteCandidate | null {
  if (points.length < 2) return null;

  const gMin = cheapest(points)!;
  const gMax = dearest(points)!;

  let from: PricePoint | null;
  let to: PricePoint | null;

  if (gMin.systemId !== gMax.systemId) {
    from = gMin;
    to = gMax;
  } else {
    const sys = gMin.systemId;
    const altTo = dearest(points, (p) => p.systemId !== sys);
    const altFrom = cheapest(points, (p) => p.systemId !== sys);
    const marginA = altTo
      ? marginOf(gMin.price, altTo.price)
      : Number.NEGATIVE_INFINITY;
    const marginB = altFrom
      ? marginOf(altFrom.price, gMax.price)
      : Number.NEGATIVE_INFINITY;
    if (
      marginA === Number.NEGATIVE_INFINITY &&
      marginB === Number.NEGATIVE_INFINITY
    ) {
      return null;
    }
    if (marginA >= marginB) {
      from = gMin;
      to = altTo;
    } else {
      from = altFrom;
      to = gMax;
    }
  }

  if (!from || !to) return null;
  const marginPct = marginOf(from.price, to.price);
  if (!(marginPct > minMargin)) return null;

  return {
    resource,
    fromSystemId: from.systemId,
    fromPlanetId: from.planetId,
    toSystemId: to.systemId,
    toPlanetId: to.planetId,
    fromPrice: from.price,
    toPrice: to.price,
    marginPct,
  };
}

/** Margin descending, then a deterministic id-based tie-break. */
function compareRoutes(a: RouteCandidate, b: RouteCandidate): number {
  if (a.marginPct !== b.marginPct) return b.marginPct - a.marginPct;
  if (a.resource !== b.resource) return a.resource < b.resource ? -1 : 1;
  if (a.fromSystemId !== b.fromSystemId)
    return a.fromSystemId < b.fromSystemId ? -1 : 1;
  if (a.toSystemId !== b.toSystemId)
    return a.toSystemId < b.toSystemId ? -1 : 1;
  if (a.fromPlanetId !== b.fromPlanetId)
    return a.fromPlanetId < b.fromPlanetId ? -1 : 1;
  if (a.toPlanetId !== b.toPlanetId)
    return a.toPlanetId < b.toPlanetId ? -1 : 1;
  return 0;
}
