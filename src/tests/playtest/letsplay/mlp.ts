/**
 * Letsplay engine — a hand-written, dependency-free multi-layer perceptron.
 *
 * The only nets this game needs (the letsplay player policy, and later the
 * Overmind) are **tiny feature-vector MLPs** — e.g. `12→32→10` ≈ 746 weights,
 * ~704 multiply-adds per inference. That is microseconds on the CPU and runs
 * inline, so it needs no wasm runtime, Web Worker, or GPU dispatch. This module
 * is the whole inference path: a dense forward pass (matmul + ReLU on the hidden
 * layers, a linear output head) over weights shipped as a small JSON array
 * (`MlpWeights`). It replaces the former `onnxruntime-web` dependency.
 *
 * Pure and dependency-free apart from the project exception types: `forward` is
 * deterministic and side-effect-free, and `loadWeights` validates the shape of
 * untrusted JSON before it is ever fed to `forward`.
 *
 * **Weight orientation** follows PyTorch's `nn.Linear`: each layer's `W` is
 * `[outDim][inDim]` (one row per output neuron) and `b` is `[outDim]`, so
 * `out[j] = Σ_i W[j][i] * input[i] + b[j]`. Exporting `nn.Linear.weight` /
 * `.bias` straight to JSON therefore matches this layout with no transpose.
 */
import { GameValidationException } from "@/exceptions/GameValidationException";

/** One dense layer: weight matrix `W` (`[outDim][inDim]`) + bias `b` (`[outDim]`). */
export interface MlpLayer {
  /** Weight matrix, shape `[outDim][inDim]` (PyTorch `nn.Linear` orientation). */
  readonly W: number[][];
  /** Bias vector, length `outDim`. */
  readonly b: number[];
}

/** A feed-forward net as an ordered list of dense layers. */
export interface MlpWeights {
  readonly layers: readonly MlpLayer[];
}

/** Rectified linear unit — the hidden-layer activation. */
function relu(x: number): number {
  return x > 0 ? x : 0;
}

/**
 * One dense layer: `out[j] = Σ_i layer.W[j][i] * input[i] + layer.b[j]`. Assumes
 * `layer` has already passed {@link loadWeights} validation; `input.length` must
 * equal the layer's input dim — checked by {@link forward}.
 */
function dense(layer: MlpLayer, input: readonly number[]): number[] {
  return layer.W.map((row, j) => {
    let sum = layer.b[j];
    for (let i = 0; i < row.length; i++) sum += row[i] * input[i];
    return sum;
  });
}

/**
 * Run the net for one input vector. Each layer is a dense projection; the hidden
 * layers apply ReLU, the final layer is linear (raw scores / logits). Pure: same
 * weights + input always yield the same output. Throws
 * {@link GameValidationException} when `input` width does not match the first
 * layer's input dim, so a featurizer/weights mismatch fails loudly rather than
 * silently reading `undefined`s.
 */
export function forward(
  weights: MlpWeights,
  input: readonly number[],
): number[] {
  const layers = weights.layers;
  if (layers.length === 0) {
    throw new GameValidationException(
      "MLP_NO_LAYERS",
      "mlp.forward: weights have no layers",
    );
  }
  const expectedIn = layers[0].W[0]?.length ?? 0;
  if (input.length !== expectedIn) {
    throw new GameValidationException(
      "MLP_INPUT_WIDTH",
      `mlp.forward: input width ${input.length} != first-layer input dim ${expectedIn}`,
      { inputWidth: input.length, expected: expectedIn },
    );
  }
  const lastIndex = layers.length - 1;
  let activation: readonly number[] = input;
  for (let l = 0; l < layers.length; l++) {
    const out = dense(layers[l], activation);
    activation = l < lastIndex ? out.map(relu) : out;
  }
  return activation as number[];
}

/**
 * Validate and adopt an untrusted weights object (e.g. parsed from the exported
 * `*.weights.json`). Checks that every layer's `W` is a non-empty rectangular
 * matrix, `b` length matches `W`'s row count (the output dim), and consecutive
 * layers chain (layer `k`'s input dim equals layer `k-1`'s output dim), and that
 * all entries are finite numbers. Returns the value typed as {@link MlpWeights};
 * throws {@link GameValidationException} on any mismatch.
 */
export function loadWeights(json: unknown): MlpWeights {
  const obj = json as { layers?: unknown };
  const rawLayers = obj?.layers;
  if (!Array.isArray(rawLayers) || rawLayers.length === 0) {
    throw new GameValidationException(
      "MLP_WEIGHTS_SHAPE",
      "loadWeights: expected a non-empty `layers` array",
    );
  }

  let prevOut: number | null = null;
  const layers: MlpLayer[] = rawLayers.map((raw, idx) => {
    const layer = raw as { W?: unknown; b?: unknown };
    const W = layer.W;
    const b = layer.b;
    if (!Array.isArray(W) || W.length === 0 || !Array.isArray(b)) {
      throw new GameValidationException(
        "MLP_WEIGHTS_SHAPE",
        `loadWeights: layer ${idx} must have a non-empty W matrix and a b vector`,
      );
    }
    const outDim = W.length;
    if (b.length !== outDim) {
      throw new GameValidationException(
        "MLP_WEIGHTS_SHAPE",
        `loadWeights: layer ${idx} bias length ${b.length} != output dim ${outDim}`,
      );
    }
    const inDim = Array.isArray(W[0]) ? (W[0] as unknown[]).length : 0;
    if (inDim === 0) {
      throw new GameValidationException(
        "MLP_WEIGHTS_SHAPE",
        `loadWeights: layer ${idx} rows must be non-empty`,
      );
    }
    for (let r = 0; r < outDim; r++) {
      const row = W[r];
      if (!Array.isArray(row) || row.length !== inDim) {
        throw new GameValidationException(
          "MLP_WEIGHTS_SHAPE",
          `loadWeights: layer ${idx} row ${r} width ${
            Array.isArray(row) ? row.length : "?"
          } != ${inDim} (W must be rectangular)`,
        );
      }
      for (let c = 0; c < inDim; c++) {
        if (!Number.isFinite(row[c])) {
          throw new GameValidationException(
            "MLP_WEIGHTS_NONFINITE",
            `loadWeights: layer ${idx} W[${r}][${c}] is not a finite number`,
          );
        }
      }
    }
    for (let j = 0; j < outDim; j++) {
      if (!Number.isFinite(b[j])) {
        throw new GameValidationException(
          "MLP_WEIGHTS_NONFINITE",
          `loadWeights: layer ${idx} b[${j}] is not a finite number`,
        );
      }
    }
    if (prevOut !== null && inDim !== prevOut) {
      throw new GameValidationException(
        "MLP_WEIGHTS_CHAIN",
        `loadWeights: layer ${idx} input dim ${inDim} != previous layer output dim ${prevOut}`,
      );
    }
    prevOut = outDim;
    return { W: W as number[][], b: b as number[] };
  });

  return { layers };
}
