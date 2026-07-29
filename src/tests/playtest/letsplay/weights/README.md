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
`npm run dataset:export`) via `tools/ai/train_player.py`, trained **locally on
Apple MPS** (not the RTX 4090 host):

**2026-07-18 retrain note:** the teacher's combat/garrison behavior changed
materially since the 2026-07-07 run below (headless `attack` went from a no-op
to genuinely driving combat, plus garrison-discount and combat-round
hardening), so the dataset was regenerated from scratch rather than reused.
Chunking widened from 4×0.25-scale to **10×0.1-scale** chunks (`BC1..BC10`) —
the post-three-year-campaign engine state (Overmind arc, garrison layer) is
heavier per session than when the 4-chunk scheme was sized, and a single
0.25-scale (50-session) chunk now OOMs a vitest worker even with the memory
budget that used to cover it. `NODE_OPTIONS=--max-old-space-size=10240` is
also set for the export step as a second safety margin. See
`tools/ai/dataset/retrain_combat.sh` for the full scripted pipeline
(export ×10 → validate each chunk → concatenate → validate the full set →
train). `tools/ai/dataset/validate_dataset.py` now also checks the featurize
[0,1] range contract, per-column statistical outliers, and exact-duplicate
rows (train/val leakage risk) before a training run is trusted — run it before
`train_player.py`, not just after.

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

**2026-07-30 retrain** (fresh 100K-row dataset regenerated after the
land↔take-off anti-loop fix landed in the teacher — `MemoryHeuristicPolicy`'s
no-op-land cooldown + `AgentMemory.noopLandStreak`, see
`.claude/docs/systems/letsplay.md` and `noopLandCooldown.test.ts`): converged
and **early-stopped at epoch 461/500**, **val_acc 91.4%**, val_loss 0.248. No
NaN loss at any point. `--parity-out` re-wrote `fixtures/player.io.json`,
re-asserted by `shippedParity.test.ts` (≤ 1e-5). All neural guard gates green
(`shippedWeights`/`weightsContract`/`neuralSession`/`neuralTargetResolution`/
`neuralActionSpace`).

**The teacher fix is visible in the dataset's action mix** (the whole reason to
regenerate). Compared to the 07-18 dataset below, `land` collapsed
**20.5% → 5.3%** while `dock` rose **8.6% → 25.4%** — a direct, measured
consequence of the no-op-land cooldown: the barren earn-landing churn (the
land↔take-off loop) is gone, so the base ladder falls through to `dock` (which
also refuels but is productive) instead of re-landing the same quest-less
planet. Full new mix: `move` 30.9%, `dock` 25.4%, `warp` 17.1%, `wait` 9.3%,
`trade` 6.3%, `land` 5.3%, `flee` 2.0%, `take-quest` 1.3%, `attack` 1.1%,
`repair` 0.5%, `arm-up` 253 rows, `buy-gear` 221 rows, `liberate` 30 rows,
`upgrade-hull`/`buy-module` double-digit rows; `take-loan`/`repay-loan`/
`sell-cargo` remain **dead heads** (the known, pre-existing headless-applier
limitation, unchanged by this work). Exact-duplicate rows also eased
**49.8% → 47.71%** — modestly fewer repeated/looping states, consistent with
the fix, though still high (train/val leakage caveat below still applies).

**Neural win-rate ceiling is UNMOVED — and this is expected, not a regression.**
Measured **0% win-rate / 15 sessions** via `CAMPAIGN_POLICY=neural
npm run letsplay:campaign` — all 15 wedged, but with `worst repeat-run=1` across
every session (the prior net's collapse was a *repeat-action* argmax loop; this
one is not) and several sessions now progressing further before stalling
(one to day 14 with a quest taken, one to day 62 with 2 quests) vs the prior
net's "most within ~300 steps of day 0." The 0% is **structural to
`NeuralPolicy`, not the teacher's loop**: the net decides by pure argmax on a
static observation with **no anti-stagnation fallback**, and — decisively — the
new cooldown signal (`noopLandStreak`) lives in `AgentMemory` but is **not** in
the 20-wide `memoryFeatures` projection the net is fed, so a static net
literally cannot see it. BC clones the teacher's *outputs*; it cannot replicate
a memory-driven escape the teacher performs by reading a counter the net never
receives. Fixing this would need either an anti-stagnation fallback in
`NeuralPolicy` or featurizing the cooldown (a width change ⇒ full retrain) —
both out of scope here. The neural flag stays **off** in production (default
false); the live autopilot runs the fixed teacher directly, where the anti-loop
fix is fully in effect. See `.claude/docs/systems/letsplay.md`'s neural ceiling
note and the `project-bc-player-net-ceiling` memory.

