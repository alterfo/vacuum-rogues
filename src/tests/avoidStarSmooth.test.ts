import { describe, it, expect } from "vitest";
import { avoidStarPath, catmullRomSpline, Point } from "@/utils/flightGeometry";

/** Angle (radians) at vertex P1 between vectors P0→P1 and P1→P2. */
function turnAngle(p0: Point, p1: Point, p2: Point): number {
  const ax = p1.x - p0.x;
  const ay = p1.y - p0.y;
  const bx = p2.x - p1.x;
  const by = p2.y - p1.y;
  const lenA = Math.hypot(ax, ay);
  const lenB = Math.hypot(bx, by);
  if (lenA < 1e-9 || lenB < 1e-9) return 0;
  const dot = (ax * bx + ay * by) / (lenA * lenB);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

const DEG30 = (30 * Math.PI) / 180;

describe("avoidStarPath smoothness (Task 4: Catmull-Rom arc)", () => {
  it("returns straight shot when path clears the star", () => {
    const path = avoidStarPath(0, 0, 1000, 0, 500, -500, 300);
    expect(path).toEqual([{ x: 1000, y: 0 }]);
  });

  it("all arc waypoints stay outside the star radius", () => {
    const R = 300;
    const path = avoidStarPath(-500, 0, 500, 0, 0, 0, R);
    expect(path.length).toBeGreaterThan(1);
    for (const p of path.slice(0, -1)) {
      expect(Math.hypot(p.x, p.y)).toBeGreaterThanOrEqual(R * 0.99);
    }
  });

  it("no sharp angles > 30° between consecutive segments (Catmull-Rom smoothness)", () => {
    // Straight path through the star at origin — worst-case arc deviation.
    const path = avoidStarPath(-600, 0, 600, 0, 0, 0, 300);
    expect(path.length).toBeGreaterThan(2);
    for (let i = 1; i < path.length - 1; i++) {
      const angle = turnAngle(path[i - 1], path[i], path[i + 1]);
      expect(angle).toBeLessThan(DEG30);
    }
  });

  it("no sharp angles when the path barely clips the star", () => {
    // Path from (-500, 280) to (500, 280) clips a star of R=300 at (0,0).
    const path = avoidStarPath(-500, 280, 500, 280, 0, 0, 300);
    for (let i = 1; i < path.length - 1; i++) {
      const angle = turnAngle(path[i - 1], path[i], path[i + 1]);
      expect(angle).toBeLessThan(DEG30);
    }
  });

  it("destination is always preserved as the last waypoint", () => {
    const path = avoidStarPath(-500, 0, 500, 0, 0, 0, 300);
    expect(path[path.length - 1]).toEqual({ x: 500, y: 0 });
  });
});

describe("catmullRomSpline", () => {
  it("passes through the first and last control point", () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
      { x: 200, y: 0 },
    ];
    const spline = catmullRomSpline(pts, 4);
    expect(spline[0]).toEqual({ x: 0, y: 0 });
    expect(spline[spline.length - 1]).toEqual({ x: 200, y: 0 });
  });

  it("returns more points than control points when samplesPerSegment > 1", () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ];
    const spline = catmullRomSpline(pts, 4);
    expect(spline.length).toBeGreaterThan(pts.length);
  });

  it("handles two-point input", () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const spline = catmullRomSpline(pts, 4);
    expect(spline.length).toBeGreaterThanOrEqual(2);
    expect(spline[spline.length - 1]).toEqual({ x: 100, y: 0 });
  });
});
