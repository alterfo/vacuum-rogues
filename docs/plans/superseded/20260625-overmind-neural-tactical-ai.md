---
# Overmind Neural Tactical AI (trained ONNX policy) + Letsplay Agent

## Overview
ONNX is fully scaffolded but ships no models, so it never runs (always falls back to
the rule-based `FallbackEngine`) while costing a 129 MB dep + ~1100 LOC. Decision:
**make ONNX earn its keep on the one thing where "neural" is the point** — the
**OVERMIND / Dominators** antagonist (the game's subtitle is literally "Neural
Onslaught") — and **remove the adapters templates do better** (dialogue, quest-gen,
emotion).

The Overmind becomes a **real trained neural tactical policy** that adapts to how the
player fights, with `FallbackEngine` heuristics as the floor. The **game's own combat
is the RL environment**: a faithful headless combat sim (built on
`CombatModule`/`ShipPhysics`/`balance.ts`) trains the policy via **self-play PPO on
the RTX 4090**, exported to ONNX and loaded through the existing
`OvermindAdapter` + `inference.worker.ts`. The same environment + self-play yields a
**player-side agent** that drives the **letsplay/playtest harness** automatically
(bug-finding + Overmind training data) — dual use.

**Two-commit shape (like the art):** all code ships + tests green with **no model on
disk** (FallbackEngine floor); training + ONNX export is a manual step on the 4090
(Post-Completion), after which the policy "lights up" via the model manifest.

## Context (from discovery)
- **Dead ONNX scaffolding** (`src/ai/`): `ONNXModelRegistry`, `ONNXModel`,
  `SimpleONNXModel`, `WebWorkerPool`, `IndexedDBCache`, `ModelManifest`,
  `inference.worker.ts`, `AdaptiveQualityProfile`, `FallbackEngine`, and 6 adapters
  (`OvermindAdapter`, `PPOAdapter`, `GRUAdapter`, `T5DialogueAdapter`,
  `QuestNarrator`, `VAEAdapter`). **No `.onnx` files** anywhere ⇒ inference never
  runs. `onnxruntime-web@^1.17` (129 MB).
- **Where it's wired:** `GameEngine.onnxRegistry = new ONNXModelRegistry(...)`;
  `DialogueSystem` calls `gruAdapter.infer(...)` (→ fallback). The Overmind path uses
  `OvermindAdapter` (the keep-target).
- **Inference contract (canon):** never call `ort.InferenceSession.run()` on the main
  thread — go through `ONNXModelRegistry.infer()` (Web Worker) [CLAUDE.md].
- **Combat math to mirror:** `src/presentation/flight/CombatModule.ts` (fire
  intervals/ranges/damage), `src/systems/ShipPhysics.ts` (arc movement, just
  reworked), `src/config/balance.ts` (`combatFireIntervalMs`, `weaponRange`, etc.).
- **Harness for the player agent:** the real-engine playtest harness
  (`src/tests/playtest/**`) boots the real engine headlessly — the env + player
  policy plug in here for automated letsplays.
- **GPU:** `oleg@192.168.88.193` (RTX 4090) — same host as the asset pipeline; shared
  with ollama/whisper (free VRAM by unloading: `~/ollama/bin/ollama stop <model>`).

## Development Approach
- **Testing approach: TDD.** The env (state featurization, step, reward) and the
  policy→Overmind-command mapping are pure and unit-tested; a **parity test** pins
  the env's combat step against the real `CombatModule`/balance math so the sim the
  policy trains on matches the game. All integration tests pass with **no model**
  (FallbackEngine floor); a stubbed in-memory policy exercises the inference path.
- Training is offline (Python/PPO on the 4090) and is a **Post-Completion** step;
  ralphex ships the env, the integration, the export *script*, the letsplay hook, and
  the adapter removal — all verifiable headlessly.
- `impact` on `ONNXModelRegistry`/`OvermindAdapter`/`DialogueSystem` before editing.
  Removing adapters is a real blast radius — keep `FallbackEngine` as the canonical
  AI and re-point `DialogueSystem` at it.

## Testing Strategy
- **Unit:** env state/step/reward determinism; **parity** of env combat step vs
  `CombatModule`/`balance` within tolerance; policy→command mapping; `OvermindAdapter`
  uses the model when present (stub) and FallbackEngine when absent.
- **Real-engine playtest:** an Overmind fight runs end-to-end with the model **absent**
  (heuristic floor) and with a **stub** policy, zero thrown/logged errors; the
  letsplay player-agent completes a short automated session.
- **No E2E rendering needed** (logic/worker path).

## Implementation Steps

### Task 1: Faithful headless combat RL environment
**Files:**
- Create: `src/ai/training/CombatEnv.ts`
- Create: `src/tests/ai/combatEnv.test.ts`

- [ ] Build a pure, PixiJS-free `CombatEnv` exposing `reset()`, `step(action)` →
      `{state, reward, done}` using the game's combat math (fire interval/range/damage
      from `balance.ts`, arc movement from `ShipPhysics`): state = featurized ship
      kinematics + hull + ranges; action = maneuver + fire-target; reward = damage
      dealt − taken (+ terminal win/loss).
