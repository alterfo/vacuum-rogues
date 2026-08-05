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

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

function mkStep(kind: PlayerActionKind, index = 0): AgentStep {
  return {
    index,
    scene: SceneType.SPACE_FLIGHT,
    action: { kind, reason: "syn" } as Action,
  };
}

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

  it("renders n/a for balance signals that produced no value (the real CI path)", () => {
    const report = mkReport([mkSession({ transcript: [mkStep("land")] })]); // no samples
    const { run, result } = evaluateLetsplayRun(report);
    expect(run.avgCreditsPerDay).toBeNull();
    expect(run.avgDaysToFirstUpgrade).toBeNull();
    const text = formatCiResult({ report, run, result, ok: result.ok });
    expect(text).toContain("credits/day=n/a");
    expect(text).toContain("days-to-upgrade=n/a");
    expect(text).not.toContain("NaN");
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

  it("is deterministic — the same seed reproduces identical run metrics", async () => {
    const opts = { sessions: 1, steps: 10, seedPrefix: "CI_DET" } as const;
    const a = await runLetsplayCi(opts);
    const b = await runLetsplayCi(opts);
    expect(b.run).toEqual(a.run);
    expect(b.ok).toBe(a.ok);
  });
});

const CI = !!process.env.LETSPLAY_CI;

function positiveIntEnv(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

describe.runIf(CI)("npm run letsplay:ci — full deterministic gate", () => {
  it("plays K sessions × N steps and passes every threshold", async () => {
    const sessions = positiveIntEnv(process.env.LETSPLAY_CI_SESSIONS, 3);
    const steps = positiveIntEnv(process.env.LETSPLAY_CI_STEPS, 40);

    const r = await runLetsplayCi({
      sessions,
      steps,
      seedPrefix: "LETSPLAY_CI",
    });
     
    console.log(formatCiResult(r));

    expect(r.result.reasons, formatCiResult(r)).toEqual([]);
    expect(r.ok).toBe(true);
  }, 120_000);
});
