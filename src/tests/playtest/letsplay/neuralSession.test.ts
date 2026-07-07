/**
 * Guard: the **shipped** trained net (`weights/player.weights.json`) actually
 * *drives* a real-engine session — not just loads (that is `shippedWeights.test.ts`).
 *
 * The net is a behavioural clone of `MemoryHeuristicPolicy` (Task 9 of the
 * 20260701 smart-autopilot plan). After a retrain we want a fast, committed
 * assertion that it (a) boots through `NeuralPolicy`, (b) plays a multi-step
 * session on the real `GameEngine` with **zero harness errors**, and (c) picks a
 * **diverse** repertoire — not collapsed onto a single action.
 *
 * The teacher's dataset populates the reachable action heads (dead heads —
 * take-loan/repay-loan/sell-cargo, and the rare gear/module heads — stay sparse
 * in the headless teacher, the documented `project-letsplay-flee-noop-deadhead`
 * ceiling), so the bar here is "several distinct legal kinds", not the full 18.
 *
 * HISTORY (now healed): while the shipped net was the orphaned pre-retrain clone
 * (trained on the OLD `executeMemoryAwareTrade` that always nudged cargo forward),
 * the no-speculation trade fix collapsed it into a `land`+`trade` (2-kind) loop on
 * this seed, so the diversity assertion was marked `.fails`. The three-year-campaign
 * Task 11 retrain — a behavioural clone of the *current* teacher on the widened
 * 54→256→128→18 space — restored the diverse repertoire, so the marker is removed
 * and the assertion is a plain passing gate again (as the old header instructed).
 *
 * Dev-only, like the rest of `letsplay/`.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import { PlayerAgent } from "./PlayerAgent";
import { NeuralPolicy } from "./NeuralPolicy";
import playerWeights from "./weights/player.weights.json";
import type { AgentRunResult } from "./PlayerAgent";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

describe("shipped net drives a real-engine session", () => {
  let result: AgentRunResult;

  beforeAll(async () => {
    const harness = await RealEngineHarness.boot({ seed: "NEURAL_SESSION" });
    await harness.newGame();

    const policy = new NeuralPolicy({ weights: playerWeights });
    await policy.load();
    expect(policy.isLoaded).toBe(true);

    const agent = new PlayerAgent(harness, policy);
    result = await agent.run(150);
  }, 60_000);

  it("boots and plays error-free, with the net actually driving", () => {
    // No engine/harness errors along the whole session.
    expect(result.errors).toHaveLength(0);
    expect(result.steps.length).toBeGreaterThan(0);

    // The net drives (not the heuristic fallback): decisions are tagged neural.
    const neuralSteps = result.steps.filter(
      (s) => s.action.reason === "neural",
    );
    expect(neuralSteps.length).toBeGreaterThan(0);
  });

  // HEALED by the Task 11 retrain (three-year-campaign): the shipped net is now
  // a behavioural clone of the *current* `MemoryHeuristicPolicy` teacher on the
  // 54→256→128→18 action space, cloned goal-less (no aliasing), so it reproduces
  // the teacher's diverse repertoire in a real session instead of collapsing to
  // the old `land`+`trade` loop. The `.fails` marker (kept while the shipped net
  // was the orphaned pre-retrain clone) is removed now that the assertion passes,
  // exactly as the prior header instructed. Floor stays at its original 3.
  it("picks a diverse action repertoire (>= 3 distinct kinds)", () => {
    const kinds = new Set(result.steps.map((s) => s.action.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });
});
