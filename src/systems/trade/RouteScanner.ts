import type { Galaxy } from "@/domain/Galaxy";
import type { Planet } from "@/domain/Planet";
import type { ResourceType } from "@/types";

export interface RouteCandidate {
  resource: ResourceType;
  fromSystemId: string;
  fromPlanetId: string;
  toSystemId: string;
  toPlanetId: string;
  fromPrice: number;
  toPrice: number;
  marginPct: number;
}

export type ReferencePriceFn = (
  planet: Planet,
  resource: ResourceType,
) => number;

export interface ScanOptions {
  maxRoutes: number;
  minMarginPct?: number;
}

interface PricePoint {
  systemId: string;
  planetId: string;
  price: number;
}

export function scanTradeRoutes(
  galaxy: Galaxy,
  priceFn: ReferencePriceFn,
  opts: ScanOptions,
): RouteCandidate[] {
  const minMargin = opts.minMarginPct ?? 0;

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

function marginOf(buy: number, sell: number): number {
  if (!(buy > 0)) return Number.NEGATIVE_INFINITY;
  return ((sell - buy) / buy) * 100;
}

function cheaper(a: PricePoint, b: PricePoint): boolean {
  if (a.price !== b.price) return a.price < b.price;
  if (a.systemId !== b.systemId) return a.systemId < b.systemId;
  return a.planetId < b.planetId;
}

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
