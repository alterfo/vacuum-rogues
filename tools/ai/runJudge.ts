import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmClient } from "./llmClient";
import {
  judgeTranscript,
  type OdditySeverity,
  type OddityReport,
  ODDITY_SEVERITIES,
} from "./oddityJudge";
import {
  generateScenarios,
  type ScenarioConfig,
  type ScenarioGoal,
} from "./scenarioGen";
import type {
  SessionSummary,
  SessionTranscript,
} from "../../src/tests/playtest/letsplay/transcript";

export interface PlaySpec {
  seed: string;
  steps: number;
  scenario?: ScenarioConfig;
}

export interface JudgeSessionInput {
  transcript: SessionTranscript;
  scenario?: ScenarioConfig;
}

export type PlayFn = (specs: PlaySpec[]) => Promise<JudgeSessionInput[]>;

export interface JudgedSession {
  seed: string;
  scenario?: string;
  goal?: ScenarioGoal;
  summary: SessionSummary;
  report: OddityReport;
}

export interface JudgeRunReport {
  generatedAt: string;
  sessions: JudgedSession[];
  totalSessions: number;
  totalFindings: number;
  malformedReplies: number;
  bySeverity: Record<OdditySeverity, number>;
}

export const DEFAULT_JUDGE_SESSIONS = 3;
export const DEFAULT_JUDGE_STEPS = 40;
export const DEFAULT_JUDGE_SEED_PREFIX = "JUDGE";

export interface JudgeRunModelOptions {
  model?: string;
  maxTokens?: number;
}

export interface JudgeTranscriptsOptions extends JudgeRunModelOptions {
  now?: () => string;
}

export function buildPlaySpecs(opts: {
  sessions: number;
  steps: number;
  seedPrefix: string;
  scenarios?: ScenarioConfig[];
}): PlaySpec[] {
  const { steps, seedPrefix } = opts;
  if (opts.scenarios && opts.scenarios.length > 0) {
    return opts.scenarios.map((scenario, i) => ({
      seed: scenario.seed ?? `${seedPrefix}-${scenario.goal}-${i}`,
      steps,
      scenario,
    }));
  }
  const n = Math.max(0, Math.trunc(opts.sessions));
  const specs: PlaySpec[] = [];
  for (let i = 0; i < n; i++) specs.push({ seed: `${seedPrefix}-${i}`, steps });
  return specs;
}

function emptySeverityCounts(): Record<OdditySeverity, number> {
  const counts = {} as Record<OdditySeverity, number>;
  for (const s of ODDITY_SEVERITIES) counts[s] = 0;
  return counts;
}

function consolidate(
  sessions: JudgedSession[],
  now: () => string,
): JudgeRunReport {
  const bySeverity = emptySeverityCounts();
  let totalFindings = 0;
  let malformedReplies = 0;
  for (const s of sessions) {
    if (s.report.malformed) malformedReplies++;
    for (const f of s.report.findings) {
      totalFindings++;
      bySeverity[f.severity]++;
    }
  }
  return {
    generatedAt: now(),
    sessions,
    totalSessions: sessions.length,
    totalFindings,
    malformedReplies,
    bySeverity,
  };
}

export async function judgeTranscripts(
  client: LlmClient,
  items: JudgeSessionInput[],
  opts: JudgeTranscriptsOptions = {},
): Promise<JudgeRunReport> {
  const sessions: JudgedSession[] = [];
  for (const item of items) {
    const report = await judgeTranscript(client, item.transcript, {
      ...(opts.model !== undefined ? { model: opts.model } : {}),
      ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
    });
    sessions.push({
      seed: item.transcript.seed,
      ...(item.scenario
        ? { scenario: item.scenario.name, goal: item.scenario.goal }
        : {}),
      summary: item.transcript.summary,
      report,
    });
  }
  return consolidate(sessions, opts.now ?? (() => new Date().toISOString()));
}

export interface RunJudgeOptions extends JudgeRunModelOptions {
  client: LlmClient;
  play: PlayFn;
  sessions?: number;
  steps?: number;
  seedPrefix?: string;
  scenarios?: ScenarioConfig[];
  useScenarios?: boolean;
  now?: () => string;
}

export async function runJudge(opts: RunJudgeOptions): Promise<JudgeRunReport> {
  const sessions = opts.sessions ?? DEFAULT_JUDGE_SESSIONS;
  const steps = opts.steps ?? DEFAULT_JUDGE_STEPS;
  const seedPrefix = opts.seedPrefix ?? DEFAULT_JUDGE_SEED_PREFIX;
  const model = opts.model;
  const maxTokens = opts.maxTokens;

  let scenarios: ScenarioConfig[] | undefined = opts.scenarios;
  if ((!scenarios || scenarios.length === 0) && opts.useScenarios) {
    scenarios = await generateScenarios(opts.client, sessions, {
      ...(model !== undefined ? { model } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    });
  }

  const specs = buildPlaySpecs({ sessions, steps, seedPrefix, scenarios });
  const items = await opts.play(specs);
  return judgeTranscripts(opts.client, items, {
    ...(model !== undefined ? { model } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
}

export function formatJudgeReport(report: JudgeRunReport): string {
  const lines: string[] = [];
  const mark = report.totalFindings === 0 ? "✓" : "⚠";
  lines.push(
    `${mark} Oddity judge — ${report.totalSessions} session(s), ${report.totalFindings} finding(s)`,
  );
  lines.push(
    `  severity: ` +
      ODDITY_SEVERITIES.map((s) => `${s}=${report.bySeverity[s]}`).join(" "),
  );
  if (report.malformedReplies > 0) {
    lines.push(`  malformed judge replies: ${report.malformedReplies}`);
  }
  for (const s of report.sessions) {
    const tag = s.scenario ? `${s.scenario} (${s.goal})` : "free-play";
    lines.push(
      `  session [${s.seed}] ${tag} — ${s.report.findings.length} finding(s), ` +
        `${s.summary.steps} step(s), ${s.summary.daysElapsed} day(s), net ${s.summary.netCredits} cr`,
    );
    for (const f of s.report.findings) {
      const where = f.evidence.length ? ` @steps ${f.evidence.join(",")}` : "";
      lines.push(`    - [${f.severity}] ${f.title}${where} — ${f.rationale}`);
    }
    if (s.report.malformed) {
      lines.push(`    (malformed judge reply — raw text preserved in JSON)`);
    }
  }
  return lines.join("\n");
}

export interface WrittenJudgeReport {
  reportPath: string;
  summaryPath: string;
}

export function writeJudgeReport(
  report: JudgeRunReport,
  dir = ".letsplay",
): WrittenJudgeReport {
  mkdirSync(dir, { recursive: true });
  const reportPath = join(dir, "oddity-report.json");
  const summaryPath = join(dir, "oddity-report.txt");
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  writeFileSync(summaryPath, formatJudgeReport(report), "utf8");
  return { reportPath, summaryPath };
}
