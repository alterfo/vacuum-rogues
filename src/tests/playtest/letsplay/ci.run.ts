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

export const DEFAULT_CI_THRESHOLDS: MetricsThresholds = {
  maxErrors: 0,
  maxSoftLocks: 0,
  maxInvariantViolations: 0,
  maxFuelDeaths: 0,
  maxOvermindLosses: 0,
  minSurvivalRate: 0.8,
};

export interface CiRunOptions extends LetsplayOptions {
  thresholds?: MetricsThresholds;
}

export interface CiRunResult {
  report: LetsplayReport;
  run: RunMetrics;
  result: EvalResult;
  ok: boolean;
}

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

function num(v: number | null, digits = 0): string {
  return v == null ? "n/a" : v.toFixed(digits);
}

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
