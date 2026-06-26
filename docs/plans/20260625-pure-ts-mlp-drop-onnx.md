---
# Pure-TS MLP for the Neural Policy — Drop onnxruntime-web

## Overview
The only neural nets this game needs (the letsplay player policy, and later the
Overmind) are **tiny feature-vector MLPs** (e.g. `12→32→10` ≈ **746 weights**, ~704
multiply-adds per inference). Running those through `onnxruntime-web` — a **129 MB**
dependency with a wasm runtime + a Web Worker + IndexedDB model caching — is enormous
overkill. Replace it with a **hand-written pure-TS forward pass** (matmul + ReLU +
argmax) over **weights shipped as a small JSON array (~3 KB)**, and **remove
`onnxruntime-web`** and the dead ONNX scaffolding entirely.

The `NeuralPolicy` seam is unchanged — `featurize → forward → mapNetOutputToAction` —
only `forward` swaps from an ONNX session to a TS loop, so it stays runtime-agnostic
(if a net ever genuinely needs a runtime — a conv/transformer — we swap `forward` back
then, not before). Training stays in PyTorch on the 4090; we just export **weights as
JSON** instead of ONNX, pinned by a **parity test**.

## Context (from discovery)
- **The seam already exists** (`src/tests/playtest/letsplay/NeuralPolicy.ts`):
  `FEATURE_LENGTH = 12`, `featurize(obs) → number[12]`, `mapNetOutputToAction(scores,
  obs) → legal Action`, and a dev-only **dynamic** ONNX import in `load()`. Only the
  inference call changes.
- **Dead ONNX scaffolding** (`src/ai/`): `onnxruntime-web` is imported by
  `inference.worker.ts`, `ONNXModelRegistry.ts`, `SimpleONNXModel.ts`; `GameEngine`
  eagerly builds `onnxRegistry`. `ModelManifest`, `IndexedDBCache`, `WebWorkerPool`,
  `AdaptiveQualityProfile`, and the adapters (`OvermindAdapter`, `PPOAdapter`,
  `GRUAdapter`, `T5DialogueAdapter`, `QuestNarrator`, `VAEAdapter`) exist but ship no
  models. `FallbackEngine` is the canonical rule-based engine and stays.
- `DialogueSystem` constructs with an `ONNXModelRegistry` and calls `gruAdapter.infer`
  (→ fallback today) — re-point it at `FallbackEngine`.
- **Supersedes** `docs/plans/20260625-overmind-neural-tactical-ai.md`'s ONNX plumbing
  (that plan is deferred; when revived the Overmind reuses this pure-TS MLP).

## Development Approach
- **Testing approach: TDD.** The MLP forward + weights loader are pure; test shapes +
  a numeric **parity** fixture (a known weights/input/output triple) within `1e-5`. The
  `NeuralPolicy` swap keeps its existing contract tests. Removal is verified by the
  suite staying green + onnxruntime gone from the dep graph.
- `impact` on `GameEngine.onnxRegistry` / `DialogueSystem` / `ONNXModelRegistry` before
  deleting. Keep `FallbackEngine`. No domain/schema/save change.

## Testing Strategy
- **Unit:** `mlp.forward(weights, input)` matches a hand-computed reference (matmul +
  ReLU); `loadWeights(json)` validates dims; `NeuralPolicy` with weights returns the
  argmax legal action, with none falls back to heuristic.
- **Dependency guard:** a test asserts no `src/**` module imports `onnxruntime-web`;
  `package.json` no longer lists it; `npm run build` succeeds with a smaller bundle.

## Implementation Steps

### Task 1: Pure-TS MLP module (forward + weights JSON)
**Files:**
- Create: `src/tests/playtest/letsplay/mlp.ts`
- Create: `src/tests/playtest/letsplay/mlp.test.ts`

- [x] `MlpWeights` (layers of `{W, b}`) + `forward(weights, input: number[]) → number[]`
      (dense + ReLU on hidden layers, linear output) + `loadWeights(json)` with dim
      validation. Pure, dependency-free.
- [x] write tests: forward matches a hand-computed 2-layer reference within `1e-5`;
      `loadWeights` rejects mismatched dims; handles the `12→32→10` shape.
- [x] run tests — green.

### Task 2: Reframe NeuralPolicy onto the pure-TS MLP
**Files:**
- Modify: `src/tests/playtest/letsplay/NeuralPolicy.ts`, `NeuralPolicy.test.ts`

