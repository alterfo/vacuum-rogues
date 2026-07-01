# `tools/ai` — player-policy training (behavioural cloning)

The letsplay neural player (`NeuralPolicy`) is a **tiny pure-TS MLP** run by
`src/tests/playtest/letsplay/mlp.ts`. There is no ONNX runtime — the net is just
a small weights JSON. This directory is the **code side** of producing that
JSON; the actual training run is a manual Post-Completion step.

The current target architecture (for the RTX 4090 retrain) is **50 → 256 → 128
→ 16** (≈51K params: `FEATURE_LENGTH` = 30 observation + 20 memory features,
`ACTION_ORDER.length` = 16). The reference/parity-test net (`fixtures/*.weights.json`
in `weightsContract.test.ts`) stays small (`18 → 32 → 10`) — it pins the
*format*, not the shipped architecture.

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
dataset. Each row is `{"features": number[50], "action": 0..15}`; the action
index is into `ACTION_ORDER` (observe.ts) — the single source of truth shared by
the legal-action surface, the net's output head, and `NUM_ACTIONS` in the trainer.

## 2. Train + export (Python)

`train_player.py` supports an arbitrary number of hidden layers, mini-batch
training via `DataLoader`, an optional train/val split with early stopping, a
cosine-annealing LR schedule, and `cuda`/`mps`/`cpu` auto-detection.

Small local run (single hidden layer, full-batch, no validation — matches the
old default behaviour):

```bash
pip install torch
python3 tools/ai/train_player.py \
    --data .letsplay/bc-dataset.jsonl \
    --out  src/tests/playtest/letsplay/weights/player.weights.json \
    --hidden 32 --epochs 200 --seed 0
```

The RTX 4090 target architecture (**50 → 256 → 128 → 16**, ≈51K params), run
over SSH on `oleg@192.168.88.193`:

```bash
scp tools/ai/train_player.py oleg@192.168.88.193:/tmp/
scp tools/ai/dataset/train.jsonl oleg@192.168.88.193:/tmp/
ssh oleg@192.168.88.193 "cd /tmp && python train_player.py \
  --data train.jsonl \
  --hidden 256 128 \
  --dropout 0.15 \
  --epochs 500 \
  --batch 512 \
  --lr 3e-4 \
  --val-split 0.2 \
  --patience 30 \
  --device cuda \
  --out player.weights.json"
scp oleg@192.168.88.193:/tmp/player.weights.json \
  src/tests/playtest/letsplay/weights/player.weights.json
```

CLI reference:

| Flag | Default | Meaning |
|------|---------|---------|
| `--data` | required | JSONL BC dataset path |
| `--out` | required | output weights JSON path |
| `--hidden` | `32` | hidden layer widths, e.g. `--hidden 256 128` for N layers |
| `--dropout` | `0.0` | dropout after each hidden ReLU (omitted from the net entirely when `0`) |
| `--epochs` | `200` | max epochs (early stopping can end it sooner) |
| `--batch` | `512` | mini-batch size (a batch larger than the dataset just becomes full-batch) |
| `--lr` | `1e-2` | Adam learning rate, cosine-annealed over `--epochs` |
| `--val-split` | `0.0` | fraction held out for validation/early-stopping (`0` = train-only, no early stop) |
| `--patience` | `30` | epochs of no val-loss improvement before stopping early |
| `--device` | `auto` | `auto`\|`cuda`\|`mps`\|`cpu` — `auto` and any unavailable explicit choice fall back down the cuda → mps → cpu chain |
| `--num-workers` | `0` | `DataLoader` worker processes (dataset fits in RAM, so `0` is fine) |
| `--seed` | `0` | seeds `torch`, the train/val split, and shuffling |

`in_dim` is always read from the dataset's feature width (tracks `FEATURE_LENGTH`
automatically); only `NUM_ACTIONS` is a pinned constant in the script.

**Weight orientation** matches PyTorch `nn.Linear` and `mlp.ts`: each layer's `W`
is `[outDim][inDim]`, `b` is `[outDim]` — no transpose. Only `nn.Linear` layers
are exported (in order); `nn.ReLU`/`nn.Dropout` carry no parameters and are
skipped — `mlp.ts` re-applies ReLU between layers and leaves the last layer
linear, so the JSON carries **no activation metadata** regardless of how many
hidden layers or how much dropout the training run used.

Exported shape (one entry per `nn.Linear`, so a 3-hidden-layer net exports 4):

```json
{ "layers": [ { "W": [[...]], "b": [...] }, { "W": [[...]], "b": [...] } ] }
```

### Smoke test

`tools/ai/test_train.sh` generates a tiny random 50-feature/16-action dataset
and runs 3 epochs end-to-end (mini-batch + dropout + val-split + early-stopping
config all exercised) to catch a pipeline crash before spending a real 4090 run:

```bash
tools/ai/test_train.sh
```

## 3. Load it (TS)

Drop the exported `*.weights.json` where `NeuralPolicy` loads it (dev-only) and
construct `new NeuralPolicy({ weights })`. `load()` validates that the input width
== `FEATURE_LENGTH` (50) and the output width == `ACTION_ORDER.length` (16), so a
mis-sized export fails loudly.

## Contract / parity test

`src/tests/playtest/letsplay/weightsContract.test.ts` pins the interchange format
so a trained net is guaranteed to load and run identically to the reference:

