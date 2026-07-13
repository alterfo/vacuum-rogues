/**
 * Draw the tactical-planning movement preview (Task 3). The pure trajectory math
 * lives in {@link combatTrajectory}; this thin presentation seam clamps a planning
 * click to reach, records it on the planned turn, and draws the achievable-arc
 * preview onto the shared {@link RouteRenderer}.
 *
 * **Renderer decision (Task 3):** reuse the existing {@link RouteRenderer} rather
 * than a new combat-scoped renderer — its `drawRoute` already dashes an arbitrary
 * polyline and `drawNavigationMarker` marks the endpoint, which is exactly the shape
 * the preview needs (the combat-specific length/arc logic is the polyline fed in,
 * from `previewTrajectory`). No new draw class is warranted.
 */

import type { RouteRenderer } from "./RouteRenderer";
import {
  combatReach,
  clampDestinationToReach,
  previewTrajectory,
  SHIP_ROTATION_SPEED,
  type ShipMotionProfile,
} from "./combatTrajectory";
import { COMBAT_ROUND_MS } from "@/config/balance";

/** The planned-turn draft the click records its destination on. */
export interface PlanningDestinationSink {
  setDestination(dest: { x: number; y: number } | null): void;
}

/** The live ship kinematics the preview reads (structural subset of `ShipPhysics`). */
export interface ShipKinematics {
  getMaxSpeed(): number;
  shipX: number;
  shipY: number;
  shipAngle: number;
}

/**
 * Handle a planning-phase movement click at world `(x,y)`: clamp it to this round's
 * reach (engine potency × round duration), record the clamped destination on the
 * planned turn, and draw the achievable-arc preview line + destination marker. The
 * clamped destination is returned for callers/tests.
 */
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
