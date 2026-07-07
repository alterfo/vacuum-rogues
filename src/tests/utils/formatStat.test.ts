import { describe, it, expect } from "vitest";
import { formatStat, formatStatDelta } from "@/utils/formatStat";

describe("formatStat", () => {
  it("keeps integers integral", () => {
    expect(formatStat(40)).toBe("40");
    expect(formatStat(1400)).toBe("1400");
    expect(formatStat(0)).toBe("0");
  });

  it("keeps clean decimals in shape", () => {
    expect(formatStat(1.4)).toBe("1.4");
    expect(formatStat(0.9)).toBe("0.9");
    expect(formatStat(0.5)).toBe("0.5");
  });

  it("kills IEEE-754 subtraction noise", () => {
    // The exact leak observed in the equipment shop: 1.4 - 0.9.
    expect(1.4 - 0.9).not.toBe(0.5); // sanity: the raw value IS noisy
    expect(formatStat(1.4 - 0.9)).toBe("0.5");
    expect(formatStat(0.30000000000000004)).toBe("0.3");
  });

  it("never renders a long floating-point tail", () => {
    for (const v of [1.4 - 0.9, 1.1 - 0.9, 0.1 + 0.2, 40.00000001]) {
      expect(formatStat(v)).not.toMatch(/\d{5,}/);
    }
  });
});

describe("formatStatDelta", () => {
  it("prefixes non-negative deltas with +", () => {
    expect(formatStatDelta(0.5)).toBe("+0.5");
    expect(formatStatDelta(0)).toBe("+0");
    expect(formatStatDelta(35)).toBe("+35");
  });

  it("keeps the minus on negative deltas", () => {
    expect(formatStatDelta(-0.5)).toBe("-0.5");
    expect(formatStatDelta(-12)).toBe("-12");
  });

  it("rounds the noisy delta the shop displays (1.4 vs 0.9)", () => {
    expect(formatStatDelta(1.4 - 0.9)).toBe("+0.5");
    expect(formatStatDelta(0.9 - 1.4)).toBe("-0.5");
  });
});
