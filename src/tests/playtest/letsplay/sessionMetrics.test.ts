import { describe, it, expect } from "vitest";
import { SceneType } from "@/types";
import {
  aggregateSession,
  aggregateRun,
  evaluate,
  WAIT_STREAK_SOFTLOCK,
  type SessionMetricsInput,
  type SessionMetrics,
  type VitalsSample,
} from "./sessionMetrics";

/**
 * Task 1 of the letsplay CI oracle: the pure session-metrics + report evaluator.
 *
 * Every test runs on **synthetic** inputs (no engine, no I/O) — the whole point
 * of the pure split is that a clean session passes and an injected fault
 * (error / soft-lock / out-of-band balance signal) fails deterministically.
 */

/** A clean, fault-free session input — the baseline every negative test perturbs. */
function cleanInput(
  over: Partial<SessionMetricsInput> = {},
): SessionMetricsInput {
  return {
    steps: 40,
    endScene: SceneType.SPACE_FLIGHT,
    errorCount: 0,
    violations: [],
    actions: ["move", "land", "trade", "move", "warp"],
    ...over,
  };
}

/** A rising vitals series: credits up, an upgrade at day 2. */
function risingSamples(): VitalsSample[] {
  return [
    { step: 0, day: 0, credits: 1000, hull: 100, maxHull: 100 },
    { step: 10, day: 1, credits: 1500, hull: 100, maxHull: 100 },
    { step: 20, day: 2, credits: 2000, hull: 120, maxHull: 130 },
    { step: 30, day: 3, credits: 2600, hull: 130, maxHull: 130 },
  ];
}

describe("aggregateSession", () => {
  it("a clean session has zero faults and survives", () => {
    const m = aggregateSession(cleanInput());
    expect(m.errors).toBe(0);
    expect(m.softLocks).toBe(0);
    expect(m.invariantViolations).toBe(0);
    expect(m.survived).toBe(true);
  });

  it("counts harness-sink errors", () => {
    const m = aggregateSession(cleanInput({ errorCount: 3 }));
    expect(m.errors).toBe(3);
  });

  it("classifies an always-actionable breach as a soft-lock, not a vital violation", () => {
    const m = aggregateSession(
      cleanInput({ violations: [{ invariant: "always-actionable" }] }),
    );
    expect(m.softLocks).toBe(1);
    expect(m.invariantViolations).toBe(0);
  });

  it("classifies a hull/credits breach as a vital invariant violation", () => {
    const m = aggregateSession(
      cleanInput({
        violations: [
          { invariant: "hull-nonnegative" },
          { invariant: "credits-finite" },
        ],
      }),
    );
    expect(m.invariantViolations).toBe(2);
    expect(m.softLocks).toBe(0);
  });

  it("flags a long wait-streak as a behavioural soft-lock", () => {
    const actions = Array.from(
      { length: WAIT_STREAK_SOFTLOCK },
      () => "wait" as const,
    );
    const m = aggregateSession(cleanInput({ actions }));
    expect(m.softLocks).toBe(1);
  });

  it("does not flag a wait-streak below the threshold", () => {
    const actions = Array.from(
      { length: WAIT_STREAK_SOFTLOCK - 1 },
      () => "wait" as const,
    );
    const m = aggregateSession(cleanInput({ actions }));
    expect(m.softLocks).toBe(0);
  });

  it("marks a GAME_OVER session as not survived", () => {
    const m = aggregateSession(cleanInput({ endScene: SceneType.GAME_OVER }));
    expect(m.survived).toBe(false);
  });

  it("derives credits/day, net credits and days-to-first-upgrade from samples", () => {
    const m = aggregateSession(cleanInput({ samples: risingSamples() }));
    expect(m.netCredits).toBe(1600); // 2600 - 1000
    expect(m.creditsPerDay).toBeCloseTo(1600 / 3); // over a 3-day span
    expect(m.daysToFirstUpgrade).toBe(2); // maxHull rises at day 2
  });

  it("returns null balance signals without samples", () => {
    const m = aggregateSession(cleanInput());
    expect(m.netCredits).toBeNull();
    expect(m.creditsPerDay).toBeNull();
    expect(m.daysToFirstUpgrade).toBeNull();
  });

  it("returns null credits/day when no galaxy day elapsed", () => {
    const flat: VitalsSample[] = [
      { step: 0, day: 0, credits: 1000, hull: 100, maxHull: 100 },
      { step: 40, day: 0, credits: 1800, hull: 100, maxHull: 100 },
    ];
    const m = aggregateSession(cleanInput({ samples: flat }));
    expect(m.netCredits).toBe(800);
    expect(m.creditsPerDay).toBeNull();
    expect(m.daysToFirstUpgrade).toBeNull();
  });
});

