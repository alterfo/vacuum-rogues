import { describe, it, expect } from "vitest";
import {
  combatReach,
  minTurnRadius,
  clampDestinationToReach,
  previewTrajectory,
  applyPlannedMovement,
  SHIP_ROTATION_SPEED,
  type ShipMotionProfile,
} from "@/presentation/flight/combatTrajectory";
import { ShipPhysics, SHIP_STOP_THRESHOLD } from "@/systems/ShipPhysics";
import { COMBAT_ROUND_MS } from "@/config/balance";

const profile: ShipMotionProfile = {
  maxSpeed: 0.11, // px/ms (starter engine tier)
  rotationSpeed: SHIP_ROTATION_SPEED,
};

describe("combatReach — trajectory line length scaled by engine potency (Task 3)", () => {
  it("is maxSpeed × roundMs (distance coverable in one execute window)", () => {
    expect(combatReach(profile, COMBAT_ROUND_MS)).toBeCloseTo(
      0.11 * COMBAT_ROUND_MS,
      6,
    );
  });

  it("a more potent (faster) engine draws a strictly longer line", () => {
    const slow = combatReach(
      { maxSpeed: 0.08, rotationSpeed: SHIP_ROTATION_SPEED },
      COMBAT_ROUND_MS,
    );
    const fast = combatReach(
      { maxSpeed: 0.22, rotationSpeed: SHIP_ROTATION_SPEED },
      COMBAT_ROUND_MS,
    );
    expect(fast).toBeGreaterThan(slow);
    expect(fast).toBeCloseTo(
      2 *
        combatReach(
          { maxSpeed: 0.11, rotationSpeed: SHIP_ROTATION_SPEED },
          COMBAT_ROUND_MS,
        ),
      6,
    );
  });

  it("never returns a negative reach for degenerate inputs", () => {
    expect(
      combatReach({ maxSpeed: -1, rotationSpeed: 0.1 }, COMBAT_ROUND_MS),
    ).toBe(0);
    expect(combatReach(profile, -100)).toBe(0);
  });
});

describe("minTurnRadius — maneuverability constraint (Task 3)", () => {
  it("is maxSpeed ÷ rotationSpeed", () => {
    expect(minTurnRadius(profile)).toBeCloseTo(0.11 / SHIP_ROTATION_SPEED, 6);
  });

  it("a ship that cannot turn has an infinite turn radius", () => {
    expect(minTurnRadius({ maxSpeed: 0.11, rotationSpeed: 0 })).toBe(Infinity);
  });
});

describe("clampDestinationToReach (Task 3)", () => {
  const from = { x: 0, y: 0 };

  it("leaves a within-reach click unchanged and flags it reachable", () => {
    const { dest, reachable } = clampDestinationToReach(
      from,
      { x: 30, y: 40 },
      100,
    ); // dist 50
    expect(dest).toEqual({ x: 30, y: 40 });
    expect(reachable).toBe(true);
  });

  it("pulls a too-far click back onto the reach circle along the ray", () => {
    const reach = 50;
    const { dest, reachable } = clampDestinationToReach(
      from,
      { x: 300, y: 400 },
      reach,
    ); // dist 500
    expect(reachable).toBe(false);
    const d = Math.sqrt(dest.x * dest.x + dest.y * dest.y);
    expect(d).toBeCloseTo(reach, 6);
    expect(dest.x / dest.y).toBeCloseTo(300 / 400, 6); // direction preserved
  });

  it("returns the origin for a click at the ship / a non-positive reach", () => {
    expect(clampDestinationToReach(from, { x: 0, y: 0 }, 100).dest).toEqual({
      x: 0,
      y: 0,
    });
    const zero = clampDestinationToReach(from, { x: 10, y: 0 }, 0);
    expect(zero.dest).toEqual({ x: 0, y: 0 });
    expect(zero.reachable).toBe(false);
  });
});

