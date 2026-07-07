import { describe, it, expect } from "vitest";
import {
  adaptiveSpreadIntervalDays,
  DEFAULT_ADAPTIVE_PACING,
  type AdaptivePacingConfig,
} from "@/systems/campaign/adaptivePacing";
import {
  advanceOvermind,
  initialOvermindSpreadState,
  type OvermindSpreadConfig,
  type SpreadGalaxyView,
} from "@/systems/overmind/overmindSpread";
import {
  GAME_BALANCE,
  ADAPTIVE_SPREAD_SLOW_DAYS,
  ADAPTIVE_SPREAD_FAST_DAYS,
  ADAPTIVE_GRACE_DAYS,
  ADAPTIVE_CREEP_START_DAY,
  ADAPTIVE_CREEP_MIN_DAYS,
} from "@/config/balance";

/**
 * Adaptive Overmind spread pacing (three-year-campaign Task 3) — the 2–3-year
 * clock. The spread interval is a pure function of (day, arc dayZero, RATCHETED
 * player power): a weak player faces the slow cadence, a strong player the fast
 * one, and the baseline-creep floor guarantees a permanently idle run still
 * resolves (loses) well before the 1080-day campaign ceiling.
 */

/** A ring galaxy of `n` systems — the frontier never pinches off. */
function ringGalaxy(n: number, overmind: string[]): SpreadGalaxyView {
  const systems = Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    connections: [{ toSystemId: `s${(i + 1) % n}` }],
  }));
  return {
    id: "adaptive-pacing-test",
    systems,
    overmindSystems: overmind,
    overmindCoreSystemId: overmind[0] ?? "",
  };
}

/** The live adaptive spread config the EOD drive assembles for one day. */
function adaptiveConfig(
  day: number,
  dayZero: number,
  peak: number,
): OvermindSpreadConfig {
  return {
    graceDays: ADAPTIVE_GRACE_DAYS,
    spreadIntervalDays: adaptiveSpreadIntervalDays(day, dayZero, peak),
    capturesPerTick: GAME_BALANCE.OVERMIND_SPREAD_CAPTURES_PER_TICK,
    lossShare: GAME_BALANCE.OVERMIND_SPREAD_LOSS_SHARE,
    containedShare: GAME_BALANCE.OVERMIND_SPREAD_CONTAINED_SHARE,
    minSystemsForLoss: GAME_BALANCE.OVERMIND_SPREAD_MIN_SYSTEMS,
  };
}

/**
 * Drive the pure spread machine day-by-day with the adaptive schedule, the way
 * `DayTickController.advanceOvermindArc` does, applying captures to the view.
 * Returns the day the arc resolved (won/lost) or -1 if it never did.
 */
function runIdleCampaign(
  totalSystems: number,
  peakPowerByDay: (day: number) => number,
  maxDay: number,
): { resolvedDay: number; status: string; engagedBeforeLoss: boolean } {
  const overmind = new Set(["s0", `s${Math.floor(totalSystems / 2)}`]);
  let state = initialOvermindSpreadState();
  let engagedBeforeLoss = false;
  for (let day = 1; day <= maxDay; day++) {
    const view = ringGalaxy(totalSystems, [...overmind]);
    const cfg = adaptiveConfig(day, state.dayZero, peakPowerByDay(day));
    const result = advanceOvermind(state, view, day, cfg);
    state = result.state;
    for (const id of result.captured) overmind.add(id);
    if (state.status === "lost") {
      engagedBeforeLoss = state.lastSpreadDay >= 0;
      return { resolvedDay: day, status: state.status, engagedBeforeLoss };
    }
    if (state.status === "won") {
      return { resolvedDay: day, status: state.status, engagedBeforeLoss };
    }
  }
  return { resolvedDay: -1, status: state.status, engagedBeforeLoss };
}

