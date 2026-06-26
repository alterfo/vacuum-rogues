---
# Human-Like Letsplay Agent: Partial Observability + Structured Memory

## Overview
Make the letsplay agent **think like a human**: it only knows what it has **seen**, and
it **remembers** what it saw. Today's `observe()` is omniscient and the policy is
memoryless, so the agent can't reason "I saw that hull for 11000 at another planet — I
need to earn 12000 and fly there, but there are dominators between here and there, so
first I'll earn for shields." This plan adds two things and keeps the net tiny:

- **Partial observability** — `observe()` becomes **egocentric**: only the *current*
  location's market, this system's *visible* ships, and the player's own
  cargo/credits/known-map. No prices on unvisited planets.
- **Structured memory** — an explicit, per-run **belief state** the agent carries and
  updates only from what it sees: a **price book**, **inventory with buy-price** (for
  sell-for-profit), a **threat map**, and **known upgrade offers**. The policy net then
  reads a *featurized summary* of this belief ("best known margin and where", "cheapest
  upgrade I know of and how much more I need", "is the route there dangerous"), so the
  memory is **structured state, not net weights** — the MLP stays small (this is why we
  dropped onnxruntime).

Memory is **per-run** (resets each new game, like a human starting fresh).

## Context (from discovery)
- **Builds on the dev letsplay engine** (`src/tests/playtest/letsplay/`):
  `observe(engine) → Observation`, `PlayerAgent` (observe→decide→apply→tick),
  `PlayerPolicy`/`HeuristicPolicy`, and `NeuralPolicy` (now a pure-TS MLP via
  `pure-ts-mlp-drop-onnx`). `featurize(obs)` + `mapNetOutputToAction` are the net I/O.
- **Depends on** `docs/plans/20260625-pure-ts-mlp-drop-onnx.md` (the MLP + featurize
  seam this plan extends) and the completed `dev-letsplay-engine`.
- **Egocentric data exists in the engine** — current planet market (`TradeSystem`),
  current system's NPCs (`NpcShipManager`), player inventory/credits — `observe` just
  must stop exposing galaxy-wide info the player hasn't discovered.
- Dev-only: all of this lives under `src/tests/`; no prod module imports it (guarded by
  the existing `letsplayDevOnly` test).

## Development Approach
- **Testing approach: TDD.** `observe` (now partial), `AgentMemory` + `updateMemory`,
  the memory-derived features, and the memory-using heuristic are all **pure** — tested
  in isolation, then the agent loop is tested for memory-informed behaviour (returns to
  sell where it knows a high price; saves for a known upgrade; avoids a known-dangerous
  system).
- Keep memory **per-run** + structured (inspectable). The net stays small — features
  summarise the belief. `impact` on `observe`/`featurize`/`HeuristicPolicy` first.
- **Coordination:** growing `featurize` changes the MLP input width — note it for the
  pure-TS MLP (retrain at the new width); no domain/schema/save change (dev-only).

## Testing Strategy
- **Unit:** `observe` exposes only visible info (a fixture asserts an unvisited planet's
  prices are absent); `updateMemory` folds an observation into the price book / buy-price
  inventory / threat map / known offers and never invents unseen facts; memory-derived
  features compute the right "best margin / cheapest-affordable-gap / route-danger".
- **Agent behaviour:** a scripted scenario where the agent sees a cheap good at A, a high
  price at B, and a threat at C → with memory it buys at A, remembers, and sells at B
  while routing around C (memoryless baseline can't).

## Implementation Steps

### Task 1: Egocentric (partial) observation
**Files:**
- Modify: `src/tests/playtest/letsplay/observe.ts`, `observe.test.ts`

- [x] Restrict `observe()` to what the player can currently perceive: this planet's
      market, this system's visible ships/threats, own cargo/credits, and only
      *discovered* map nodes — drop any galaxy-wide / unvisited-planet data from the
      snapshot.
- [x] write tests: an unvisited planet's prices / an unseen system's threats are absent;
      the current location's data is present.
- [x] run tests — green.

### Task 2: Structured belief state (AgentMemory) + update
**Files:**
- Create: `src/tests/playtest/letsplay/AgentMemory.ts`, `AgentMemory.test.ts`

- [x] `AgentMemory` = `{ priceBook: Map<planet, Map<good, {price, seenAt}>>,
      inventoryLots: {good, qty, buyPrice}[], threatMap: Map<system, danger>,
      knownOffers: {item, price, location}[] }` + `updateMemory(mem, obs)` (pure; folds
      one egocentric observation in; records buy-price on a buy; never stores unseen
      facts). Per-run (fresh per game).
- [x] write tests: visiting a market records its prices; a buy records its lot+price; a
      threat encounter marks the system; re-seeing updates `seenAt`.
- [x] run tests — green.

### Task 3: Memory-derived features
**Files:**
- Modify: `src/tests/playtest/letsplay/NeuralPolicy.ts` (featurize) or a new `features.ts`
- Create: `src/tests/playtest/letsplay/memoryFeatures.test.ts`

- [x] Extend the feature vector (grow `FEATURE_LENGTH`) with belief signals: best known
      buy→sell margin (+ direction), profit-if-sold-here for held cargo, cheapest known
      upgrade and the credit gap to afford it, route danger to the current goal, and
      goal progress.
- [x] write tests: each feature computes correctly from a fixture `AgentMemory`+`obs`;
      vector length/normalisation stable; missing knowledge degrades to a sane default.
- [x] run tests — green (note the new width for MLP retraining).

### Task 4: Memory-using heuristic (the BC teacher)
**Files:**
- Modify/Create: `src/tests/playtest/letsplay/MemoryHeuristicPolicy.ts` (+ test)

- [x] A `PlayerPolicy` that uses the belief state for human-like, multi-step play: buy
      low + remember, sell where the known margin is best, save toward a known upgrade,
      avoid known-dangerous systems, sequence goals (earn → shields → proceed). Returns
      only legal actions (applier resolves the concrete target from memory).
- [x] write tests: in the scripted A/B/C scenario it buys@A, sells@B, routes around C,
      and defers an unaffordable upgrade until it has saved.
- [x] run tests — green.

### Task 5: Carry memory through PlayerAgent
**Files:**
- Modify: `src/tests/playtest/letsplay/PlayerAgent.ts`, `letsplaySession.test.ts`

- [ ] The agent owns an `AgentMemory`, `updateMemory(obs)` each step before `decide`,
      and passes `{obs, memory}` (or memory-features) to the policy; memory resets on a
      new run. Transcript records the belief-driven `reason`.
- [ ] write tests: a session shows memory-informed decisions (a return-to-sell); memory
      resets between runs; zero logged/thrown errors.
- [ ] run tests — green.

### Task 6: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [ ] `detect_changes({scope:"compare", base_ref:"master"})` — only the letsplay engine
      (under `src/tests/`) affected; dev-only guard still green; no prod/schema change.
- [ ] full unit suite green; `npm run test:playtest` green; `npm run letsplay` runs a
      clean memory-driven session; lint clean; build ok.

### Task 7: Update documentation
**Files:**
- Modify: `docs/` + the letsplay note

- [ ] Document the POMDP design: egocentric `observe`, the structured per-run
      `AgentMemory`, memory-derived features, the memory-using heuristic teacher, and
      that the net stays small because memory is structured state.

## Technical Details
- The agent is a POMDP solver with an **explicit belief state**: memory is structured +
  inspectable (a notebook), the small MLP is just the decision-maker over a featurised
  summary. Per-run, dev-only, no schema/save change. Growing `featurize` widens the MLP
  input (retrain).

## Post-Completion
*Manual / external — my 4090 task.*

- Generate BC data from the **memory-using heuristic**, train the pure-TS MLP at the new
  feature width, export weights JSON, drop into `NeuralPolicy`; then RL self-play to
  surpass the teacher. This memory agent is also what lets letsplay **validate the
  rebalanced economy** (it actually trades, saves, and upgrades like a player).
