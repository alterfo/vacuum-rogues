/**
 * Letsplay engine — the deterministic multi-session **CI gate** (dev-only).
 *
 * This is the oracle's verdict layer: play `K` seeded sessions of `N` steps on the
 * real engine ({@link runLetsplay}), fold each into the pure
 * {@link sessionMetrics} (errors / soft-locks / corrupt vitals + the balance
 * signals credits-per-day & days-to-first-upgrade), roll them into a cross-session
 * {@link RunMetrics}, and {@link evaluate} that against a band of thresholds. A
 * clean build is `ok: true`; any crash, soft-lock, invariant breach, or
 * out-of-band balance metric makes it `ok: false` with one human-readable reason
 * per breach — the signal the `letsplay:ci` gate turns into a non-zero exit.
 *
 * Two seams, both reusing the *same* metrics core so the gate scores exactly what
 * the unit tests do:
 *  - {@link evaluateLetsplayRun} — **pure**: a played {@link LetsplayReport} (real
 *    *or* synthetic) → `{ run, result }`. Unit-testable with a hand-built report,
 *    so the gate's pass/fail logic is provable without booting an engine.
 *  - {@link runLetsplayCi} — plays the real sessions, then evaluates them.
 *
 * Determinism: each session's galaxy is seeded `"<prefix>-<i>"` (inherited from
 * {@link runLetsplay}), so a CI failure reproduces locally from the same seed.
 *
 * **Dev-only.** Lives under `src/tests/`, imported by no production module
 * (enforced by `letsplayDevOnly.test.ts`).
 */
import {
  runLetsplay,
  formatLetsplayReport,
  type LetsplayOptions,
  type LetsplayReport,
  type SessionReport,
} from "./letsplay.run";
import {
  aggregateSession,
  aggregateRun,
  evaluate,
  type SessionMetricsInput,
  type RunMetrics,
  type MetricsThresholds,
  type EvalResult,
} from "./sessionMetrics";

/**
 * Default CI bands — the gate the pre-push `letsplay-ci` command and the
 * `letsplay-ci` CI workflow score against. Hard faults are gated at a hard
 * **zero** (a crash, a stranded player, or a corrupt vital is never acceptable);
 * these are strict by design and need no headroom.
 *
 * **Task 8 rebaseline** (needs-based `MemoryHeuristicPolicy`, Tasks 1–7):
 * measured at the default headless budget (`letsplay:ci`, 3×40) and a wider
 * 5×150 sweep across several seed prefixes. Unlike the pre-Task-8 dumb
 * heuristic, the galaxy day now reliably advances (`creditsPerDay`/
 * `daysSurvived` produce real values), so those get real hard-fault + band
 * coverage here:
 *  - `maxFuelDeaths`/`maxOvermindLosses` at **0**: zero observed across every
 *    probe session at both budgets (Task 1's fuel-gate and Task 3's threat
 *    tier respectively eliminate these), so — like the existing hard faults —
 *    no headroom is warranted. Both are budget-agnostic (a session can't
 *    starve/lose the galaxy in a handful of steps either), so — unlike the two
 *    signals below — they hold at this shared default regardless of run size.
 *  - `minSurvivalRate` raised to **0.8**: `survivalRate` was a flat 1.0 across
 *    every probe run; 0.8 keeps generous headroom for an unlucky combat death
 *    while still catching a real survival regression.
 *
 * `minDaysSurvived`/`minAvgDistinctSystemsVisited` are **deliberately not**
 * set here even though Task 8 measured real floors for them (3 days / 1
 * distinct system worst-case, 2–4 average) — both are budget-dependent (a
 * 1–12-step smoke run, like this file's own tiny-budget tests, legitimately
 * never leaves the start system) and this default is shared by exactly such
 * runs. They're scored instead in `src/tests/oddities/` against a
 * properly-sized session budget — see the "competent play" oracle test there.
 *
 * `creditsPerDayBand`/`maxAvgDaysToFirstUpgrade`/`minUpgradeRate` stay
 * **unscored**: `creditsPerDay` was consistently *negative* across every probe
 * (roughly −25 to −135/day) and no session reached a hull upgrade in the
 * probed budgets — a real, noted oddity (the agent still isn't a net earner at
 * this short a horizon; `netCredits` also can't see unsold held cargo as
 * value), not something to paper over with a band that would either always
 * fail or have to be set suspiciously loose. Left for a follow-up economy
 * tune, per this file's "never tighten a band to chase noise" rule applied in
 * reverse — don't score a band whose honest baseline is still shaky.
 *
 * **Rebaselining a band (when balance intentionally changes):** run
 * `npm run letsplay:ci` (optionally bump `LETSPLAY_CI_SESSIONS`/`LETSPLAY_CI_STEPS`),
 * read the printed `balance:` line ({@link formatCiResult}), and set the band to
 * the observed mean ± generous headroom. When a deliberate balance tune moves
 * the baseline, re-measure and widen/shift the band in the **same** change so
 * the new economics is the intended band, not a surprise red. Never tighten a
 * band to chase noise from a single seed.
 */
