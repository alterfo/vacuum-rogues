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

  it("flags a fuel-death: GAME_OVER with the last sample starved to empty", () => {
    const starved: VitalsSample[] = [
      { step: 0, day: 0, credits: 1000, hull: 100, maxHull: 100, fuel: 30 },
      { step: 20, day: 2, credits: 900, hull: 100, maxHull: 100, fuel: 0 },
    ];
    const m = aggregateSession(
      cleanInput({ endScene: SceneType.GAME_OVER, samples: starved }),
    );
    expect(m.fuelDeath).toBe(true);
  });

  it("does not flag a fuel-death for a combat death that ended with fuel left", () => {
    const combatDeath: VitalsSample[] = [
      { step: 0, day: 0, credits: 1000, hull: 100, maxHull: 100, fuel: 30 },
      { step: 20, day: 2, credits: 900, hull: 0, maxHull: 100, fuel: 25 },
    ];
    const m = aggregateSession(
      cleanInput({ endScene: SceneType.GAME_OVER, samples: combatDeath }),
    );
    expect(m.fuelDeath).toBe(false);
  });

  it("does not flag a fuel-death when the session survived at empty fuel", () => {
    const survivedEmpty: VitalsSample[] = [
      { step: 0, day: 0, credits: 1000, hull: 100, maxHull: 100, fuel: 30 },
      { step: 20, day: 2, credits: 900, hull: 100, maxHull: 100, fuel: 0 },
    ];
    const m = aggregateSession(cleanInput({ samples: survivedEmpty }));
    expect(m.survived).toBe(true);
    expect(m.fuelDeath).toBe(false);
  });

  it("flags an Overmind loss: GAME_OVER with the last share at the loss band", () => {
    const overrun: VitalsSample[] = [
      {
        step: 0,
        day: 0,
        credits: 1000,
        hull: 100,
        maxHull: 100,
        overmindShare: 0.3,
      },
      {
        step: 20,
        day: 5,
        credits: 900,
        hull: 100,
        maxHull: 100,
        overmindShare: 1,
      },
    ];
    const m = aggregateSession(
      cleanInput({ endScene: SceneType.GAME_OVER, samples: overrun }),
    );
    expect(m.overmindLost).toBe(true);
  });

  it("does not flag an Overmind loss when the session survived at a high share", () => {
    const pressured: VitalsSample[] = [
      {
        step: 0,
        day: 0,
        credits: 1000,
        hull: 100,
        maxHull: 100,
        overmindShare: 0.3,
      },
      {
        step: 20,
        day: 5,
        credits: 900,
        hull: 100,
        maxHull: 100,
        overmindShare: 1,
      },
    ];
    const m = aggregateSession(cleanInput({ samples: pressured }));
    expect(m.survived).toBe(true);
    expect(m.overmindLost).toBe(false);
  });

  it("counts distinct systems visited and days survived across samples", () => {
    const roaming: VitalsSample[] = [
      {
        step: 0,
        day: 0,
        credits: 1000,
        hull: 100,
        maxHull: 100,
        systemId: "sysA",
      },
      {
        step: 10,
        day: 1,
        credits: 1100,
        hull: 100,
        maxHull: 100,
        systemId: "sysB",
      },
      {
        step: 20,
        day: 3,
        credits: 1200,
        hull: 100,
        maxHull: 100,
        systemId: "sysA",
      },
      {
        step: 30,
        day: 4,
        credits: 1300,
        hull: 100,
        maxHull: 100,
        systemId: "sysC",
      },
    ];
    const m = aggregateSession(cleanInput({ samples: roaming }));
    expect(m.distinctSystemsVisited).toBe(3); // sysA, sysB, sysC
    expect(m.daysSurvived).toBe(4); // day 4 − day 0
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

  it("fails when a session died stranded on empty fuel", () => {
    const run = aggregateRun([{ ...clean, survived: false, fuelDeath: true }]);
    const res = evaluate(run);
    expect(res.ok).toBe(false);
    expect(res.reasons.join(" ")).toMatch(/fuel-death/i);
  });

  it("fails when the Overmind overran the galaxy during play", () => {
    const run = aggregateRun([
      { ...clean, survived: false, overmindLost: true },
    ]);
    const res = evaluate(run);
    expect(res.ok).toBe(false);
    expect(res.reasons.join(" ")).toMatch(/overmind/i);
  });

  it("fails when the agent isn't exploring enough distinct systems", () => {
    const run = aggregateRun([{ ...clean, distinctSystemsVisited: 1 }]);
    const res = evaluate(run, { minAvgDistinctSystemsVisited: 2 });
    expect(res.ok).toBe(false);
    expect(res.reasons.join(" ")).toMatch(/exploring/i);
  });

  it("fails when a session died earlier than the required day floor", () => {
    const run = aggregateRun([{ ...clean, daysSurvived: 0 }]);
    const res = evaluate(run, { minDaysSurvived: 2 });
    expect(res.ok).toBe(false);
    expect(res.reasons.join(" ")).toMatch(/days survived/i);
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
