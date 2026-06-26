# `tools/ai` — player-policy training (behavioural cloning)

The letsplay neural player (`NeuralPolicy`) is a **tiny pure-TS MLP**
(`12 → 32 → 10`, ~746 weights) run by `src/tests/playtest/letsplay/mlp.ts`. There
is no ONNX runtime — the net is just a small weights JSON. This directory is the
**code side** of producing that JSON; the actual training run is a manual
Post-Completion step.

## Pipeline

```
exportBcData.ts          train_player.py             mlp.ts
(TS, real engine)        (Python, PyTorch)           (TS, runtime)
  teacher plays    ──►   JSONL dataset   ──►  *.weights.json  ──►  NeuralPolicy
  (features,action)      supervised fit       MlpWeights JSON      forward()
```

Behavioural cloning = **clone a teacher**. The teacher (the `HeuristicPolicy`
today; the memory-using teacher later) labels every observation with the action it
took, so training is plain supervised classification — **no environment in the
loop**.

## 1. Generate the dataset (TS)

`src/tests/playtest/letsplay/exportBcData.ts` runs the teacher on the real
`GameEngine` and logs `(featurize(obs), actionIndex)` rows. It is dev-only and
runs through vitest (it needs the pixi stub + `@/` alias). To dump a dataset to
the gitignored `.letsplay/`:

```ts
import { collectBcDataset, writeBcDataset } from "./exportBcData";
const rows = await collectBcDataset({ sessions: 50, steps: 200, seedPrefix: "BC" });
writeBcDataset(rows); // → .letsplay/bc-dataset.jsonl
```

The run is **deterministic by seed**: the same `seedPrefix` reproduces the same
dataset. Each row is `{"features": number[12], "action": 0..9}`; the action index
is into `ACTION_ORDER` (observe.ts) — the single source of truth shared by the
legal-action surface, the net's output head, and `NUM_ACTIONS` in the trainer.

## 2. Train + export (Python)

```bash
pip install torch          # train on the RTX 4090
python3 tools/ai/train_player.py \
    --data .letsplay/bc-dataset.jsonl \
    --out  src/tests/playtest/letsplay/weights/player.weights.json \
    --hidden 32 --epochs 200 --seed 0
```

It fits `Linear(12,32) → ReLU → Linear(32,10)` with cross-entropy and exports the
two Linear layers as JSON.

**Weight orientation** matches PyTorch `nn.Linear` and `mlp.ts`: each layer's `W`
is `[outDim][inDim]`, `b` is `[outDim]` — no transpose. Only the Linear layers are
exported (in order); `mlp.ts` re-applies ReLU between layers and leaves the last
layer linear, so the JSON carries **no activation metadata**.

Exported shape:

```json
{ "layers": [ { "W": [[...]], "b": [...] }, { "W": [[...]], "b": [...] } ] }
```

## 3. Load it (TS)

Drop the exported `*.weights.json` where `NeuralPolicy` loads it (dev-only) and
construct `new NeuralPolicy({ weights })`. `load()` validates that the input width
== `FEATURE_LENGTH` (12) and the output width == `ACTION_ORDER.length` (10), so a
mis-sized export fails loudly.

## Contract / parity test

`src/tests/playtest/letsplay/weightsContract.test.ts` pins the interchange format
so a trained net is guaranteed to load and run identically to the reference:

- **Parity** — `fixtures/reference.weights.json` + `fixtures/reference.io.json`
  (a hand-computed `input → expected scores` triple) must be reproduced by
  `mlp.forward` within `1e-5`. If `forward`'s maths or the JSON orientation ever
  drift, this fails.
- **Shape** — a `12 → 32 → 10` export loads via `loadWeights` with the widths
  `NeuralPolicy` requires.

When you change `featurize`'s width or `ACTION_ORDER`, update `FEATURE_LENGTH`
(NeuralPolicy.ts) and `NUM_ACTIONS` (train_player.py) together and regenerate the
dataset + retrain.
