import { describe, it, expect } from "vitest";
import {
  dayTickMarks,
  radarToWorld,
  avoidStarPath,
} from "@/utils/flightGeometry";

describe("dayTickMarks (US-070 #7: per-day route divisions)", () => {
  it("places a tick every distancePerDay along a straight route", () => {
    const ticks = dayTickMarks(
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
      ],
      500,
    );
    expect(ticks).toHaveLength(2);
    expect(ticks[0].x).toBeCloseTo(500);
    expect(ticks[1].x).toBeCloseTo(1000);
    // Perpendicular to a horizontal segment is vertical.
    expect(ticks[0].px).toBeCloseTo(0);
    expect(Math.abs(ticks[0].py)).toBeCloseTo(1);
  });

  it("crosses segment boundaries of a curved (multi-waypoint) path", () => {
    // Two segments totalling 800px; one day-mark falls on the second segment.
    const ticks = dayTickMarks(
      [
        { x: 0, y: 0 },
        { x: 0, y: 300 },
        { x: 0, y: 800 },
      ],
      500,
    );
    expect(ticks).toHaveLength(1);
    expect(ticks[0].x).toBeCloseTo(0);
    expect(ticks[0].y).toBeCloseTo(500);
  });

  it("returns nothing for degenerate input", () => {
    expect(dayTickMarks([{ x: 0, y: 0 }], 500)).toEqual([]);
    expect(
      dayTickMarks(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        0,
      ),
    ).toEqual([]);
    // Trip shorter than one day → no divisions yet.
    expect(
      dayTickMarks(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        500,
      ),
    ).toEqual([]);
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
