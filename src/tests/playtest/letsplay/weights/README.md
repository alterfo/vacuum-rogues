# `weights/player.weights.json`

The shipped, trained player policy net for the dev-only letsplay `NeuralPolicy`
(`src/tests/playtest/letsplay/NeuralPolicy.ts`). It is a plain JSON weights export
run through the hand-written pure-TS forward pass in `mlp.ts` — there is no ONNX
runtime and nothing here reaches the prod bundle
(`src/tests/architecture/letsplayDevOnly.test.ts`,
`src/tests/architecture/noOnnxRuntime.test.ts`).

## Contract

| Field | Value |
|---|---|
| `FEATURE_LENGTH` (input width) | **54** = `OBS_FEATURE_LENGTH` (30, egocentric observation) + `MEMORY_FEATURE_LENGTH` (20, belief-derived) + `CAMPAIGN_FEATURE_LENGTH` (4, campaign difficulty) |
| `NUM_ACTIONS` (output width) | **18** = `ACTION_ORDER.length` (`observe.ts`) — the 16 base actions + `arm-up` + `liberate` |
| Architecture | **54 → 256 → 128 → 18** (3 `nn.Linear` layers, ReLU between each hidden pair, linear output head) |
| Parameters | ≈49,298 |

> **Three-year-campaign Task 11 (real retrain).** Task 10 first shipped this file
> **zero-extended** from the prior `50 → 256 → 128 → 16` net (4 zeroed input
> columns + 2 strongly-negative-biased output rows, so it played byte-identically
> to the 16-action clone and could not express `arm-up`/`liberate`). Task 11
> **replaced that zero-extension with a real retrain** on the goal-less
> `MemoryHeuristicPolicy` teacher at the full 54/18 shape — the net now can and
> does select `arm-up`/`liberate` (see Result below). Its win-rate ceiling is the
> teacher's own — see "Known ceiling" below.

`NeuralPolicy.load()` rejects any weights file whose first layer's input width
!= `FEATURE_LENGTH` or last layer's output width != `ACTION_ORDER.length` — a
stale/mis-sized export fails loudly rather than silently mispredicting
(`shippedWeights.test.ts` pins this against the shipped file on every run).
Interchange **format** (JSON shape, `nn.Linear`-only export, no transpose) is
pinned independently by `weightsContract.test.ts` against a small fixed
reference net — that fixture is intentionally **not** resized when this
architecture changes; it only pins the wire format.

## Training config

Trained on `tools/ai/dataset/train.jsonl` (200 goal-less `MemoryHeuristicPolicy`
sessions × 500 steps = 100,000 rows at the 54-wide feature shape, exported via
`npm run dataset:export` in 4 memory-bounded chunks —
`LETSPLAY_EXPORT_MIX_SESSIONS_SCALE=0.25` with distinct
`LETSPLAY_EXPORT_MIX_SEED_PREFIX=BC1..BC4` — since a single 200×500 run OOMs one
vitest worker; see `tools/ai/README.md`) via `tools/ai/train_player.py`, trained
**locally on Apple MPS** (not the RTX 4090 host):

```bash
python train_player.py \
  --data train.jsonl \
  --hidden 256 128 \
  --dropout 0.15 \
  --epochs 500 \
  --batch 512 \
  --lr 3e-4 \
  --val-split 0.2 \
  --patience 40 \
  --seed 0 \
  --device mps \
  --parity-out fixtures/player.io.json \
  --out player.weights.json
```

| Setting | Value |
|---|---|
| Hidden layers | `256 128` |
| Dropout | `0.15` (train-only; not present in the export) |
| Batch size | `512` |
| Learning rate | `3e-4`, Adam, cosine-annealed over `--epochs` |
| Val split | `0.2` |
| Early-stop patience | `40` epochs of no val-loss improvement |
| Device | `mps` (Apple Silicon) |

## Result

Converged and **early-stopped at epoch 448/500**, **val_acc 96.8%**,
val_loss 0.083. No NaN loss at any point. `--parity-out` also wrote
`fixtures/player.io.json`, a `{input, expected}` PyTorch↔TS parity fixture
(float64 forward pass for bit-comparable maths), asserted against the pure-TS
`mlp.forward` by `shippedParity.test.ts` (≤ 1e-5).

**Read the 96.8% val accuracy with the documented ceiling, not as a win-rate.**
The dataset populates every reachable action head (`wait` 57.8%, `warp` 14.1%,
`move` 7.8%, `land` 7.3%, `trade` 6.0%, `attack` 3.9%, `take-quest` 1.4%,
`flee` 1.3%, `arm-up` 235 rows, `liberate` 12 rows), so — unlike the Task 10
zero-extension's 8-dead-head dataset — this net genuinely learned to select
`arm-up`/`liberate`, not just the trade/navigate/fight repertoire. But a BC
clone can only **match**, not **exceed**, its teacher: measured **4% win-rate /
25 sessions** vs the `MemoryHeuristicPolicy` teacher's own ~18%, because most
seeds hit a pre-existing pure-argmax `PLANET↔TRADE` no-op collapse
(`NeuralPolicy` has no anti-stagnation fallback — confirmed pre-existing via
`git stash` on the committed weights, not a retrain regression). The neural
flag stays **off** in production; see `docs/plans/20260706-three-year-campaign.md`
Task 11 and `.claude/docs/systems/letsplay.md` for the full record.

## Regenerating

See `tools/ai/README.md` for the full pipeline (`exportBcData.ts` →
`train_player.py` → drop the JSON here) and
`docs/architecture/LETSPLAY_ENGINE.md` → "Shipped architecture" for the
architecture rationale. Any `featurize`/`ACTION_ORDER` width change invalidates
this file immediately (`weightsContract.test.ts`/`shippedWeights.test.ts` will
fail) until a fresh dataset is generated and retrained at the new width.
