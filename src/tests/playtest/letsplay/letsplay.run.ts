/**
 * Letsplay engine — the dev-only session runner + bug-discovery report.
 *
 * {@link runLetsplay} plays **K sessions of N steps** with a {@link PlayerPolicy}
 * (the neural-gated default — heuristic while the flag is off) on a freshly-booted, *real*
 * {@link GameEngine} per session (via {@link RealEngineHarness}), collecting a
 * transcript plus a **failure report** — every `logger.error` / thrown error the
 * harness sink caught **and** every always-actionable-invariant violation
 * {@link checkInvariants} found. The whole point is bug discovery on the real
 * engine: a clean run has `ok: true` / `failures: []`; any integration break or
 * stranded-player state shows up as a failure, and a caller (the `npm run
 * letsplay` session test) turns a non-empty `failures` into a non-zero exit.
 *
 * **Dev-only.** This module lives under `src/tests/`, is imported by no
 * production module (enforced by the Task 4 guard test), and is *not* a test file
 * itself — it has no `vi.mock`, so it relies on its caller (a vitest test) to have
 * mocked PixiJS. That is exactly why `npm run letsplay` drives it through vitest:
 * the dev test environment (jsdom + the pixi stub + the `@/` alias) is what the
 * real harness needs to boot headlessly.
 */
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

/** Knobs for a letsplay run; every field has a sane dev default. */
export interface LetsplayOptions {
  /** Number of sessions (fresh games) to play — `K`. */
  sessions?: number;
  /** Steps the agent takes per session — `N`. */
  steps?: number;
  /** Seed prefix; each session uses `"<prefix>-<i>"` so runs are reproducible. */
  seedPrefix?: string;
  /**
   * Policy factory — a fresh policy per session. Defaults to the neural feature
   * gate ({@link selectPlayerPolicy}): off (the default flag) ⇒ the heuristic,
   * on ⇒ the (inert-until-trained) neural policy.
   */
  policy?: () => PlayerPolicy;
}

/** A single always-actionable-invariant breach observed at one step. */
export interface InvariantViolation {
  /** Which session (0-based) it occurred in. */
  session: number;
  /** Step index within the session (`steps` ⇒ the post-final-state sweep). */
  step: number;
  /** The scene the player was in when the invariant broke. */
  scene: SceneType;
  /** Short invariant id (e.g. `"always-actionable"`). */
  invariant: string;
  /** Human detail of the breach. */
  detail: string;
}

/** A uniform failure row — a logged/thrown error OR an invariant violation. */
export interface LetsplayFailure {
  session: number;
  kind: "error" | "invariant";
  /** Step index for invariant failures; `null` for harness-sink errors. */
  step: number | null;
  scene: SceneType | null;
  message: string;
}

/** The outcome of one played session. */
export interface SessionReport {
  index: number;
  seed: string;
  steps: number;
  endScene: SceneType;
  /** Every observe→decide step the agent took, in order. */
  transcript: AgentStep[];
  /** The harness error sink at session end (logged errors + global rejections). */
  errors: RecordedError[];
  /** Always-actionable-invariant breaches caught during the session. */
  violations: InvariantViolation[];
  /**
   * Per-checkpoint vitals time-series (one sample before each step plus a final
   * resting sample) — the raw material the metrics layer folds into balance
   * signals (credits/day, days-to-first-upgrade). Empty only if the player never
   * existed (it always does after `newGame`).
   */
  samples: VitalsSample[];
}

/** The aggregate report across all sessions — what a run produces. */
export interface LetsplayReport {
  sessions: SessionReport[];
  totalSteps: number;
  /** Flattened errors + violations across every session (the bug list). */
  failures: LetsplayFailure[];
  /** `true` ⇔ no failure — the clean-run signal the runner exits on. */
  ok: boolean;
}

