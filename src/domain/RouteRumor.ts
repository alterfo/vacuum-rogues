import type { Galaxy } from "@/domain/Galaxy";
import { t } from "@/i18n/i18n";
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

/**
 * Localized label for a tradeable good, resolved live through i18n
 * (`resource.<TYPE>` in `ru.ts`/`en.ts`). The name is kept for its many call
 * sites (the RU label was the historical behaviour and is the default-language
 * value); it now renders in the active language instead of a hardcoded map.
 */
export function resourceLabelRu(resource: ResourceType): string {
  return t(`resource.${resource}`);
}

/** Masked margin copy when the route touches a system the player hasn't discovered. */
export function rumorMarginMasked(): string {
  return t("rumor.marginMasked");
}

/**
 * One-liner for the news/Info Center feed, e.g. (RU) "Везите <товар> из <A> в
 * <B>: маржа ~N%" — rendered in the **active language** via i18n (`rumor.line` +
 * `rumor.margin`). Uses the rumor's live `lastMarginPct` so the headline stays
 * current as the spread closes. System names are resolved from the galaxy;
 * unknown ids fall back to the raw id.
 *
 * Partial observability: pass `maskMargin = true` to hide the profit number
 * («маржа ~?%») while keeping the route/location text — the InfoCenter masks the
 * margin when a system the route depends on hasn't been explored/visited. The
 * decision is made by the caller (presentation layer); this helper stays pure
 * given the active language. Default `false` keeps every existing caller's
 * RU output bit-identical.
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
    ? rumorMarginMasked()
    : t("rumor.margin", { pct: Math.round(rumor.lastMarginPct) });
  return t("rumor.line", {
    resource: resourceLabelRu(rumor.resource),
    from: fromName,
    to: toName,
    margin,
  });
}