- [x] Replace the ONNX-session path with `mlp.forward` over `loadWeights(modelJson)`:
      `featurize(obs)` → `forward` → `mapNetOutputToAction`. No model/weights ⇒ inert,
      falls back to the heuristic (unchanged contract). Remove the dynamic
      `import("onnxruntime-web")` and the local ORT shims.
- [x] write/adjust tests: with weights, returns the mapped legal action; without,
      falls back; never throws.
- [x] run tests — green.

### Task 3: Remove onnxruntime-web + dead ONNX scaffolding
**Files:**
- Delete: `src/ai/inference.worker.ts`, `ONNXModelRegistry.ts`, `ONNXModel.ts`, `SimpleONNXModel.ts`, `WebWorkerPool.ts`, `IndexedDBCache.ts`, `ModelManifest.ts`, `AdaptiveQualityProfile.ts`, `src/ai/adapters/*`
- Modify: `src/systems/GameEngine.ts`, `src/systems/DialogueSystem.ts`, `package.json`
- Create: `src/tests/architecture/noOnnxRuntime.test.ts`

- [x] Delete the ONNX registry/worker/cache/manifest/adapters; drop `onnxRegistry` from
      `GameEngine`; re-point `DialogueSystem` at `FallbackEngine` directly (behaviour
      unchanged — it already ran on fallback). Remove `onnxruntime-web` from
      `package.json`.
- [x] write a guard test: no `src/**` imports `onnxruntime-web`; `FallbackEngine` is the
      dialogue/AI path.
- [x] run tests — green; `npm run build` ok (smaller bundle, no onnxruntime).

### Task 4: BC training pipeline — data-gen + train script + weights contract
**Files:**
- Create: `src/tests/playtest/letsplay/exportBcData.ts` (+ test), `tools/ai/train_player.py`, `tools/ai/README.md`
- Create: `src/tests/playtest/letsplay/weightsContract.test.ts`

> This is the **code** side of training (the data-gen + train + export pipeline). The
> *actual training run* is a manual Post-Completion step. BC clones a heuristic, so it
> needs **no env in the loop** — just logged `(features, action)` pairs → a supervised
> classifier → weights JSON. Uses the current `HeuristicPolicy` now; re-run later on the
> memory-using teacher from `agent-memory`.

- [x] **Data-gen (TS):** a dev-only exporter that runs `PlayerAgent` + `HeuristicPolicy`
      for K headless sessions and writes `(featurize(obs), actionIndex)` rows to JSONL
      (the BC dataset). Deterministic by seed.
- [x] **Train script (Python):** `tools/ai/train_player.py` loads the JSONL, trains the
      tiny MLP as a multi-class classifier (cross-entropy, `featurize`-width → 10 actions),
      and **exports weights as JSON** matching `mlp.ts`'s `MlpWeights` shape.
- [x] **Contract test (TS):** a fixture `(weights.json, input) → expected scores` pins
      that `mlp.forward` reproduces a reference net within `1e-5` (parity), and that the
      exported shape loads via `loadWeights`.
- [x] write tests: the exporter produces well-formed JSONL (right feature width, legal
      action indices); the weights contract/parity test passes against a checked-in tiny
      reference net.
- [x] run tests — green. (Generating real data + training + dropping the weights in is
      Post-Completion.)

### Task 5: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [ ] `detect_changes({scope:"compare", base_ref:"master"})` — `src/ai` removal +
      NeuralPolicy + GameEngine/DialogueSystem + the new MLP module affected; no
      schema/migration.
- [ ] full unit suite green; `npm run test:playtest` green; `npm run letsplay` runs;
      lint clean; build ok and the bundle no longer contains onnxruntime.

### Task 6: Update documentation
**Files:**
- Modify: `CLAUDE.md` (ONNX pipeline section), `src/presentation/` notes

- [ ] Replace the "ONNX in a worker" guidance: neural policies are tiny pure-TS MLPs
      (weights-JSON + `mlp.forward`); `onnxruntime-web` is removed; `FallbackEngine` is
      the canonical rule engine; a real runtime returns only if a net ever needs one.

## Technical Details
- A `12→32→10` MLP is two matmuls (704 MACs) — microseconds on CPU, runs inline, no
  worker/WebGPU needed (GPU dispatch overhead ≫ compute at this size). Weights ~3 KB
  JSON. Training: PyTorch on the 4090 → export weights JSON → parity-tested.

## Post-Completion
- Train the player policy offline and drop its `*.weights.json` where `NeuralPolicy`
  loads it (dev-only) — covered by the player-net training task.
