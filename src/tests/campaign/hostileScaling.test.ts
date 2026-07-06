/**
 * Adaptive hostile combat scaling (three-year-campaign Task 4) — the pure
 * `hostileScaling(powerIndex, gameMode)` helper that revives the dead
 * OVERMIND_COMBAT_HP_MULT / OVERMIND_COMBAT_DAMAGE_MULT levers.
 *
 * Contract locked here:
 *  - weak player (ratcheted index 0) faces a gentle ~0.9× garrison;
 *  - maxed player (index 1) faces the full OVERMIND_COMBAT_*_MULT (1.5×);
 *  - monotone in power; input clamped to [0,1];
 *  - HARD composes an extra multiplier from DIFFICULTY_HOSTILE_SCALING —
 *    config-only, never at call sites; NORMAL and GOD are identical baselines;
 *  - garrison count bonus on Overmind systems: 0 while weak, up to
 *    OVERMIND_GARRISON_POWER_MAX_BONUS extra ships at full power.
 */
import { describe, it, expect } from "vitest";
import {
  hostileScaling,
  scaleHostileDamage,
  overmindGarrisonPowerBonus,
  NEUTRAL_HOSTILE_SCALING,
} from "@/systems/campaign/hostileScaling";
import {
  GAME_BALANCE,
  HOSTILE_SCALING_WEAK_MULT,
  OVERMIND_GARRISON_POWER_MAX_BONUS,
  DIFFICULTY_HOSTILE_SCALING,
} from "@/config/balance";

describe("hostileScaling — endpoints", () => {
  it("weak player (index 0) faces the gentle weak multiplier on both axes", () => {
    const s = hostileScaling(0, "NORMAL");
    expect(s.hpMult).toBeCloseTo(HOSTILE_SCALING_WEAK_MULT, 10);
    expect(s.damageMult).toBeCloseTo(HOSTILE_SCALING_WEAK_MULT, 10);
  });

  it("the weak multiplier is gentle: below 1, at ~0.9", () => {
    expect(HOSTILE_SCALING_WEAK_MULT).toBeLessThan(1);
    expect(HOSTILE_SCALING_WEAK_MULT).toBeCloseTo(0.9, 5);
  });

  it("maxed player (index 1) faces the full OVERMIND_COMBAT_*_MULT levers", () => {
    const s = hostileScaling(1, "NORMAL");
    expect(s.hpMult).toBeCloseTo(GAME_BALANCE.OVERMIND_COMBAT_HP_MULT, 10);
    expect(s.damageMult).toBeCloseTo(
      GAME_BALANCE.OVERMIND_COMBAT_DAMAGE_MULT,
      10,
    );
  });

  it("clamps the power input to [0,1]", () => {
    expect(hostileScaling(-3, "NORMAL")).toEqual(hostileScaling(0, "NORMAL"));
    expect(hostileScaling(7, "NORMAL")).toEqual(hostileScaling(1, "NORMAL"));
  });

  it("is monotone non-decreasing in power on both axes", () => {
    let prev = hostileScaling(0, "NORMAL");
    for (const p of [0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const s = hostileScaling(p, "NORMAL");
      expect(s.hpMult).toBeGreaterThanOrEqual(prev.hpMult);
      expect(s.damageMult).toBeGreaterThanOrEqual(prev.damageMult);
      prev = s;
    }
  });

  it("is pure/deterministic", () => {
    expect(hostileScaling(0.42, "NORMAL")).toEqual(
      hostileScaling(0.42, "NORMAL"),
    );
  });
});

describe("hostileScaling — difficulty-mode composition", () => {
  it("NORMAL and GOD are the identical baseline", () => {
    for (const p of [0, 0.5, 1]) {
      expect(hostileScaling(p, "GOD")).toEqual(hostileScaling(p, "NORMAL"));
    }
  });

  it("HARD composes the config combat multiplier on top of the adaptive lerp", () => {
    const hard = DIFFICULTY_HOSTILE_SCALING.HARD.hostileCombatMultiplier;
    expect(hard).toBeGreaterThan(1);
    for (const p of [0, 0.5, 1]) {
      const base = hostileScaling(p, "NORMAL");
      const s = hostileScaling(p, "HARD");
      expect(s.hpMult).toBeCloseTo(base.hpMult * hard, 10);
      expect(s.damageMult).toBeCloseTo(base.damageMult * hard, 10);
    }
  });

  it("NORMAL/GOD carry a neutral (1.0) combat multiplier in the config table", () => {
    expect(DIFFICULTY_HOSTILE_SCALING.NORMAL.hostileCombatMultiplier).toBe(1.0);
    expect(DIFFICULTY_HOSTILE_SCALING.GOD.hostileCombatMultiplier).toBe(1.0);
  });
});

describe("scaleHostileDamage", () => {
  it("rounds to a whole hit and never drops a positive hit below 1", () => {
    expect(scaleHostileDamage(20, 0.9)).toBe(18);
    expect(scaleHostileDamage(20, 1.5)).toBe(30);
    expect(scaleHostileDamage(1, 0.1)).toBe(1); // floor: a landed hit hurts
  });

  it("keeps a zero/negative damage source at zero (no conjured damage)", () => {
    expect(scaleHostileDamage(0, 1.5)).toBe(0);
    expect(scaleHostileDamage(-5, 0.9)).toBe(0);
  });

  it("neutral scaling is the identity on integer damage", () => {
    expect(scaleHostileDamage(14, NEUTRAL_HOSTILE_SCALING.damageMult)).toBe(14);
  });
});

describe("overmindGarrisonPowerBonus", () => {
  it("adds no ships while the player is weak", () => {
    expect(overmindGarrisonPowerBonus(0)).toBe(0);
    expect(overmindGarrisonPowerBonus(0.2)).toBe(0);
  });

  it("reaches the full configured bonus at max power", () => {
    expect(overmindGarrisonPowerBonus(1)).toBe(
      OVERMIND_GARRISON_POWER_MAX_BONUS,
    );
    expect(OVERMIND_GARRISON_POWER_MAX_BONUS).toBeGreaterThan(0);
  });

  it("steps up gently (floor, not round) and clamps the input", () => {
    // Just below the halfway step stays at 0 extra ships.
    expect(overmindGarrisonPowerBonus(0.49)).toBe(0);
    expect(overmindGarrisonPowerBonus(0.5)).toBe(1);
    expect(overmindGarrisonPowerBonus(-1)).toBe(0);
    expect(overmindGarrisonPowerBonus(99)).toBe(
      OVERMIND_GARRISON_POWER_MAX_BONUS,
    );
  });

  it("is monotone non-decreasing in power", () => {
    let prev = overmindGarrisonPowerBonus(0);
    for (const p of [0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
      const b = overmindGarrisonPowerBonus(p);
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });
});
