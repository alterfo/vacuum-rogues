import { describe, it, expect } from "vitest";
import { avoidStarPath, clampOutsideRadius } from "@/utils/flightGeometry";

describe("clampOutsideRadius", () => {
  it("returns the point unchanged when it is outside the radius", () => {
    const p = clampOutsideRadius(500, 0, 0, 0, 390);
    expect(p.x).toBeCloseTo(500);
    expect(p.y).toBeCloseTo(0);
  });

  it("projects an inside point radially out to the ring", () => {
    const p = clampOutsideRadius(30, 40, 0, 0, 390); // dist 50, angle preserved
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(390);
    expect(p.x / p.y).toBeCloseTo(30 / 40);
    expect(p.x).toBeGreaterThan(0);
    expect(p.y).toBeGreaterThan(0);
  });

  it("handles a click exactly on the center deterministically", () => {
    const p = clampOutsideRadius(100, 200, 100, 200, 390);
    expect(Math.hypot(p.x - 100, p.y - 200)).toBeCloseTo(390);
  });
});

describe("avoidStarPath sun clearance (playtest 2 ③: no fly-through)", () => {
  it("clamps a destination inside the exclusion ring to its edge", () => {
    const path = avoidStarPath(-800, 0, 50, 30, 0, 0, 390);
    for (const p of path) {
      expect(Math.hypot(p.x, p.y)).toBeGreaterThanOrEqual(390 - 1e-6);
    }
    const last = path[path.length - 1];
    const clickAngle = Math.atan2(30, 50);
    expect(Math.atan2(last.y, last.x)).toBeCloseTo(clickAngle, 5);
  });

  it("clamps a click exactly on the star center", () => {
    const path = avoidStarPath(-800, 0, 0, 0, 0, 0, 390);
    for (const p of path) {
      expect(Math.hypot(p.x, p.y)).toBeGreaterThanOrEqual(390 - 1e-6);
    }
  });

  it("keeps every path point ≥ R from the star for random routes incl. in-ring clicks", () => {
    let seed = 0x51ce950d;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    for (let k = 0; k < 5000; k++) {
      const sx = (rnd() - 0.5) * 1000;
      const sy = (rnd() - 0.5) * 1000;
      const R = 150 + rnd() * 350;
      const angA = rnd() * Math.PI * 2;
      const distA = R * 1.15 + 100 + rnd() * 3000;
      const a = {
        x: sx + Math.cos(angA) * distA,
        y: sy + Math.sin(angA) * distA,
      };
      const angB = rnd() * Math.PI * 2;
      const distB = rnd() * 3000;
      const b = {
        x: sx + Math.cos(angB) * distB,
        y: sy + Math.sin(angB) * distB,
      };
      const path = avoidStarPath(a.x, a.y, b.x, b.y, sx, sy, R);
      for (const p of path) {
        expect(Math.hypot(p.x - sx, p.y - sy)).toBeGreaterThanOrEqual(R - 1e-6);
      }
    }
  });
});
