import { describe, it, expect } from "vitest";
import {
  radarToWorld,
  avoidStarPath,
  planWarpEdgeRoute,
  planetApproachPoint,
  planetOrbitPosition,
  questMarkerRadius,
  shouldReaim,
  warpEdgePoint,
} from "@/utils/flightGeometry";

describe("planetOrbitPosition (Task 3: domain-only fallback matching PlanetSprite's own orbit math)", () => {
  it("matches PlanetSprite's constructor formula: BASE_PERIOD_DAYS=400, radius/600^1.5", () => {
    const center = { x: 400, y: 300 };
    const orbitalRadius = 600;
    const baseAngle = 0;
    const day = 200; // half of the 400-day period at radius=600 -> half a revolution
    const pos = planetOrbitPosition(orbitalRadius, baseAngle, day, center);
    expect(pos.x).toBeCloseTo(center.x - orbitalRadius, 5);
    expect(pos.y).toBeCloseTo(center.y, 5);
  });

  it("at day 0 sits exactly at baseAngle on the orbital radius", () => {
    const center = { x: 0, y: 0 };
    const pos = planetOrbitPosition(500, Math.PI / 2, 0, center);
    expect(pos.x).toBeCloseTo(0, 5);
    expect(pos.y).toBeCloseTo(500, 5);
  });
});

describe("planetApproachPoint — landing dead zone (live report 2026-07-19, Task 10)", () => {
  it("heads straight at the planet once inside the radius+offset ring (the dead zone)", () => {
    const shipX = 742.505002119266;
    const shipY = 1244.3162688035698;
    const planetX = 784.6317656732414;
    const planetY = 1089.799601245169;
    const radius = 84;
    const offset = 80;
    const dist = Math.hypot(planetX - shipX, planetY - shipY);
    expect(dist).toBeLessThan(radius + offset); // confirms the dead zone
    expect(dist).toBeGreaterThan(radius + 60); // still outside LANDING_RANGE=60

    const ap = planetApproachPoint(
      shipX,
      shipY,
      planetX,
      planetY,
      radius,
      offset,
    );

    const apToShip = Math.hypot(ap.x - shipX, ap.y - shipY);
    const apToPlanet = Math.hypot(ap.x - planetX, ap.y - planetY);
    expect(apToPlanet).toBeLessThan(dist);
    expect(apToShip).toBeGreaterThan(10);
  });

  it("still backs off to the radius+offset ring when genuinely far away (unchanged behavior)", () => {
    const ap = planetApproachPoint(0, 0, 1000, 0, 50, 30);
    expect(ap.x).toBeCloseTo(1000 - 80, 5);
    expect(ap.y).toBeCloseTo(0, 5);
  });

  it("handles the ship already coincident with the planet (degenerate distance)", () => {
    const ap = planetApproachPoint(500, 500, 500, 500, 50, 30);
    expect(Number.isFinite(ap.x)).toBe(true);
    expect(Number.isFinite(ap.y)).toBe(true);
  });
});

describe("questMarkerRadius (quest ring halos the planet, not a stray circle)", () => {
  it("scales with the planet's display radius (halo just outside the disc)", () => {
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
    expect(shouldReaim({ x: 100, y: 100 }, { x: 150, y: 100 }, 30)).toBe(true);
  });

  it("uses Euclidean drift (diagonal drift counts)", () => {
    expect(shouldReaim({ x: 0, y: 0 }, { x: 25, y: 25 }, 30)).toBe(true); // ~35px
    expect(shouldReaim({ x: 0, y: 0 }, { x: 18, y: 18 }, 30)).toBe(false); // ~25px
  });
});

describe("avoidStarPath (US-070 #6: route bows around the star)", () => {
  it("returns a straight shot when the segment already clears the star", () => {
    const path = avoidStarPath(0, 0, 1000, 0, 500, -500, 300);
    expect(path).toEqual([{ x: 1000, y: 0 }]);
  });

  it("inserts arc waypoints clear of the star when the segment cuts through it", () => {
    const path = avoidStarPath(-500, 0, 500, 0, 0, 0, 300);
    expect(path.length).toBeGreaterThan(1);
    expect(path[path.length - 1]).toEqual({ x: 500, y: 0 });
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
    const p = radarToWorld(90, 100, W, H, SCALE, 1000, 1000);
    expect(p.x).toBeCloseTo(1000);
    expect(p.y).toBeCloseTo(1000);
  });

  it("maps an offset on the radar to the scaled world offset", () => {
    const p = radarToWorld(120, 100, W, H, SCALE, 1000, 1000);
    expect(p.x).toBeCloseTo(2000);
    expect(p.y).toBeCloseTo(1000);
  });
});

describe("warpEdgePoint (Task 9 iv: committed flee-jump fires from the near edge)", () => {
  const center = { x: 1000, y: 1000 };
  const R = 2800; // SYSTEM_BOUNDARY_RADIUS
  const exitVector = { x: 1, y: 0 };

  it("a fresh entry (not mid-system) exits at the exit-direction edge", () => {
    const p = warpEdgePoint({ x: 400, y: 1000 }, center, exitVector, R, false);
    expect(p.x).toBeCloseTo(center.x + R); // 3800
    expect(p.y).toBeCloseTo(center.y);
  });

  it("a mid-system flee fires from the NEAREST edge (radially out from the ship)", () => {
    const ship = { x: 100, y: 1000 }; // 900px left of centre
    const p = warpEdgePoint(ship, center, exitVector, R, true);
    expect(p.x).toBeCloseTo(center.x - R); // 3800 to the LEFT: -1800
    expect(p.y).toBeCloseTo(center.y);
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

describe("planWarpEdgeRoute (composes warpEdgePoint + avoidStarPath for a pending warp)", () => {
  const center = { x: 1000, y: 1000 };
  const R = 2800;
  const exitVector = { x: 1, y: 0 };

  it("matches warpEdgePoint's edge and a straight route when clear of the star", () => {
    const ship = { x: 400, y: 1000 };
    const { edge, routePath } = planWarpEdgeRoute(
      ship,
      center,
      exitVector,
      R,
      false,
      { x: center.x, y: center.y + 1000 },
      300,
    );
    const expectedEdge = warpEdgePoint(ship, center, exitVector, R, false);
    expect(edge).toEqual(expectedEdge);
    expect(routePath).toEqual([{ x: expectedEdge.x, y: expectedEdge.y }]);
  });

  it("routes a mid-system flee to the near edge, bowing around the star if needed", () => {
    const ship = { x: 1000, y: 400 }; // straight above the star
    const { edge, routePath } = planWarpEdgeRoute(
      ship,
      center,
      exitVector,
      R,
      true,
      center,
      2000, // large avoidance radius forces a bypass around the straight line
    );
    expect(edge.x).toBeCloseTo(center.x);
    expect(edge.y).toBeCloseTo(center.y - R);
    expect(routePath.length).toBeGreaterThan(1); // bowed, not a straight shot
  });
});
