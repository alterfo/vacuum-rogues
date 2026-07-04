/**
 * Letsplay engine — session metrics + report evaluator (dev-only, pure).
 *
 * The letsplay oracle's job is to turn a *played* session into a verdict: did the
 * agent hit a crash, a soft-lock, a corrupt vital, or drift a balance signal out
 * of its band? This module is the **pure** core of that verdict — no engine, no
 * I/O — so it is unit-testable on synthetic data and produces deterministic,
 * reproducible pass/fail reasons.
 *
 * Three layers, each pure:
 *  - {@link aggregateSession} folds one session's raw signals (errors, invariant
 *    breaches, the action transcript, an optional vitals time-series) into a
 *    {@link SessionMetrics}.
 *  - {@link aggregateRun} rolls K {@link SessionMetrics} up into the cross-session
 *    {@link RunMetrics} (totals + rates + means) the CI gate scores.
 *  - {@link evaluate} compares {@link RunMetrics} against {@link MetricsThresholds}
 *    and returns `{ ok, reasons }` — a clean run is `ok: true, reasons: []`.
 *
 * The split between *per-session* and *per-run* is deliberate: a single short
 * session is noisy (40 steps may not even advance a galaxy day), so balance bands
 * (credits/day, days-to-upgrade) are scored on the **aggregate** of many seeded
 * sessions, while hard faults (errors / soft-locks / vital corruption) are counted
 * as totals and gated at zero.
 *
 * **Dev-only.** Lives under `src/tests/`, imported by no production module
 * (enforced by `letsplayDevOnly.test.ts`).
 */
import { SceneType } from "@/types";
import { GAME_BALANCE } from "@/config/balance";
import type { PlayerActionKind } from "./observe";

/**
 * Overmind galaxy-share at/above this fraction is the real loss condition
 * (`overmindSpread.ts`'s `lossShare`, mirrored here as a read-only threshold —
 * the oracle only needs to *detect* the share crossing it, not the grace-days/
 * min-systems gating that decides whether it actually fires in-engine).
 */
const OVERMIND_LOSS_SHARE = GAME_BALANCE.OVERMIND_SPREAD_LOSS_SHARE;

/**
 * Invariant ids (from `checkInvariants`) that mean "the player is stranded" — a
 * **soft-lock**, distinct from a corrupt-vital invariant. Currently only the
 * always-actionable rule; kept as a set so future stranded-state invariants
 * classify as soft-locks without touching call sites.
 */
export const SOFT_LOCK_INVARIANTS: ReadonlySet<string> = new Set([
  "always-actionable",
]);

/**
 * A run of this many consecutive `wait` actions in a non-terminal session is
 * treated as a behavioural soft-lock (the agent found nothing to do for a long
 * stretch) — a second, transcript-derived soft-lock signal beside the
 * always-actionable invariant.
 */
export const WAIT_STREAK_SOFTLOCK = 8;

/** A vitals time-sample at one step — the raw material for balance signals. */
export interface VitalsSample {
  /** Step index this sample was taken at. */
  step: number;
  /** Galaxy business day at this step (monotonic non-decreasing). */
  day: number;
  /** Player credits (the current-account GL projection). */
  credits: number;
  /** Current hull HP. */
  hull: number;
  /** Max hull — a rise above the first sample's value flags a ship upgrade. */
  maxHull: number;
  /**
   * Installed weapon damage (`PlayerSnapshot.weaponDamage`). Optional so
   * pre-existing synthetic fixtures still type-check; absent ⇒ treated as `0`.
   * Paired with `maxHull` it flags when the ship reached "battle-ready".
   */
  weaponDamage?: number;
  /**
   * Reactor energy / warp fuel at this step (`PlayerSnapshot.fuel`). Optional so
   * pre-Task-8 synthetic `VitalsSample` fixtures (built without this field) still
   * type-check; absent ⇒ the fuel-death signal is skipped for that session.
   */
  fuel?: number;
  /**
   * The player's current star system id. Optional for the same
   * fixture-compatibility reason; absent samples are excluded from the
   * distinct-systems-visited count.
   */
  systemId?: string;
  /**
   * Fraction of the galaxy's systems currently Overmind-controlled, `[0, 1]`.
   * Optional for the same reason; absent ⇒ treated as `0` (no Overmind signal).
   */
  overmindShare?: number;
}

