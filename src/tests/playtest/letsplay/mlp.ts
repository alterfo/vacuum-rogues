import { GameValidationException } from "@/exceptions/GameValidationException";

export interface MlpLayer {
  readonly W: number[][];
  readonly b: number[];
}

export interface MlpWeights {
  readonly layers: readonly MlpLayer[];
}

function relu(x: number): number {
  return x > 0 ? x : 0;
}

function dense(layer: MlpLayer, input: readonly number[]): number[] {
  return layer.W.map((row, j) => {
    let sum = layer.b[j];
    for (let i = 0; i < row.length; i++) sum += row[i] * input[i];
    return sum;
  });
}

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
