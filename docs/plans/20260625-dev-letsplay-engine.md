---
# Dev-Only Letsplay Engine (an agent plays as the player)

## Overview
Build the **letsplay engine**: a headless agent that **plays the game as the player**
— observing game state and choosing player actions (navigate, trade, dock, take/finish
quests, fight, repair) to drive a full playthrough on the *real* `GameEngine`. The
policy is **pluggable**: a baseline **heuristic** ships now; a **neural policy**
("нейросеть думает за игрока") drops in later behind the same interface.

Hard constraint: **dev-environment only — never shipped to prod.** The engine lives
outside the production bundle (vite builds from `src/main.ts`; `src/tests/` + `tools/`
are not bundled) and is guarded so no prod code can import it; any ONNX runtime it
later uses is a **dev-only dynamic import**, not added to the prod build.

Primary value now: **automated playtesting** — the agent plays many sessions, surfacing
errors / always-actionable-invariant violations (bug discovery on the real engine).
Later: it generates self-play data + becomes the player-side net for the Overmind work
(`docs/plans/20260625-overmind-neural-tactical-ai.md`, whose letsplay task this
supersedes).

## Context (from discovery)
- **Foundation:** `src/tests/playtest/realEngineHarness.ts` — `RealEngineHarness.boot()`
  boots the real `GameEngine` (real `GalaxyService`/`QuestManager`/`BankingService`,
  pixi stubbed via `pixiStub.ts`), drives genuine `transitionTo` scene wiring, advances
  frames deterministically via `tick()` (no rAF), and records logged/thrown errors in a
  sink. The agent drives the game through this.
- **Letsplay precedent:** `e2e/letsplay-discovery.spec.ts`,
  `docs/playtests/20260610-letsplay-discovery.md`, and the completed
  `letsplay-*` fix plans — automated-discovery is an established idea; this makes it an
  agent with a policy.
- **Dev-only mechanisms:** `import.meta.env.DEV` / `import.meta.env.PROD`, `__DEBUG__`
  (`= mode==='development'`, `vite.config.ts`). Prod bundle = the import graph of
  `src/main.ts`; nothing under `src/tests/`/`tools/` is included.
- **Run target:** `package.json` `test:playtest` runs `vitest src/tests/playtest`; a
  `letsplay` script will run the agent the same dev-only way.

## Development Approach
- **Testing approach: TDD.** The observation extractor (engine state → features +
  legal actions) and the heuristic policy (features → action) are **pure** and
  unit-tested; the action applier maps an action onto the real engine via the harness.
  The agent loop is tested by running short sessions against the real harness asserting
  zero logged/thrown errors + invariants hold.
- **Dev-only is a first-class requirement, enforced by a test:** the engine lives under
  `src/tests/playtest/letsplay/` (or `tools/letsplay/`), and a guard test asserts **no
  production module** (`src/**` excluding `src/tests/**`) imports the letsplay engine,
  so it can never reach the prod bundle. Any future `onnxruntime` use is a dev-only
  dynamic `import()` inside the dev path — never added to prod `src` imports.
- Builds on `RealEngineHarness`; no domain/schema/save change. `impact` on the harness
  before extending it.

## Testing Strategy
- **Unit:** observation extractor (deterministic features + correct legal-action set
  per scene); heuristic policy (sane action for representative states; never an illegal
  action); action applier (each action maps to the right engine call).
- **Real-engine session:** the agent plays N steps across scenes (flight → planet →
  trade → quest → combat) with zero logged/thrown errors and no invariant violation.
- **Guard test:** no prod module imports the letsplay engine (dev-only enforced).

## Implementation Steps

### Task 1: Observation + legal-action surface over the harness
**Files:**
- Create: `src/tests/playtest/letsplay/observe.ts`
- Create: `src/tests/playtest/letsplay/observe.test.ts`

- [x] `observe(engine)` → a pure snapshot: current scene, player credits/hull/fuel/
      cargo/position, nearby planets/stations/NPCs, active quests, and the **set of
      legal player actions** for the current scene (move/dock/land/trade/take-quest/
      attack/flee/repair/wait/warp).
- [x] write tests: deterministic snapshot for a booted harness; legal-action set
      matches the scene (e.g. no "trade" outside a market).
- [x] run tests — green.

### Task 2: PlayerAgent loop + pluggable PlayerPolicy + heuristic baseline
**Files:**
- Create: `src/tests/playtest/letsplay/PlayerPolicy.ts` (interface), `HeuristicPolicy.ts`, `PlayerAgent.ts`
- Create: `src/tests/playtest/letsplay/heuristicPolicy.test.ts`

