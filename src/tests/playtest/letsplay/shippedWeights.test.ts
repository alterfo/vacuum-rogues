/**
 * Guard: the **shipped** trained player net (`weights/player.weights.json`,
 * produced by `tools/ai/train_player.py` via behavioural cloning) must load
 * cleanly through {@link NeuralPolicy} at the *current* I/O contract.
 *
 * `NeuralPolicy.load()` rejects a net whose input width != {@link FEATURE_LENGTH}
 * or output width != {@link ACTION_ORDER}. So if a later `featurize` change grows
 * the feature block (or `ACTION_ORDER` changes) without retraining + re-exporting,
 * this fails loudly here — the shipped artifact can never silently desync from the
 * code that runs it (the lockstep documented in `tools/ai/README.md`).
 *
 * Dev-only, like the rest of `letsplay/`. No PixiJS needed — this is pure JSON +
 * the policy's load path.
 */
import { describe, it, expect } from "vitest";
import { NeuralPolicy, FEATURE_LENGTH } from "./NeuralPolicy";
import { ACTION_ORDER } from "./observe";
import playerWeights from "./weights/player.weights.json";

// Shipped at the widened 54-feature / 18-action vocabulary (three-year-campaign
// architecture 54->256->128->18). As of Task 11 this is the **real retrain** on
// the new action space (a behavioural clone of the current MemoryHeuristicPolicy
// teacher over the full campaign dataset, `tools/ai/train_player.py`) — no longer
// the Task 10 zero-extension. PyTorch↔TS parity is pinned by shippedParity.test.ts.
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
    // first layer consumes a FEATURE_LENGTH-wide input ([outDim][inDim])
    expect(layers[0].W[0].length).toBe(FEATURE_LENGTH);
    // output head has one score per action slot
    expect(layers[layers.length - 1].W.length).toBe(ACTION_ORDER.length);
  });
});
