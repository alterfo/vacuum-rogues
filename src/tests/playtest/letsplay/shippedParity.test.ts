import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forward, loadWeights } from "./mlp";
import { FEATURE_LENGTH } from "./NeuralPolicy";
import { ACTION_ORDER } from "./observe";
import playerWeights from "./weights/player.weights.json";

const FIXTURES = join(__dirname, "fixtures");

describe("shipped player.weights.json — PyTorch ↔ pure-TS forward parity", () => {
  it("reproduces the trained model's logits within 1e-5", () => {
    const io = JSON.parse(
      readFileSync(join(FIXTURES, "player.io.json"), "utf8"),
    ) as { input: number[]; expected: number[] };

    expect(io.input).toHaveLength(FEATURE_LENGTH);
    expect(io.expected).toHaveLength(ACTION_ORDER.length);

    const weights = loadWeights(playerWeights);
    const out = forward(weights, io.input);
    expect(out).toHaveLength(io.expected.length);
    for (let i = 0; i < io.expected.length; i++) {
      expect(out[i]).toBeCloseTo(io.expected[i], 5);
    }
  });
});
