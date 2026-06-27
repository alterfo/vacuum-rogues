/**
 * Offline `letsplay:judge` runner — the deep-sweep glue (dev-only, `tools/`-resident).
 *
 * This is the orchestration layer over the Task 1-4 pieces: it plays `K` sessions
 * (optionally scenario-driven), folds each into a judge-ready
 * {@link SessionTranscript}, sends every transcript through the LLM
 * {@link judgeTranscript}, and consolidates the verdicts into one
 * {@link JudgeRunReport} written to `.letsplay/oddity-report.*` (gitignored).
 *
 * **It is NOT a gate.** The deterministic port-agent + invariants stay the cheap
 * pre-push gate; this is the slow, paid, non-deterministic deep sweep run manually
 * (`npm run letsplay:judge`) or nightly — never in `lefthook.yml` or CI.
 *
 * **Engine-free + injectable.** The heavy real-engine play is the lone seam this
 * module does *not* own: the caller passes a {@link PlayFn} (the `judge.run.test.ts`
 * vitest runner supplies the engine-bound one; tests inject a fake). Everything
 * else here — spec building, judging, consolidation, formatting, file write — is
 * pure or pure-plus-`fs`, so the whole pipeline is unit-testable against a
 * {@link FakeLlmClient} with no engine and no API key.
 *
 * Three layers, each testable in isolation:
 *  - {@link buildPlaySpecs} — pure: turn run knobs (+ optional scenarios) into the
 *    concrete `{seed, steps, scenario?}` list to play;
 *  - {@link judgeTranscripts} — async glue over the LLM client: judge each
 *    transcript and {@link consolidate} the findings into a {@link JudgeRunReport};
 *  - {@link runJudge} — the orchestrator: resolve scenarios (explicit > generated >
 *    none) → specs → `play` → judge.
 *
 * **Dev-only.** Lives under `tools/`, imported by no production module (the prod
 * graph guard in `letsplayDevOnly.test.ts` keeps it out of the bundle).
 */
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

/** One session to play: its seed, step budget, and (when scenario-driven) goal. */
export interface PlaySpec {
  /** Galaxy seed (reproducibility); scenario seed wins, else `<prefix>-<i>`. */
  seed: string;
  /** Steps the agent takes this session. */
  steps: number;
  /** The scenario whose goal biases the agent, when scenario-driven. */
  scenario?: ScenarioConfig;
}

/** A played session ready for judging: its transcript + the scenario it ran (if any). */
export interface JudgeSessionInput {
  transcript: SessionTranscript;
  scenario?: ScenarioConfig;
}

/**
 * The engine-bound play seam — the only piece this module does not own. Given the
 * concrete specs, boot + play each session and return its judge-ready transcript.
 * The live runner supplies the real one (real `GameEngine` via the harness); tests
 * inject a deterministic fake.
 */
export type PlayFn = (specs: PlaySpec[]) => Promise<JudgeSessionInput[]>;

/** One judged session in a run — its identity, summary, and the oddity verdict. */
export interface JudgedSession {
  /** The galaxy seed it was played on. */
  seed: string;
  /** The scenario name, when scenario-driven (omitted for free-play). */
  scenario?: string;
  /** The scenario goal, when scenario-driven. */
  goal?: ScenarioGoal;
  /** The transcript's session-level rollup (days, curves, kills, quests). */
  summary: SessionSummary;
  /** The LLM judge's parsed verdict for this session. */
  report: OddityReport;
}

/** The consolidated verdict across every judged session in a run. */
export interface JudgeRunReport {
  /** When the report was assembled (ISO); injectable for deterministic tests. */
  generatedAt: string;
  /** Per-session verdicts, in play order. */
  sessions: JudgedSession[];
  /** Number of sessions judged. */
  totalSessions: number;
  /** Total oddity findings across all sessions. */
  totalFindings: number;
  /** How many sessions returned an unparseable (malformed) judge reply. */
  malformedReplies: number;
  /** Findings tallied by severity. */
  bySeverity: Record<OdditySeverity, number>;
}

