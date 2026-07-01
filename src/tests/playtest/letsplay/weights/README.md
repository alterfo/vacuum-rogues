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
| `FEATURE_LENGTH` (input width) | **50** = `OBS_FEATURE_LENGTH` (30, egocentric observation) + `MEMORY_FEATURE_LENGTH` (20, belief-derived) |
| `NUM_ACTIONS` (output width) | **16** = `ACTION_ORDER.length` (`observe.ts`) |
| Architecture | **50 → 256 → 128 → 16** (3 `nn.Linear` layers, ReLU between each hidden pair, linear output head) |
| Parameters | ≈51,328 |

`NeuralPolicy.load()` rejects any weights file whose first layer's input width
!= `FEATURE_LENGTH` or last layer's output width != `ACTION_ORDER.length` — a
stale/mis-sized export fails loudly rather than silently mispredicting
(`shippedWeights.test.ts` pins this against the shipped file on every run).
Interchange **format** (JSON shape, `nn.Linear`-only export, no transpose) is
pinned independently by `weightsContract.test.ts` against a small fixed
reference net — that fixture is intentionally **not** resized when this
architecture changes; it only pins the wire format.

## Training config

Trained on `tools/ai/dataset/train.jsonl` (9,600 rows, generated via
`npm run dataset:export` at a reduced scale — see `tools/ai/README.md` and the
20260701 action-expansion plan's Task 9 notes) via `tools/ai/train_player.py`,
over SSH on the game's ComfyUI host (`oleg@192.168.88.193`, RTX 4090, using the
host's existing `torch 2.6.0+cu124` venv):

```bash
python train_player.py \
  --data train.jsonl \
  --hidden 256 128 \
  --dropout 0.15 \
  --epochs 500 \
  --batch 512 \
  --lr 3e-4 \
  --val-split 0.2 \
  --patience 30 \
  --device cuda \
  --out player.weights.json
```

| Setting | Value |
|---|---|
| Hidden layers | `256 128` |
| Dropout | `0.15` (train-only; not present in the export) |
| Batch size | `512` |
| Learning rate | `3e-4`, Adam, cosine-annealed over `--epochs` |
| Val split | `0.2` |
| Early-stop patience | `30` epochs of no val-loss improvement |
| Device | `cuda` (RTX 4090) |

## Result

Converged and **early-stopped at epoch 409/500** (< 60 s wall-clock on the
4090). No NaN loss at any point.

| Epoch | train_loss | train_acc | val_loss | val_acc |
|---|---|---|---|---|
| 1 | 2.5846 | 0.377 | 2.4228 | 0.351 |
| 100 | 0.0122 | 0.996 | 0.0114 | 0.994 |
| 250 | 0.0052 | 0.998 | 0.0059 | 0.997 |
| 409 (early stop) | 0.0041 | 0.999 | 0.0047 | **0.997** |

Full log: `tools/ai/dataset/training_log.txt`.

**Read the 99.7% val accuracy with the documented caveat, not at face value.**
The `train.jsonl` this net trained on has **8 of 16 action kinds as dead heads**
(zero labeled rows) — `dock`, `take-quest`, `repair`, and all 6 of this plan's
new economy actions (`buy-gear`, `upgrade-hull`, `buy-module`, `take-loan`,
`repay-loan`). Root cause: the headless applier's `flee`/`repair` degrade to a
no-op tick (no real disengage/repair-dock executor exists yet), so once the
teacher engages a heavily-garrisoned Overmind system it can neither win nor
escape — hull oscillates around the ~50% engage/retreat threshold and the run
spends its step budget cycling `attack`/`flee` forever, never reaching a
station/bank/quest/gear action. The net therefore only ever had to discriminate
among the 8 action kinds the teacher actually emitted; 99.7% reflects mastery of
*that* narrower task, not full 16-action competence. See
`docs/architecture/LETSPLAY_ENGINE.md` → "Known Traps" and `tools/ai/README.md`
for the full writeup and the recommended fix (give the headless applier a real
disengage executor, regenerate the dataset, retrain) before relying on this net
for anything beyond the trade/navigate/fight repertoire it actually learned.

## Regenerating

See `tools/ai/README.md` for the full pipeline (`exportBcData.ts` →
`train_player.py` → drop the JSON here) and
`docs/architecture/LETSPLAY_ENGINE.md` → "Shipped architecture" for the
architecture rationale. Any `featurize`/`ACTION_ORDER` width change invalidates
this file immediately (`weightsContract.test.ts`/`shippedWeights.test.ts` will
fail) until a fresh dataset is generated and retrained at the new width.