- [ ] write tests: deterministic given a seed; **parity** — the env's per-step damage
      / range / fire-timing matches `CombatModule`/`balance` within tolerance (the
      load-bearing anti-sim-drift test).
- [ ] run tests — green.

### Task 2: OvermindAdapter — drive the Overmind from the policy (model-optional)
**Files:**
- Modify: `src/ai/adapters/OvermindAdapter.ts`, `src/ai/ModelManifest.ts`
- Modify: `src/ai/FallbackEngine.ts` (Overmind heuristic floor)
- Create: `src/tests/ai/overmindAdapter.test.ts`

- [ ] `OvermindAdapter.decide(state)` featurizes the live combat state, runs
      `ONNXModelRegistry.infer()` (worker) when the Overmind model is present, maps the
      output to Overmind combat commands; falls back to the `FallbackEngine` heuristic
      when no model/inference error. Wire it into the Overmind's combat decision tick.
- [ ] register a single `overmind-tactical` entry in `ModelManifest` (lazy, IndexedDB-
      cached); absent file ⇒ graceful fallback.
- [ ] write tests: with a **stub** model the adapter emits the mapped command; with no
      model it uses the heuristic; never throws on the main thread.
- [ ] run tests — green.

### Task 3: Training + ONNX export pipeline (code; run is manual)
**Files:**
- Create: `tools/ai/train_overmind.py` (PPO self-play on `CombatEnv`'s spec), `tools/ai/README.md`
- Create: `src/tests/ai/exportContract.test.ts`

- [ ] Implement the PPO self-play trainer against a Python mirror of `CombatEnv`'s
      state/action/reward spec (or a Node bridge to `CombatEnv`); export the policy to
      ONNX matching the adapter's expected input/output tensor shapes.
- [ ] write a contract test pinning the ONNX input/output shape the `OvermindAdapter`
      expects (so a trained model drops in cleanly); a smoke test that a random-weights
      export loads + infers a valid action shape.
- [ ] run tests — green. (Actual training run = Post-Completion on the 4090.)

### Task 4: Letsplay dual-use — automated player agent
**Files:**
- Modify: `src/tests/playtest/**` (a player-agent driver) or `src/ai/training/`
- Create: `src/tests/ai/playerAgent.test.ts`

- [ ] Reuse `CombatEnv` + a player-side policy (heuristic now; ONNX later) to drive an
      **automated player** through the real-engine harness for a short session —
      surfacing errors / asserting always-actionable invariants (bug-finding) and
      generating self-play episodes for Overmind training.
- [ ] write a test: the player agent completes N steps against the engine with zero
      logged/thrown errors.
- [ ] run tests — green.

### Task 5: Remove the adapters templates do better
**Files:**
- Modify/Delete: `src/ai/adapters/{T5DialogueAdapter,QuestNarrator,GRUAdapter,VAEAdapter}.ts`
- Modify: `src/systems/DialogueSystem.ts`, `src/ai/ModelManifest.ts`, `src/ai/ONNXModelRegistry.ts`

- [ ] Delete the dialogue/quest-gen/emotion adapters + their manifest entries;
      re-point `DialogueSystem` (and any caller) at `FallbackEngine` directly so
      dialogue behaviour is unchanged (it already runs on fallback).
- [ ] keep `ONNXModelRegistry`/`WebWorkerPool`/`IndexedDBCache` (now serving the single
      Overmind model); update/trim their tests.
- [ ] run tests — green (the suite stays green; no behaviour regression).

### Task 6: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [ ] `detect_changes({scope:"compare", base_ref:"master"})` — `src/ai` (env, Overmind
      adapter, registry trim, removed adapters) + DialogueSystem + tools/ai affected.
- [ ] full unit suite green; `npm run test:playtest` green; lint clean; build ok;
      confirm the game runs with **no model** (Overmind on heuristic floor) — no
      regression.

### Task 7: Update documentation
**Files:**
- Modify: `CLAUDE.md` (ONNX pipeline section), `src/ai/` notes

- [ ] Document the new scope: ONNX serves **only** the Overmind tactical policy
      (model-optional, FallbackEngine floor), the `CombatEnv` training env, the
      train/export recipe, and the letsplay player-agent; the dialogue/quest adapters
      are gone (FallbackEngine is canonical).

## Technical Details
- Inference stays off the main thread (`ONNXModelRegistry.infer` → worker). The
  model is lazy + IndexedDB-cached; its absence is a safe default (heuristic). The
  env↔game **parity test** is the keystone (a sim that diverges trains a useless
  policy). No domain/schema/save change.

## Post-Completion
*Manual / external — run by a human/Claude, not ralphex.*

**Training the policy (RTX 4090 `oleg@192.168.88.193`):**
- Free VRAM if needed (`~/ollama/bin/ollama stop <model>`), run `tools/ai/train_overmind.py`
  (self-play PPO), iterate reward/curriculum until the policy beats the heuristic in
  the env, export `overmind-tactical.onnx`, drop it where the manifest expects; it
  lights up via lazy load. Re-train as combat balance changes.

**Manual verification:** fight the Overmind with the trained model present — it
maneuvers/targets adaptively (and degrades to the heuristic if the model is missing);
the letsplay agent runs a clean automated session.
