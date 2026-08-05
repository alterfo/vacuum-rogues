import { describe, it, expect } from "vitest";
import {
  hostileScaling,
  neutralScaling,
  combatScaling,
  scaleHostileDamage,
  overmindGarrisonPowerBonus,
  overmindGarrisonPowerDiscount,
  NEUTRAL_HOSTILE_SCALING,
} from "@/systems/campaign/hostileScaling";
import {
  GAME_BALANCE,
  HOSTILE_SCALING_WEAK_MULT,
  NEUTRAL_SCALING_WEAK_MULT,
  NEUTRAL_SCALING_STRONG_MULT,
  OVERMIND_GARRISON_POWER_MAX_BONUS,
  OVERMIND_GARRISON_POWER_MAX_DISCOUNT,
  DIFFICULTY_HOSTILE_SCALING,
} from "@/config/balance";

describe("hostileScaling — endpoints", () => {
  it("weak player (index 0) faces the gentle weak multiplier on both axes", () => {
    const s = hostileScaling(0, "NORMAL");
    expect(s.hpMult).toBeCloseTo(HOSTILE_SCALING_WEAK_MULT, 10);
    expect(s.damageMult).toBeCloseTo(HOSTILE_SCALING_WEAK_MULT, 10);
  });

  it("the weak multiplier is gentle: below 1, at ~0.5 (win-rate-100pct plan, Task 5)", () => {
    expect(HOSTILE_SCALING_WEAK_MULT).toBeLessThan(1);
    expect(HOSTILE_SCALING_WEAK_MULT).toBeCloseTo(0.5, 5);
    expect(HOSTILE_SCALING_WEAK_MULT).toBeGreaterThan(
      NEUTRAL_SCALING_WEAK_MULT,
    );
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

  it("a NaN power falls back to the weak (safest) multiplier instead of NaN", () => {
    const s = hostileScaling(NaN, "NORMAL");
    expect(Number.isNaN(s.hpMult)).toBe(false);
    expect(Number.isNaN(s.damageMult)).toBe(false);
    expect(s).toEqual(hostileScaling(0, "NORMAL"));
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

describe("neutralScaling — Task 9 (i): weak ships gentled in neutral space", () => {
  it("weak player (index 0) takes reduced incoming hits in a neutral fight", () => {
    const s = neutralScaling(0, "NORMAL");
    expect(s.damageMult).toBeCloseTo(NEUTRAL_SCALING_WEAK_MULT, 10);
    expect(s.damageMult).toBeLessThan(1);
  });

  it("maxed player (index 1) faces baseline neutral combat (strong = 1.0)", () => {
    const s = neutralScaling(1, "NORMAL");
    expect(s.damageMult).toBeCloseTo(NEUTRAL_SCALING_STRONG_MULT, 10);
    expect(NEUTRAL_SCALING_STRONG_MULT).toBe(1.0);
  });

  it("never scales offense in neutral space (hpMult stays 1 at every power)", () => {
    for (const p of [0, 0.3, 0.5, 1]) {
      expect(neutralScaling(p, "NORMAL").hpMult).toBe(1);
    }
  });

  it("is monotone non-decreasing in power and clamps the input", () => {
    let prev = neutralScaling(0, "NORMAL").damageMult;
    for (const p of [0.1, 0.5, 0.9, 1]) {
      const d = neutralScaling(p, "NORMAL").damageMult;
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
    expect(neutralScaling(-2, "NORMAL")).toEqual(neutralScaling(0, "NORMAL"));
    expect(neutralScaling(9, "NORMAL")).toEqual(neutralScaling(1, "NORMAL"));
  });

  it("NORMAL and GOD share the identical neutral baseline", () => {
    for (const p of [0, 0.5, 1]) {
      expect(neutralScaling(p, "GOD")).toEqual(neutralScaling(p, "NORMAL"));
    }
  });

  it("HARD composes its config combat multiplier on the neutral incoming hit", () => {
    const hard = DIFFICULTY_HOSTILE_SCALING.HARD.hostileCombatMultiplier;
    for (const p of [0, 0.5, 1]) {
      const base = neutralScaling(p, "NORMAL");
      const s = neutralScaling(p, "HARD");
      expect(s.damageMult).toBeCloseTo(base.damageMult * hard, 10);
    }
  });

  it("is pure/deterministic", () => {
    expect(neutralScaling(0.33, "NORMAL")).toEqual(
      neutralScaling(0.33, "NORMAL"),
    );
  });
});

describe("combatScaling — dispatch by held vs neutral system", () => {
  it("routes a held system to the garrison scaling (weak → 1.5× levers)", () => {
    for (const p of [0, 0.5, 1]) {
      expect(combatScaling(p, "NORMAL", true)).toEqual(
        hostileScaling(p, "NORMAL"),
      );
    }
  });

  it("routes a neutral system to the neutral gentling", () => {
    for (const p of [0, 0.5, 1]) {
      expect(combatScaling(p, "NORMAL", false)).toEqual(
        neutralScaling(p, "NORMAL"),
      );
    }
  });

  it("a weak ship takes strictly less in neutral space than in a held garrison", () => {
    const neutral = combatScaling(0, "NORMAL", false);
    const held = combatScaling(0, "NORMAL", true);
    expect(neutral.damageMult).toBeLessThan(held.damageMult);
  });

  it("a maxed ship faces baseline neutral but the full garrison in a held system", () => {
    expect(combatScaling(1, "NORMAL", false).damageMult).toBe(1.0);
    expect(combatScaling(1, "NORMAL", true).damageMult).toBeCloseTo(
      GAME_BALANCE.OVERMIND_COMBAT_DAMAGE_MULT,
      10,
    );
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

describe("overmindGarrisonPowerDiscount", () => {
  it("subtracts the full configured discount while the player is powerless", () => {
    expect(overmindGarrisonPowerDiscount(0)).toBe(
      OVERMIND_GARRISON_POWER_MAX_DISCOUNT,
    );
    expect(OVERMIND_GARRISON_POWER_MAX_DISCOUNT).toBeGreaterThan(0);
  });

  it("phases out to 0 at max power", () => {
    expect(overmindGarrisonPowerDiscount(1)).toBe(0);
  });

  it("clamps out-of-range input", () => {
    expect(overmindGarrisonPowerDiscount(-1)).toBe(
      OVERMIND_GARRISON_POWER_MAX_DISCOUNT,
    );
    expect(overmindGarrisonPowerDiscount(99)).toBe(0);
  });

  it("is monotone non-increasing in power (mirrors the bonus's non-decreasing shape)", () => {
    let prev = overmindGarrisonPowerDiscount(0);
    for (const p of [0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
      const d = overmindGarrisonPowerDiscount(p);
      expect(d).toBeLessThanOrEqual(prev);
      prev = d;
    }
  });

  it("at the shipped max discount (4), the early-death power band (0.02-0.15) gets a graded, near-maximal discount — not a knife-edge", () => {
    expect(overmindGarrisonPowerDiscount(0.02)).toBe(
      OVERMIND_GARRISON_POWER_MAX_DISCOUNT - 1,
    );
    expect(overmindGarrisonPowerDiscount(0.15)).toBe(
      OVERMIND_GARRISON_POWER_MAX_DISCOUNT - 1,
    );
    expect(overmindGarrisonPowerDiscount(0.001)).toBe(
      OVERMIND_GARRISON_POWER_MAX_DISCOUNT - 1,
    );
    expect(overmindGarrisonPowerDiscount(0.01)).toBe(
      OVERMIND_GARRISON_POWER_MAX_DISCOUNT - 1,
    );
  });

  it("does have a real interior step once maxDiscount gives floor() room (e.g. 2)", () => {
    expect(overmindGarrisonPowerDiscount(0.49, 2)).toBe(1);
    expect(overmindGarrisonPowerDiscount(0.5, 2)).toBe(1);
    expect(overmindGarrisonPowerDiscount(0.51, 2)).toBe(0);
  });
});
