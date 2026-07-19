/**
 * Unit tests for the pure campaign-metrics core (Task 6, three-year-campaign
 * plan): milestone folding, outcome classification, the bounded-memory gate,
 * aggregation, and formatting — all on synthetic data, no engine boot, so this
 * file stays in the always-on playtest tier.
 */
import { describe, it, expect } from "vitest";
import { SceneType } from "@/types";
import {
  BATTLE_READY_MAX_HULL,
  BATTLE_READY_WEAPON_DAMAGE,
} from "./MemoryHeuristicPolicy";
import {
  aggregateCampaign,
  checkMemoryBounds,
  classifyCampaignOutcome,
  emptyMilestones,
  emptyStallStats,
  foldCampaignDay,
  foldCampaignStep,
  formatCampaignReport,
  NEWS_FEED_CAP,
  type CampaignDaySignal,
  type CampaignDeathCause,
  type CampaignMemoryStats,
  type CampaignSessionReport,
  type CampaignStepSignal,
} from "./campaignMetrics";

/** A weak-ship, no-Overmind day signal; override per scenario. */
function mkSignal(over: Partial<CampaignDaySignal> = {}): CampaignDaySignal {
  return {
    day: 1,
    maxHull: 130,
    weaponDamage: 14,
    overmindSystemCount: 0,
    playerLiberations: 0,
    ...over,
  };
}

/** In-bounds memory stats; override one field to build a breach. */
function mkStats(over: Partial<CampaignMemoryStats> = {}): CampaignMemoryStats {
  return {
    priceBookPlanets: 10,
    threatMapSystems: 5,
    visitedSystems: 8,
    inventoryLots: 3,
    inventoryLotUnits: 20,
    newsFeedLength: 40,
    planetCount: 30,
    systemCount: 12,
    peakCargoCapacity: 50,
    ...over,
  };
}

/** A clean winning session report; override per scenario. */
function mkReport(
  over: Partial<CampaignSessionReport> = {},
): CampaignSessionReport {
  return {
    index: 0,
    seed: "SYN-0",
    outcome: "win",
    resolutionDay: 700,
    finalDay: 700,
    steps: 4000,
    stepStalled: false,
    calendarWedged: false,
    peakPower: 0.6,
    milestones: {
      battleReadyDay: 120,
      firstLiberationDay: 300,
      firstPlayerLiberationDay: null,
      peakOvermindCount: 6,
    },
    died: false,
    questsCompleted: 3,
    finalCredits: 5000,
    loanBalance: 0,
    finalOvermindShare: 0,
    errors: 0,
    violations: 0,
    wallMs: 60_000,
    heapDeltaMB: 100,
    memory: mkStats(),
    ...over,
  };
}

/** A no-progress in-flight step signal; override per scenario. */
function mkStep(over: Partial<CampaignStepSignal> = {}): CampaignStepSignal {
  return {
    day: 10,
    scene: SceneType.SPACE_FLIGHT,
    actionKind: "wait",
    credits: 1000,
    combatActive: false,
    hostileCount: 0,
    ...over,
  };
}

