import { describe, it, expect } from "vitest";
import { radarToWorld, avoidStarPath } from "@/utils/flightGeometry";

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
