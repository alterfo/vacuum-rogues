import { describe, it, expect } from "vitest";
import {
  radarToWorld,
  avoidStarPath,
  questMarkerRadius,
  shouldReaim,
  warpEdgePoint,
} from "@/utils/flightGeometry";

describe("questMarkerRadius (quest ring halos the planet, not a stray circle)", () => {
  it("scales with the planet's display radius (halo just outside the disc)", () => {
    // Bug: a fixed 25px ring sat INSIDE a large planet disc, reading as a random
    // circle. The ring must now encircle the disc → radius > displayRadius.
    expect(questMarkerRadius(60)).toBe(70);
    expect(questMarkerRadius(120)).toBe(130);
    expect(questMarkerRadius(60)).toBeGreaterThan(60);
    expect(questMarkerRadius(40, 6)).toBe(46);
  });
});

describe("shouldReaim (continuous course-correction toward a moving target)", () => {
  it("does not re-aim while the target stays near the route endpoint", () => {
    expect(shouldReaim({ x: 100, y: 100 }, { x: 110, y: 105 }, 30)).toBe(false);
  });

  it("re-aims once the target drifts beyond the threshold", () => {
    // Endpoint at (100,100); the moving target's fresh lead is now 50px away.
    expect(shouldReaim({ x: 100, y: 100 }, { x: 150, y: 100 }, 30)).toBe(true);
  });

  it("uses Euclidean drift (diagonal drift counts)", () => {
    expect(shouldReaim({ x: 0, y: 0 }, { x: 25, y: 25 }, 30)).toBe(true); // ~35px
    expect(shouldReaim({ x: 0, y: 0 }, { x: 18, y: 18 }, 30)).toBe(false); // ~25px
  });
});

describe("avoidStarPath (US-070 #6: route bows around the star)", () => {
  it("returns a straight shot when the segment already clears the star", () => {
    // Path along y=0; star far above at (500,-500), well outside R=300.
    const path = avoidStarPath(0, 0, 1000, 0, 500, -500, 300);
    expect(path).toEqual([{ x: 1000, y: 0 }]);
  });

  it("inserts arc waypoints clear of the star when the segment cuts through it", () => {
    // Straight line passes through the star at the origin.
    const path = avoidStarPath(-500, 0, 500, 0, 0, 0, 300);
    expect(path.length).toBeGreaterThan(1);
    // Destination is preserved as the last point.
    expect(path[path.length - 1]).toEqual({ x: 500, y: 0 });
    // Every intermediate waypoint sits outside the star radius.
    for (const p of path.slice(0, -1)) {
      expect(Math.hypot(p.x, p.y)).toBeGreaterThanOrEqual(300);
    }
  });
});

describe("radarToWorld (US-070 #2: minimap drag-to-pan mapping)", () => {
  const W = 180;
  const H = 180;
  const SCALE = 0.03;

  it("maps the radar centre to the system centre", () => {
    // Radar centre is (W/2, H/2 + titleOffset).
    const p = radarToWorld(90, 100, W, H, SCALE, 1000, 1000);
    expect(p.x).toBeCloseTo(1000);
    expect(p.y).toBeCloseTo(1000);
  });

  it("maps an offset on the radar to the scaled world offset", () => {
    // 30px right of centre at 0.03 scale → 1000px in world.
    const p = radarToWorld(120, 100, W, H, SCALE, 1000, 1000);
    expect(p.x).toBeCloseTo(2000);
    expect(p.y).toBeCloseTo(1000);
  });
});

describe("warpEdgePoint (Task 9 iv: committed flee-jump fires from the near edge)", () => {
  const center = { x: 1000, y: 1000 };
  const R = 2800; // SYSTEM_BOUNDARY_RADIUS
  // Destination lies to the right, so a fresh warp exits at the right-hand edge.
  const exitVector = { x: 1, y: 0 };

  it("a fresh entry (not mid-system) exits at the exit-direction edge", () => {
    // Ship anywhere; fresh warp ignores its position and heads to the exit edge.
    const p = warpEdgePoint({ x: 400, y: 1000 }, center, exitVector, R, false);
    expect(p.x).toBeCloseTo(center.x + R); // 3800
    expect(p.y).toBeCloseTo(center.y);
  });

  it("a mid-system flee fires from the NEAREST edge (radially out from the ship)", () => {
    // Ship fleeing on the LEFT of the star while the destination is to the RIGHT.
    // The old behaviour beelined right across the whole system past pursuers;
    // now it exits at the nearest (left) edge instead.
    const ship = { x: 100, y: 1000 }; // 900px left of centre
    const p = warpEdgePoint(ship, center, exitVector, R, true);
    expect(p.x).toBeCloseTo(center.x - R); // 3800 to the LEFT: -1800
    expect(p.y).toBeCloseTo(center.y);
    // And the crossing to the near edge is far shorter than to the far edge.
    const nearDist = Math.hypot(p.x - ship.x, p.y - ship.y);
    const farDist = Math.hypot(center.x + R - ship.x, center.y - ship.y);
    expect(nearDist).toBeLessThan(farDist);
  });

  it("the near-edge point always lies on the boundary circle", () => {
    const ship = { x: 1600, y: 400 };
    const p = warpEdgePoint(ship, center, exitVector, R, true);
    expect(Math.hypot(p.x - center.x, p.y - center.y)).toBeCloseTo(R);
  });

  it("a ship exactly at the centre degrades to the exit-direction edge (no NaN)", () => {
    const p = warpEdgePoint(center, center, exitVector, R, true);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
    expect(Math.hypot(p.x - center.x, p.y - center.y)).toBeCloseTo(R);
  });
});