/** The raw per-session signals the metrics layer aggregates. */
export interface SessionMetricsInput {
  /** Steps the agent took this session. */
  steps: number;
  /** The scene the session ended in (GAME_OVER ⇒ the player died). */
  endScene: SceneType;
  /** Harness-sink faults this session — logged `logger.error`s + thrown errors. */
  errorCount: number;
  /** Invariant breaches with their ids, so soft-lock vs vital can be split. */
  violations: readonly { invariant: string }[];
  /** Per-step action kinds (transcript order) — for wait-streak soft-lock. */
  actions: readonly PlayerActionKind[];
  /** Optional vitals time-series; absent ⇒ balance signals are `null`. */
  samples?: readonly VitalsSample[];
}

/** The aggregated verdict signals for one session. */
export interface SessionMetrics {
  steps: number;
  /** Harness-sink faults (crashes). */
  errors: number;
  /** Stranded/stuck signals: always-actionable breaches + a long wait-streak. */
  softLocks: number;
  /** Corrupt-vital invariant breaches (hull/credits sanity) — not soft-locks. */
  invariantViolations: number;
  /** `false` ⇔ the session ended in GAME_OVER (the player died). */
  survived: boolean;
  /** Net credits change across the session (last − first sample); `null` w/o samples. */
  netCredits: number | null;
  /**
   * Credits earned per galaxy day across the session; `null` when no day elapsed
   * (a short session that never crosses a business date) so a noisy near-zero
   * day-span never produces a divide-by-tiny spike.
   */
  creditsPerDay: number | null;
  /**
   * Galaxy days until the first ship upgrade (first sample whose `maxHull` rises
   * above the opening sample's); `null` if the session never upgraded.
   */
  daysToFirstUpgrade: number | null;
  /**
   * `true` ⇔ the session ended in GAME_OVER with the last sample's fuel at (or
   * below) empty — the specific "starved out mid-transit" failure Task 1's
   * fuel-survival tier exists to eliminate, distinct from a combat death.
   */
  fuelDeath: boolean;
  /** Count of distinct `systemId`s seen across the session's samples. */
  distinctSystemsVisited: number;
  /**
   * `true` ⇔ the session ended in GAME_OVER with the last sample's
   * `overmindShare` at/above the real galaxy loss share
   * ({@link OVERMIND_LOSS_SHARE}) — the game actually ended with the
   * Overmind holding the galaxy, not merely a share that briefly touched the
   * band (the real in-engine condition also needs the grace-days gate).
   */
  overmindLost: boolean;
  /** Galaxy days elapsed across the session (last sample's day − first's). */
  daysSurvived: number;
}

/** Cross-session aggregate — what the CI gate actually scores. */
export interface RunMetrics {
  sessions: number;
  totalSteps: number;
  totalErrors: number;
  totalSoftLocks: number;
  totalInvariantViolations: number;
  /** Fraction of sessions that did not end in GAME_OVER, in `[0, 1]`. */
  survivalRate: number;
  /** Mean credits/day over sessions that produced a value; `null` if none did. */
  avgCreditsPerDay: number | null;
  /** Fraction of sessions that reached ≥1 upgrade, in `[0, 1]`. */
  upgradeRate: number;
  /** Mean days-to-first-upgrade over sessions that upgraded; `null` if none did. */
  avgDaysToFirstUpgrade: number | null;
  /** Sessions that died specifically stranded on empty fuel. */
  fuelDeathCount: number;
  /** Sessions where the Overmind reached the real galaxy loss share. */
  overmindLossCount: number;
  /** Mean distinct systems visited per session. */
  avgDistinctSystemsVisited: number;
  /** The worst-case (minimum) galaxy days survived across sessions. */
  minDaysSurvived: number;
}