describe("foldCampaignStep — stall/cycle detectors (Task 9 vi)", () => {
  it("counts a phantom combat stance (combat active, zero hostiles)", () => {
    let s = emptyStallStats();
    s = foldCampaignStep(s, mkStep({ combatActive: true, hostileCount: 0 }));
    s = foldCampaignStep(s, mkStep({ combatActive: true, hostileCount: 2 })); // real fight
    s = foldCampaignStep(s, mkStep({ combatActive: true, hostileCount: 0 }));
    s = foldCampaignStep(s, mkStep({ combatActive: false, hostileCount: 0 }));
    expect(s.combatStanceZeroHostileSteps).toBe(2);
    expect(s.steps).toBe(4);
  });

  it("measures the longest no-progress repeat-action run (same scene+action, day+credits frozen)", () => {
    let s = emptyStallStats();
    // Three identical stuck steps in a row → run of 3.
    for (let i = 0; i < 3; i++)
      s = foldCampaignStep(
        s,
        mkStep({ day: 10, credits: 500, actionKind: "warp" }),
      );
    // Day advances → the streak breaks even with the same action.
    s = foldCampaignStep(
      s,
      mkStep({ day: 11, credits: 500, actionKind: "warp" }),
    );
    // Two more stuck → run of 2, so the max stays 3.
    s = foldCampaignStep(
      s,
      mkStep({ day: 11, credits: 500, actionKind: "warp" }),
    );
    s = foldCampaignStep(
      s,
      mkStep({ day: 11, credits: 500, actionKind: "warp" }),
    );
    expect(s.maxRepeatActionRun).toBe(3);
    // The culprit key names the stuck (scene, action) for diagnosis.
    expect(s.worstRepeatKey).toBe(`${SceneType.SPACE_FLIGHT}|warp`);
  });

  it("a credit change breaks the no-progress run even at a frozen day", () => {
    let s = emptyStallStats();
    s = foldCampaignStep(
      s,
      mkStep({ day: 10, credits: 500, actionKind: "trade" }),
    );
    s = foldCampaignStep(
      s,
      mkStep({ day: 10, credits: 500, actionKind: "trade" }),
    ); // run 2
    s = foldCampaignStep(
      s,
      mkStep({ day: 10, credits: 900, actionKind: "trade" }),
    ); // progress → reset
    s = foldCampaignStep(
      s,
      mkStep({ day: 10, credits: 900, actionKind: "trade" }),
    ); // run 2
    expect(s.maxRepeatActionRun).toBe(2);
  });

  it("measures the undocked day-frozen streak but exempts a docked/landed stay", () => {
    let s = emptyStallStats();
    // Four undocked steps with the day frozen → streak of 3 (first has no prior day).
    for (let i = 0; i < 4; i++)
      s = foldCampaignStep(
        s,
        mkStep({ day: 10, scene: SceneType.SPACE_FLIGHT }),
      );
    expect(s.maxDayFrozenStreakUndocked).toBe(3);
    // A long STATION stay at a frozen day does NOT extend the undocked streak.
    let d = emptyStallStats();
    for (let i = 0; i < 5; i++)
      d = foldCampaignStep(d, mkStep({ day: 10, scene: SceneType.STATION }));
    expect(d.maxDayFrozenStreakUndocked).toBe(0);
  });

  it("a healthy run (progressing day, varied actions) shows no stalls", () => {
    let s = emptyStallStats();
    for (let i = 0; i < 10; i++)
      s = foldCampaignStep(
        s,
        mkStep({
          day: 10 + i,
          credits: 1000 + i * 50,
          actionKind: i % 2 ? "warp" : "trade",
        }),
      );
    expect(s.combatStanceZeroHostileSteps).toBe(0);
    expect(s.maxRepeatActionRun).toBe(1);
    expect(s.maxDayFrozenStreakUndocked).toBe(0);
  });

  it("does not mutate the input fold value (pure)", () => {
    const s0 = emptyStallStats();
    const s1 = foldCampaignStep(s0, mkStep({ combatActive: true }));
    expect(s0.steps).toBe(0);
    expect(s1.steps).toBe(1);
    expect(s1).not.toBe(s0);
  });
});

describe("formatCampaignReport — stall footer", () => {
  it("renders the stall detail + aggregate when present, and omits it when absent", () => {
    const stall = {
      ...emptyStallStats(),
      combatStanceZeroHostileSteps: 4,
      maxRepeatActionRun: 7,
      maxDayFrozenStreakUndocked: 12,
      steps: 100,
    };
    const withStall = formatCampaignReport([mkReport({ stall })]);
    expect(withStall).toContain("phantom=4");
    expect(withStall).toContain("repeat=7");
    expect(withStall).toContain("dayFrozen=12");
    expect(withStall).toContain("phantom-stance sessions=1/1");
    // A report with no stall data omits the footer entirely.
    const noStall = formatCampaignReport([mkReport()]);
    expect(noStall).not.toContain("phantom");
    expect(noStall).not.toContain("stalls:");
  });
});

/** A synthetic death cause; override per scenario. */
function mkDeathCause(
  over: Partial<CampaignDeathCause> = {},
): CampaignDeathCause {
  return {
    killerNpcId: "npc-1",
    killerRole: "PIRATE",
    engagementStartHullFraction: 0.07,
    simultaneousCombatants: 3,
    roundsSurvived: 2,
    ...over,
  };
}

