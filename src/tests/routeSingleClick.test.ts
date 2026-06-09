/**
 * Task 2 (Sprint 2): a single planet click must plan a route that SURVIVES the
 * trailing pointerup — it must not clear immediately. This models the full
 * mock event sequence the scene runs:
 *
 *   1. pointerdown on the planet sprite → stopPropagation() → onPlanetClick:
 *      plans a route to the planet's disc edge (planetApproachPoint). Because
 *      the sprite stops propagation, the stage's onPointerDown (which would
 *      call startDragTracking) never runs.
 *   2. an incidental pointermove between press and release.
 *   3. pointerup on the stage → onPointerUp: clears the planned route only when
 *      shouldSwallowClick() is true (i.e. a real drag gesture).
 *
 * Regression guard: before the fix, step 2 computed a large _dragDistance from a
 * stale origin, making shouldSwallowClick() return true and wiping the freshly
 * planned route on the very first click.
 */
import { describe, it, expect } from "vitest";
import { PanZoomController } from "@/systems/PanZoomController";
import { planetApproachPoint } from "@/utils/flightGeometry";

describe("Task 2: single planet click plans a persistent route to the disc edge", () => {
  it("first click plans a route that pointerup does NOT clear", () => {
    const ctrl = new PanZoomController();
    let plannedRoute: { x: number; y: number } | null = null;

    // (1) pointerdown on the planet sprite → onPlanetClick → planRouteTo(approach).
    // stopPropagation means startDragTracking is never called for this gesture.
    const ship = { x: 0, y: 500 };
    const planet = { x: 500, y: 500, radius: 60 };
    const offset = 80;
    const approach = planetApproachPoint(
      ship.x,
      ship.y,
      planet.x,
      planet.y,
      planet.radius,
      offset,
    );
    plannedRoute = approach;

    // Endpoint sits at the disc edge (radius + offset), never the planet centre.
    const distToCenter = Math.hypot(
      approach.x - planet.x,
      approach.y - planet.y,
    );
    expect(distToCenter).toBeCloseTo(planet.radius + offset);
    expect(distToCenter).toBeGreaterThan(planet.radius);

    // (2) incidental pointermove between press and release.
    ctrl.onMove(approach.x + 3, approach.y + 2);

    // (3) pointerup → onPointerUp: clear only if the gesture was a drag.
    if (ctrl.shouldSwallowClick()) {
      plannedRoute = null; // clearPlannedRoute()
    }
    ctrl.reset();

    // The single click committed a route that is still present.
    expect(plannedRoute).not.toBeNull();
    expect(plannedRoute).toEqual(approach);
  });

  it("a genuine drag gesture (LMB in empty space) still clears the route", () => {
    const ctrl = new PanZoomController();
    let plannedRoute: { x: number; y: number } | null = null;

    // Empty-space click: the stage's onPointerDown runs and tracks the drag.
    ctrl.startDragTracking(100, 100);
    plannedRoute = { x: 300, y: 200 };

    // The pointer is dragged well beyond the threshold before release.
    ctrl.onMove(260, 100);

    if (ctrl.shouldSwallowClick()) {
      plannedRoute = null; // clearPlannedRoute()
    }
    ctrl.reset();

    expect(plannedRoute).toBeNull();
  });
});
