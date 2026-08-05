import { describe, it, expect } from "vitest";
import {
  gravityAssistRadius,
  gravityAssistDelta,
  gravityAssistTotal,
  DEFAULT_GRAVITY_ASSIST,
  type GravityBody,
  type GravityShipState,
} from "@/presentation/flight/combatGravity";
import { GRAVITY_ASSIST } from "@/config/balance";

const planet: GravityBody = { x: 0, y: 0, radius: 120 };

function shipAt(x: number, y: number, vx = 0.11, vy = 0): GravityShipState {
  return { pos: { x, y }, vel: { x: vx, y: vy } };
}

const mag = (v: { x: number; y: number }) => Math.sqrt(v.x * v.x + v.y * v.y);

describe("GRAVITY_ASSIST config parity (single source of truth)", () => {
  it("balance.ts GRAVITY_ASSIST mirrors the module default", () => {
    expect(DEFAULT_GRAVITY_ASSIST).toEqual({
      radiusMultiplier: GRAVITY_ASSIST.radiusMultiplier,
      referenceRadius: GRAVITY_ASSIST.referenceRadius,
      strengthPerMs: GRAVITY_ASSIST.strengthPerMs,
      maxBoostPerMs: GRAVITY_ASSIST.maxBoostPerMs,
    });
  });
});

describe("gravityAssistRadius — the threshold reach (Task 4)", () => {
  it("is displayRadius × radiusMultiplier", () => {
    expect(gravityAssistRadius(planet)).toBeCloseTo(
      120 * DEFAULT_GRAVITY_ASSIST.radiusMultiplier,
      6,
    );
  });

  it("a larger (more massive) planet reaches farther", () => {
    expect(gravityAssistRadius({ x: 0, y: 0, radius: 240 })).toBeGreaterThan(
      gravityAssistRadius(planet),
    );
  });

  it("a zero-size body has no reach", () => {
    expect(gravityAssistRadius({ x: 0, y: 0, radius: 0 })).toBe(0);
  });
});

describe("gravityAssistDelta — slingshot vector/magnitude (Task 4)", () => {
  const reach = gravityAssistRadius(planet);

  it("is zero outside the assist radius", () => {
    const d = gravityAssistDelta(shipAt(reach + 10, 0), planet, 16);
    expect(d).toEqual({ x: 0, y: 0 });
  });

  it("adds a nonzero boost when passing within the assist radius", () => {
    const d = gravityAssistDelta(shipAt(reach * 0.5, 0), planet, 16);
    expect(mag(d)).toBeGreaterThan(0);
  });

  it("boost points along the ship's heading, not toward the planet", () => {
    const d = gravityAssistDelta(shipAt(0, reach * 0.4, 0.11, 0), planet, 16);
    expect(d.y).toBeCloseTo(0, 9);
    expect(d.x).toBeGreaterThan(0);
  });

  it("boost direction follows a diagonal heading (unit velocity)", () => {
    const ship = shipAt(reach * 0.5, 0, 0.08, 0.06); // heading up-right
    const d = gravityAssistDelta(ship, planet, 16);
    const cross = d.x * ship.vel.y - d.y * ship.vel.x;
    expect(cross).toBeCloseTo(0, 9);
    expect(d.x).toBeGreaterThan(0);
    expect(d.y).toBeGreaterThan(0);
  });

  it("a closer pass yields a strictly stronger boost (linear falloff)", () => {
    const near = mag(gravityAssistDelta(shipAt(reach * 0.2, 0), planet, 16));
    const far = mag(gravityAssistDelta(shipAt(reach * 0.8, 0), planet, 16));
    expect(near).toBeGreaterThan(far);
  });

  it("falloff reaches zero exactly at the assist edge", () => {
    const d = gravityAssistDelta(shipAt(reach - 1e-6, 0), planet, 16);
    expect(mag(d)).toBeGreaterThanOrEqual(0);
    expect(mag(d)).toBeLessThan(1e-6);
  });

  it("a more massive planet slings harder at the same distance", () => {
    const small = { x: 0, y: 0, radius: 120 };
    const big = { x: 0, y: 0, radius: 240 };
    const d = 150;
    const nSmall = mag(gravityAssistDelta(shipAt(d, 0), small, 16));
    const nBig = mag(gravityAssistDelta(shipAt(d, 0), big, 16));
    expect(nBig).toBeGreaterThan(nSmall);
  });

  it("is zero for a (near-)stationary ship — no trajectory to slingshot", () => {
    const d = gravityAssistDelta(shipAt(reach * 0.3, 0, 0, 0), planet, 16);
    expect(d).toEqual({ x: 0, y: 0 });
  });

  it("is zero for a non-positive dt", () => {
    expect(gravityAssistDelta(shipAt(reach * 0.3, 0), planet, 0)).toEqual({
      x: 0,
      y: 0,
    });
    expect(gravityAssistDelta(shipAt(reach * 0.3, 0), planet, -5)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("scales linearly with dt (integrated boost)", () => {
    const d1 = mag(gravityAssistDelta(shipAt(reach * 0.3, 0), planet, 16));
    const d2 = mag(gravityAssistDelta(shipAt(reach * 0.3, 0), planet, 32));
    expect(d2).toBeCloseTo(d1 * 2, 9);
  });

  it("is capped at maxBoostPerMs × dt even at a very close, very massive pass", () => {
    const huge: GravityBody = { x: 0, y: 0, radius: 5000 };
    const dt = 16;
    const d = gravityAssistDelta(shipAt(1, 0), huge, dt);
    expect(mag(d)).toBeLessThanOrEqual(
      DEFAULT_GRAVITY_ASSIST.maxBoostPerMs * dt + 1e-9,
    );
  });
});

describe("gravityAssistTotal — sum over multiple bodies (Task 4)", () => {
  it("sums the deltas of every body the ship is passing", () => {
    const a: GravityBody = { x: 0, y: 0, radius: 120 };
    const b: GravityBody = { x: 20, y: 0, radius: 120 };
    const ship = shipAt(80, 0);
    const total = gravityAssistTotal(ship, [a, b], 16);
    const sum = {
      x: gravityAssistDelta(ship, a, 16).x + gravityAssistDelta(ship, b, 16).x,
      y: gravityAssistDelta(ship, a, 16).y + gravityAssistDelta(ship, b, 16).y,
    };
    expect(total.x).toBeCloseTo(sum.x, 12);
    expect(total.y).toBeCloseTo(sum.y, 12);
    expect(mag(total)).toBeGreaterThan(0);
  });

  it("is zero when the ship is in no planet's assist radius", () => {
    const far: GravityBody = { x: 100000, y: 0, radius: 120 };
    expect(gravityAssistTotal(shipAt(0, 0), [far], 16)).toEqual({ x: 0, y: 0 });
  });

  it("is zero over an empty body list (plain coast)", () => {
    expect(gravityAssistTotal(shipAt(0, 0), [], 16)).toEqual({ x: 0, y: 0 });
  });
});