/** Default number of free-play sessions when the caller does not specify. */
export const DEFAULT_JUDGE_SESSIONS = 3;
/** Default step budget per session. */
export const DEFAULT_JUDGE_STEPS = 40;
/** Default seed prefix (`<prefix>-<i>`). */
export const DEFAULT_JUDGE_SEED_PREFIX = "JUDGE";

/** Per-call model/token overrides shared by judging + scenario generation. */
export interface JudgeRunModelOptions {
  /** Override the judge/generation model id. */
  model?: string;
  /** Hard cap on output tokens per call. */
  maxTokens?: number;
}

/** Knobs for {@link judgeTranscripts}. */
export interface JudgeTranscriptsOptions extends JudgeRunModelOptions {
  /** Injected clock for `generatedAt` (deterministic in tests). */
  now?: () => string;
}

/**
 * Build the concrete {@link PlaySpec} list. **Pure.** When `scenarios` are given,
 * one spec per scenario (its own `seed` wins, else a goal-tagged prefixed seed);
 * otherwise `sessions` free-play specs seeded `<prefix>-<i>`. The step budget is
 * shared across all specs.
 */
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

/** A fresh, zeroed severity histogram covering every known severity. */
function emptySeverityCounts(): Record<OdditySeverity, number> {
  const counts = {} as Record<OdditySeverity, number>;
  for (const s of ODDITY_SEVERITIES) counts[s] = 0;
  return counts;
}

/** Fold per-session verdicts into the cross-session {@link JudgeRunReport}. Pure. */
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

/**
 * Judge a list of played sessions and consolidate them. Each transcript is sent
 * through {@link judgeTranscript} (so a malformed reply degrades to "no structured
 * findings", never throwing); the per-session verdicts roll up into one
 * {@link JudgeRunReport}. The client's own missing-key guard propagates.
 */
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

/** Options for {@link runJudge} — the play knobs + the injected seams. */
export interface RunJudgeOptions extends JudgeRunModelOptions {
  /** The LLM client used to judge (and, when generating, to propose scenarios). */
  client: LlmClient;
  /** The engine-bound play seam (the live runner supplies it; tests fake it). */
  play: PlayFn;
  /** Free-play session count (ignored when `scenarios`/`useScenarios` drive it). */
  sessions?: number;
  /** Steps per session. */
  steps?: number;
  /** Seed prefix for free-play / scenario-less seeds. */
  seedPrefix?: string;
  /** Pre-supplied scenarios — takes precedence over `useScenarios`. */
  scenarios?: ScenarioConfig[];
  /** Ask the LLM for `sessions` scenarios and play them goal-biased. */
  useScenarios?: boolean;
  /** Injected clock for the report timestamp (deterministic in tests). */
  now?: () => string;
}

/**
 * The orchestrator: resolve scenarios (explicit `scenarios` > LLM-`useScenarios` >
 * none) → {@link buildPlaySpecs} → `play` → {@link judgeTranscripts}. Returns the
 * consolidated {@link JudgeRunReport}; the caller persists it via
 * {@link writeJudgeReport}.
 */
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

/**
 * Render a {@link JudgeRunReport} as a concise, human-readable summary — a verdict
 * header, the severity histogram, then one block per session with its findings.
 * Pure string-building (the text artifact written beside the JSON).
 */
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

/** Where the written artifacts land (gitignored — regenerated every run). */
export interface WrittenJudgeReport {
  /** The full structured {@link JudgeRunReport} as JSON. */
  reportPath: string;
  /** The {@link formatJudgeReport} summary as text. */
  summaryPath: string;
}

/**
 * Persist a run's verdict to `dir` (default `.letsplay/`, gitignored): the full
 * structured {@link JudgeRunReport} JSON and the {@link formatJudgeReport} summary.
 * Dev-only side-effect used by the offline runner.
 */
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
