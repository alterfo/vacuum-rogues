import { describe, it, expect } from "vitest";
import {
  decideManeuver,
  ManeuverMode,
  BREAK_OFF_HULL_RATIO,
  ORBIT_RANGE_FRACTION,
} from "@/systems/combat/combatManeuver";

const WEAPON_RANGE = 240;

/** Base input: aggressor at origin, target on the +X axis at `range`, both at
 *  equal cruise speed and full hull. Override fields per case. */
function input(over: Partial<Parameters<typeof decideManeuver>[0]> = {}) {
  const range = over.range ?? 500;
  const targetX = over.targetX ?? range;
  const targetY = over.targetY ?? 0;
  return {
    range,
    weaponRange: WEAPON_RANGE,
    selfSpeed: 0.2,
    targetSpeed: 0.2,
    selfX: 0,
    selfY: 0,
    targetX,
    targetY,
    hullRatio: 1,
    orbitDir: 1 as const,
    ...over,
  };
}

/** Smallest signed difference between two angles, normalized to (-π, π]. */
function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

describe("decideManeuver — mode selection", () => {
  it("far from the target → CLOSE (drive straight in)", () => {
    const d = decideManeuver(input({ range: 500, targetX: 500 }));
    expect(d.mode).toBe(ManeuverMode.CLOSE);
  });

  it("inside weapon range → ORBIT (circle, don't tail)", () => {
    const orbitRange = WEAPON_RANGE * ORBIT_RANGE_FRACTION;
    const d = decideManeuver(input({ range: orbitRange, targetX: orbitRange }));
    expect(d.mode).toBe(ManeuverMode.ORBIT);
  });

  it("low hull → BREAK_OFF even when in range", () => {
    const d = decideManeuver(
      input({
        range: 100,
        targetX: 100,
        hullRatio: BREAK_OFF_HULL_RATIO - 0.05,
      }),
    );
    expect(d.mode).toBe(ManeuverMode.BREAK_OFF);
  });

  it("out-matched (faster target still out of range) → BREAK_OFF", () => {
    const d = decideManeuver(
      input({ range: 500, targetX: 500, selfSpeed: 0.2, targetSpeed: 0.35 }),
    );
    expect(d.mode).toBe(ManeuverMode.BREAK_OFF);
  });

  it("a faster target already in range is still ORBITed (fire while you can)", () => {
    const d = decideManeuver(
      input({ range: 150, targetX: 150, selfSpeed: 0.2, targetSpeed: 0.35 }),
    );
    expect(d.mode).toBe(ManeuverMode.ORBIT);
  });

  it("at exactly weapon range counts as in range → ORBIT", () => {
    const d = decideManeuver(
      input({ range: WEAPON_RANGE, targetX: WEAPON_RANGE }),
    );
    expect(d.mode).toBe(ManeuverMode.ORBIT);
  });
});