describe("formatCampaignReport — death-cause telemetry (win-rate-100pct plan, Task 6 escalation)", () => {
  it("renders the per-session death line + the aggregate breakdown when present", () => {
    const report = formatCampaignReport([
      mkReport({
        outcome: "died",
        died: true,
        deathCause: mkDeathCause({ killerRole: "PIRATE" }),
      }),
    ]);
    expect(report).toContain("killer=PIRATE#npc-1");
    expect(report).toContain("hull@engage=0.07");
    expect(report).toContain("vs=3");
    expect(report).toContain("rounds=2");
    expect(report).toContain("death causes (1/1)");
    expect(report).toContain("PIRATE=1");
  });

  it("omits the per-session death tag and the aggregate footer when no session died", () => {
    const report = formatCampaignReport([mkReport({ outcome: "win" })]);
    expect(report).not.toContain("death[");
    expect(report).not.toContain("death causes");
  });

  it("aggregates killer-role counts and medians across multiple deaths", () => {
    const report = formatCampaignReport([
      mkReport({
        seed: "SYN-0",
        outcome: "died",
        died: true,
        deathCause: mkDeathCause({
          killerRole: "PIRATE",
          engagementStartHullFraction: 0.1,
          simultaneousCombatants: 2,
          roundsSurvived: 1,
        }),
      }),
      mkReport({
        seed: "SYN-1",
        outcome: "died",
        died: true,
        deathCause: mkDeathCause({
          killerRole: "OVERMIND",
          engagementStartHullFraction: 0.2,
          simultaneousCombatants: 4,
          roundsSurvived: 5,
        }),
      }),
      mkReport({ seed: "SYN-2", outcome: "win" }), // no death cause — excluded
    ]);
    expect(report).toContain("death causes (2/3)");
    expect(report).toContain("PIRATE=1");
    expect(report).toContain("OVERMIND=1");
    expect(report).toContain("median hull@engage=0.15");
    expect(report).toContain("median simultaneous combatants=3");
    expect(report).toContain("median rounds survived=3");
  });

  it("renders a null engagementStartHullFraction as '-' without crashing", () => {
    const report = formatCampaignReport([
      mkReport({
        outcome: "died",
        died: true,
        deathCause: mkDeathCause({ engagementStartHullFraction: null }),
      }),
    ]);
    expect(report).toContain("hull@engage=-");
  });
});

describe("foldCampaignDay — milestone latching", () => {
  it("latches battle-ready on the first day BOTH thresholds are met, and never moves it", () => {
    let m = emptyMilestones();
    m = foldCampaignDay(m, mkSignal({ day: 5 }));
    expect(m.battleReadyDay).toBeNull();
    // Only one threshold met ⇒ not battle-ready yet.
    m = foldCampaignDay(
      m,
      mkSignal({ day: 10, maxHull: BATTLE_READY_MAX_HULL }),
    );
    expect(m.battleReadyDay).toBeNull();
    m = foldCampaignDay(
      m,
      mkSignal({
        day: 42,
        maxHull: BATTLE_READY_MAX_HULL,
        weaponDamage: BATTLE_READY_WEAPON_DAMAGE,
      }),
    );
    expect(m.battleReadyDay).toBe(42);
    // A later (even stronger) day never moves the latch.
    m = foldCampaignDay(
      m,
      mkSignal({ day: 90, maxHull: 400, weaponDamage: 80 }),
    );
    expect(m.battleReadyDay).toBe(42);
  });

  it("latches first liberation on a count DECREASE, never on growth or the first sample", () => {
    let m = emptyMilestones();
    // First sample can never be a liberation (no previous count to compare).
    m = foldCampaignDay(m, mkSignal({ day: 1, overmindSystemCount: 3 }));
    expect(m.firstLiberationDay).toBeNull();
    // Growth is spread, not liberation.
    m = foldCampaignDay(m, mkSignal({ day: 50, overmindSystemCount: 5 }));
    expect(m.firstLiberationDay).toBeNull();
    m = foldCampaignDay(m, mkSignal({ day: 200, overmindSystemCount: 4 }));
    expect(m.firstLiberationDay).toBe(200);
    // Latched: a later decrease doesn't move it.
    m = foldCampaignDay(m, mkSignal({ day: 300, overmindSystemCount: 2 }));
    expect(m.firstLiberationDay).toBe(200);
    expect(m.peakOvermindCount).toBe(5);
  });

  it("latches first PLAYER liberation on playerLiberations > 0, distinct from the generic liberation proxy (gear-catalog & garrison-power-ceiling plan Task 3)", () => {
    let m = emptyMilestones();
    // An Overmind system count decrease (an NPC ranger liberation) fires the
    // generic proxy but must NOT fire the player-specific one.
    m = foldCampaignDay(
      m,
      mkSignal({ day: 1, overmindSystemCount: 3, playerLiberations: 0 }),
    );
    m = foldCampaignDay(
      m,
      mkSignal({ day: 100, overmindSystemCount: 2, playerLiberations: 0 }),
    );
    expect(m.firstLiberationDay).toBe(100);
    expect(m.firstPlayerLiberationDay).toBeNull();
    // The player's own ship liberates one later — only now does the
    // player-specific milestone latch.
    m = foldCampaignDay(
      m,
      mkSignal({ day: 250, overmindSystemCount: 1, playerLiberations: 1 }),
    );
    expect(m.firstPlayerLiberationDay).toBe(250);
    // Latched: a later increase doesn't move it.
    m = foldCampaignDay(
      m,
      mkSignal({ day: 400, overmindSystemCount: 0, playerLiberations: 2 }),
    );
    expect(m.firstPlayerLiberationDay).toBe(250);
  });

  it("never-liberated case: stays null across a whole session with no player liberation", () => {
    let m = emptyMilestones();
    m = foldCampaignDay(
      m,
      mkSignal({ day: 1, overmindSystemCount: 2, playerLiberations: 0 }),
    );
    m = foldCampaignDay(
      m,
      mkSignal({ day: 730, overmindSystemCount: 8, playerLiberations: 0 }),
    );
    expect(m.firstPlayerLiberationDay).toBeNull();
  });

  it("is pure — the input milestones value is never mutated", () => {
    const before = emptyMilestones();
    const frozen = JSON.stringify(before);
    foldCampaignDay(before, mkSignal({ day: 9, overmindSystemCount: 7 }));
    expect(JSON.stringify(before)).toBe(frozen);
  });
});

