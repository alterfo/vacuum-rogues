import { describe, it, expect } from "vitest";
import {
  roundDamageBudget,
  roundAcceptsShot,
  roundIsComplete,
  type CombatRoundConfig,
} from "@/systems/combat/combatRounds";

const HALF: CombatRoundConfig = { hullFraction: 0.5 };

describe("combatRounds — roundDamageBudget", () => {
  it("scales the budget with the configured fraction of max hull", () => {
    expect(roundDamageBudget(100, HALF)).toBe(50);
    expect(roundDamageBudget(200, { hullFraction: 0.25 })).toBe(50);
    expect(roundDamageBudget(130, { hullFraction: 0.5 })).toBe(65);
  });

  it("is always strictly below full hull (never full → zero in one round)", () => {
    for (const maxHull of [10, 50, 100, 130, 360, 1000]) {
      for (const hullFraction of [0.1, 0.34, 0.5, 0.75, 0.95, 0.999]) {
        expect(roundDamageBudget(maxHull, { hullFraction })).toBeLessThan(
          maxHull,
        );
      }
    }
  });

  it("is always at least 1 (a round can always take one shot — no dead-lock)", () => {
    expect(roundDamageBudget(100, { hullFraction: 0 })).toBeGreaterThanOrEqual(
      1,
    );
    expect(roundDamageBudget(3, { hullFraction: 0.01 })).toBeGreaterThanOrEqual(
      1,
    );
    expect(roundDamageBudget(1, HALF)).toBeGreaterThanOrEqual(1);
  });

  it("clamps a malformed fraction so it can neither freeze nor one-shot the ship", () => {
    const zero = roundDamageBudget(100, { hullFraction: 0 });
    expect(zero).toBeGreaterThanOrEqual(1);
    expect(zero).toBeLessThan(100);
    const over = roundDamageBudget(100, { hullFraction: 5 });
    expect(over).toBeLessThan(100);
    const nan = roundDamageBudget(100, { hullFraction: Number.NaN });
    expect(nan).toBeGreaterThan(0);
    expect(nan).toBeLessThan(100);
  });

  it("is monotonic non-decreasing in the fraction", () => {
    const b1 = roundDamageBudget(100, { hullFraction: 0.2 });
    const b2 = roundDamageBudget(100, { hullFraction: 0.5 });
    const b3 = roundDamageBudget(100, { hullFraction: 0.8 });
    expect(b1).toBeLessThanOrEqual(b2);
    expect(b2).toBeLessThanOrEqual(b3);
  });
});

describe("combatRounds — roundAcceptsShot", () => {
  it("accepts the first shot of a round (taken = 0 < budget)", () => {
    expect(roundAcceptsShot(0, 100, HALF)).toBe(true);
  });

  it("keeps accepting until the budget is reached, then stops", () => {
    expect(roundAcceptsShot(49, 100, HALF)).toBe(true); // budget 50
    expect(roundAcceptsShot(50, 100, HALF)).toBe(false);
    expect(roundAcceptsShot(60, 100, HALF)).toBe(false);
  });

  it("simulates a committed fight capping at ≤ budget + one crossing shot", () => {
    const maxHull = 130;
    const budget = roundDamageBudget(maxHull, HALF); // 65
    let taken = 0;
    let shots = 0;
    while (roundAcceptsShot(taken, maxHull, HALF)) {
      taken += 18;
      shots += 1;
    }
    expect(taken).toBeLessThanOrEqual(budget + 18);
    expect(maxHull - taken).toBeGreaterThan(0);
    expect(shots).toBeGreaterThan(0);
  });
});

describe("combatRounds — roundIsComplete", () => {
  it("is false while the budget is unspent", () => {
    expect(roundIsComplete(0, 100, 100, HALF)).toBe(false);
  });

  it("is true once the budget is spent and the defender still lives", () => {
    expect(roundIsComplete(50, 50, 100, HALF)).toBe(true);
    expect(roundIsComplete(80, 20, 100, HALF)).toBe(true);
  });

  it("is false when the defender is dead (a kill ends the fight, not a window)", () => {
    expect(roundIsComplete(100, 0, 100, HALF)).toBe(false);
  });

  it("scales the budget DOWN off current hull, not max hull, for a damaged ship", () => {
    expect(roundIsComplete(49, 51, 100, HALF)).toBe(true);
  });

  it("a fresh (full-hull) ship's budget is unaffected — still maxHull-based", () => {
    expect(roundIsComplete(49, 100, 100, HALF)).toBe(false);
    expect(roundIsComplete(50, 100, 100, HALF)).toBe(true);
  });
});
