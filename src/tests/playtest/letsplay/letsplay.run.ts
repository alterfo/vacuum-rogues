import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GameEngine } from "@/systems/GameEngine";
import { SceneType } from "@/types";
import { RealEngineHarness, type RecordedError } from "../realEngineHarness";
import { observe, type Observation } from "./observe";
import { PlayerAgent, type AgentStep } from "./PlayerAgent";
import type { PlayerPolicy } from "./PlayerPolicy";
import { MemoryHeuristicPolicy } from "./MemoryHeuristicPolicy";
import type { VitalsSample } from "./sessionMetrics";

export interface LetsplayOptions {
  sessions?: number;
  steps?: number;
  seedPrefix?: string;
  policy?: () => PlayerPolicy;
}

export interface InvariantViolation {
  session: number;
  step: number;
  scene: SceneType;
  invariant: string;
  detail: string;
}

export interface LetsplayFailure {
  session: number;
  kind: "error" | "invariant";
  step: number | null;
  scene: SceneType | null;
  message: string;
}

export interface SessionReport {
  index: number;
  seed: string;
  steps: number;
  endScene: SceneType;
  transcript: AgentStep[];
  errors: RecordedError[];
  violations: InvariantViolation[];
  samples: VitalsSample[];
}

export interface LetsplayReport {
  sessions: SessionReport[];
  totalSteps: number;
  failures: LetsplayFailure[];
  ok: boolean;
}

export function checkInvariants(
  obs: Observation,
): { invariant: string; detail: string }[] {
  const out: { invariant: string; detail: string }[] = [];
  const terminal =
    obs.scene === SceneType.WIN_SCREEN || obs.scene === SceneType.GAME_OVER;

  if (obs.hasPlayer && !terminal) {
    const hasForward = obs.legalActions.some((a) => a !== "wait");
    if (!hasForward)
      out.push({
        invariant: "always-actionable",
        detail: `scene ${obs.scene} offered only "wait" — player stranded`,
      });
  }

  if (obs.player) {
    const { hull, maxHull, credits } = obs.player;
    if (!Number.isFinite(hull) || hull < 0)
      out.push({ invariant: "hull-nonnegative", detail: `hull=${hull}` });
    if (maxHull > 0 && hull > maxHull + 1e-6)
      out.push({
        invariant: "hull-within-max",
        detail: `hull=${hull} > maxHull=${maxHull}`,
      });
    if (!Number.isFinite(credits))
      out.push({ invariant: "credits-finite", detail: `credits=${credits}` });
    else if (credits < 0)
      out.push({
        invariant: "credits-nonnegative",
        detail: `credits=${credits}`,
      });
  }

  return out;
}

interface Checkpoint {
  violations: InvariantViolation[];
  sample: VitalsSample | null;
}

function checkpoint(
  engine: GameEngine,
  session: number,
  step: number,
): Checkpoint {
  const obs = observe(engine);
  const violations = checkInvariants(obs).map((v) => ({
    session,
    step,
    scene: obs.scene,
    invariant: v.invariant,
    detail: v.detail,
  }));
  const sample: VitalsSample | null = obs.player
    ? {
        step,
        day: engine.galaxy?.gameDays ?? 0,
        credits: obs.player.credits,
        hull: obs.player.hull,
        maxHull: obs.player.maxHull,
        weaponDamage: obs.player.weaponDamage ?? 0,
        fuel: obs.player.fuel,
        systemId: obs.player.systemId,
        overmindShare: obs.overmindShare ?? 0,
      }
    : null;
  return { violations, sample };
}

async function playSession(
  index: number,
  seed: string,
  steps: number,
  makePolicy: () => PlayerPolicy,
): Promise<SessionReport> {
  const harness = await RealEngineHarness.boot({ seed });
  try {
    await harness.newGame();
    const agent = new PlayerAgent(harness, makePolicy());
    const transcript: AgentStep[] = [];
    const violations: InvariantViolation[] = [];
    const samples: VitalsSample[] = [];

    for (let step = 0; step < steps; step++) {
      const cp = checkpoint(harness.engine, index, step);
      violations.push(...cp.violations);
      if (cp.sample) samples.push(cp.sample);
      const res = await agent.run(1);
      for (const s of res.steps) transcript.push({ ...s, index: step });
    }
    const final = checkpoint(harness.engine, index, steps);
    violations.push(...final.violations);
    if (final.sample) samples.push(final.sample);

    return {
      index,
      seed,
      steps,
      endScene: harness.currentSceneType(),
      transcript,
      errors: harness.errors(),
      violations,
      samples,
    };
  } finally {
    harness.dispose();
  }
}

function failuresOf(session: SessionReport): LetsplayFailure[] {
  const errors: LetsplayFailure[] = session.errors.map((e) => ({
    session: session.index,
    kind: "error" as const,
    step: null,
    scene: null,
    message: `[${e.source}] ${e.message}`,
  }));
  const invariants: LetsplayFailure[] = session.violations.map((v) => ({
    session: session.index,
    kind: "invariant" as const,
    step: v.step,
    scene: v.scene,
    message: `${v.invariant}: ${v.detail}`,
  }));
  return [...errors, ...invariants];
}

export async function runLetsplay(
  opts: LetsplayOptions = {},
): Promise<LetsplayReport> {
  const sessions = opts.sessions ?? 3;
  const steps = opts.steps ?? 40;
  const seedPrefix = opts.seedPrefix ?? "LETSPLAY";
  const makePolicy = opts.policy ?? (() => new MemoryHeuristicPolicy());

  const sessionReports: SessionReport[] = [];
  for (let i = 0; i < sessions; i++) {
    sessionReports.push(
      await playSession(i, `${seedPrefix}-${i}`, steps, makePolicy),
    );
  }

  const failures = sessionReports.flatMap(failuresOf);
  return {
    sessions: sessionReports,
    totalSteps: sessions * steps,
    failures,
    ok: failures.length === 0,
  };
}

export function formatLetsplayReport(report: LetsplayReport): string {
  const lines: string[] = [];
  const mark = report.ok ? "✓" : "✗";
  lines.push(
    `${mark} Letsplay — ${report.sessions.length} session(s), ${report.totalSteps} step(s), ${report.failures.length} failure(s)`,
  );
  for (const s of report.sessions) {
    const ok = s.errors.length === 0 && s.violations.length === 0;
    lines.push(
      `  ${ok ? "✓" : "✗"} session ${s.index} [${s.seed}] — ${s.steps} step(s), ` +
        `end=${s.endScene}, ${s.errors.length} error(s), ${s.violations.length} violation(s)`,
    );
  }
  if (report.failures.length > 0) {
    lines.push("  FAILURES:");
    for (const f of report.failures) {
      const where = f.step != null ? ` @step ${f.step} (${f.scene})` : "";
      lines.push(`    - [s${f.session}] ${f.kind}${where}: ${f.message}`);
    }
  }
  return lines.join("\n");
}

export interface WrittenReport {
  reportPath: string;
  summaryPath: string;
}

export function writeLetsplayReport(
  report: LetsplayReport,
  dir = ".letsplay",
): WrittenReport {
  mkdirSync(dir, { recursive: true });
  const reportPath = join(dir, "letsplay-report.json");
  const summaryPath = join(dir, "letsplay-summary.txt");
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  writeFileSync(summaryPath, formatLetsplayReport(report), "utf8");
  return { reportPath, summaryPath };
}
