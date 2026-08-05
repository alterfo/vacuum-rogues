import type { RouteRenderer } from "./RouteRenderer";
import {
  combatReach,
  clampDestinationToReach,
  previewTrajectory,
  SHIP_ROTATION_SPEED,
  type ShipMotionProfile,
} from "./combatTrajectory";
import { COMBAT_ROUND_MS } from "@/config/balance";
import { clampOutsideRadius } from "@/utils/flightGeometry";

export interface PlanningDestinationSink {
  setDestination(dest: { x: number; y: number } | null): void;
}

export interface ShipKinematics {
  getMaxSpeed(): number;
  shipX: number;
  shipY: number;
  shipAngle: number;
}

export function previewCombatCourse(
  routeRenderer: RouteRenderer,
  planning: PlanningDestinationSink,
  ship: ShipKinematics,
  x: number,
  y: number,
): { x: number; y: number } {
  const profile: ShipMotionProfile = {
    maxSpeed: ship.getMaxSpeed(),
    rotationSpeed: SHIP_ROTATION_SPEED,
  };
  const reach = combatReach(profile, COMBAT_ROUND_MS);
  const from = { x: ship.shipX, y: ship.shipY };
  const { dest } = clampDestinationToReach(from, { x, y }, reach);
  planning.setDestination(dest);
  routeRenderer.drawRoute(
    previewTrajectory(profile, from, ship.shipAngle, dest, reach),
  );
  routeRenderer.drawNavigationMarker(dest.x, dest.y);
  return dest;
}

export function routePlanningClick(
  event: {
    button: number;
    shiftKey: boolean;
    global: { x: number; y: number };
  },
  ctx: {
    planning: PlanningDestinationSink & { isPlanning: boolean };
    ship: ShipKinematics | null;
    camera: { screenToWorld(x: number, y: number): { x: number; y: number } };
    star: { centerX: number; centerY: number; avoidRadius: number };
    routeRenderer: RouteRenderer;
  },
): boolean {
  if (event.button !== 0 || event.shiftKey) return false;
  if (!ctx.planning.isPlanning || !ctx.ship) return false;
  const pt = ctx.camera.screenToWorld(event.global.x, event.global.y);
  const { centerX: sx, centerY: sy, avoidRadius } = ctx.star;
  const world = clampOutsideRadius(pt.x, pt.y, sx, sy, avoidRadius);
  previewCombatCourse(ctx.routeRenderer, ctx.planning, ctx.ship, world.x, world.y); // prettier-ignore
  return true;
}
