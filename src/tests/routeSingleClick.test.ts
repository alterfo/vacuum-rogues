import { describe, it, expect } from "vitest";
import { PanZoomController } from "@/systems/PanZoomController";
import { planetApproachPoint } from "@/utils/flightGeometry";

describe("Task 2: single planet click plans a persistent route to the disc edge", () => {
  it("first click plans a route that pointerup does NOT clear", () => {
    const ctrl = new PanZoomController();
    let plannedRoute: { x: number; y: number } | null = null;

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

    const distToCenter = Math.hypot(
      approach.x - planet.x,
      approach.y - planet.y,
    );
    expect(distToCenter).toBeCloseTo(planet.radius + offset);
    expect(distToCenter).toBeGreaterThan(planet.radius);

    ctrl.onMove(approach.x + 3, approach.y + 2);

    if (ctrl.shouldSwallowClick()) {
      plannedRoute = null; // clearPlannedRoute()
    }
    ctrl.reset();

    expect(plannedRoute).not.toBeNull();
    expect(plannedRoute).toEqual(approach);
  });

  it("a genuine drag gesture (LMB in empty space) still clears the route", () => {
    const ctrl = new PanZoomController();
    let plannedRoute: { x: number; y: number } | null = null;

    ctrl.startDragTracking(100, 100);
    plannedRoute = { x: 300, y: 200 };

    ctrl.onMove(260, 100);

    if (ctrl.shouldSwallowClick()) {
      plannedRoute = null; // clearPlannedRoute()
    }
    ctrl.reset();

    expect(plannedRoute).toBeNull();
  });
});