describe("decideManeuver — heading math", () => {
  it("CLOSE heading points straight at the target", () => {
    const d = decideManeuver(input({ range: 500, targetX: 300, targetY: 400 }));
    expect(d.mode).toBe(ManeuverMode.CLOSE);
    expect(angleDiff(d.heading, Math.atan2(400, 300))).toBeCloseTo(0, 6);
  });

  it("BREAK_OFF heading points directly away from the target", () => {
    const d = decideManeuver(
      input({ range: 100, targetX: 100, targetY: 0, hullRatio: 0.1 }),
    );
    expect(d.mode).toBe(ManeuverMode.BREAK_OFF);
    // Target on +X → flee along -X (heading ≈ π).
    expect(Math.abs(angleDiff(d.heading, Math.PI))).toBeCloseTo(0, 6);
  });

  it("ORBIT at the orbit radius is exactly tangential (perpendicular to range)", () => {
    const orbitRange = WEAPON_RANGE * ORBIT_RANGE_FRACTION;
    const d = decideManeuver(
      input({ range: orbitRange, targetX: 0, targetY: orbitRange }),
    );
    expect(d.mode).toBe(ManeuverMode.ORBIT);
    const toTarget = Math.atan2(orbitRange, 0); // +Y
    // Tangential → heading is perpendicular to the line to the target.
    expect(Math.abs(angleDiff(d.heading, toTarget))).toBeCloseTo(
      Math.PI / 2,
      4,
    );
  });

  it("orbit direction flips the tangential heading", () => {
    const orbitRange = WEAPON_RANGE * ORBIT_RANGE_FRACTION;
    const cw = decideManeuver(
      input({ range: orbitRange, targetX: orbitRange, orbitDir: 1 }),
    );
    const ccw = decideManeuver(
      input({ range: orbitRange, targetX: orbitRange, orbitDir: -1 }),
    );
    // Same geometry, opposite circling direction → headings are π apart.
    expect(Math.abs(angleDiff(cw.heading, ccw.heading))).toBeCloseTo(
      Math.PI,
      4,
    );
  });

  it("ORBIT too far (but in range) biases the heading inward toward the target", () => {
    // range above the orbit radius but at/below weapon range → still ORBIT, with
    // a radial component pulling the ship back toward the desired circle.
    const d = decideManeuver(
      input({ range: WEAPON_RANGE, targetX: WEAPON_RANGE, orbitDir: 1 }),
    );
    expect(d.mode).toBe(ManeuverMode.ORBIT);
    const toTarget = 0; // +X
    // cos(headingError) > 0 means the heading leans toward the target (inward).
    expect(Math.cos(angleDiff(d.heading, toTarget))).toBeGreaterThan(0);
  });

  it("ORBIT too close biases the heading outward away from the target", () => {
    const tooClose = WEAPON_RANGE * ORBIT_RANGE_FRACTION * 0.5;
    const d = decideManeuver(
      input({ range: tooClose, targetX: tooClose, orbitDir: 1 }),
    );
    expect(d.mode).toBe(ManeuverMode.ORBIT);
    const toTarget = 0; // +X
    // cos(headingError) < 0 means the heading leans away from the target (outward).
    expect(Math.cos(angleDiff(d.heading, toTarget))).toBeLessThan(0);
  });
});

describe("decideManeuver — boundary cases", () => {
  it("identical positions (range 0) yield a finite heading, never NaN", () => {
    // atan2(0, 0) = 0; the radial-bias clamp keeps the heading finite even when
    // the aggressor sits exactly on the target. A NaN heading would freeze or
    // teleport the sprite (cos/sin(NaN) = NaN).
    const d = decideManeuver(input({ range: 0, targetX: 0, targetY: 0 }));
    expect(d.mode).toBe(ManeuverMode.ORBIT);
    expect(Number.isFinite(d.heading)).toBe(true);
  });

  it("hull exactly at the break-off threshold does NOT break off (strict <)", () => {
    // The guard is `hullRatio < BREAK_OFF_HULL_RATIO`; equality must keep fighting,
    // so an off-by-one flip to `<=` is caught here.
    const d = decideManeuver(
      input({ range: 500, targetX: 500, hullRatio: BREAK_OFF_HULL_RATIO }),
    );
    expect(d.mode).not.toBe(ManeuverMode.BREAK_OFF);
    expect(d.mode).toBe(ManeuverMode.CLOSE);
  });

  it("equal target speed out of range does NOT break off (strict >)", () => {
    // `outmatched` is `targetSpeed > selfSpeed`; an exactly-matched target is not
    // out-matched, so the aggressor keeps closing rather than fleeing. Guards an
    // off-by-one flip to `>=`.
    const d = decideManeuver(
      input({ range: 500, targetX: 500, selfSpeed: 0.2, targetSpeed: 0.2 }),
    );
    expect(d.mode).toBe(ManeuverMode.CLOSE);
  });
});