describe("classifyCampaignOutcome", () => {
  it("arc status won ⇒ win (whatever the scene)", () => {
    expect(
      classifyCampaignOutcome({
        arcStatus: "won",
        endScene: SceneType.SPACE_FLIGHT,
      }),
    ).toBe("win");
    expect(
      classifyCampaignOutcome({
        arcStatus: "dormant",
        endScene: SceneType.WIN_SCREEN,
      }),
    ).toBe("win");
  });

  it("arc status lost ⇒ loss even when the defeat screen is GAME_OVER (not misfiled as a death)", () => {
    expect(
      classifyCampaignOutcome({
        arcStatus: "lost",
        endScene: SceneType.GAME_OVER,
      }),
    ).toBe("loss");
  });

  it("GAME_OVER with a non-terminal arc ⇒ died (a genuine combat death)", () => {
    expect(
      classifyCampaignOutcome({
        arcStatus: "advancing",
        endScene: SceneType.GAME_OVER,
      }),
    ).toBe("died");
  });

  it("anything unresolved ⇒ timeout", () => {
    expect(
      classifyCampaignOutcome({
        arcStatus: "contained",
        endScene: SceneType.SPACE_FLIGHT,
      }),
    ).toBe("timeout");
  });
});

describe("checkMemoryBounds — the bounded-memory gate", () => {
  it("passes in-bounds stats", () => {
    expect(checkMemoryBounds(mkStats())).toEqual([]);
  });

  it("boundary values (exactly at the cap) still pass", () => {
    expect(
      checkMemoryBounds(
        mkStats({
          priceBookPlanets: 30,
          threatMapSystems: 12,
          visitedSystems: 12,
          inventoryLotUnits: 50,
          inventoryLots: 50,
          newsFeedLength: NEWS_FEED_CAP,
        }),
      ),
    ).toEqual([]);
  });

  it("flags every unbounded-growth breach with its own reason", () => {
    const reasons = checkMemoryBounds(
      mkStats({
        priceBookPlanets: 31,
        threatMapSystems: 13,
        visitedSystems: 13,
        inventoryLotUnits: 51,
        newsFeedLength: NEWS_FEED_CAP + 1,
      }),
    );
    expect(reasons).toHaveLength(5);
    expect(reasons.join("\n")).toContain("priceBook");
    expect(reasons.join("\n")).toContain("threatMap");
    expect(reasons.join("\n")).toContain("visitedSystemIds");
    expect(reasons.join("\n")).toContain("cargo capacity");
    expect(reasons.join("\n")).toContain("newsFeed");
  });

  it("flags leaked empty lots (more lots than total units)", () => {
    const reasons = checkMemoryBounds(
      mkStats({ inventoryLots: 21, inventoryLotUnits: 20 }),
    );
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("empty lots leaked");
  });
});

