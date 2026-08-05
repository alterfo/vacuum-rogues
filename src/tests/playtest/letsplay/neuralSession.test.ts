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
    expect(result.errors).toHaveLength(0);
    expect(result.steps.length).toBeGreaterThan(0);

    const neuralSteps = result.steps.filter(
      (s) => s.action.reason === "neural",
    );
    expect(neuralSteps.length).toBeGreaterThan(0);
  });

  it("picks a diverse action repertoire (>= 3 distinct kinds)", () => {
    const kinds = new Set(result.steps.map((s) => s.action.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });
});