export const DEFAULT_CI_THRESHOLDS: MetricsThresholds = {
  maxErrors: 0,
  maxSoftLocks: 0,
  maxInvariantViolations: 0,
  maxFuelDeaths: 0,
  maxOvermindLosses: 0,
  minSurvivalRate: 0.8,
};

/** Options for a CI run — the play knobs plus the scoring thresholds. */
export interface CiRunOptions extends LetsplayOptions {
  /** Pass/fail bands; defaults to {@link DEFAULT_CI_THRESHOLDS}. */
  thresholds?: MetricsThresholds;
}

/** The CI gate's verdict for one run — metrics, the scored result, and the raw play. */
export interface CiRunResult {
  /** The underlying played report (sessions + transcripts + failures). */
  report: LetsplayReport;
  /** Cross-session aggregate metrics the gate scored. */
  run: RunMetrics;
  /** The threshold evaluation — `ok` ⇔ `reasons` empty. */
  result: EvalResult;
  /** `true` ⇔ the run passed every threshold. */
  ok: boolean;
}

/** Project one played {@link SessionReport} onto the metrics layer's input. */
function toMetricsInput(s: SessionReport): SessionMetricsInput {
  return {
    steps: s.steps,
    endScene: s.endScene,
    errorCount: s.errors.length,
    violations: s.violations.map((v) => ({ invariant: v.invariant })),
    actions: s.transcript.map((t) => t.action.kind),
    samples: s.samples,
  };
}

/**
 * **Pure** verdict: fold a played {@link LetsplayReport} into {@link RunMetrics}
 * and score it against `thresholds`. Works on a synthetic report (no engine), so
 * the gate's pass/fail logic is unit-testable in isolation. Note the score is
 * *stricter* than `report.ok`: it adds the soft-lock + balance dimensions the raw
 * report does not carry.
 */
export function evaluateLetsplayRun(
  report: LetsplayReport,
  thresholds: MetricsThresholds = DEFAULT_CI_THRESHOLDS,
): { run: RunMetrics; result: EvalResult } {
  const sessions = report.sessions.map((s) =>
    aggregateSession(toMetricsInput(s)),
  );
  const run = aggregateRun(sessions);
  const result = evaluate(run, thresholds);
  return { run, result };
}

/**
 * Play `K` sessions × `N` steps on the real engine, then evaluate them against the
 * CI thresholds. Never throws on a play fault — a thrown applier error lands in the
 * harness sink and surfaces as an error metric, so the caller asserts on
 * `result.ok` rather than a try/catch.
 */
export async function runLetsplayCi(
  opts: CiRunOptions = {},
): Promise<CiRunResult> {
  const report = await runLetsplay(opts);
  const { run, result } = evaluateLetsplayRun(
    report,
    opts.thresholds ?? DEFAULT_CI_THRESHOLDS,
  );
  return { report, run, result, ok: result.ok };
}

/** A balance signal rendered for the report, or `n/a` when no value was produced. */
function num(v: number | null, digits = 0): string {
  return v == null ? "n/a" : v.toFixed(digits);
}

/**
 * Render a {@link CiRunResult} as a concise, human-readable gate report: a verdict
 * header, the run's aggregate metrics, and — on failure — every threshold breach
 * followed by the underlying letsplay failure summary so a developer can triage
 * the crash/soft-lock without re-running. Pure string-building.
 */
export function formatCiResult(r: CiRunResult): string {
  const mark = r.ok ? "✓" : "✗";
  const lines: string[] = [
    `${mark} Letsplay CI — ${r.run.sessions} session(s), ${r.run.totalSteps} step(s)`,
    `  faults: errors=${r.run.totalErrors} soft-locks=${r.run.totalSoftLocks} invariant=${r.run.totalInvariantViolations} ` +
      `fuel-deaths=${r.run.fuelDeathCount} overmind-losses=${r.run.overmindLossCount}`,
    `  balance: survival=${(r.run.survivalRate * 100).toFixed(0)}% ` +
      `upgrade=${(r.run.upgradeRate * 100).toFixed(0)}% ` +
      `credits/day=${num(r.run.avgCreditsPerDay)} ` +
      `days-to-upgrade=${num(r.run.avgDaysToFirstUpgrade, 1)} ` +
      `systems-visited=${r.run.avgDistinctSystemsVisited.toFixed(1)} ` +
      `min-days-survived=${r.run.minDaysSurvived}`,
  ];
  if (!r.ok) {
    lines.push("  GATE FAILURES:");
    for (const reason of r.result.reasons) lines.push(`    - ${reason}`);
    lines.push(formatLetsplayReport(r.report));
  }
  return lines.join("\n");
}