describe("aggregateRun", () => {
  const survived: SessionMetrics = {
    steps: 40,
    errors: 0,
    softLocks: 0,
    invariantViolations: 0,
    survived: true,
    netCredits: 1600,
    creditsPerDay: 500,
    daysToFirstUpgrade: 2,
    fuelDeath: false,
    distinctSystemsVisited: 1,
    overmindLost: false,
    daysSurvived: 3,
  };
  const died: SessionMetrics = {
    steps: 30,
    errors: 1,
    softLocks: 0,
    invariantViolations: 0,
    survived: false,
    netCredits: -200,
    creditsPerDay: 100,
    daysToFirstUpgrade: null,
    fuelDeath: false,
    distinctSystemsVisited: 1,
    overmindLost: false,
    daysSurvived: 1,
  };

  it("totals faults and computes rates + means", () => {
    const run = aggregateRun([survived, died]);
    expect(run.sessions).toBe(2);
    expect(run.totalErrors).toBe(1);
    expect(run.totalSteps).toBe(70);
    expect(run.survivalRate).toBe(0.5);
    expect(run.upgradeRate).toBe(0.5);
    expect(run.avgCreditsPerDay).toBe(300); // (500 + 100) / 2
    expect(run.avgDaysToFirstUpgrade).toBe(2); // only the upgraded session counts
  });

  it("reports null means when no session produced a value", () => {
    const run = aggregateRun([died, { ...died }]);
    expect(run.avgDaysToFirstUpgrade).toBeNull();
    expect(run.upgradeRate).toBe(0);
  });

  it("an empty run is the trivial all-zero aggregate", () => {
    const run = aggregateRun([]);
    expect(run.sessions).toBe(0);
    expect(run.survivalRate).toBe(0);
    expect(run.avgCreditsPerDay).toBeNull();
  });
});

describe("evaluate", () => {
  const clean: SessionMetrics = {
    steps: 40,
    errors: 0,
    softLocks: 0,
    invariantViolations: 0,
    survived: true,
    netCredits: 1500,
    creditsPerDay: 500,
    daysToFirstUpgrade: 2,
    fuelDeath: false,
    distinctSystemsVisited: 1,
    overmindLost: false,
    daysSurvived: 3,
  };

  it("passes a clean run with no reasons", () => {
    const res = evaluate(aggregateRun([clean, { ...clean }]));
    expect(res.ok).toBe(true);
    expect(res.reasons).toEqual([]);
  });

  it("fails on a harness error", () => {
    const res = evaluate(aggregateRun([{ ...clean, errors: 1 }]));
    expect(res.ok).toBe(false);
    expect(res.reasons.join(" ")).toMatch(/error/i);
  });

  it("fails on a soft-lock", () => {
    const res = evaluate(aggregateRun([{ ...clean, softLocks: 1 }]));
    expect(res.ok).toBe(false);
    expect(res.reasons.join(" ")).toMatch(/soft-lock/i);
  });

  it("fails on a corrupt-vital invariant violation", () => {
    const res = evaluate(aggregateRun([{ ...clean, invariantViolations: 1 }]));
    expect(res.ok).toBe(false);
    expect(res.reasons.join(" ")).toMatch(/invariant/i);
  });

  it("fails when credits/day drifts below the band", () => {
    const run = aggregateRun([{ ...clean, creditsPerDay: 10 }]);
    const res = evaluate(run, { creditsPerDayBand: { min: 100, max: 5000 } });
    expect(res.ok).toBe(false);
    expect(res.reasons.join(" ")).toMatch(/income too low/i);
  });

  it("fails when credits/day drifts above the band (a printer)", () => {
    const run = aggregateRun([{ ...clean, creditsPerDay: 99999 }]);
    const res = evaluate(run, { creditsPerDayBand: { min: 100, max: 5000 } });
    expect(res.ok).toBe(false);
    expect(res.reasons.join(" ")).toMatch(/printer|too high/i);
  });

  it("does not score the balance band when the run produced no value", () => {
    const run = aggregateRun([{ ...clean, creditsPerDay: null }]);
    const res = evaluate(run, { creditsPerDayBand: { min: 100, max: 5000 } });
    expect(res.ok).toBe(true);
  });

  it("fails when survival is below the required minimum", () => {
    const died: SessionMetrics = { ...clean, survived: false };
    const res = evaluate(aggregateRun([clean, died]), { minSurvivalRate: 0.8 });
    expect(res.ok).toBe(false);
    expect(res.reasons.join(" ")).toMatch(/survival/i);
  });

  it("fails when progression is too slow", () => {
    const run = aggregateRun([{ ...clean, daysToFirstUpgrade: 20 }]);
    const res = evaluate(run, { maxAvgDaysToFirstUpgrade: 5 });
    expect(res.ok).toBe(false);
    expect(res.reasons.join(" ")).toMatch(/days-to-first-upgrade/i);
  });

  it("fails when too few sessions reach an upgrade", () => {
    const noUpgrade: SessionMetrics = { ...clean, daysToFirstUpgrade: null };
    const res = evaluate(aggregateRun([noUpgrade, noUpgrade]), {
      minUpgradeRate: 0.5,
    });
    expect(res.ok).toBe(false);
    expect(res.reasons.join(" ")).toMatch(/upgrade rate/i);
  });

  it("fails a zero-session run rather than passing vacuously", () => {
    // A misconfigured gate (e.g. LETSPLAY_CI_SESSIONS=0) plays nothing; the empty
    // aggregate trips no fault ceiling, so without this guard it would green.
    const res = evaluate(aggregateRun([]));
    expect(res.ok).toBe(false);
    expect(res.reasons.join(" ")).toMatch(/no sessions/i);
  });

  it("accumulates every breach reason, not just the first", () => {
    // An error AND a soft-lock AND an out-of-band band must all be reported, so a
    // regression that early-returns after the first breach is caught.
    const run = aggregateRun([
      { ...clean, errors: 1, softLocks: 1, creditsPerDay: 99999 },
    ]);
    const res = evaluate(run, { creditsPerDayBand: { min: 100, max: 5000 } });
    expect(res.ok).toBe(false);
    const joined = res.reasons.join("\n");
    expect(joined).toMatch(/error/i);
    expect(joined).toMatch(/soft-lock/i);
    expect(joined).toMatch(/printer|too high/i);
    expect(res.reasons.length).toBe(3);
  });
});
