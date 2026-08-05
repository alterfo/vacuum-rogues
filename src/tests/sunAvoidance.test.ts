import { describe, it, expect } from "vitest";
import { avoidStarPath, Point } from "@/utils/flightGeometry";
import {
  SUN_EXCLUSION_RADIUS,
  SUN_CONTACT_HULL_DAMAGE,
  SUN_CONTACT_DAMAGE_INTERVAL_MS,
  SYSTEM_GEOMETRY,
} from "@/config/balance";

describe("sun avoidance — waypoints never enter the exclusion radius", () => {
  function minClearance(path: Point[], sx: number, sy: number): number {
    return Math.min(...path.map((p) => Math.hypot(p.x - sx, p.y - sy)));
  }

  const EPS = 1e-6;

  it("exposes a positive exclusion radius aliased to the geometry config", () => {
    expect(SUN_EXCLUSION_RADIUS).toBeGreaterThan(0);
    expect(SUN_EXCLUSION_RADIUS).toBe(SYSTEM_GEOMETRY.starAvoidRadius);
  });

  it("returns a straight shot when the path already clears the sun", () => {
    const R = SUN_EXCLUSION_RADIUS;
    const path = avoidStarPath(2000, 0, 2000, 2000, 0, 0, R);
    expect(path).toEqual([{ x: 2000, y: 2000 }]);
  });

  it("bows around the sun at the real game radius (390px)", () => {
    const R = SUN_EXCLUSION_RADIUS; // 390
    const path = avoidStarPath(-1500, 0, 1500, 0, 0, 0, R);
    expect(path.length).toBeGreaterThan(2);
    expect(minClearance(path, 0, 0)).toBeGreaterThanOrEqual(R - EPS);
  });

  it("keeps waypoints outside the exclusion radius for an off-centre star", () => {
    const R = SUN_EXCLUSION_RADIUS;
    const sx = 800;
    const sy = -200;
    const path = avoidStarPath(-400, -200, 2000, -200, sx, sy, R);
    expect(path.length).toBeGreaterThan(2);
    expect(minClearance(path, sx, sy)).toBeGreaterThanOrEqual(R - EPS);
  });

  it("keeps waypoints outside the exclusion radius when the path only grazes the sun", () => {
    const R = SUN_EXCLUSION_RADIUS;
    const grazeY = R - 20;
    const path = avoidStarPath(-1200, grazeY, 1200, grazeY, 0, 0, R);
    expect(path.length).toBeGreaterThan(1);
    expect(minClearance(path, 0, 0)).toBeGreaterThanOrEqual(R - EPS);
  });

  it("preserves the destination as the final waypoint", () => {
    const R = SUN_EXCLUSION_RADIUS;
    const path = avoidStarPath(-1500, 0, 1500, 0, 0, 0, R);
    expect(path[path.length - 1]).toEqual({ x: 1500, y: 0 });
  });
});

describe("sun contact damage — rate-limited burn", () => {
  function simulateBurn(deltasMs: number[]): number {
    let timer = 0;
    let burned = 0;
    for (const dt of deltasMs) {
      timer += dt;
      while (timer >= SUN_CONTACT_DAMAGE_INTERVAL_MS) {
        timer -= SUN_CONTACT_DAMAGE_INTERVAL_MS;
        burned += SUN_CONTACT_HULL_DAMAGE;
      }
    }
    return burned;
  }

  it("applies no damage before the first interval elapses", () => {
    expect(simulateBurn(Array(8).fill(16))).toBe(0);
  });

  it("applies exactly one chunk after a single interval", () => {
    expect(simulateBurn([SUN_CONTACT_DAMAGE_INTERVAL_MS])).toBe(
      SUN_CONTACT_HULL_DAMAGE,
    );
  });

  it("applies one chunk per interval over a long graze", () => {
    const frames = Array(Math.round(2050 / 16)).fill(16);
    expect(simulateBurn(frames)).toBe(4 * SUN_CONTACT_HULL_DAMAGE);
  });

  it("does not drain the hull frame-by-frame regardless of frame rate", () => {
    const tiny = Array(500).fill(1);
    expect(simulateBurn(tiny)).toBe(SUN_CONTACT_HULL_DAMAGE);
  });
});
