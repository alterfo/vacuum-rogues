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
 * The **balance bands** (credits/day, days-to-upgrade, survival, upgrade-rate)
 * are deliberately left **unscored**. Task 3 measured the heuristic agent's real
 * distribution at the bounded headless budget (`letsplay:ci`, default 3×40, also
 * verified at 4×150) and found that **none of them produce a value**: the galaxy
 * day never advances during headless flight (`VitalsSample.day = galaxy.gameDays`
 * stays 0, so `creditsPerDay` is `null`) and the dumb heuristic never upgrades a
 * hull (`daysToFirstUpgrade` is `null`); survival is a flat 100%. Scoring a band
 * around a never-produced value is a no-op, and the metrics layer already skips an
 * omitted/`null`-valued band rather than spuriously failing — so the honest
 * baseline is hard-faults-zero + unscored balance.
 *
 * **Rebaselining a band (when balance intentionally changes):** once a richer
 * policy or a larger step/day budget makes a signal produce values, run
 * `npm run letsplay:ci` (optionally bump `LETSPLAY_CI_SESSIONS`/`LETSPLAY_CI_STEPS`),
 * read the printed `balance:` line ({@link formatCiResult}), and set the band to
 * the observed mean ± generous headroom — e.g. `creditsPerDayBand: { min, max }`
 * or `maxAvgDaysToFirstUpgrade` / `minSurvivalRate` / `minUpgradeRate`. When a
 * deliberate balance tune moves the baseline, re-measure and widen/shift the band
 * in the **same** change so the new economics is the intended band, not a
 * surprise red. Never tighten a band to chase noise from a single seed.
 */
export const DEFAULT_CI_THRESHOLDS: MetricsThresholds = {
  maxErrors: 0,
  maxSoftLocks: 0,
  maxInvariantViolations: 0,
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
    `  faults: errors=${r.run.totalErrors} soft-locks=${r.run.totalSoftLocks} invariant=${r.run.totalInvariantViolations}`,
    `  balance: survival=${(r.run.survivalRate * 100).toFixed(0)}% ` +
      `upgrade=${(r.run.upgradeRate * 100).toFixed(0)}% ` +
      `credits/day=${num(r.run.avgCreditsPerDay)} ` +
      `days-to-upgrade=${num(r.run.avgDaysToFirstUpgrade, 1)}`,
  ];
  if (!r.ok) {
    lines.push("  GATE FAILURES:");
    for (const reason of r.result.reasons) lines.push(`    - ${reason}`);
    lines.push(formatLetsplayReport(r.report));
  }
  return lines.join("\n");
}
