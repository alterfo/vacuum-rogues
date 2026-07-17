import { describe, it, expect } from "vitest";
import {
  resolveShieldedDamage,
  barFraction,
  shieldFlashAlpha,
  DEFAULT_SHIELD_COMBAT,
} from "@/presentation/flight/combatShield";
import { SHIELD_COMBAT } from "@/config/balance";
import { applyShieldRestore } from "@/presentation/flight/combatConsumable";

describe("combatShield — shield-vs-hull damage ordering (Task 12)", () => {
  it("balance/module config parity (tune-in-one-place)", () => {
    expect(DEFAULT_SHIELD_COMBAT).toEqual(SHIELD_COMBAT);
  });

  describe("resolveShieldedDamage", () => {
    it("shields absorb the whole hit when they exceed the damage — no hull overflow", () => {
      const r = resolveShieldedDamage(100, 30);
      expect(r.shieldAbsorbed).toBe(30);
      expect(r.shields).toBe(70);
      expect(r.hullDamage).toBe(0);
      expect(r.shieldHit).toBe(true);
    });

    it("overflow spills to the hull once shields are exhausted", () => {
      const r = resolveShieldedDamage(20, 50);
      expect(r.shieldAbsorbed).toBe(20);
      expect(r.shields).toBe(0);
      expect(r.hullDamage).toBe(30);
      expect(r.shieldHit).toBe(true);
    });

    it("with shields already down, the whole hit hits the hull and there is no shield-hit flash", () => {
      const r = resolveShieldedDamage(0, 40);
      expect(r.shieldAbsorbed).toBe(0);
      expect(r.shields).toBe(0);
      expect(r.hullDamage).toBe(40);
      expect(r.shieldHit).toBe(false);
    });

    it("exact-drain hit leaves shields at 0 with no overflow", () => {
      const r = resolveShieldedDamage(25, 25);
      expect(r.shields).toBe(0);
      expect(r.hullDamage).toBe(0);
      expect(r.shieldHit).toBe(true);
    });

    it("a zero-damage hit is a no-op split (no absorb, no flash)", () => {
      const r = resolveShieldedDamage(50, 0);
      expect(r.shieldAbsorbed).toBe(0);
      expect(r.shields).toBe(50);
      expect(r.hullDamage).toBe(0);
      expect(r.shieldHit).toBe(false);
    });

    it("guards non-finite / negative inputs (treated as 0, never leaks a bad value)", () => {
      const nan = resolveShieldedDamage(Number.NaN, 30);
      expect(nan.shields).toBe(0);
      expect(nan.hullDamage).toBe(30);
      const negDmg = resolveShieldedDamage(40, -10);
      expect(negDmg.shieldAbsorbed).toBe(0);
      expect(negDmg.shields).toBe(40);
      expect(negDmg.hullDamage).toBe(0);
      const negShield = resolveShieldedDamage(-5, 20);
      expect(negShield.shields).toBe(0);
      expect(negShield.hullDamage).toBe(20);
    });

    it("round-trips with Task 9's applyShieldRestore (same [0,max] pool semantics)", () => {
      // Drain, then a shield cell restores toward max — the two agree on what a shield value means.
      const drained = resolveShieldedDamage(100, 60).shields; // 40
      expect(drained).toBe(40);
      const restored = applyShieldRestore(drained, 100, 30); // 70, clamped to max, never reduced
      expect(restored).toBe(70);
      // A full restore can't exceed max.
      expect(applyShieldRestore(drained, 100, 1000)).toBe(100);
    });
  });

  describe("barFraction", () => {
    it("maps current/max into [0,1]", () => {
      expect(barFraction(50, 100)).toBe(0.5);
      expect(barFraction(100, 100)).toBe(1);
      expect(barFraction(0, 100)).toBe(0);
    });

    it("clamps over-full to 1 and negative to 0", () => {
      expect(barFraction(150, 100)).toBe(1);
      expect(barFraction(-20, 100)).toBe(0);
    });

    it("a non-positive / non-finite max is an empty bar (shield-less ship)", () => {
      expect(barFraction(10, 0)).toBe(0);
      expect(barFraction(10, -5)).toBe(0);
      expect(barFraction(10, Number.NaN)).toBe(0);
    });

    it("a non-finite current reads as empty, not NaN", () => {
      expect(barFraction(Number.NaN, 100)).toBe(0);
    });
  });

  describe("shieldFlashAlpha", () => {
    it("peaks at the hit instant and fades linearly to 0 over shieldFlashMs", () => {
      const dur = DEFAULT_SHIELD_COMBAT.shieldFlashMs;
      const peak = DEFAULT_SHIELD_COMBAT.shieldFlashPeakAlpha;
      expect(shieldFlashAlpha(0)).toBeCloseTo(peak);
      expect(shieldFlashAlpha(dur / 2)).toBeCloseTo(peak / 2);
      expect(shieldFlashAlpha(dur)).toBe(0);
    });

    it("monotonically decreases across the flash lifetime", () => {
      const dur = DEFAULT_SHIELD_COMBAT.shieldFlashMs;
      let prev = shieldFlashAlpha(0);
      for (let t = dur / 8; t <= dur; t += dur / 8) {
        const a = shieldFlashAlpha(t);
        expect(a).toBeLessThanOrEqual(prev);
        prev = a;
      }
    });

    it("a negative age reads as the peak, past-duration reads as 0", () => {
      expect(shieldFlashAlpha(-10)).toBeCloseTo(
        DEFAULT_SHIELD_COMBAT.shieldFlashPeakAlpha,
      );
      expect(shieldFlashAlpha(DEFAULT_SHIELD_COMBAT.shieldFlashMs + 100)).toBe(
        0,
      );
    });

    it("a non-positive duration config yields 0 (no flash)", () => {
      expect(
        shieldFlashAlpha(10, { ...DEFAULT_SHIELD_COMBAT, shieldFlashMs: 0 }),
      ).toBe(0);
    });
  });
});
