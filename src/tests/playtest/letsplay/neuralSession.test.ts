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
 * The teacher's dataset populates 8 of the 16 action heads (the other 8 —
 * dock/take-quest/repair/gear/hull/module/loan-heads — are dead in the headless
 * teacher, the documented `project-letsplay-flee-noop-deadhead` ceiling), so the
 * bar here is "several distinct legal kinds", not the full 16.
 *
 * Dev-only, like the rest of `letsplay/`.
 */
import { describe, it, expect, vi } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import { PlayerAgent } from "./PlayerAgent";
import { NeuralPolicy } from "./NeuralPolicy";
import playerWeights from "./weights/player.weights.json";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

describe("shipped net drives a real-engine session", () => {
  it("boots, plays error-free, and picks a diverse action repertoire", async () => {
    const harness = await RealEngineHarness.boot({ seed: "NEURAL_SESSION" });
    await harness.newGame();

    const policy = new NeuralPolicy({ weights: playerWeights });
    await policy.load();
    expect(policy.isLoaded).toBe(true);

    const agent = new PlayerAgent(harness, policy);
    const result = await agent.run(150);

    // No engine/harness errors along the whole session.
    expect(result.errors).toHaveLength(0);
    expect(result.steps.length).toBeGreaterThan(0);

    // The net drives (not the heuristic fallback): decisions are tagged neural.
    const neuralSteps = result.steps.filter(
      (s) => s.action.reason === "neural",
    );
    expect(neuralSteps.length).toBeGreaterThan(0);

    // Repertoire is diverse — at least 3 distinct legal kinds over the session,
    // so the net is not collapsed onto a single action.
    const kinds = new Set(result.steps.map((s) => s.action.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  }, 60_000);
});