/**
 * Pass/fail bands. Hard faults default to a hard zero; balance bands are
 * **optional** — omit one to leave that signal unscored (the default while a band
 * is still being baselined). Survival defaults to "not required" because the
 * baseline heuristic agent is deliberately dumb and dies sometimes; raise
 * `minSurvivalRate` once a smarter policy is the oracle.
 */
export interface MetricsThresholds {
  /** Max harness-sink errors across the whole run (default 0). */
  maxErrors?: number;
  /** Max soft-locks across the whole run (default 0). */
  maxSoftLocks?: number;
  /** Max corrupt-vital invariant breaches across the whole run (default 0). */
  maxInvariantViolations?: number;
  /** Minimum fraction of sessions that must survive (default 0 — not required). */
  minSurvivalRate?: number;
  /** Allowed band for mean credits/day; unscored when omitted or no day elapsed. */
  creditsPerDayBand?: { min: number; max: number };
  /** Max acceptable mean days-to-first-upgrade; unscored when omitted. */
  maxAvgDaysToFirstUpgrade?: number;
  /** Min fraction of sessions that must reach an upgrade; unscored when omitted. */
  minUpgradeRate?: number;
  /** Max sessions allowed to die stranded on empty fuel (default 0). */
  maxFuelDeaths?: number;
  /** Max sessions allowed to lose the galaxy to the Overmind (default 0). */
  maxOvermindLosses?: number;
  /** Min mean distinct systems visited per session; unscored when omitted. */
  minAvgDistinctSystemsVisited?: number;
  /** Min galaxy days every session must survive; unscored when omitted. */
  minDaysSurvived?: number;
}

/** The verdict — `ok` ⇔ `reasons` is empty. */
export interface EvalResult {
  ok: boolean;
  /** One human-readable line per failed threshold. */
  reasons: string[];
}

/** The longest run of consecutive `wait` actions in a transcript. */
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

/**
 * Fold one session's raw signals into {@link SessionMetrics}. Pure: every output
 * is derived solely from `input`, so a synthetic input yields a deterministic
 * metric. Balance signals are `null` when the session carries no samples or no
 * galaxy day elapsed.
 */
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
    // Only counts as a *loss* when the game actually ended while the Overmind
    // held the galaxy — a share crossing the band mid-session is expected
    // pressure (the real in-engine loss also needs the grace-days gate before
    // it can fire), not itself a failure. Mirrors `fuelDeath`'s "died with X"
    // shape rather than "ever touched X".
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

/** Mean of a list, or `null` when empty (so "no data" ≠ "zero"). */
function meanOrNull(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Roll a list of per-session metrics into the cross-session {@link RunMetrics}.
 * Rates are fractions in `[0, 1]`; means skip sessions that produced no value
 * (`null`), so a run where no session ever upgraded reports `avgDaysToFirstUpgrade:
 * null` rather than a misleading 0. An empty run is the trivial all-zero / no-data
 * aggregate.
 */
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

/**
 * Score a {@link RunMetrics} against {@link MetricsThresholds}. Hard faults
 * (errors / soft-locks / vital invariants) default to a zero ceiling; balance
 * bands and survival are only scored when their threshold is supplied **and** the
 * run produced a value for them — so an unbaselined or sample-less band never
 * spuriously fails the gate. Returns one reason line per breach; `ok` ⇔ no breach.
 *
 * A run that played **zero sessions** always fails: an empty aggregate trips no
 * fault ceiling and would otherwise pass vacuously, so a misconfigured gate (e.g.
 * `LETSPLAY_CI_SESSIONS=0` or a non-numeric override) silently playing nothing
 * must red the oracle rather than green it.
 */
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
