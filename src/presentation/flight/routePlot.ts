import type { RouteRenderer } from "./RouteRenderer";
import { pointAlongPath } from "@/utils/flightGeometry";

interface Vec2 {
  x: number;
  y: number;
}

export interface PlotPlannedRouteArgs {
  shipPos: Vec2 | null;
  plannedRoute: Vec2 | null;
  isTurnRunning: boolean;
  routePath: Vec2[];
  isPlanetAt(x: number, y: number): boolean;
  distancePerDay: number;
}

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
  const path = args.routePath.length > 0 ? args.routePath : [plannedRoute];
  const points = [{ x: shipPos.x, y: shipPos.y }, ...path];
  const { x: toX, y: toY } = plannedRoute;

  routeRenderer.drawRoute(points);

  if (args.isPlanetAt(toX, toY)) {
    routeRenderer.drawLandingMarker(toX, toY);
  } else {
    routeRenderer.drawNavigationMarker(toX, toY);
  }

  const dayPoint = pointAlongPath(points, args.distancePerDay);
  if (!dayPoint.done) {
    routeRenderer.drawDayMarker(dayPoint.x, dayPoint.y);
  }
}

export interface QuestNavHost<TPlanet extends { id: string }> {
  planets(): readonly { planet: TPlanet; screenX: number; screenY: number }[];
  hasShip(): boolean;
  planRouteTo(x: number, y: number): void;
  openPlanetPanel(planet: TPlanet): void;
  openStarMapOn(systemId: string): void;
  systemForLocation(locationId: string): { id: string } | null;
}

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
