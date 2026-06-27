---
# Letsplay Agent: Full-Game Play, Oddity Coverage, and Net Retrain

## Overview
Make the dev-only letsplay agent actually **play the whole game** — fly real
distances (advancing galaxy days), trade for profit, fight, repair, complete
quests, and explore by warping — so it (a) **catches oddities across every
system** (the user's primary goal) and (b) becomes a rich enough behavioural-
cloning **teacher** that the shipped pure-TS MLP can be retrained to "play fully"
instead of the current move/land/trade-only clone. Today the agent is stuck in a
`land → trade(no-op) → move(back out)` micro-loop: `move` in flight is a single
frame (no real travel), and `attack`/`flee`/`repair`/`trade` "degrade to a safe
tick", so it never advances a galaxy day and exercises almost none of the game
(why the CI balance bands read empty and the BC net is Bayes-capped at ~67% — see
memory `project-bc-player-net-ceiling`).

## Context
- Agent loop + applier: `src/tests/playtest/letsplay/PlayerAgent.ts` (the `apply`
  switch is where executors live). Action vocab: `observe.ts` `ACTION_ORDER`
  (`move/warp/land/dock/trade/take-quest/attack/flee/repair/wait`).
- Policies: `HeuristicPolicy.ts` (baseline, CI teacher) and
  `MemoryHeuristicPolicy.ts` (belief-driven; the BC teacher). Belief:
  `AgentMemory.ts` (priceBook, inventoryLots, threatMap, knownOffers).
- Harness: `src/tests/playtest/realEngineHarness.ts` (`goTo`, `tick(deltaMs)`,
  `currentScene`, `newGame`). Real engine underneath — `GameEngine`,
  `SpaceFlightScene` (route plotting, `endTurn`, `performWarp`), `TradeScene`,
  `CombatModule`, `StationScene` (repair), `QuestManager`.
- Net: `NeuralPolicy.ts` (`FEATURE_LENGTH = 18` = `OBS_FEATURE_LENGTH 12` +
  `MEMORY_FEATURE_LENGTH 6`), `mlp.ts` forward pass, `weights/player.weights.json`
  (shipped, wired into autopilot only via `installAutopilotHook.ts`). Training:
  `tools/ai/train_player.py` (exports JSON weights), dataset via `exportBcData.ts`.
  Lockstep guards: `weightsContract.test.ts`, `shippedWeights.test.ts`.
- Oracle: `ci.run.ts` + `sessionMetrics.ts` (balance bands currently measured-empty
  + unscored); static oddities in `src/tests/oddities/`. Gates: `npm run letsplay`,
  `npm run letsplay:ci` (pre-push + CI).
- Memory: `feedback-letsplay-oddity-hunting`, `feedback-agent-is-diagnostic-fix-the-game`,
  `feedback-reduce-breakage-context-engineering` (prefer day-advancing oracle),
  `project-bc-player-net-ceiling`.

## Development Approach
TDD, real-engine tier: every executor is proven by a `letsplaySession`/real-engine
test that asserts the *observable* engine effect (day advanced, credits changed,
hull restored, system changed) **with zero logged errors** — never a mocked seam.
Order matters: executors first (they make the agent play), then oddity assertions
over the now-reachable states, then featurize enrichment, then dataset regen +
retrain (the only offline/Python step) **last** so the net clones the finished
teacher. Keep the agent dev-only (`letsplayDevOnly.test.ts` must stay green). Do
NOT widen `featurize` until the teacher repertoire is final (each width change ⇒
retrain + re-export under the lockstep). Tune via existing balance config, not new
constants at call sites.

## Implementation Steps

### Task 1: Real flight movement that advances galaxy days
**Files:**
- Modify: src/tests/playtest/letsplay/PlayerAgent.ts
- Modify: src/tests/playtest/letsplay/realEngineHarness.ts (a `flyTo`/`advanceDays` helper if needed)
- Create: src/tests/playtest/letsplay/movement.test.ts

- [x] `move` in SPACE_FLIGHT plots a **real route** (`flyForward` → the scene's real `executeRouteTo`) and ticks until the ship traverses real distance / crosses a day boundary.
- [x] `wait` runs a real course-less **wait turn** (`waitOneDay` → `onPlayPause`/`advanceWaitTime`, one `MS_PER_WAIT_DAY` tick = one day), reusing the scene's real turn path — no synthetic day mutation.
- [x] Regression: `movement.test.ts` — a wait turn advances `galaxy.gameDays`, an in-flight move flies a real distance, zero harness errors.
- [x] `letsplaySession.test.ts` + `npm run letsplay` + `npm run letsplay:ci` stay green.

### Task 2: Trade executor (buy low / sell high)
**Files:**
- Modify: src/tests/playtest/letsplay/PlayerAgent.ts
- Modify: src/tests/playtest/letsplay/engineQueries.ts
- Create: src/tests/playtest/letsplay/trade.test.ts

- [ ] `trade` executes a real buy/sell through the engine's market path (the same seam `TradeScene` uses), driven by the policy's belief (buy under-priced goods with hold/credits, sell held lots where the known margin is best).
- [ ] Update `AgentMemory` `inventoryLots`/`priceBook` from the *executed* trade (folded via `updateMemory`), not omniscient state.
- [ ] Regression: a buy-then-sell round trip changes credits + cargo as expected, zero errors.

### Task 3: Combat executor (attack / flee actually engage)
**Files:**
- Modify: src/tests/playtest/letsplay/PlayerAgent.ts
- Create: src/tests/playtest/letsplay/combat.test.ts

- [ ] `attack` engages the in-range hostile through the real `CombatModule` (add combatant / confirm fire), `flee` plots a real break-off route (the existing `breakOffCombatPursuit` path).
- [ ] Regression: against a seeded hostile the agent actually exchanges fire (NPC or player hull changes) and can disengage, zero errors.

### Task 4: Repair + quest-completion executors
**Files:**
- Modify: src/tests/playtest/letsplay/PlayerAgent.ts
- Modify: src/tests/playtest/letsplay/engineQueries.ts
- Create: src/tests/playtest/letsplay/repairQuest.test.ts

- [ ] `repair` restores hull at a repair-capable base via the real station path (credits spent, hull up).
- [ ] `take-quest` + completion: the agent can accept a board quest and satisfy a return/delivery objective through the real `QuestManager`, claiming the reward.

### Task 5: Exploration policy — traverse the galaxy, don't loop
**Files:**
- Modify: src/tests/playtest/letsplay/HeuristicPolicy.ts
- Modify: src/tests/playtest/letsplay/MemoryHeuristicPolicy.ts
- Modify: src/tests/playtest/letsplay/heuristicPolicy.test.ts (extend, don't weaken)

- [ ] Break the land→trade→move loop: once a system's local commerce is done (or on a cadence), prefer `warp` to an unvisited connected system so the agent tours the galaxy.
- [ ] Bias toward exercising under-covered actions over a session so coverage is broad (visits multiple systems / stations / quests across the budget).
- [ ] Regression: over a session the agent visits ≥N distinct systems and reaches station/quest/combat states.

### Task 6: Oddity assertions over the now-reachable game
**Files:**
- Create: src/tests/oddities/economyInvariants.test.ts
- Create: src/tests/oddities/combatInvariants.test.ts
- Modify: src/tests/playtest/letsplay/ci.run.ts (score the now-non-empty bands)
- Modify: src/tests/playtest/letsplay/sessionMetrics.ts

- [ ] Re-enable + score the balance bands now that the agent advances days (credits/day, days-to-upgrade, survival) per the rebaseline procedure in `LETSPLAY_ENGINE.md`.
- [ ] New oddity invariants over the states the agent now reaches (no negative credits, no stuck hull, combat resolves, prices sane, quests claimable) — the "catch all странности" deliverable.
- [ ] `npm run letsplay:ci` gates on the new bands (hard faults at zero; bands scored).

### Task 7: Enrich featurize to break the land/trade aliasing
**Files:**
- Modify: src/tests/playtest/letsplay/observe.ts (or memoryFeatures.ts) — the feature block
- Modify: src/tests/playtest/letsplay/NeuralPolicy.ts (`FEATURE_LENGTH`)
- Modify: tools/ai/train_player.py (`NUM_FEATURES`)

- [ ] Add the disambiguating signals (e.g. "already traded here this visit", market-known vs price, inventory-vs-hold) so equal-looking states stop carrying both `trade` and `move` labels.
- [ ] Bump `FEATURE_LENGTH`/`NUM_FEATURES` in lockstep; `weightsContract.test.ts` still pins the contract.

### Task 8: Regenerate dataset, retrain, re-export weights (offline/Python)
**Files:**
- Modify: src/tests/playtest/letsplay/exportBcData.ts (gen the fuller dataset)
- Modify: src/tests/playtest/letsplay/weights/player.weights.json (re-exported)
- Reference: tools/ai/README.md, tools/ai/train_player.py

- [ ] Regenerate the BC dataset from the now-full-repertoire teacher (`GEN_BC=1` gen → `.letsplay/bc-dataset.jsonl`).
- [ ] Train + export with `python3 tools/ai/train_player.py`; drop the new `player.weights.json`.
- [ ] `weightsContract.test.ts` (within 1e-5) + `shippedWeights.test.ts` (loads at current `FEATURE_LENGTH`) green; net measurably plays the fuller repertoire in autopilot.

### Task 9: Verify end-to-end + update docs/memory
**Files:**
- Modify: docs/architecture/LETSPLAY_ENGINE.md
- Modify: memory `project-bc-player-net-ceiling`

- [ ] Full gates green: `npm test -- --run`, `npm run test:playtest`, `npm run letsplay:ci`.
- [ ] Document the new full-play agent + the lifted ceilings; update the BC-ceiling memory to reflect the retrain.
