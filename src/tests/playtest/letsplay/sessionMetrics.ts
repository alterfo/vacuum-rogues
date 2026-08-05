import { SceneType } from "@/types";
import { GAME_BALANCE } from "@/config/balance";
import type { PlayerActionKind } from "./observe";

const OVERMIND_LOSS_SHARE = GAME_BALANCE.OVERMIND_SPREAD_LOSS_SHARE;

export const SOFT_LOCK_INVARIANTS: ReadonlySet<string> = new Set([
  "always-actionable",
]);

export const WAIT_STREAK_SOFTLOCK = 8;

export interface VitalsSample {
  step: number;
  day: number;
  credits: number;
  hull: number;
  maxHull: number;
  weaponDamage?: number;
  fuel?: number;
  systemId?: string;
  overmindShare?: number;
}

export interface SessionMetricsInput {
  steps: number;
  endScene: SceneType;
  errorCount: number;
  violations: readonly { invariant: string }[];
  actions: readonly PlayerActionKind[];
  samples?: readonly VitalsSample[];
}

export interface SessionMetrics {
  steps: number;
  errors: number;
  softLocks: number;
  invariantViolations: number;
  survived: boolean;
  netCredits: number | null;
  creditsPerDay: number | null;
  daysToFirstUpgrade: number | null;
  fuelDeath: boolean;
  distinctSystemsVisited: number;
  overmindLost: boolean;
  daysSurvived: number;
}

export interface RunMetrics {
  sessions: number;
  totalSteps: number;
  totalErrors: number;
  totalSoftLocks: number;
  totalInvariantViolations: number;
  survivalRate: number;
  avgCreditsPerDay: number | null;
  upgradeRate: number;
  avgDaysToFirstUpgrade: number | null;
  fuelDeathCount: number;
  overmindLossCount: number;
  avgDistinctSystemsVisited: number;
  minDaysSurvived: number;
}

export interface MetricsThresholds {
  maxErrors?: number;
  maxSoftLocks?: number;
  maxInvariantViolations?: number;
  minSurvivalRate?: number;
  creditsPerDayBand?: { min: number; max: number };
  maxAvgDaysToFirstUpgrade?: number;
  minUpgradeRate?: number;
  maxFuelDeaths?: number;
  maxOvermindLosses?: number;
  minAvgDistinctSystemsVisited?: number;
  minDaysSurvived?: number;
}

export interface EvalResult {
  ok: boolean;
  reasons: string[];
}

