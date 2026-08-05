import { describe, it, expect } from "vitest";
import {
  shipTurnRate,
  bankingAngle,
  approachRoll,
  DEFAULT_BANKING,
  type BankingConfig,
} from "@/presentation/flight/combatBanking";
import { BANKING } from "@/config/balance";

const CFG: BankingConfig = DEFAULT_BANKING;

describe("BANKING config parity (single source of truth)", () => {
  it("balance.ts BANKING mirrors the module default", () => {
    expect(DEFAULT_BANKING).toEqual({
      rollPerTurnRate: BANKING.rollPerTurnRate,
      maxRollAngle: BANKING.maxRollAngle,
      rollSmoothingPerMs: BANKING.rollSmoothingPerMs,
    });
  });
});

describe("shipTurnRate — signed turn rate from two headings", () => {
  it("is zero when the heading is unchanged", () => {
    expect(shipTurnRate(1, 1, 16)).toBe(0);
  });

  it("is positive turning one way, negative the other, magnitude = delta/dt", () => {
    expect(shipTurnRate(0, 0.1, 10)).toBeCloseTo(0.01, 10);
    expect(shipTurnRate(0, -0.1, 10)).toBeCloseTo(-0.01, 10);
  });

  it("wraps across ±π to the shortest rotation (no spurious huge turn)", () => {
    const rate = shipTurnRate(Math.PI - 0.05, -(Math.PI - 0.05), 10);
    expect(Math.abs(rate)).toBeCloseTo(0.1 / 10, 10);
  });

  it("is zero for a non-positive dt or a non-finite heading", () => {
    expect(shipTurnRate(0, 0.5, 0)).toBe(0);
    expect(shipTurnRate(0, 0.5, -5)).toBe(0);
    expect(shipTurnRate(Number.NaN, 0.5, 10)).toBe(0);
    expect(shipTurnRate(0, Number.POSITIVE_INFINITY, 10)).toBe(0);
  });
});

describe("bankingAngle — turn rate → roll, clamped (Task 11)", () => {
  it("is level (0) for no turn", () => {
    expect(bankingAngle(0, CFG)).toBe(0);
  });

  it("banks into the turn — sign follows the turn direction", () => {
    expect(bankingAngle(0.001, CFG)).toBeGreaterThan(0);
    expect(bankingAngle(-0.001, CFG)).toBeLessThan(0);
  });

  it("is linear in turn rate below the clamp", () => {
    const small = 0.001;
    expect(bankingAngle(small, CFG)).toBeCloseTo(
      small * CFG.rollPerTurnRate,
      10,
    );
    expect(bankingAngle(2 * small, CFG)).toBeCloseTo(
      2 * bankingAngle(small, CFG),
      10,
    );
  });

  it("magnitude is monotonic in turn-rate magnitude", () => {
    expect(bankingAngle(0.002, CFG)).toBeGreaterThan(bankingAngle(0.001, CFG));
    expect(Math.abs(bankingAngle(-0.002, CFG))).toBeGreaterThan(
      Math.abs(bankingAngle(-0.001, CFG)),
    );
  });

  it("clamps to ±maxRollAngle for an outsized turn rate (lag / time-scale guard)", () => {
    expect(bankingAngle(10, CFG)).toBeCloseTo(CFG.maxRollAngle, 10);
    expect(bankingAngle(-10, CFG)).toBeCloseTo(-CFG.maxRollAngle, 10);
  });

  it("a full-rate ShipPhysics turn lands right at the clamp", () => {
    const maxTurnRate = Math.PI / 2 / 300;
    expect(bankingAngle(maxTurnRate, CFG)).toBeCloseTo(CFG.maxRollAngle, 6);
    expect(bankingAngle(maxTurnRate, CFG)).toBeLessThanOrEqual(
      CFG.maxRollAngle,
    );
  });

  it("never exceeds the clamp across a sweep of turn rates", () => {
    for (let r = -1; r <= 1; r += 0.05) {
      expect(Math.abs(bankingAngle(r, CFG))).toBeLessThanOrEqual(
        CFG.maxRollAngle + 1e-9,
      );
    }
  });

  it("is level (0) for a non-finite turn rate", () => {
    expect(bankingAngle(Number.NaN, CFG)).toBe(0);
    expect(bankingAngle(Number.POSITIVE_INFINITY, CFG)).toBe(0);
  });
});

describe("approachRoll — smooth roll-in / roll-out easing", () => {
  it("steps toward the target at the smoothing rate when far", () => {
    const next = approachRoll(0, CFG.maxRollAngle, 10, CFG);
    expect(next).toBeCloseTo(CFG.rollSmoothingPerMs * 10, 10);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(CFG.maxRollAngle);
  });

  it("snaps to the target (no overshoot) when within one step", () => {
    const target = 0.001;
    expect(approachRoll(0, target, 100, CFG)).toBe(target);
  });

  it("eases both up and down toward the target", () => {
    const next = approachRoll(CFG.maxRollAngle, 0, 10, CFG);
    expect(next).toBeLessThan(CFG.maxRollAngle);
    expect(next).toBeGreaterThan(0);
  });

  it("holds the current roll for a non-positive dt", () => {
    expect(approachRoll(0.2, 0.5, 0, CFG)).toBe(0.2);
    expect(approachRoll(0.2, 0.5, -3, CFG)).toBe(0.2);
  });

  it("converges to the target over repeated steps", () => {
    let roll = 0;
    const target = bankingAngle(0.003, CFG);
    for (let i = 0; i < 100; i++) roll = approachRoll(roll, target, 16, CFG);
    expect(roll).toBeCloseTo(target, 10);
  });
});