- **Parity** — `fixtures/reference.weights.json` + `fixtures/reference.io.json`
  (a hand-computed `input → expected scores` triple, a small fixed `18 → 32 → 10`
  net) must be reproduced by `mlp.forward` within `1e-5`. If `forward`'s maths or
  the JSON orientation ever drift, this fails. This fixture is intentionally
  **not** resized when the real architecture changes — it only pins the
  interchange format, not the shipped shape.
- **Shape** — a `FEATURE_LENGTH → 32 → ACTION_ORDER` export loads via
  `loadWeights` with the widths `NeuralPolicy` requires (`FEATURE_LENGTH` = 50,
  `ACTION_ORDER.length` = 16).

When you change `featurize`'s width or `ACTION_ORDER`, update `FEATURE_LENGTH`
(NeuralPolicy.ts) and `NUM_ACTIONS` (train_player.py) together and regenerate the
dataset + retrain.

---

# Offline LLM oddity-judge + scenario-generator (dev-only, paid, NOT a gate)

The rest of `tools/ai/` is a **deep-sweep layer that runs OFF the push hot-path** —
an LLM that *judges* what the letsplay agent played and *generates* new things for
it to try. It catches the open-ended **semantic** oddities the deterministic oracle
(`letsplay:ci`) cannot encode (unrewarded combat, a rep dead-end, a quest target
unreachable for its deadline, stuck progression with no feedback). It is **never a
gate** — LLM calls are slow, paid, and non-deterministic
(`docs/plans/20260627-llm-oddity-judge-and-scenario-generator.md`). See
`docs/architecture/LETSPLAY_ENGINE.md` → "Offline LLM oddity-judge" for the full
design and the **three-tier oddity-finding model** (fast deterministic gate every
push → targeted Playwright E2E → this paid deep sweep, manual/nightly).

## Pipeline

```
transcript.ts          oddityJudge.ts / visionJudge.ts      runJudge.ts
(TS, from a run)        (prompt + parse, via LlmClient)      (orchestrate K)
 SessionTranscript ──►  OddityReport (findings)         ──►  .letsplay/oddity-report.*
  scenarioGen.ts ──► scenario configs ──► GoalBiasedPolicy biases what gets played
```

| Module | Role |
|--------|------|
| `llmClient.ts` | The injectable LLM boundary: `LlmClient.complete(messages, opts) → text` with the real `AnthropicLlmClient` (model + key from env; `opts.images` for vision) and a `FakeLlmClient` for deterministic, free tests. The Anthropic SDK is a **lazy dynamic import**; a missing key throws a clear error **only when invoked live**, never at import. |
| `oddityJudge.ts` | Builds a judge prompt from a `SessionTranscript` + `ODDITY_RUBRIC`; `parseOddityReport` → a structured `OddityReport` (`{title, severity, evidence, rationale}`). A malformed reply degrades to "no structured findings" + raw text — never throws. |
| `visionJudge.ts` | The visual sibling: `judgeFrames` attaches captured frames (`opts.images`) and judges against `VISION_ODDITY_RUBRIC` (text overflow, missing art, sameness, a missing death explosion) — the classes a text transcript provably cannot see. |
| `scenarioGen.ts` | Asks the LLM for N diverse play scenarios → configs `{name, seed?, goal, maxDays}` (`goal` ∈ `go-broke`/`max-rep`/`ignore-overmind`/`hoard`/`free-explore`). An unknown goal is dropped, not crashed. `GoalBiasedPolicy` (in `src/tests/playtest/letsplay/goalBias.ts`) steers the agent; default free-play is unchanged. |
| `runJudge.ts` | `runJudge({client, play, sessions, steps})` plays K sessions (optionally scenario-driven), judges each transcript, consolidates the verdicts, and `writeJudgeReport`s `.letsplay/oddity-report.*` (gitignored). |
| `judge.run.test.ts` | The `npm run letsplay:judge` entry. An **always-on** check plays a short real session and judges it through the `FakeLlmClient` (no key, no live call — runs on every `npm test`); the **`LETSPLAY_JUDGE=1` deep sweep** judges live with the real client. |

## Running it

The Anthropic SDK is an **optional dev-only install** — kept out of `package.json` so
importing the judge and running every test stays free without it. Install it once
before the first live run (running live without it degrades to a clear "install
`@anthropic-ai/sdk`" error, never an opaque module-not-found crash):

```bash
npm i -D @anthropic-ai/sdk      # one-time, only needed for the live deep sweep
```

```bash
npm run letsplay:judge          # plays K sessions, judges live, writes .letsplay/oddity-report.*
ANTHROPIC_API_KEY=sk-...  npm run letsplay:judge   # needs a real key
LETSPLAY_JUDGE_SESSIONS=5 LETSPLAY_JUDGE_STEPS=60 LETSPLAY_JUDGE_SCENARIOS=1 \
  LETSPLAY_JUDGE_MODEL=claude-... npm run letsplay:judge
```

With **no `ANTHROPIC_API_KEY`** it logs a clear "set ANTHROPIC_API_KEY" and exits
**non-zero**. Prefer Sonnet/Haiku for the high-volume judge, Opus for a periodic
deep pass — configurable via `LETSPLAY_JUDGE_MODEL` (see the `claude-api` reference
for current model ids before changing the default).

## Dev-only / never bundled

Everything here is **dev-only and never a gate**. `tools/ai/*` lives outside the
`src/` build root, and `src/tests/architecture/letsplayDevOnly.test.ts` asserts **no
production module imports it — static or dynamic** (so neither the judge nor the
Anthropic SDK reaches `npm run build`). The runner is in **no** `lefthook.yml`
pre-push command and **no** CI workflow; the cheap deterministic `letsplay:ci` gate
is untouched. No domain/schema/save change.