**The teacher itself — what actually ships live — improved dramatically from the
same fix.** `MemoryHeuristicPolicy` (unretrained, default policy) measured
**33.3% win-rate / 12 sessions** (4 win / 8 loss / 0 died / 0 timeout, **0
wedged**) via `npm run letsplay:campaign` — every session resolved the Overmind
arc by ~day 360–460 with liberation firing, none ran out the step budget stuck.
Compare the pre-fix baseline recorded below (**6.7% / 15, with 13% hitting a
calendar-freeze wedge**): the no-op-land cooldown ~5×'d the live win-rate and
**eliminated the wedges/timeouts entirely** — the land↔take-off loop that used
to freeze the calendar is gone. The remaining 8 losses are the *known, open*
Overmind spread-cadence balance gap (the front outruns the player at ~day 400,
see root `CLAUDE.md`'s Overmind section), not a loop or a wedge. This is the
real payoff of the exercise; the neural retrain above is a faithful but
ceiling-bound clone of this now-healthier teacher.

---

**2026-07-18 retrain** (fresh 100K-row dataset, see note above): converged and
**early-stopped at epoch 412/500**, **val_acc 90.5%**, val_loss 0.241. No NaN
loss at any point. `--parity-out` also wrote `fixtures/player.io.json`,
re-asserted by `shippedParity.test.ts` (≤ 1e-5).

**Read val accuracy with the documented ceiling, not as a win-rate — and this
retrain's ceiling got worse, not better.** The teacher's own action mix shifted
a lot since the 07-07 run (`move` 31.0%, `land` 20.5%, `warp` 18.3%, `dock`
8.6%, `wait` 10.6% — `wait` no longer dominates — `trade` 6.0%, `flee` 2.0%,
`take-quest` 1.4%, `attack` 0.9%, `arm-up` 261 rows, `repair` 0.3%, `liberate`
34 rows; `buy-gear`/`upgrade-hull`/`buy-module` are single/double-digit rows
and `take-loan`/`repay-loan`/`sell-cargo` are still **dead heads** — a known,
pre-existing headless-applier limitation, not new). `validate_dataset.py` also
flags **49.8% exact-duplicate rows** (down from 63.4% in the stale 07-07
dataset, but still high) — a real methodological caveat: some of that 90.5%
val accuracy is train/val leakage from near-identical repeated states, not
genuine held-out generalization.

Measured **0% win-rate / 15 sessions** via `CAMPAIGN_POLICY=neural
npm run letsplay:campaign` (`CAMPAIGN_SESSIONS=15`) — worse than the previous
net's 4%/25 sessions, and **all 15 sessions wedged** (most within ~300 steps of
day 0, several never leaving the home station) rather than merely losing. This
is the same pre-existing structural collapse as before — `NeuralPolicy` has no
anti-stagnation fallback, so a repetitive argmax loop (that a healthy episode's
random/heuristic exploration would break out of) just runs out the step budget
— not a new regression from this retrain, but confirmation the ceiling has not
moved and may be more likely to trigger given the teacher's action mix shifted
further from `wait`-dominated toward move/land/warp/dock, none of which are
resolved by pure argmax on a static net when the observation stops changing.
The neural flag stays **off** in production; see
`docs/plans/20260706-three-year-campaign.md` Task 11 and
`.claude/docs/systems/letsplay.md` for the full record.

For context, the **teacher itself** (`MemoryHeuristicPolicy`, unretrained,
what actually ships live) measured **6.7% win-rate / 15 sessions** the same
day, with 2/15 sessions (13%) hitting a genuine calendar-freeze wedge
(`SPACE_FLIGHT`/`attack` repeat pattern, day frozen ~300 steps) and one death
from engaging combat at 11% hull — both real, open combat issues independent
of this retrain, reported separately.

## Regenerating

See `tools/ai/README.md` for the full pipeline (`exportBcData.ts` →
`train_player.py` → drop the JSON here) and
`docs/architecture/LETSPLAY_ENGINE.md` → "Shipped architecture" for the
architecture rationale. Any `featurize`/`ACTION_ORDER` width change invalidates
this file immediately (`weightsContract.test.ts`/`shippedWeights.test.ts` will
fail) until a fresh dataset is generated and retrained at the new width.