describe("aggregateCampaign", () => {
  it("counts outcomes, win-rate, and the median win day", () => {
    const sum = aggregateCampaign([
      mkReport({ resolutionDay: 600 }),
      mkReport({ index: 1, seed: "SYN-1", resolutionDay: 900 }),
      mkReport({ index: 2, seed: "SYN-2", resolutionDay: 700 }),
      mkReport({
        index: 3,
        seed: "SYN-3",
        outcome: "loss",
        resolutionDay: 500,
      }),
      mkReport({
        index: 4,
        seed: "SYN-4",
        outcome: "died",
        died: true,
        resolutionDay: 90,
      }),
      mkReport({
        index: 5,
        seed: "SYN-5",
        outcome: "timeout",
        resolutionDay: null,
        milestones: {
          battleReadyDay: null,
          firstLiberationDay: null,
          firstPlayerLiberationDay: null,
          peakOvermindCount: 9,
        },
      }),
    ]);
    expect(sum.sessions).toBe(6);
    expect(sum.wins).toBe(3);
    expect(sum.losses).toBe(1);
    expect(sum.deaths).toBe(1);
    expect(sum.timeouts).toBe(1);
    expect(sum.winRate).toBeCloseTo(3 / 6);
    expect(sum.medianWinDay).toBe(700); // median of 600/700/900
    expect(sum.battleReadyRate).toBeCloseTo(5 / 6);
    expect(sum.liberationRate).toBeCloseTo(5 / 6);
    expect(sum.avgBattleReadyDay).toBe(120);
    expect(sum.avgFirstLiberationDay).toBe(300);
  });

  it("sums faults and takes the slowest wall time", () => {
    const sum = aggregateCampaign([
      mkReport({ errors: 1, violations: 2, wallMs: 30_000 }),
      mkReport({ index: 1, errors: 2, violations: 0, wallMs: 90_000 }),
    ]);
    expect(sum.totalErrors).toBe(3);
    expect(sum.totalViolations).toBe(2);
    expect(sum.maxWallMs).toBe(90_000);
  });

  it("an empty run is the all-zero / no-data aggregate (never NaN)", () => {
    const sum = aggregateCampaign([]);
    expect(sum.sessions).toBe(0);
    expect(sum.winRate).toBe(0);
    expect(sum.medianWinDay).toBeNull();
    expect(sum.avgBattleReadyDay).toBeNull();
    expect(sum.avgFirstLiberationDay).toBeNull();
    expect(sum.avgPeakPower).toBe(0);
    expect(sum.maxWallMs).toBe(0);
  });

  it("counts calendar-wedged sessions separately from plain timeouts", () => {
    const sum = aggregateCampaign([
      mkReport({
        outcome: "timeout",
        resolutionDay: null,
        calendarWedged: true,
      }),
      mkReport({ index: 1, outcome: "timeout", resolutionDay: null }),
      mkReport({ index: 2 }),
    ]);
    expect(sum.timeouts).toBe(2);
    expect(sum.wedged).toBe(1);
  });

  it("a run with no wins reports medianWinDay null (no data ≠ zero)", () => {
    const sum = aggregateCampaign([
      mkReport({ outcome: "loss" }),
      mkReport({ index: 1, outcome: "timeout", resolutionDay: null }),
    ]);
    expect(sum.wins).toBe(0);
    expect(sum.medianWinDay).toBeNull();
  });
});

describe("formatCampaignReport", () => {
  it("renders one row per session plus the aggregate header/footer", () => {
    const text = formatCampaignReport([
      mkReport(),
      mkReport({
        index: 1,
        seed: "SYN-1",
        outcome: "timeout",
        resolutionDay: null,
        stepStalled: true,
      }),
      mkReport({
        index: 2,
        seed: "SYN-2",
        outcome: "timeout",
        resolutionDay: null,
        calendarWedged: true,
      }),
    ]);
    expect(text).toContain("3 session(s)");
    expect(text).toContain("1 win");
    expect(text).toContain("1 wedged");
    expect(text).toContain("[SYN-0] WIN");
    expect(text).toContain("[SYN-1] TIMEOUT");
    expect(text).toContain("STEP-STALLED");
    expect(text).toContain("[SYN-2] TIMEOUT");
    expect(text).toContain("WEDGED");
    expect(text).toContain("resolved=d700");
    expect(text).toContain("resolved=-"); // a timeout has no resolution day
    expect(text).toContain("battleReady=d120");
    expect(text).toContain("win-rate 33.3%");
  });
});
