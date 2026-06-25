import type { Galaxy } from "@/domain/Galaxy";
import { ResourceType } from "@/types";

/**
 * The persisted, lifecycle-tracked form of a discoverable trade route. A
 * RouteRumor is built from a RouteScanner `RouteCandidate` (it mirrors the same
 * route fields, structurally) plus identity (`id`) and lifecycle bookkeeping
 * (`createdDay`, `lastMarginPct`). It lives in the domain layer, so — to honour
 * the strict top→bottom dependency rule — it does not import `RouteCandidate`
 * from the systems layer; a `RouteCandidate` simply *satisfies* {@link RouteLike}
 * by structural typing, so `createRumor(candidate, day)` works directly.
 */
export interface RouteRumor {
  /** Stable id derived from the route: `${resource}:${fromSystemId}->${toSystemId}`. */
  id: string;
  resource: ResourceType;
  fromSystemId: string;
  fromPlanetId: string;
  toSystemId: string;
  toPlanetId: string;
  /** Neutral reference buy price at the source when last (re)scored. */
  fromPrice: number;
  /** Neutral reference sell price at the destination when last (re)scored. */
  toPrice: number;
  /** Margin percentage at open time (the headline number). */
  marginPct: number;
  /** Galaxy day the rumor was first opened. */
  createdDay: number;
  /** Most recently re-scored margin — drives expiry as the spread closes. */
  lastMarginPct: number;
}

/**
 * The route fields a {@link RouteRumor} shares with a RouteScanner
 * `RouteCandidate`. Declared via `Omit` so the two stay in lockstep without an
 * upward layer import.
 */
export type RouteLike = Omit<RouteRumor, "id" | "createdDay" | "lastMarginPct">;

/** Deterministic rumor id from a route's resource + endpoint systems. */
export function rumorId(route: RouteLike): string {
  return `${route.resource}:${route.fromSystemId}->${route.toSystemId}`;
}

/** Build a fresh rumor from a scanned route on a given galaxy day. */
export function createRumor(route: RouteLike, day: number): RouteRumor {
  return {
    id: rumorId(route),
    resource: route.resource,
    fromSystemId: route.fromSystemId,
    fromPlanetId: route.fromPlanetId,
    toSystemId: route.toSystemId,
    toPlanetId: route.toPlanetId,
    fromPrice: route.fromPrice,
    toPrice: route.toPrice,
    marginPct: route.marginPct,
    createdDay: day,
    lastMarginPct: route.marginPct,
  };
}

/** Russian display labels for tradeable goods (domain-local, no presentation dep). */
const RESOURCE_RU: Record<ResourceType, string> = {
  [ResourceType.FUEL]: "Топливо",
  [ResourceType.METALS]: "Металлы",
  [ResourceType.CRYSTALS]: "Кристаллы",
  [ResourceType.ORGANICS]: "Органика",
  [ResourceType.ARTIFACTS]: "Артефакты",
  [ResourceType.WEAPONS]: "Оружие",
  [ResourceType.MEDICINE]: "Медикаменты",
  [ResourceType.ELECTRONICS]: "Электроника",
  [ResourceType.LUXURY]: "Роскошь",
  [ResourceType.DATA_CORES]: "Ядра данных",
};

/** Russian label for a resource, falling back to the raw id. */
export function resourceLabelRu(resource: ResourceType): string {
  return RESOURCE_RU[resource] ?? resource;
}

/** Masked margin copy when the route touches a system the player hasn't discovered. */
export const RUMOR_MARGIN_MASKED = "маржа ~?%";

/**
 * Russian one-liner for the news/Info Center feed:
 * "Везите <товар> из <A> в <B>: маржа ~N%". Uses the rumor's live
 * `lastMarginPct` so the headline stays current as the spread closes. System
 * names are resolved from the galaxy; unknown ids fall back to the raw id.
 *
 * Partial observability: pass `maskMargin = true` to hide the profit number
 * («маржа ~?%») while keeping the route/location text — the InfoCenter masks the
 * margin when a system the route depends on hasn't been explored/visited. The
 * decision is made by the caller (presentation layer); this domain helper stays
 * pure. Default `false` keeps every existing caller's output bit-identical.
 */
export function describeRumor(
  rumor: RouteRumor,
  galaxy: Galaxy,
  maskMargin = false,
): string {
  const fromName =
    galaxy.systems.find((s) => s.id === rumor.fromSystemId)?.name ??
    rumor.fromSystemId;
  const toName =
    galaxy.systems.find((s) => s.id === rumor.toSystemId)?.name ??
    rumor.toSystemId;
  const margin = maskMargin
    ? RUMOR_MARGIN_MASKED
    : `маржа ~${Math.round(rumor.lastMarginPct)}%`;
  return `Везите ${resourceLabelRu(rumor.resource)} из ${fromName} в ${toName}: ${margin}`;
}