/**
 * The **always-actionable invariant** net — pure over an {@link Observation}, so
 * it is unit-testable and fires identically on synthetic and live states. It
 * encodes the "the player is never stranded / never in a corrupt vital state"
 * rules every step must uphold:
 *
 *  - **always-actionable:** with a player in a non-terminal scene there is always
 *    at least one non-`wait` action — the player can never be dead-ended (the
 *    same rule the invariants harness asserts, read off `legalActions`).
 *  - **hull/credits sanity:** hull is a finite value in `[0, maxHull]` and credits
 *    is a finite number — a NaN/negative vital is a real wiring bug.
 *
 * Returns one entry per breach (empty ⇒ the state is sound).
 */
export function checkInvariants(
  obs: Observation,
): { invariant: string; detail: string }[] {
  const out: { invariant: string; detail: string }[] = [];
  const terminal =
    obs.scene === SceneType.WIN_SCREEN || obs.scene === SceneType.GAME_OVER;

  // always-actionable: a live, non-terminal scene must offer a forward move.
  if (obs.hasPlayer && !terminal) {
    const hasForward = obs.legalActions.some((a) => a !== "wait");
    if (!hasForward)
      out.push({
        invariant: "always-actionable",
        detail: `scene ${obs.scene} offered only "wait" — player stranded`,
      });
  }

  // vital sanity — a corrupt hull/credits projection is a real bug, not play.
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

/** What one observe-checkpoint yields: invariant breaches + a vitals sample. */
interface Checkpoint {
  violations: InvariantViolation[];
  sample: VitalsSample | null;
}

/**
 * Observe `engine` **once** at `step` of `session` and derive both the invariant
 * breaches and a vitals sample from that single projection — folding the
 * always-actionable sweep and the balance-signal sampling into one observe so the
 * two never disagree about the state they saw.
 */
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

/** Play one session of `steps` steps on a freshly-booted harness. */
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
      // Check the state the agent is about to act in, then let it take one step.
      const cp = checkpoint(harness.engine, index, step);
      violations.push(...cp.violations);
      if (cp.sample) samples.push(cp.sample);
      const res = await agent.run(1);
      for (const s of res.steps) transcript.push({ ...s, index: step });
    }
    // A final sweep + sample on the resting state after the last applied action.
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

/** Flatten a session's errors + violations into uniform failure rows. */
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

/**
 * Play `K` sessions × `N` steps and return the aggregate {@link LetsplayReport}.
 * Never throws on a play fault — a thrown applier error lands in the harness sink
 * and becomes a `failures` row, so the caller asserts on `report.ok` rather than
 * a try/catch. Each session boots its own real engine (a clean galaxy + new game)
 * so sessions are independent and reproducible from their seed.
 */
export async function runLetsplay(
  opts: LetsplayOptions = {},
): Promise<LetsplayReport> {
  const sessions = opts.sessions ?? 3;
  const steps = opts.steps ?? 40;
  const seedPrefix = opts.seedPrefix ?? "LETSPLAY";
  // MemoryHeuristicPolicy is the BC teacher — it has the buy-low/sell-high
  // trade loop, cross-planet routing, and "early-explore" warp trigger that
  // prevents the session from looping on one planet forever. The gate policy
  // (selectPlayerPolicy → HeuristicPolicy when off) lacks memory, so the
  // agent gets stuck in PLANET → SPACE_FLIGHT cycles with no exploration.
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

/**
 * Render a {@link LetsplayReport} as a concise, human-readable summary — a header,
 * one line per session (✓/✗ with its error+violation counts), and then every
 * failure row. Pure string-building; the session test logs this and writes the
 * structured report to disk.
 */
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

/** Where the written artifacts land (gitignored — regenerated every run). */
export interface WrittenReport {
  /** The full structured report (sessions + transcripts + failures). */
  reportPath: string;
  /** A flat, human-readable summary of the run. */
  summaryPath: string;
}

/**
 * Persist a run's artifacts to `dir` (default `.letsplay/`, gitignored): the full
 * structured {@link LetsplayReport} as JSON and the {@link formatLetsplayReport}
 * summary as text. Dev-only side-effect, used by the `npm run letsplay` driver;
 * the fast in-suite session test asserts in memory and does not write.
 */
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
