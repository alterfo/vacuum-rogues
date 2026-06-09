import { describe, it, expect } from "vitest";
import {
  bowedPath,
  spiralApproachPath,
  takeoffArcPath,
  pointAlongPath,
  leadInterceptPoint,
  avoidStarPath,
  type Point,
} from "@/utils/flightGeometry";

/** Max perpendicular deviation of a polyline from the straight start→end chord. */
function maxChordDeviation(points: Point[], from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len; // unit perpendicular
  const ny = dx / len;
  let max = 0;
  for (const p of points) {
    const dev = Math.abs((p.x - from.x) * nx + (p.y - from.y) * ny);
    if (dev > max) max = dev;
  }
  return max;
}

describe("bowedPath (Task 5: curved manoeuvring arc)", () => {
  it("returns a curved multi-point arc ending at the target", () => {
    const path = bowedPath(0, 0, 100, 0, 0.2);
    expect(path.length).toBeGreaterThan(1);
    const last = path[path.length - 1];
    expect(last.x).toBeCloseTo(100);
    expect(last.y).toBeCloseTo(0);
    // The arc bows ~20px (0.2 * 100) off the straight chord.
    expect(
      maxChordDeviation(path, { x: 0, y: 0 }, { x: 100, y: 0 }),
    ).toBeGreaterThan(12);
  });

  it("flips bow direction with the sign of bowFrac", () => {
    const up = bowedPath(0, 0, 100, 0, 0.2);
    const down = bowedPath(0, 0, 100, 0, -0.2);
    const upMid = up[Math.floor(up.length / 2)];
    const downMid = down[Math.floor(down.length / 2)];
    expect(Math.sign(upMid.y)).toBe(-Math.sign(downMid.y));
  });

  it("returns a straight single point when bowFrac is zero or degenerate", () => {
    expect(bowedPath(0, 0, 100, 0, 0)).toEqual([{ x: 100, y: 0 }]);
    expect(bowedPath(5, 5, 5, 5, 0.2)).toEqual([{ x: 5, y: 5 }]);
  });
});

describe("spiralApproachPath (Task 5: curved landing insertion)", () => {
  it("ends at the orbit-edge approach point and curves toward it", () => {
    // Ship at origin, planet to the right (radius 30, approach offset 80).
    const path = spiralApproachPath(0, 0, 200, 0, 30, 80);
    expect(path.length).toBeGreaterThan(1);
    const last = path[path.length - 1];
    // Approach point sits radius+offset short of the planet centre (200 - 110).
    expect(last.x).toBeCloseTo(90);
    expect(last.y).toBeCloseTo(0);
    // Path bows off the straight beeline rather than driving at the disc.
    expect(
      maxChordDeviation(path, { x: 0, y: 0 }, { x: 90, y: 0 }),
    ).toBeGreaterThan(3);
  });

  it("never routes to the planet centre", () => {
    const path = spiralApproachPath(0, 0, 200, 0, 30, 80);
    for (const p of path) {
      expect(Math.hypot(p.x - 200, p.y - 0)).toBeGreaterThan(30);
    }
  });
});

describe("takeoffArcPath (Task 5: outward lift-off arc)", () => {
  it("starts at the planet edge and arcs out beyond it", () => {
    // Planet at origin, outward direction +x, radius 30, fly 90px out.
    const path = takeoffArcPath(0, 0, 1, 0, 30, 90);
    expect(path.length).toBeGreaterThan(2);
    // Lift-off point is on the planet surface (radius 30 from centre).
    expect(path[0].x).toBeCloseTo(30);
    expect(path[0].y).toBeCloseTo(0);
    // End point is radius + outDist beyond the centre (30 + 90 = 120).
    const last = path[path.length - 1];
    expect(last.x).toBeCloseTo(120);
    expect(last.y).toBeCloseTo(0);
    // The manoeuvre curves (not a straight radial slide).
    expect(
      maxChordDeviation(path, { x: 30, y: 0 }, { x: 120, y: 0 }),
    ).toBeGreaterThan(8);
  });
});

describe("pointAlongPath (Task 5: take-off animation sampling)", () => {
  const poly: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];

  it("returns the start point at distance 0", () => {
    const s = pointAlongPath(poly, 0);
    expect(s.x).toBeCloseTo(0);
    expect(s.y).toBeCloseTo(0);
    expect(s.done).toBe(false);
  });

  it("interpolates within a segment with that segment's heading", () => {
    const s = pointAlongPath(poly, 15); // 5px into the vertical second segment
    expect(s.x).toBeCloseTo(10);
    expect(s.y).toBeCloseTo(5);
    expect(s.heading).toBeCloseTo(Math.PI / 2);
    expect(s.done).toBe(false);
  });

  it("clamps to the final point and reports done past the end", () => {
    const s = pointAlongPath(poly, 1000);
    expect(s.x).toBeCloseTo(10);
    expect(s.y).toBeCloseTo(10);
    expect(s.done).toBe(true);
  });
});

describe("leadInterceptPoint (Task 5: curved intercept lead)", () => {
  it("leads a crossing target so the pursuer aims ahead of it", () => {
    // Shooter at origin (speed 1); target 10px right, drifting +y at 0.5.
    const lead = leadInterceptPoint(0, 0, 1, 10, 0, 0, 0.5);
    // Lead is ahead of the target along its velocity (+y).
    expect(lead.y).toBeGreaterThan(0);
    // Time to fly to the lead matches the time for the target to reach it.
    const flightTime = Math.hypot(lead.x, lead.y) / 1;
    const targetTime = (lead.y - 0) / 0.5;
    expect(flightTime).toBeCloseTo(targetTime, 3);
  });

  it("returns the target's position for a stationary target", () => {
    const lead = leadInterceptPoint(0, 0, 1, 25, -7, 0, 0);
    expect(lead.x).toBeCloseTo(25);
    expect(lead.y).toBeCloseTo(-7);
  });

  it("falls back to the target when no positive-time intercept exists", () => {
    // Target flees directly away faster than the pursuer can close.
    const lead = leadInterceptPoint(0, 0, 1, 10, 0, 2, 0);
    expect(lead.x).toBeCloseTo(10);
    expect(lead.y).toBeCloseTo(0);
  });
});

describe("route line arc (Task 5: route bends visibly around the sun)", () => {
  it("yields a multi-segment polyline that clears the star", () => {
    // Straight shot would pass through a star at the origin (R = 300).
    const path = avoidStarPath(-500, 0, 500, 0, 0, 0, 300);
    expect(path.length).toBeGreaterThan(2); // curved, not a single straight leg
    const full: Point[] = [{ x: -500, y: 0 }, ...path];
    // Every rendered vertex stays outside the exclusion radius.
    for (const p of full.slice(0, -1)) {
      expect(Math.hypot(p.x, p.y)).toBeGreaterThanOrEqual(300 - 1e-6);
    }
    // The polyline bows well off the straight chord (a visible arc).
    expect(
      maxChordDeviation(full, { x: -500, y: 0 }, { x: 500, y: 0 }),
    ).toBeGreaterThan(50);
  });
});
