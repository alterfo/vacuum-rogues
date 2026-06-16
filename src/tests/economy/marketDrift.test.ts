import { describe, it, expect } from "vitest";
import { Market } from "@/domain/Market";
import { ResourceType } from "@/types";

/**
 * Unit coverage for Market.advanceMarketDay — the daily mean-reversion of the
 * dynamic price multiplier toward the neutral 1.0. The livePricing integration
 * suite only ever drives a multiplier DOWN (after a BUY); these cases pin the
 * opposite (UP) direction, the no-overshoot guard, and the [0.4, 2.5] clamp, so
 * a sign error in the up-branch can't slip through unnoticed.
 */
function singleResourceMarket(startMultiplier: number): Market {
  const m = new Market([ResourceType.METALS], [1.0], [1.0]);
  m.priceMultipliers[0] = startMultiplier;
  return m;
}

// Deterministic rng in (0,1) so driftMag is a fixed 2–8% step.
const fixedRng = (v: number) => () => v;

describe("Market.advanceMarketDay drift", () => {
  it("drifts a depressed multiplier UP toward 1.0 (post-SELL recovery)", () => {
    const m = singleResourceMarket(0.6);
    m.advanceMarketDay(fixedRng(0.5)); // driftMag = 0.02 + 0.5*0.06 = 0.05
    expect(m.priceMultipliers[0]).toBeCloseTo(0.65, 5);
    expect(m.priceMultipliers[0]).toBeLessThan(1.0); // still below neutral
  });

  it("drifts an elevated multiplier DOWN toward 1.0 (post-BUY relaxation)", () => {
    const m = singleResourceMarket(1.4);
    m.advanceMarketDay(fixedRng(0.5)); // driftMag 0.05
    expect(m.priceMultipliers[0]).toBeCloseTo(1.35, 5);
    expect(m.priceMultipliers[0]).toBeGreaterThan(1.0);
  });

  it("never overshoots neutral when the remaining gap is smaller than the step", () => {
    const up = singleResourceMarket(0.98);
    up.advanceMarketDay(fixedRng(1.0)); // driftMag 0.08, gap only 0.02
    expect(up.priceMultipliers[0]).toBe(1.0);

    const down = singleResourceMarket(1.02);
    down.advanceMarketDay(fixedRng(1.0));
    expect(down.priceMultipliers[0]).toBe(1.0);
  });

  it("converges to exactly 1.0 over repeated days from either side", () => {
    const up = singleResourceMarket(0.4);
    const down = singleResourceMarket(2.5);
    for (let day = 0; day < 100; day++) {
      up.advanceMarketDay(fixedRng(0.5));
      down.advanceMarketDay(fixedRng(0.5));
    }
    expect(up.priceMultipliers[0]).toBe(1.0);
    expect(down.priceMultipliers[0]).toBe(1.0);
  });

  it("keeps the multiplier inside the [0.4, 2.5] band every step", () => {
    const m = singleResourceMarket(1.0);
    let i = 0;
    const rng = () => (i++ * 0.37) % 1.0;
    for (let day = 0; day < 50; day++) {
      m.advanceMarketDay(rng);
      expect(m.priceMultipliers[0]).toBeGreaterThanOrEqual(0.4);
      expect(m.priceMultipliers[0]).toBeLessThanOrEqual(2.5);
    }
  });
});
