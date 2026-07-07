/**
 * Three-year-campaign Task 11: **shipped-net TS↔PyTorch parity gate.**
 *
 * `weightsContract.test.ts` pins `mlp.forward`'s maths against a tiny reference
 * net (3→2→2). This gate closes the parity loop for the *actual shipped* player
 * net (`weights/player.weights.json`, 54→256→128→18): `tools/ai/train_player.py`
 * exported a `{input, expected}` fixture (`fixtures/player.io.json`) holding the
 * trained PyTorch model's forward logits on a deterministic input, and the pure-TS
 * `forward` must reproduce them within `1e-5`. If the exporter's orientation or
 * `forward`'s maths ever drift for the real architecture, this fails loudly — the
 * shipped weights would then mean something different in-engine than at training.
 *
 * Regenerate the fixture whenever the net is retrained:
 *   python3 tools/ai/train_player.py --data tools/ai/dataset/train.jsonl \
 *     --hidden 256 128 --out src/tests/playtest/letsplay/weights/player.weights.json \
 *     --parity-out src/tests/playtest/letsplay/fixtures/player.io.json ...
 *
 * Dev-only, like the rest of `letsplay/`. Pure JSON + the forward pass.
 */
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

    // The parity fixture is at the current I/O contract.
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