describe("adaptiveSpreadIntervalDays — power-keyed cadence", () => {
  it("a weak player (index ≈ 0) faces the slow cadence", () => {
    expect(adaptiveSpreadIntervalDays(100, 1, 0)).toBe(
      ADAPTIVE_SPREAD_SLOW_DAYS,
    );
  });

  it("a maxed player (index 1) faces the fast cadence", () => {
    expect(adaptiveSpreadIntervalDays(100, 1, 1)).toBe(
      ADAPTIVE_SPREAD_FAST_DAYS,
    );
  });

  it("out-of-range power clamps to the [slow, fast] band", () => {
    expect(adaptiveSpreadIntervalDays(100, 1, -3)).toBe(
      ADAPTIVE_SPREAD_SLOW_DAYS,
    );
    expect(adaptiveSpreadIntervalDays(100, 1, 7)).toBe(
      ADAPTIVE_SPREAD_FAST_DAYS,
    );
  });

  it("a NaN power falls back to the slow cadence instead of freezing the arc", () => {
    const interval = adaptiveSpreadIntervalDays(100, 1, NaN);
    expect(Number.isNaN(interval)).toBe(false);
    expect(interval).toBe(ADAPTIVE_SPREAD_SLOW_DAYS);
  });

  it("is monotone non-increasing in power — stronger never slows the front", () => {
    let prev = Infinity;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const interval = adaptiveSpreadIntervalDays(100, 1, p);
      expect(interval).toBeLessThanOrEqual(prev);
      prev = interval;
    }
  });

  it("under a RATCHETED power sequence the cadence never slows over the run", () => {
    // Ratcheted input is non-decreasing by construction; the schedule must
    // never re-open breathing room (no rubber-band exploit even across days).
    const peaks = [0, 0.05, 0.05, 0.3, 0.3, 0.55, 0.8, 0.8, 1];
    let prev = Infinity;
    peaks.forEach((peak, i) => {
      const day = 91 + i * 30;
      const interval = adaptiveSpreadIntervalDays(day, 1, peak);
      expect(interval).toBeLessThanOrEqual(prev);
      prev = interval;
    });
  });

  it("always returns a whole positive day count", () => {
    for (const p of [0, 0.13, 0.5, 0.77, 1]) {
      const interval = adaptiveSpreadIntervalDays(200, 1, p);
      expect(Number.isInteger(interval)).toBe(true);
      expect(interval).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("adaptiveSpreadIntervalDays — baseline creep floor", () => {
  it("before the creep start day the idle cadence stays slow", () => {
    const day = 1 + ADAPTIVE_CREEP_START_DAY - 1;
    expect(adaptiveSpreadIntervalDays(day, 1, 0)).toBe(
      ADAPTIVE_SPREAD_SLOW_DAYS,
    );
  });

  it("from the creep start day the idle cadence is floored at the creep minimum", () => {
    const day = 1 + ADAPTIVE_CREEP_START_DAY;
    expect(adaptiveSpreadIntervalDays(day, 1, 0)).toBe(ADAPTIVE_CREEP_MIN_DAYS);
  });

  it("creep never slows an already-fast front (min, not override)", () => {
    const day = 1 + ADAPTIVE_CREEP_START_DAY + 50;
    expect(adaptiveSpreadIntervalDays(day, 1, 1)).toBe(
      Math.min(ADAPTIVE_SPREAD_FAST_DAYS, ADAPTIVE_CREEP_MIN_DAYS),
    );
  });

  it("an unstarted arc clock (dayZero = -1) anchors creep at the current day (not active)", () => {
    expect(adaptiveSpreadIntervalDays(2000, -1, 0)).toBe(
      ADAPTIVE_SPREAD_SLOW_DAYS,
    );
  });

  it("honours a custom config (pure, no hidden globals)", () => {
    const cfg: AdaptivePacingConfig = {
      slowDays: 20,
      fastDays: 4,
      creepStartDay: 100,
      creepMinDays: 6,
    };
    expect(adaptiveSpreadIntervalDays(50, 1, 0, cfg)).toBe(20);
    expect(adaptiveSpreadIntervalDays(50, 1, 1, cfg)).toBe(4);
    expect(adaptiveSpreadIntervalDays(101, 1, 0, cfg)).toBe(6);
    expect(DEFAULT_ADAPTIVE_PACING.slowDays).toBe(ADAPTIVE_SPREAD_SLOW_DAYS);
  });
});

describe("adaptive pacing — the campaign always resolves", () => {
  it("a permanently idle player still loses the galaxy well before day 1080", () => {
    const run = runIdleCampaign(24, () => 0, 1080);
    expect(run.status).toBe("lost");
    expect(run.resolvedDay).toBeGreaterThan(ADAPTIVE_GRACE_DAYS);
    // "Well before" the hard ceiling — the creep floor leaves real headroom.
    expect(run.resolvedDay).toBeLessThan(900);
    // A loss is only ever declared by an ENGAGED front (spread actually ran).
    expect(run.engagedBeforeLoss).toBe(true);
  });

  it("a strong player faces the loss line much sooner than an idle one (pressure scales)", () => {
    const idle = runIdleCampaign(24, () => 0, 1080);
    const strong = runIdleCampaign(24, () => 1, 1080);
    expect(strong.status).toBe("lost");
    expect(strong.resolvedDay).toBeLessThan(idle.resolvedDay);
  });

  it("loss share and engagement semantics are unchanged by the adaptive clock", () => {
    // The loss line itself did not move.
    expect(GAME_BALANCE.OVERMIND_SPREAD_LOSS_SHARE).toBe(0.85);
    // A never-engaged front cleared during grace still cannot win.
    const state = {
      ...initialOvermindSpreadState(),
      dayZero: 1,
      peakThreat: 0.1,
    };
    const view = ringGalaxy(24, []);
    const result = advanceOvermind(state, view, 5, adaptiveConfig(5, 1, 0));
    expect(result.state.status).not.toBe("won");
  });
});