describe("previewTrajectory — arc-radius constraint honored (Task 3)", () => {
  const reach = combatReach(profile, COMBAT_ROUND_MS);
  const maxTurnPerStep = SHIP_ROTATION_SPEED * 50; // rad per default sample

  function segmentAngles(pts: { x: number; y: number }[]): number[] {
    const angs: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      angs.push(Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x));
    }
    return angs;
  }

  it("never turns faster than the min-turn-radius rate between consecutive segments", () => {
    const pts = previewTrajectory(
      profile,
      { x: 0, y: 0 },
      0,
      { x: -400, y: 0 },
      reach,
    );
    expect(pts.length).toBeGreaterThan(3);
    const angs = segmentAngles(pts);
    for (let i = 1; i < angs.length; i++) {
      let diff = angs[i] - angs[i - 1];
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      expect(Math.abs(diff)).toBeLessThanOrEqual(maxTurnPerStep + 1e-9);
    }
  });

  it("does not snap straight to a behind-target (first step keeps the initial heading arc)", () => {
    const pts = previewTrajectory(
      profile,
      { x: 0, y: 0 },
      0,
      { x: -400, y: 0 },
      reach,
    );
    const firstSeg = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
    expect(Math.abs(firstSeg)).toBeLessThanOrEqual(maxTurnPerStep + 1e-9);
  });

  it("the cumulative arc length never exceeds the reach", () => {
    const pts = previewTrajectory(
      profile,
      { x: 0, y: 0 },
      0,
      { x: -400, y: 0 },
      reach,
    );
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    expect(len).toBeLessThanOrEqual(reach + 1e-6);
  });

  it("an aligned, in-reach destination previews an essentially straight run that reaches it", () => {
    const dest = { x: 200, y: 0 }; // straight ahead, within reach (reach ≈ 330)
    const pts = previewTrajectory(profile, { x: 0, y: 0 }, 0, dest, reach);
    const last = pts[pts.length - 1];
    expect(Math.hypot(last.x - dest.x, last.y - dest.y)).toBeLessThanOrEqual(
      SHIP_STOP_THRESHOLD + profile.maxSpeed * 50,
    );
    for (const p of pts) expect(Math.abs(p.y)).toBeLessThan(1);
  });

  it("returns just the origin for a zero-reach / zero-speed profile", () => {
    expect(
      previewTrajectory(profile, { x: 5, y: 5 }, 0, { x: 9, y: 9 }, 0),
    ).toEqual([{ x: 5, y: 5 }]);
    expect(
      previewTrajectory(
        { maxSpeed: 0, rotationSpeed: SHIP_ROTATION_SPEED },
        { x: 5, y: 5 },
        0,
        { x: 9, y: 9 },
        100,
      ),
    ).toEqual([{ x: 5, y: 5 }]);
  });
});

describe("applyPlannedMovement — confirmed course handed to ShipPhysics (Task 3)", () => {
  it("sets the ship's path to exactly the planned destination (matches the click target)", () => {
    const physics = new ShipPhysics(0, 0, 0.11, 0);
    const dest = { x: 150, y: -80 };
    expect(applyPlannedMovement(dest, physics)).toBe(true);
    expect(physics.getTargetX()).toBe(150);
    expect(physics.getTargetY()).toBe(-80);
    expect(physics.isMoving).toBe(true);
  });

  it("flying the applied path arrives at the click target", () => {
    const physics = new ShipPhysics(0, 0, 0.11, 0);
    const dest = { x: 120, y: 60 };
    applyPlannedMovement(dest, physics);
    for (let i = 0; i < 4000 && physics.isMoving; i++) physics.update(50);
    expect(
      Math.hypot(physics.shipX - dest.x, physics.shipY - dest.y),
    ).toBeLessThanOrEqual(SHIP_STOP_THRESHOLD + 1);
  });

  it("a null destination holds position (no path set)", () => {
    const physics = new ShipPhysics(0, 0, 0.11, 0);
    expect(applyPlannedMovement(null, physics)).toBe(false);
    expect(physics.isMoving).toBe(false);
  });

  it("a missing physics handle is a safe no-op", () => {
    expect(applyPlannedMovement({ x: 1, y: 2 }, null)).toBe(false);
  });
});
