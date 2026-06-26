import { describe, it, expect, vi } from "vitest";
import { SceneType } from "@/types";
import {
  evaluateLetsplayRun,
  runLetsplayCi,
  formatCiResult,
  DEFAULT_CI_THRESHOLDS,
  type CiRunResult,
} from "./ci.run";
import type { LetsplayReport, SessionReport } from "./letsplay.run";
import type { AgentStep } from "./PlayerAgent";
import type { Action, PlayerPolicy } from "./PlayerPolicy";
import type { PlayerActionKind } from "./observe";
import type { VitalsSample } from "./sessionMetrics";

/**
 * Task 2 of the letsplay CI oracle: the deterministic multi-session gate.
 *
 * Two tiers in one file:
 *  - the **pure verdict** tests ({@link evaluateLetsplayRun} / {@link formatCiResult})
 *    prove the gate's pass/fail logic on hand-built reports — a clean run passes,
 *    an injected crash / soft-lock / corrupt-vital / out-of-band balance fails —
 *    with no engine boot, so they stay fast and deterministic.
 *  - the **real-engine** tests boot the actual harness through {@link runLetsplayCi}
 *    and show the gate flagging a deliberately broken build (an always-`wait`
 *    policy that strands the player) while passing a healthy heuristic run.
 *
 * The pixi mock is what lets the real harness boot headlessly under Vitest.
 */
vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

/** Build a transcript step carrying just the action `kind` the metrics read. */
function mkStep(kind: PlayerActionKind, index = 0): AgentStep {
  return {
    index,
    scene: SceneType.SPACE_FLIGHT,
    action: { kind, reason: "syn" } as Action,
  };
}

/** A synthetic played session — every field overridable for the scenario. */
function mkSession(over: Partial<SessionReport> = {}): SessionReport {
  return {
    index: 0,
    seed: "SYN",
    steps: over.transcript?.length ?? 4,
    endScene: SceneType.SPACE_FLIGHT,
    transcript: [],
    errors: [],
    violations: [],
    samples: [],
    ...over,
  };
}

/** Wrap synthetic sessions in a {@link LetsplayReport} the gate can score. */
function mkReport(sessions: SessionReport[]): LetsplayReport {
  const failures = sessions.flatMap((s) => [
    ...s.errors.map((e) => ({
      session: s.index,
      kind: "error" as const,
      step: null,
      scene: null,
      message: e.message,
    })),
    ...s.violations.map((v) => ({
      session: s.index,
      kind: "invariant" as const,
      step: v.step,
      scene: v.scene,
      message: `${v.invariant}: ${v.detail}`,
    })),
  ]);
  return {
    sessions,
    totalSteps: sessions.reduce((a, s) => a + s.steps, 0),
    failures,
    ok: failures.length === 0,
  };
}

/** Two samples spanning `days` with `netCredits` earned and an optional upgrade. */
function risingSamples(
  netCredits: number,
  days: number,
  upgrade = false,
): VitalsSample[] {
  return [
    { step: 0, day: 0, credits: 1000, hull: 100, maxHull: 100 },
    {
      step: 1,
      day: days,
      credits: 1000 + netCredits,
      hull: 100,
      maxHull: upgrade ? 140 : 100,
    },
  ];
}

