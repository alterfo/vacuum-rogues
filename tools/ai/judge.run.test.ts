/**
 * Task 5 of the offline LLM oddity-judge: the `npm run letsplay:judge` runner.
 *
 * This is the engine-bound seam the pure orchestrator (`runJudge.ts`) does not own
 * — it boots the *real* `GameEngine` through the harness, plays each spec (free-play
 * or goal-biased by a generated scenario), and folds the run into a judge-ready
 * {@link buildTranscript}. The orchestrator then judges every transcript through the
 * LLM client and consolidates the verdicts.
 *
 * It lives under `tools/ai/` (beside the rest of the judge code) rather than under
 * `src/tests/` on purpose: the build `tsc` is rooted at `src/` and forbids a `src/`
 * file importing out-of-root `tools/ai/*`; keeping the runner in `tools/` preserves
 * the one-way boundary (tools may import src; src never imports tools). Vitest still
 * picks it up via its tools test-file include (the `tools` glob in vitest.config).
 *
 * Two tiers in one file, matching `letsplaySession.test.ts`:
 *  - the **always-on** check: a short *real* session is played and judged through a
 *    {@link FakeLlmClient}, proving the live play seam wires into `runJudge` with no
 *    live API call and no key;
 *  - the **env-gated deep sweep** (`LETSPLAY_JUDGE=1`, driven by `npm run
 *    letsplay:judge`): plays `K` sessions, judges them with the **real**
 *    {@link AnthropicLlmClient}, and writes `.letsplay/oddity-report.*`. With no
 *    `ANTHROPIC_API_KEY` it logs a clear message and throws → vitest exits non-zero.
 *
 * **NOT a gate.** This file's gated block is never wired into `lefthook.yml` or any
 * CI workflow — LLM calls are slow, paid, and non-deterministic. The deterministic
 * letsplay gate (`letsplay:ci`) is untouched.
 *
 * Real `GameEngine` / harness — only PixiJS is stubbed (the mock below is what lets
 * the runner boot headlessly).
 */
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

/**
 * The engine-bound {@link PlayFn}: boot + play each spec on a fresh real harness
 * and fold it into a judge-ready transcript. A scenario spec wraps the base policy
 * in a {@link GoalBiasedPolicy} so the agent acts out the goal; free-play uses the
 * neural-gated default policy verbatim.
 */
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
    // The transcript carried the real per-step records (one per agent step).
    expect(report.sessions[0].summary.steps).toBe(8);
    // A clean fake verdict parses (not malformed) into zero findings.
    expect(report.sessions[0].report.malformed).toBe(false);
    expect(report.totalFindings).toBe(0);
  }, 60_000);
});

/**
 * The deep sweep, opt-in via `LETSPLAY_JUDGE` so the always-on suite stays fast and
 * free. `npm run letsplay:judge` sets it: plays `K`×`N` (optionally scenario-driven
 * with `LETSPLAY_JUDGE_SCENARIOS=1`), judges live with the real Anthropic client,
 * and writes `.letsplay/oddity-report.*`. `LETSPLAY_JUDGE_SESSIONS` /
 * `LETSPLAY_JUDGE_STEPS` / `LETSPLAY_JUDGE_MODEL` override the defaults.
 */
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

    const sessions = Number(process.env.LETSPLAY_JUDGE_SESSIONS ?? 3);
    const steps = Number(process.env.LETSPLAY_JUDGE_STEPS ?? 40);
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

    // The deep sweep is a REPORT, not a gate — findings are informational, so we
    // assert only that it produced a structured report over ≥1 played session.
    expect(report.sessions.length).toBeGreaterThan(0);
    expect(report.generatedAt).toBeTruthy();
  }, 600_000);
});
