import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forward, loadWeights } from "./mlp";
import { ACTION_ORDER } from "./observe";
import { FEATURE_LENGTH } from "./NeuralPolicy";

/**
 * Task 4 of the pure-TS MLP plan: the **weights contract / parity test**.
 *
 * `tools/ai/train_player.py` trains the tiny MLP in PyTorch and exports its
 * weights as JSON in `mlp.ts`'s {@link MlpWeights} shape (`{ layers: [{ W, b }] }`,
 * `W` in PyTorch `nn.Linear` `[outDim][inDim]` orientation). This test is the
 * **contract that pins that interchange format** so a trained net the script
 * drops in is guaranteed to load and run identically to the reference:
 *
 *  1. **Parity.** A checked-in reference net (`fixtures/reference.weights.json`) +
 *     its input → expected scores triple (`fixtures/reference.io.json`) must be
 *     reproduced by `mlp.forward` within `1e-5`. If `forward`'s maths or the JSON
 *     orientation ever drift, this fails — the exported weights would then mean
 *     something different in-engine than they did at training time.
 *  2. **Shape.** A player-net-shaped export (`FEATURE_LENGTH → 32 → ACTION_ORDER`)
 *     loads via `loadWeights` with the input/output widths `NeuralPolicy` requires
 *     — so the script's output is drop-in compatible with the policy seam.
 */

const FIXTURES = join(__dirname, "fixtures");

/** Read + parse a checked-in JSON fixture by file name. */
function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

describe("weights contract — exported JSON ↔ mlp.forward parity", () => {
  it("reproduces the reference net's scores within 1e-5 (parity)", () => {
    const rawWeights = fixture<unknown>("reference.weights.json");
    const io = fixture<{ input: number[]; expected: number[] }>(
      "reference.io.json",
    );

    // The export format loads via the same validator the engine uses…
    const weights = loadWeights(rawWeights);
    // …and the pure-TS forward pass reproduces the pinned scores exactly.
    const out = forward(weights, io.input);
    expect(out).toHaveLength(io.expected.length);
    for (let i = 0; i < io.expected.length; i++) {
      expect(out[i]).toBeCloseTo(io.expected[i], 5);
    }
  });

  it("the reference fixture is in the exporter's MlpWeights JSON shape", () => {
    // Guards the interchange format the Python script must emit: a non-empty
    // `layers` array of `{ W: number[][], b: number[] }` with `b.length` ==
    // `W.length` (outDim) and rectangular `W`.
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
    // A constant-filled stand-in for what train_player.py will export — proves
    // the shape NeuralPolicy.load requires round-trips through loadWeights.
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
    // Input width == featurize width; output width == action vocabulary.
    expect(weights.layers[0].W[0]).toHaveLength(FEATURE_LENGTH);
    expect(weights.layers[weights.layers.length - 1].W).toHaveLength(out);
    expect(forward(weights, new Array(FEATURE_LENGTH).fill(0.5))).toHaveLength(
      out,
    );
  });
});