function longestWaitStreak(actions: readonly PlayerActionKind[]): number {
  let best = 0;
  let run = 0;
  for (const a of actions) {
    if (a === "wait") {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

export function aggregateSession(input: SessionMetricsInput): SessionMetrics {
  const softLockViolations = input.violations.filter((v) =>
    SOFT_LOCK_INVARIANTS.has(v.invariant),
  ).length;
  const waitStreakSoftLock =
    longestWaitStreak(input.actions) >= WAIT_STREAK_SOFTLOCK ? 1 : 0;
  const softLocks = softLockViolations + waitStreakSoftLock;
  const invariantViolations = input.violations.length - softLockViolations;

  const survived = input.endScene !== SceneType.GAME_OVER;

  let netCredits: number | null = null;
  let creditsPerDay: number | null = null;
  let daysToFirstUpgrade: number | null = null;

  const samples = input.samples;
  let fuelDeath = false;
  let distinctSystemsVisited = 0;
  let overmindLost = false;
  let daysSurvived = 0;

  if (samples && samples.length >= 2) {
    const first = samples[0];
    const last = samples[samples.length - 1];
    netCredits = last.credits - first.credits;
    const dayspan = last.day - first.day;
    if (dayspan > 0) creditsPerDay = netCredits / dayspan;

    const upgrade = samples.find((s) => s.maxHull > first.maxHull + 1e-6);
    if (upgrade) daysToFirstUpgrade = upgrade.day - first.day;

    fuelDeath = !survived && last.fuel != null && last.fuel <= 0;
    daysSurvived = last.day - first.day;
  } else if (samples && samples.length === 1) {
    netCredits = 0;
  }

  if (samples && samples.length >= 1) {
    distinctSystemsVisited = new Set(
      samples.map((s) => s.systemId).filter((id): id is string => id != null),
    ).size;
    const lastShare = samples[samples.length - 1].overmindShare ?? 0;
    overmindLost = !survived && lastShare >= OVERMIND_LOSS_SHARE;
  }

  return {
    steps: input.steps,
    errors: input.errorCount,
    softLocks,
    invariantViolations,
    survived,
    netCredits,
    creditsPerDay,
    daysToFirstUpgrade,
    fuelDeath,
    distinctSystemsVisited,
    overmindLost,
    daysSurvived,
  };
}

function meanOrNull(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function aggregateRun(sessions: readonly SessionMetrics[]): RunMetrics {
  const n = sessions.length;
  const survivors = sessions.filter((s) => s.survived).length;
  const upgraded = sessions.filter((s) => s.daysToFirstUpgrade != null);
  const creditsPerDayValues = sessions
    .map((s) => s.creditsPerDay)
    .filter((v): v is number => v != null);
  const upgradeDays = upgraded
    .map((s) => s.daysToFirstUpgrade)
    .filter((v): v is number => v != null);

  return {
    sessions: n,
    totalSteps: sessions.reduce((a, s) => a + s.steps, 0),
    totalErrors: sessions.reduce((a, s) => a + s.errors, 0),
    totalSoftLocks: sessions.reduce((a, s) => a + s.softLocks, 0),
    totalInvariantViolations: sessions.reduce(
      (a, s) => a + s.invariantViolations,
      0,
    ),
    survivalRate: n === 0 ? 0 : survivors / n,
    avgCreditsPerDay: meanOrNull(creditsPerDayValues),
    upgradeRate: n === 0 ? 0 : upgraded.length / n,
    avgDaysToFirstUpgrade: meanOrNull(upgradeDays),
    fuelDeathCount: sessions.reduce((a, s) => a + (s.fuelDeath ? 1 : 0), 0),
    overmindLossCount: sessions.reduce(
      (a, s) => a + (s.overmindLost ? 1 : 0),
      0,
    ),
    avgDistinctSystemsVisited:
      n === 0
        ? 0
        : sessions.reduce((a, s) => a + s.distinctSystemsVisited, 0) / n,
    minDaysSurvived:
      n === 0 ? 0 : Math.min(...sessions.map((s) => s.daysSurvived)),
  };
}

export function evaluate(
  run: RunMetrics,
  thresholds: MetricsThresholds = {},
): EvalResult {
  const reasons: string[] = [];
  const maxErrors = thresholds.maxErrors ?? 0;
  const maxSoftLocks = thresholds.maxSoftLocks ?? 0;
  const maxInvariantViolations = thresholds.maxInvariantViolations ?? 0;
  const minSurvivalRate = thresholds.minSurvivalRate ?? 0;
  const maxFuelDeaths = thresholds.maxFuelDeaths ?? 0;
  const maxOvermindLosses = thresholds.maxOvermindLosses ?? 0;

  if (run.sessions <= 0)
    reasons.push(
      "no sessions played — the gate ran nothing (check K/N session config)",
    );

  if (run.totalErrors > maxErrors)
    reasons.push(
      `errors ${run.totalErrors} > max ${maxErrors} (crash/logged error during play)`,
    );
  if (run.totalSoftLocks > maxSoftLocks)
    reasons.push(
      `soft-locks ${run.totalSoftLocks} > max ${maxSoftLocks} (player stranded / stuck waiting)`,
    );
  if (run.totalInvariantViolations > maxInvariantViolations)
    reasons.push(
      `invariant violations ${run.totalInvariantViolations} > max ${maxInvariantViolations} (corrupt vital)`,
    );
  if (run.survivalRate < minSurvivalRate)
    reasons.push(
      `survival rate ${run.survivalRate.toFixed(2)} < min ${minSurvivalRate.toFixed(2)}`,
    );
  if (run.fuelDeathCount > maxFuelDeaths)
    reasons.push(
      `fuel-deaths ${run.fuelDeathCount} > max ${maxFuelDeaths} (agent starved out mid-run)`,
    );
  if (run.overmindLossCount > maxOvermindLosses)
    reasons.push(
      `Overmind losses ${run.overmindLossCount} > max ${maxOvermindLosses} (galaxy overrun while playing)`,
    );

  const band = thresholds.creditsPerDayBand;
  if (band && run.avgCreditsPerDay != null) {
    if (run.avgCreditsPerDay < band.min)
      reasons.push(
        `credits/day ${run.avgCreditsPerDay.toFixed(0)} < band min ${band.min} (income too low)`,
      );
    if (run.avgCreditsPerDay > band.max)
      reasons.push(
        `credits/day ${run.avgCreditsPerDay.toFixed(0)} > band max ${band.max} (income too high / printer)`,
      );
  }

  if (
    thresholds.maxAvgDaysToFirstUpgrade != null &&
    run.avgDaysToFirstUpgrade != null &&
    run.avgDaysToFirstUpgrade > thresholds.maxAvgDaysToFirstUpgrade
  )
    reasons.push(
      `days-to-first-upgrade ${run.avgDaysToFirstUpgrade.toFixed(1)} > max ${thresholds.maxAvgDaysToFirstUpgrade} (progression too slow)`,
    );

  if (
    thresholds.minUpgradeRate != null &&
    run.upgradeRate < thresholds.minUpgradeRate
  )
    reasons.push(
      `upgrade rate ${run.upgradeRate.toFixed(2)} < min ${thresholds.minUpgradeRate.toFixed(2)} (few sessions progressed)`,
    );

  if (
    thresholds.minAvgDistinctSystemsVisited != null &&
    run.avgDistinctSystemsVisited < thresholds.minAvgDistinctSystemsVisited
  )
    reasons.push(
      `distinct systems visited ${run.avgDistinctSystemsVisited.toFixed(1)} < min ${thresholds.minAvgDistinctSystemsVisited} (agent isn't exploring)`,
    );

  if (
    thresholds.minDaysSurvived != null &&
    run.minDaysSurvived < thresholds.minDaysSurvived
  )
    reasons.push(
      `worst-case days survived ${run.minDaysSurvived} < min ${thresholds.minDaysSurvived} (a session died too early)`,
    );

  return { ok: reasons.length === 0, reasons };
}
