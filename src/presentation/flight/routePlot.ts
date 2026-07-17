/**
 * Plot the planned-course overlay onto a {@link RouteRenderer}. Extracted verbatim
 * from `SpaceFlightScene.plotRoute` (which now delegates here) to keep the scene
 * under its line-count guard while combat trajectory planning (Task 3) adds wiring.
 *
 * Route planning (the ship→waypoints→destination polyline + landing-vs-nav marker
 * decision) stays the scene's job — this helper just draws what it's told. Behavior
 * is byte-for-byte the same as the inline version (`routeHideWhileMoving.test.ts`,
 * `routeMatchesPath.test.ts`).
 */

import type { RouteRenderer } from "./RouteRenderer";
import { pointAlongPath } from "@/utils/flightGeometry";

interface Vec2 {
  x: number;
  y: number;
}

/** Scene state the plot reads (all resolved live by the caller). */
export interface PlotPlannedRouteArgs {
  /** Live ship position, or null when there's no ship yet (early boot). */
  shipPos: Vec2 | null;
  /** The committed planned destination, or null when nothing is planned. */
  plannedRoute: Vec2 | null;
  /** While a turn is running the overlay is cleared (route hidden mid-flight). */
  isTurnRunning: boolean;
  /** Curved waypoints (star-bow / spiral-in), empty for a clear shot. */
  routePath: Vec2[];
  /** Whether a planet sits at (x,y) — chooses landing vs navigation marker. */
  isPlanetAt(x: number, y: number): boolean;
  /** Px per in-game day, for the one-day-travel marker. */
  distancePerDay: number;
}

/** Draw the planned course (polyline + end marker + one-day marker). */
export function plotPlannedRoute(
  routeRenderer: RouteRenderer,
  args: PlotPlannedRouteArgs,
): void {
  const { shipPos, plannedRoute } = args;
  if (!shipPos || !plannedRoute) return;

  if (args.isTurnRunning) {
    routeRenderer.clearRoute();
    return;
  }
  // Polyline ship → (curved waypoints) → destination (bare destination on a clear shot).
  const path = args.routePath.length > 0 ? args.routePath : [plannedRoute];
  const points = [{ x: shipPos.x, y: shipPos.y }, ...path];
  const { x: toX, y: toY } = plannedRoute;

  routeRenderer.drawRoute(points);

  // Landing marker when the target sits on a planet, else a navigation marker.
  if (args.isPlanetAt(toX, toY)) {
    routeRenderer.drawLandingMarker(toX, toY);
  } else {
    routeRenderer.drawNavigationMarker(toX, toY);
  }

  // One-day-travel marker: only when the route is longer than one day's travel —
  // a shorter route has no meaningful midpoint (it would coincide with the end).
  const dayPoint = pointAlongPath(points, args.distancePerDay);
  if (!dayPoint.done) {
    routeRenderer.drawDayMarker(dayPoint.x, dayPoint.y);
  }
}

/** The scene actions quest-objective navigation drives (extracted verbatim from
 *  `SpaceFlightScene.navigateToQuestObjective` for the line guard, 14.5c). */
export interface QuestNavHost<TPlanet extends { id: string }> {
  /** The current system's planet sprites (id + live screen position). */
  planets(): readonly { planet: TPlanet; screenX: number; screenY: number }[];
  hasShip(): boolean;
  planRouteTo(x: number, y: number): void;
  /** Open the planet's info panel alongside the plotted route. */
  openPlanetPanel(planet: TPlanet): void;
  /** The quest target lives in another system → open the star map on it. */
  openStarMapOn(systemId: string): void;
  /** Resolve which system a location id (planet/system) belongs to. */
  systemForLocation(locationId: string): { id: string } | null;
}

/**
 * Navigate the ship toward a quest objective: an in-system planet gets a normal
 * plotted route + its info panel; a target in another (possibly unreachable)
 * system opens the star map pre-selected on it so the player plots the warp.
 */
export function navigateToQuestTarget<TPlanet extends { id: string }>(
  host: QuestNavHost<TPlanet>,
  locationId: string,
): void {
  const here = host.planets().find((s) => s.planet.id === locationId);
  if (here && host.hasShip()) {
    host.planRouteTo(here.screenX, here.screenY);
    host.openPlanetPanel(here.planet);
    return;
  }
  const target = host.systemForLocation(locationId);
  if (target) host.openStarMapOn(target.id);
}
