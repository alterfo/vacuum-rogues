import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forward, loadWeights } from "./mlp";
import { ACTION_ORDER } from "./observe";
import { FEATURE_LENGTH } from "./NeuralPolicy";

const FIXTURES = join(__dirname, "fixtures");

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

describe("weights contract — exported JSON ↔ mlp.forward parity", () => {
  it("campaign Task 10: the net I/O contract is 54 features in, 18 actions out", () => {
    expect(FEATURE_LENGTH).toBe(54);
    expect(ACTION_ORDER.length).toBe(18);
  });

  it("reproduces the reference net's scores within 1e-5 (parity)", () => {
    const rawWeights = fixture<unknown>("reference.weights.json");
    const io = fixture<{ input: number[]; expected: number[] }>(
      "reference.io.json",
    );

    const weights = loadWeights(rawWeights);
    const out = forward(weights, io.input);
    expect(out).toHaveLength(io.expected.length);
    for (let i = 0; i < io.expected.length; i++) {
      expect(out[i]).toBeCloseTo(io.expected[i], 5);
    }
  });

  it("the reference fixture is in the exporter's MlpWeights JSON shape", () => {
    const raw = fixture<{ layers: { W: number[][]; b: number[] }[] }>(
      "reference.weights.json",
    );
    expect(Array.isArray(raw.layers)).toBe(true);
    expect(raw.layers.length).toBeGreaterThan(0);
    for (const layer of raw.layers) {
      expect(Array.isArray(layer.W)).toBe(true);
      expect(layer.b).toHaveLength(layer.W.length); // outDim
      const inDim = layer.W[0].length;
      for (const row of layer.W) expect(row).toHaveLength(inDim); // rectangular
    }
  });

  it("accepts a player-net-shaped export (FEATURE_LENGTH → 32 → ACTION_ORDER)", () => {
    const hidden = 32;
    const out = ACTION_ORDER.length;
    const exported = {
      layers: [
        {
          W: Array.from({ length: hidden }, () =>
            Array.from({ length: FEATURE_LENGTH }, () => 0.01),
          ),
          b: Array.from({ length: hidden }, () => 0),
        },
        {
          W: Array.from({ length: out }, () =>
            Array.from({ length: hidden }, () => 0.01),
          ),
          b: Array.from({ length: out }, () => 0),
        },
      ],
    };

    const weights = loadWeights(exported);
    expect(weights.layers[0].W[0]).toHaveLength(FEATURE_LENGTH);
    expect(weights.layers[weights.layers.length - 1].W).toHaveLength(out);
    expect(forward(weights, new Array(FEATURE_LENGTH).fill(0.5))).toHaveLength(
      out,
    );
  });
});
