import { describe, it, expect } from "vitest";
import { NeuralPolicy, FEATURE_LENGTH } from "./NeuralPolicy";
import { ACTION_ORDER } from "./observe";
import playerWeights from "./weights/player.weights.json";

describe("shipped player.weights.json", () => {
  it("loads through NeuralPolicy at the current FEATURE_LENGTH / ACTION_ORDER", async () => {
    const policy = new NeuralPolicy({ weights: playerWeights });
    expect(policy.isLoaded).toBe(false);
    await policy.load();
    expect(policy.isLoaded).toBe(true);
  });

  it("has the expected layer shapes (FEATURE_LENGTH -> hidden... -> ACTION_ORDER)", () => {
    const layers = (
      playerWeights as { layers: { W: number[][]; b: number[] }[] }
    ).layers;
    expect(layers.length).toBe(3);
    expect(layers[0].W[0].length).toBe(FEATURE_LENGTH);
    expect(layers[layers.length - 1].W.length).toBe(ACTION_ORDER.length);
  });
});