describe("evaluateLetsplayRun — pure verdict over a played report", () => {
  it("passes a clean run: varied play, earnings, no faults", () => {
    const report = mkReport([
      mkSession({
        transcript: [mkStep("land"), mkStep("trade"), mkStep("warp")],
        samples: risingSamples(800, 2),
      }),
    ]);
    const { run, result } = evaluateLetsplayRun(report);
    expect(result.ok, result.reasons.join("; ")).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(run.totalErrors).toBe(0);
    expect(run.totalSoftLocks).toBe(0);
    // Balance signals are aggregated even when unscored.
    expect(run.avgCreditsPerDay).toBe(400);
  });

  it("flags an injected crash (a logged/thrown harness error)", () => {
    const report = mkReport([
      mkSession({
        errors: [{ source: "logger", message: "X is not a constructor" }],
      }),
    ]);
    const { result } = evaluateLetsplayRun(report);
    expect(result.ok).toBe(false);
    expect(result.reasons.join("\n")).toContain("errors 1");
  });

  it("flags a soft-lock — an always-actionable invariant breach", () => {
    const report = mkReport([
      mkSession({
        violations: [
          {
            session: 0,
            step: 3,
            scene: SceneType.SPACE_FLIGHT,
            invariant: "always-actionable",
            detail: "player stranded",
          },
        ],
      }),
    ]);
    const { result } = evaluateLetsplayRun(report);
    expect(result.ok).toBe(false);
    expect(result.reasons.join("\n")).toContain("soft-locks 1");
  });

  it("flags a behavioural soft-lock — a long wait-streak transcript", () => {
    const waits = Array.from({ length: 8 }, (_, i) => mkStep("wait", i));
    const report = mkReport([mkSession({ transcript: waits, steps: 8 })]);
    const { result } = evaluateLetsplayRun(report);
    expect(result.ok).toBe(false);
    expect(result.reasons.join("\n")).toContain("soft-locks 1");
  });

  it("flags a corrupt vital — a non-soft-lock invariant breach", () => {
    const report = mkReport([
      mkSession({
        violations: [
          {
            session: 0,
            step: 2,
            scene: SceneType.SPACE_FLIGHT,
            invariant: "hull-nonnegative",
            detail: "hull=-1",
          },
        ],
      }),
    ]);
    const { result } = evaluateLetsplayRun(report);
    expect(result.ok).toBe(false);
    expect(result.reasons.join("\n")).toContain("invariant violations 1");
  });

  it("flags an out-of-band balance metric (a profit printer)", () => {
    // 1600 credits over 2 days ⇒ 800/day, above the band ceiling.
    const report = mkReport([mkSession({ samples: risingSamples(1600, 2) })]);
    const { result } = evaluateLetsplayRun(report, {
      ...DEFAULT_CI_THRESHOLDS,
      creditsPerDayBand: { min: 50, max: 150 },
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.join("\n")).toContain("credits/day");
  });
});

describe("formatCiResult — readable gate report", () => {
  it("renders a passing run with its aggregate metrics", () => {
    const report = mkReport([
      mkSession({
        transcript: [mkStep("land")],
        samples: risingSamples(400, 2),
      }),
    ]);
    const { run, result } = evaluateLetsplayRun(report);
    const r: CiRunResult = { report, run, result, ok: result.ok };
    const text = formatCiResult(r);
    expect(text).toContain("✓");
    expect(text).toContain("credits/day=200");
    expect(text).not.toContain("GATE FAILURES");
  });

  it("renders failures with the underlying letsplay summary", () => {
    const report = mkReport([
      mkSession({ errors: [{ source: "logger", message: "boom" }] }),
    ]);
    const { run, result } = evaluateLetsplayRun(report);
    const r: CiRunResult = { report, run, result, ok: result.ok };
    const text = formatCiResult(r);
    expect(text).toContain("✗");
    expect(text).toContain("GATE FAILURES");
    expect(text).toContain("errors 1");
    expect(text).toContain("boom");
  });
});

describe("runLetsplayCi — real engine, broken vs healthy build", () => {
  it("passes a healthy heuristic build (default zero-fault thresholds)", async () => {
    const r = await runLetsplayCi({
      sessions: 1,
      steps: 12,
      seedPrefix: "CI_HEALTHY",
    });
    expect(r.result.reasons, formatCiResult(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.run.totalErrors).toBe(0);
    expect(r.run.totalSoftLocks).toBe(0);
    expect(r.run.totalInvariantViolations).toBe(0);
  });

  it("flags a deliberately broken build (an always-wait policy strands the player)", async () => {
    const alwaysWait: PlayerPolicy = {
      name: "always-wait",
      decide: () => ({ kind: "wait", reason: "stuck" }),
    };
    const r = await runLetsplayCi({
      sessions: 1,
      steps: 12,
      seedPrefix: "CI_STUCK",
      policy: () => alwaysWait,
    });
    expect(r.ok, formatCiResult(r)).toBe(false);
    expect(r.run.totalSoftLocks).toBeGreaterThan(0);
    expect(r.result.reasons.join("\n")).toContain("soft-locks");
  });
});

/**
 * The full CI gate, opt-in via `LETSPLAY_CI` so the always-on playtest tier stays
 * fast. `npm run letsplay:ci` sets it: plays `K` sessions × `N` steps, logs the
 * readable gate report, and turns any threshold breach into a non-zero exit.
 * `LETSPLAY_CI_SESSIONS` / `LETSPLAY_CI_STEPS` override the K/N defaults.
 */
const CI = !!process.env.LETSPLAY_CI;
describe.runIf(CI)("npm run letsplay:ci — full deterministic gate", () => {
  it("plays K sessions × N steps and passes every threshold", async () => {
    const sessions = Number(process.env.LETSPLAY_CI_SESSIONS ?? 3);
    const steps = Number(process.env.LETSPLAY_CI_STEPS ?? 40);

    const r = await runLetsplayCi({
      sessions,
      steps,
      seedPrefix: "LETSPLAY_CI",
    });
    // eslint-disable-next-line no-console
    console.log(formatCiResult(r));

    expect(r.result.reasons, formatCiResult(r)).toEqual([]);
    expect(r.ok).toBe(true);
  }, 120_000);
});
