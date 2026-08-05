import { describe, it, expect, vi } from "vitest";
import { RealEngineHarness } from "../../src/tests/playtest/realEngineHarness";
import { PlayerAgent } from "../../src/tests/playtest/letsplay/PlayerAgent";
import { selectPlayerPolicy } from "../../src/tests/playtest/letsplay/policyGate";
import { buildTranscript } from "../../src/tests/playtest/letsplay/transcript";
import { GoalBiasedPolicy } from "../../src/tests/playtest/letsplay/goalBias";
import type { PlayerPolicy } from "../../src/tests/playtest/letsplay/PlayerPolicy";
import { logger } from "@/utils/logger";
import { GameSystemException } from "@/exceptions/GameSystemException";
import { AnthropicLlmClient, FakeLlmClient } from "./llmClient";
import {
  runJudge,
  writeJudgeReport,
  formatJudgeReport,
  type JudgeSessionInput,
  type PlayFn,
} from "./runJudge";

vi.mock("pixi.js", async () => {
  const stub = await import("../../src/tests/playtest/pixiStub");
  return stub.makePixiStub();
});

function posIntEnv(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function makeLivePlay(): PlayFn {
  return async (specs) => {
    const out: JudgeSessionInput[] = [];
    for (const spec of specs) {
      const harness = await RealEngineHarness.boot({ seed: spec.seed });
      try {
        await harness.newGame();
        const base = selectPlayerPolicy();
        const policy: PlayerPolicy = spec.scenario
          ? new GoalBiasedPolicy(base, spec.scenario.goal)
          : base;
        const agent = new PlayerAgent(harness, policy);
        const result = await agent.run(spec.steps);
        const transcript = buildTranscript({
          seed: spec.seed,
          result,
          policy: policy.name,
        });
        out.push({
          transcript,
          ...(spec.scenario ? { scenario: spec.scenario } : {}),
        });
      } finally {
        harness.dispose();
      }
    }
    return out;
  };
}

describe("letsplay:judge — real play seam + runner (fake client)", () => {
  it("plays a real short session and judges it into a report (no live LLM)", async () => {
    const client = new FakeLlmClient(JSON.stringify({ findings: [] }));
    const report = await runJudge({
      client,
      play: makeLivePlay(),
      sessions: 1,
      steps: 8,
      seedPrefix: "JUDGE_FAST",
      now: () => "TS",
    });

    expect(report.totalSessions).toBe(1);
    expect(report.sessions[0].seed).toBe("JUDGE_FAST-0");
    expect(report.sessions[0].summary.steps).toBe(8);
    expect(report.sessions[0].report.malformed).toBe(false);
    expect(report.totalFindings).toBe(0);
  }, 60_000);
});

const JUDGE = process.env.LETSPLAY_JUDGE === "1";
describe.runIf(JUDGE)("npm run letsplay:judge — live LLM deep sweep", () => {
  it("plays K sessions, judges them live, and writes the oddity report", async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      const msg =
        "Set ANTHROPIC_API_KEY to run `npm run letsplay:judge` — the offline " +
        "LLM oddity judge needs a real key (it is a paid, manual deep sweep, " +
        "not a gate).";
      logger.error(msg);
      throw new GameSystemException("LLM_NO_API_KEY", msg);
    }

    const sessions = posIntEnv(process.env.LETSPLAY_JUDGE_SESSIONS, 3);
    const steps = posIntEnv(process.env.LETSPLAY_JUDGE_STEPS, 40);
    const useScenarios = process.env.LETSPLAY_JUDGE_SCENARIOS === "1";
    const model = process.env.LETSPLAY_JUDGE_MODEL;

    const client = new AnthropicLlmClient({
      apiKey,
      ...(model ? { model } : {}),
    });

    const report = await runJudge({
      client,
      play: makeLivePlay(),
      sessions,
      steps,
      useScenarios,
    });
    const written = writeJudgeReport(report);
    logger.info(`${formatJudgeReport(report)}\n  report: ${written.reportPath}`);

    expect(report.sessions.length).toBeGreaterThan(0);
    expect(report.generatedAt).toBeTruthy();
  }, 600_000);
});
