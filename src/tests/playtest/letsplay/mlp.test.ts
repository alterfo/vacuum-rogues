import { describe, it, expect } from "vitest";
import { GameValidationException } from "@/exceptions/GameValidationException";
import { forward, loadWeights, type MlpWeights } from "./mlp";

const REFERENCE: MlpWeights = {
  layers: [
    {
      W: [
        [1, 2],
        [-1, 0.5],
      ],
      b: [0.5, -1],
    },
    {
      W: [
        [0.5, 1],
        [2, -1],
        [0, 3],
      ],
      b: [1, -2, 0.5],
    },
  ],
};

describe("mlp.forward", () => {
  it("matches a hand-computed 2-layer reference within 1e-5", () => {
    const out = forward(REFERENCE, [1, 2]);
    expect(out).toHaveLength(3);
    expect(out[0]).toBeCloseTo(3.75, 5);
    expect(out[1]).toBeCloseTo(9, 5);
    expect(out[2]).toBeCloseTo(0.5, 5);
  });

  it("applies ReLU on hidden layers (negative pre-activations clamp to 0)", () => {
    const out = forward(REFERENCE, [0, 0]);
    expect(out[0]).toBeCloseTo(0.5 * 0.5 + 1 * 0 + 1, 5); // 1.25
    expect(out[1]).toBeCloseTo(2 * 0.5 + -1 * 0 - 2, 5); // -1
    expect(out[2]).toBeCloseTo(0 + 3 * 0 + 0.5, 5); // 0.5
  });

  it("handles a single-layer (no hidden) net as a plain linear map", () => {
    const linear: MlpWeights = {
      layers: [
        {
          W: [
            [2, 0],
            [0, 3],
          ],
          b: [1, -1],
        },
      ],
    };
    expect(forward(linear, [4, 5])).toEqual([9, 14]);
  });

  it("throws when input width != first-layer input dim", () => {
    expect(() => forward(REFERENCE, [1, 2, 3])).toThrow(
      GameValidationException,
    );
    expect(() => forward(REFERENCE, [1])).toThrow(GameValidationException);
  });

  it("is pure — repeated calls yield identical output", () => {
    const a = forward(REFERENCE, [1, 2]);
    const b = forward(REFERENCE, [1, 2]);
    expect(a).toEqual(b);
  });
});

function constLayer(inDim: number, outDim: number, w: number, bias: number) {
  return {
    W: Array.from({ length: outDim }, () =>
      Array.from({ length: inDim }, () => w),
    ),
    b: Array.from({ length: outDim }, () => bias),
  };
}

describe("mlp.loadWeights", () => {
  it("accepts and round-trips a valid net", () => {
    const loaded = loadWeights(REFERENCE);
    expect(loaded.layers).toHaveLength(2);
    expect(forward(loaded, [1, 2])[1]).toBeCloseTo(9, 5);
  });

  it("handles the 12→32→10 shape (the player-policy net)", () => {
    const weights: MlpWeights = {
      layers: [constLayer(12, 32, 0.01, 0), constLayer(32, 10, 0.01, 0.1)],
    };
    const loaded = loadWeights(weights);
    const out = forward(loaded, new Array(12).fill(0.5));
    expect(out).toHaveLength(10);
    expect(out[0]).toBeCloseTo(0.01 * (0.01 * 0.5 * 12) * 32 + 0.1, 5);
  });

  it("rejects a non-array / empty layers list", () => {
    expect(() => loadWeights({})).toThrow(GameValidationException);
    expect(() => loadWeights({ layers: [] })).toThrow(GameValidationException);
    expect(() => loadWeights(null)).toThrow(GameValidationException);
  });

  it("rejects a bias whose length != output dim", () => {
    const bad = {
      layers: [
        {
          W: [
            [1, 2],
            [3, 4],
          ],
          b: [0],
        },
      ],
    };
    expect(() => loadWeights(bad)).toThrow(GameValidationException);
  });

  it("rejects a non-rectangular W matrix", () => {
    const bad = { layers: [{ W: [[1, 2], [3]], b: [0, 0] }] };
    expect(() => loadWeights(bad)).toThrow(GameValidationException);
  });

  it("rejects layers whose dims do not chain", () => {
    const bad = {
      layers: [
        {
          W: [
            [1, 1],
            [1, 1],
          ],
          b: [0, 0],
        },
        { W: [[1, 1, 1]], b: [0] },
      ],
    };
    expect(() => loadWeights(bad)).toThrow(GameValidationException);
  });

  it("rejects non-finite weights", () => {
    const bad = { layers: [{ W: [[1, Number.NaN]], b: [0] }] };
    expect(() => loadWeights(bad)).toThrow(GameValidationException);
  });
});