- [x] Define `PlayerPolicy { decide(obs): Action }`; implement a goal-directed
      `HeuristicPolicy` (survive → earn credits via trade/quests → explore; flee/repair
      at low hull) that only ever returns a **legal** action.
- [x] `PlayerAgent` runs observe→decide→apply→`tick` over the harness for a step budget,
      collecting a transcript + the harness error sink.
- [x] write tests: the policy returns legal, non-degenerate actions across sampled
      states; never throws; never picks an illegal action.
- [x] run tests — green.

### Task 3: Dev-only letsplay runner + bug-discovery report
**Files:**
- Create: `src/tests/playtest/letsplay/letsplay.run.ts` (+ a `letsplay` npm script)
- Create: `src/tests/playtest/letsplay/letsplaySession.test.ts`

- [x] A runner that plays K sessions of N steps with the `HeuristicPolicy`, writing a
      transcript + a **failure report** (every logged/thrown error or always-actionable
      invariant violation), exit-non-zero on failures (a dev bug-finder). Wire an
      `npm run letsplay` that runs it via vitest (dev-only, like `test:playtest`).
- [x] write a session test: a short real-engine session completes with zero
      errors/invariant violations.
- [x] run tests — green.

### Task 4: Enforce dev-only (never in prod)
**Files:**
- Create: `src/tests/architecture/letsplayDevOnly.test.ts`

- [x] Guard test: scan `src/**` excluding `src/tests/**` and assert **no production
      module imports** anything under the letsplay engine dir; assert the engine does
      not statically import `onnxruntime-web` (the future neural policy uses a dev-only
      dynamic `import()`).
- [x] confirm `npm run build` (prod) does not pull the letsplay engine (it isn't in
      `main.ts`'s graph) and the prod bundle is unaffected.
- [x] run tests — green.

### Task 5: Neural-policy seam (stub, dev-only)
**Files:**
- Create: `src/tests/playtest/letsplay/NeuralPolicy.ts` (+ test)

- [x] Add a `NeuralPolicy implements PlayerPolicy` that will load a trained ONNX player
      net via a **dev-only dynamic import** and map net output → legal `Action`; for now
      a documented stub that throws "not trained yet" unless a model path is provided,
      so the heuristic remains the default. (Training/export is Post-Completion.)
- [x] write tests: `NeuralPolicy` with no model is inert/falls back; the action mapping
      from a stubbed net output is legal.
- [x] run tests — green.

### Task 6: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [x] `detect_changes({scope:"compare", base_ref:"master"})` — only the letsplay engine
      (under `src/tests/`) + the npm script affected; **no prod `src` module changed**.
      Verified via `git diff --stat a45e26e..HEAD` (the letsplay commits): changes are
      confined to `src/tests/playtest/letsplay/**`, `src/tests/architecture/letsplayDevOnly.test.ts`,
      `package.json` (the `letsplay` script), `docs/`, and `.gitignore` — zero prod `src` modules.
- [x] full unit suite green (2789 passed, 1 skipped / 331 files); `npm run test:playtest`
      green (63 passed); `npm run letsplay` runs a clean session (7 passed); lint clean
      (0 errors); `npm run build` ok and **prod bundle unchanged** — the letsplay engine
      is excluded (grep of `dist/` finds no `HeuristicPolicy`/`NeuralPolicy`/`PlayerAgent`;
      the lone `letsplay` string is an unrelated GLSL shader comment).

### Task 7: Update documentation
**Files:**
- Modify: `docs/` + `CLAUDE.md` (testing tiers / letsplay note)

- [ ] Document the dev-only letsplay engine: `observe`→`PlayerPolicy`→`PlayerAgent`,
      `npm run letsplay`, the dev-only guard, and the pluggable neural policy seam
      (trained later, never shipped to prod).

## Technical Details
- Pure observation + policy; the agent drives the real engine only through the existing
  harness. Dev-only by location (`src/tests/`) + a guard test + dynamic-imported ONNX;
  the prod bundle and behaviour are untouched. No domain/schema/save change.

## Post-Completion
*Manual / external — not ralphex.*

- Later: train the player net offline (RTX 4090, self-play) and point `NeuralPolicy` at
  the exported ONNX (dev-only) — the agent then "thinks" with the net. Use the letsplay
  bug reports to triage real-engine regressions between feature batches.
