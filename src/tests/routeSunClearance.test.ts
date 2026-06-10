/**
 * Playtest 2 finding ③ (fly-through): the route builder must NEVER produce a
 * path point inside the sun's exclusion ring — including the destination
 * itself. The sprint-3 property test only sampled endpoints OUTSIDE the ring
 * (planets/edges), so a free click ON or BEHIND the sun routed the ship
 * straight into the star: avoidStarPath bowed around the disc and then
 * delivered the ship to the in-ring click point.
 *
 * Contract under test: avoidStarPath clamps an in-ring destination to the
 * exclusion ring edge (radially), so every produced point — final point
 * included — keeps ≥ R from the star center, for ANY start/end pair.
 */
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
    // Same bearing as the original point (3-4-5 triangle).
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
    // Ship far left, click 58px from the star center — deep inside R=390.
    const path = avoidStarPath(-800, 0, 50, 30, 0, 0, 390);
    for (const p of path) {
      expect(Math.hypot(p.x, p.y)).toBeGreaterThanOrEqual(390 - 1e-6);
    }
    // The route still heads toward the click bearing: it ends on the ring at
    // the clicked point's bearing from the star.
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

  // Property test over ANY start/end pair — destinations sampled anywhere,
  // including deep inside the ring (free click-to-point routes have no planet
  // to keep them out). EVERY produced point, final included, keeps clearance.
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
      // Ship start: outside the ring, like a real parked/cruising ship.
      const angA = rnd() * Math.PI * 2;
      const distA = R * 1.15 + 100 + rnd() * 3000;
      const a = {
        x: sx + Math.cos(angA) * distA,
        y: sy + Math.sin(angA) * distA,
      };
      // Destination: ANYWHERE — 0..3000px from the star, so roughly a fifth of
      // the samples land inside the ring (the fly-through case).
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
