# Letsplay Engine (dev-only)

An **agent that plays the game as the player.** It observes the live `GameEngine`
state and chooses player actions (navigate, trade, dock, take/finish quests, fight,
repair) to drive a full playthrough on the *real* engine. The policy is **pluggable**:
a rule-based **heuristic** ships now; a **neural policy** ("нейросеть думает за
игрока") drops in later behind the same interface.

Primary value today is **automated playtesting** — the agent plays many sessions and
surfaces logged/thrown errors or always-actionable-invariant violations (bug discovery
on the real engine, between feature batches). Later it generates self-play data and
becomes the player-side net for the Overmind work.

> **Hard constraint — dev-environment only, never shipped to prod.** The engine lives
> entirely under `src/tests/playtest/letsplay/` (nothing under `src/tests/` is bundled;
> the prod bundle is the import graph of `src/main.ts`). A guard test
> (`src/tests/architecture/letsplayDevOnly.test.ts`) enforces that **no production
> module imports it**, and `noOnnxRuntime.test.ts` enforces that **no `src/**` module
> imports `onnxruntime-web` at all** — that runtime was removed
> (`docs/plans/completed/20260625-pure-ts-mlp-drop-onnx.md`), so the neural policy is a tiny
> pure-TS MLP (`mlp.ts`: matmul + ReLU + argmax over a small weights JSON), not a
> dynamic ONNX import. See `docs/plans/completed/20260625-dev-letsplay-engine.md`.

## The loop: `observe` → `PlayerPolicy` → `PlayerAgent`

The agent closes a tiny loop each step — `observe → decide → apply → tick` — over the
real engine via `RealEngineHarness` (the same harness the real-engine playtest tier
uses: boots the real `GameEngine`/`GalaxyService`/`QuestManager`/`BankingService`, stubs
only PixiJS, advances frames deterministically, records logged/thrown errors in a sink).

| Piece | File | Role |
|-------|------|------|
| `observe(engine)` | `observe.ts` | Pure, **egocentric** read of the live engine → a serialisable `Observation`: scene, player vitals (credits / hull / fuel / cargo / position), the **current** system's planets + stations + present NPCs, active quests, and the **set of legal player actions** for the current scene. **Partial observability:** market prices appear only on the *landed* planet (`currentPlanet`), never on an unvisited one — so the agent must *go there* to learn them. Mutates nothing; never throws on a partially-initialised engine. |
| `PlayerPolicy` | `PlayerPolicy.ts` | The brain seam: `decide(obs) → Action`. Pure, total (never throws), and **legal** — the returned `Action.kind` is always in `obs.legalActions`. Two brains satisfy it interchangeably. |
| `HeuristicPolicy` | `HeuristicPolicy.ts` | The rule-based baseline: ranks candidates by **survive → earn → explore** (hostile + healthy hull ⇒ `attack`; low hull ⇒ `flee`/`repair`/`dock`; on a planet ⇒ `take-quest`/`trade`; idle ⇒ `warp`/`move`), then returns the first candidate the scene permits. Stateless, so one instance is shareable. |
| `PlayerAgent` | `PlayerAgent.ts` | Drives the loop and **owns the per-run belief**: each step it `observe`s, folds the egocentric snapshot into its `AgentMemory` with `updateMemory` **before** deciding, hands `{obs, memory}` to the policy, then **applies** the chosen `Action` onto the real engine through the harness (`land`/`dock`/`trade`/`move` → genuine `transitionTo`; `warp` → star map then `performWarpJumpTo`; `take-quest` → accept registered board contracts; combat/`repair` degrade to a safe `tick`). Collects a transcript (each step's `reason` is belief-driven) + the harness error sink; `reset()` starts a fresh notebook per run; never throws. |

**Action vocabulary** (`PlayerActionKind`, ordered by `ACTION_ORDER` in `observe.ts`,
**16 actions** as of the 20260701 action-expansion plan):
`move`, `warp`, `land`, `dock`, `trade`, `take-quest`, `attack`, `flee`, `repair`,
`wait` (the original 10, index 0-9, preserved verbatim — several tests pin this exact
sequence), then `buy-gear`, `upgrade-hull`, `buy-module`, `take-loan`, `repay-loan`,
`sell-cargo` (the 6 economy actions appended at index 10-15). The fixed order is a
single source of truth shared by the legal-action surface and the neural net's output
head (`scores[i] → ACTION_ORDER[i]`). `wait` is legal in every scene, so a policy
always has a legal fallback and can never be stranded.

## Partial observability + structured memory (the POMDP design)

The agent is a **POMDP solver with an explicit belief state**: it plays like a human, so
it only knows what it has **seen** and it **remembers** what it saw
(`docs/plans/20260625-agent-memory-partial-observability.md`). Two pieces make this work,
and the design deliberately keeps the **memory as structured state, not net weights** —
which is *why the MLP stays tiny* (and why ONNX could be dropped):

**1. Egocentric observation (above).** `observe` reports only what the player can perceive
*right now* — own vitals/cargo/credits, the current system, and the **landed** planet's
market. An unvisited planet's prices and an unseen system's threats are simply absent.

**2. `AgentMemory` — the per-run notebook (`AgentMemory.ts`).** An explicit, inspectable
belief state the agent carries for the run and updates **only** from observations (never
from omniscient engine state). `updateMemory(mem, obs)` is **pure** — it folds one
egocentric `Observation` into a **new** memory and never stores a fact the observation did
not contain:

| Field | What it remembers | Built from |
|-------|-------------------|------------|
| `priceBook` | `planetId → (good → {buy, sell, seenAt})` — only planets actually landed on; `seenAt` bumps on a re-visit | the landed planet's market |
| `inventoryLots` | held cargo tagged with the **price each unit was bought at** (FIFO; loot ⇒ `buyPrice 0`), so sell-for-profit is computable | diffing cargo step-over-step (a rise ⇒ buy lot at the observed price; a fall ⇒ FIFO drain) |
| `threatMap` | `systemId → worst hostile presence ever seen there`, so a route can plan *around* danger | the current system's visible hostiles |
| `knownOffers` | upgrade/equipment offers + where seen (carried but unpopulated until `observe` surfaces shop offers — never invented) | (future) shop observation |
| `visitedSystemIds` | the set of systems the agent has actually been in, feeding `explorer`'s "prefer the unknown" bias and `visitedSystemFraction` | every `observe()` fold of the current system |
| `loanState` | `{ balance, missedPayments }` for an outstanding player loan, or absent | bank/loan signals surfaced on `Observation` |
| `deadlockDetected` | sticky one-shot flag so the deadlock detector (below) logs only once per run | `detectDeadlock(obs, memory)` |
| `activeQuestDelivery` | `{ questId, targetSystemId }[]` for quests currently carried, driving CJM-D's routing | active-quest signals on `Observation` |

It is **per-run**: `createMemory()` starts a fresh notebook each new game (a human
starting over), and `PlayerAgent.reset()` re-creates it for an explicit re-run.

**3. Memory-derived features (`memoryFeatures.ts`).** The net never reads the raw notebook
— it reads a short *featurised summary*. `memoryFeatures(obs, mem)` is a pure,
`[0,1]`-normalised, **`MEMORY_FEATURE_LENGTH = 20`-wide** block (widened from 7 in the
20260701 action-expansion plan), each component answering a human, multi-step question the
memoryless features can't:

1. **best known margin** — the best buy→sell arbitrage across the price book (`fraction`);
2. **direction** — am I standing on that best-margin *buy* planet right now? (`0/1`);
3. **profit-if-sold-here** — value of held lots at this market vs. what I paid (FIFO);
4. **cheapest-upgrade gap** — credits still needed for the cheapest known offer;
5. **route danger to goal** — remembered hostility of the system I'm heading toward;
6. **goal progress** — how far my credits have saved toward that upgrade;
7. **holding-for-other-system** — am I carrying cargo whose best-known sell planet is in a
   *different* system right now? (the signal that motivates warping to go sell it);
8. **loan balance** — outstanding loan balance, normalised;
9. **debt pressure** — missed loan payments, normalised;
10. **deadlock detected** — the sticky deadlock flag (`0/1`);
11. **visited-system fraction** — how much of the (approximated) galaxy the run has seen;
12. **quest-delivery progress** — fraction of carried quests with a known delivery system;
13. **nearest threat** — the worst danger remembered in the threat map;
14. **cargo value** — estimated sell value of everything currently held;
15. **days without progress** — the stagnation signal that feeds the deadlock detector;
16. **ranger-faction reputation fraction** — `reputationBastions` (Rangers' closest observable
    analogue) remapped to `[0,1]`;
17. **pirate-faction reputation fraction** — `reputationSyndicate` (Pirates' closest observable
    analogue) remapped to `[0,1]`;
18. **Overmind days-pressure** — how long the spread has been running, normalised;
19. **equip quality** — a rough loadout-value signal derived from `AgentMemory`, not read
    directly off `obs.player` (keeps the "empty notebook zeroes the whole block" contract);
20. **(reserved, zero-padded)** — headroom for a future signal without another width bump.

An empty notebook (fresh run, or `featurize(obs)` called with no memory) degrades **every**
signal to its sane `0` default. `featurize` (`NeuralPolicy.ts`) appends this block after the
**`OBS_FEATURE_LENGTH = 30`** egocentric block (widened from 16 — the observation block now
also carries bank/equipment/Overmind/quest-delivery signals: `hasCraftCenter`, `hasBank`,
`activeLoans`, `questDeliveryHere`, `overmindShare`, `nearOvermindCore`,
`cheapestGearFraction`, `questsCompleted`, plus a `warpInTransit` signal so the policy can
wait out a pending hyperjump instead of cancelling it), then the `CAMPAIGN_FEATURE_LENGTH = 4`
campaign-difficulty block (three-year-campaign Task 10: `playerPowerIndex`, `battleReady`,
hops-to-nearest-front, `armUpCost`), so the net input is
**`FEATURE_LENGTH = 30 + 20 + 4 = 54`** wide — **growing any block widens the MLP input and
requires retraining** (`weightsContract.test.ts` pins the contract).

**4. The memory-using heuristic — the BC teacher (`MemoryHeuristicPolicy.ts`).** A
`PlayerPolicy` that reasons over the belief for human-like, goal-sequenced play where the
memoryless `HeuristicPolicy` cannot: **buy low + remember** (buy on the price book's
cheapest source for a resellable good), **sell where the margin is best** (in flight it
*returns* to the remembered sell planet to realise a known margin), **save toward a known
upgrade** (defer an unaffordable offer, then route to it once affordable), and **avoid
known-dangerous systems** (don't warp deeper into a remembered threat while not
battle-ready). Its core `decideWithMemory(obs, mem)` is **pure** and always returns a legal
action (`wait` floor), which is what makes it a clean behavioural-cloning teacher: it
generates the dataset the pure-TS MLP trains on (offline) at the current feature width.

### CJM (Customer Journey Map) scenarios

The 20260701 action-expansion plan gave the teacher seven named, goal-conditioned decision
branches (`decideTradeMagnate`/`decideGearGrinder`/`decideBountyHunter`/`decideQuestRunner`/
`decideOvermindSlayer`/`decidePirate`/`decideExplorer` in `MemoryHeuristicPolicy.ts`) — each a
self-consistent playstyle so the training dataset carries labeled examples of behavior the
base survive→earn→explore sequencing never produces on its own (banking, equipment shopping,
proactive Overmind engagement, quest delivery routing). A CJM's branch gets **first refusal**
in `decideWithMemory` (right after the warp-in-transit check, before the goal-less scene
switch) — a legal CJM preference wins outright; a `null` return falls through unchanged to
the base sequencing. Goal conditioning is **not** part of the net's input (see "Feature vector
design principle" below) — the CJMs exist to diversify the *training labels*, not to give the
runtime policy a goal signal.

| Goal (`ScenarioGoal`) | CJM | Core behavior |
|---|---|---|
| `"trade-magnate"` | A — Trade magnate | Route to the best-known sell planet with cargo in hand; take a loan to bulk-buy only when `estimatedProfit > loanCost × 1.5`; repay immediately after a profitable sell. |
| `"gear-grinder"` | B — Gear grinder | Priority hull → weapon → engine → micromodules; routes to the equipment shop once credits clear a buffer over `cheapestGearPrice`/`bestHullPrice`; otherwise trades/quests to accumulate. |
| `"bounty-hunter"` | C — Combat hunter | Attacks hostiles above 50% hull, flees to repair below 30-50%, sells looted cargo after a kill (gated on `profitIfSoldHere > 0` so it never instant-sells cargo it just bought at a loss — the Task 6 credit-drain fix), warps toward danger when the local system is clear. |
| `"quest-runner"` | D — Quest runner | Always takes available contracts; routes carried quests to their delivery system via `questDeliveryHere`/`activeQuestDelivery`; re-stocks quests immediately after completing one. |
| `"overmind-slayer"` | E — Overmind slayer | Once `overmindShare > 0.1`, biases toward the core (`nearOvermindCore`/`overmindShare` signals — no real BFS routing, since the pure decide core has no pathfinding access); attacks at/near the core; flees+repairs first if hull < 40% that close. |
| `"pirate"` | F — Pirate | Hunts non-hostile traders, sells loot planetside, flees patrol/ranger-role ships, avoids the lawful faction (`FactionType.BASTIONS`, the closest observable proxy for "ranger zone" since NPC role isn't on `NpcSnapshot`). |
| `"explorer"` | G — Explorer (supersedes `"free-explore"`'s semantics for CJM purposes; `"free-explore"` itself is still a valid, separate LLM-scenario-gen goal) | Warps toward systems outside `AgentMemory.visitedSystemIds`; lands for quests when credits run low, then resumes exploring. |

**Deadlock detector** (`detectDeadlock(obs, memory)`, lives in `AgentMemory.ts` to avoid a
circular import with `MemoryHeuristicPolicy.ts`): a narrow compound condition — hull ≤ 10%,
credits < 100, no quests, a hostile present, and an outstanding loan — forces `wait` and logs
`[DEADLOCK] step=N credits=X hull=Y system=Z` via `logger.warn()` **once** per run
(`AgentMemory.deadlockDetected` sticky flag). It sits at the very top of `decideWithMemory`,
ahead of survive/goal dispatch, so it can override even an attack/flee that would otherwise be
legal in that narrow "nothing good to do" edge case.

## Running it: `npm run letsplay`

```bash
npm run letsplay        # play sessions with the heuristic; non-zero exit on any failure
npm run test:playtest   # includes the fast in-suite letsplay session test (~3 s)
```

`letsplay.run.ts` exposes `runLetsplay({ sessions, steps, seedPrefix, policy })` — plays
**K sessions of N steps** (defaults `sessions: 3`, `steps: 40`, `seedPrefix: "LETSPLAY"`),
each on a freshly-booted real engine (independent and reproducible from
`"<seedPrefix>-<i>"`). `npm run letsplay` drives this with `K`/`N` taken from the
`LETSPLAY_SESSIONS` / `LETSPLAY_STEPS` env vars (defaulting to the same `3 × 40`). It returns a `LetsplayReport` whose `failures`
flatten **every** harness-sink error **and** every always-actionable-invariant breach
(`checkInvariants`: a non-terminal scene must offer a non-`wait` action; hull is finite
in `[0, maxHull]`; credits is finite). `ok === failures.length === 0` is the clean-run
signal. `writeLetsplayReport` persists the structured JSON + a human summary to
`.letsplay/` (gitignored, regenerated each run); `formatLetsplayReport` renders the
summary.

`npm run letsplay` runs the driver **through vitest** (dev-only, like `test:playtest`)
because the driver is not a test file (no `vi.mock`) — it needs the dev test environment
(jsdom + the pixi stub + the `@/` alias) the real harness boots against. A non-empty
`failures` becomes a non-zero exit, so it is a real CI-grade bug-finder.

## The pluggable neural policy seam (pure-TS MLP, inert today)

`NeuralPolicy` (`NeuralPolicy.ts`) is the "нейросеть думает за игрока" brain behind the
identical `PlayerPolicy` contract. It is **not** an ONNX runtime — `onnxruntime-web` was
removed (`docs/plans/completed/20260625-pure-ts-mlp-drop-onnx.md`); the net is a tiny feature-vector
MLP run through a hand-written pure-TS forward pass (`mlp.ts`: matmul + ReLU + argmax) over
a small weights JSON. Training + weights export is **Post-Completion** (offline BC then
self-play on the RTX 4090), so until a `*.weights.json` is dropped in the policy is
**inert** and falls back to the `HeuristicPolicy`. The seam:

1. **`featurize(obs, memory?)`** — a pure, `FEATURE_LENGTH`-wide numeric vector: the
   `OBS_FEATURE_LENGTH = 30` egocentric block, then the `MEMORY_FEATURE_LENGTH = 20`
   belief block (`memoryFeatures` above), then the `CAMPAIGN_FEATURE_LENGTH = 4` campaign
   block (three-year-campaign Task 10: `playerPowerIndex`, `battleReady`,
   hops-to-nearest-front normalised, `armUpCost` normalised — appended at the tail so the
   historical 0–49 layout stayed byte-stable during the Task 10 zero-extension). Deterministic,
   every component in `[0,1]`, so it doubles as the training encoder. With **no** `memory` the
   belief block degrades to zeros.
2. **`mapNetOutputToAction(scores, obs)`** — maps the net's output head (one score per
   `ACTION_ORDER` slot, 18 slots — the 16 base actions plus `arm-up`/`liberate`, three-year-
   campaign Task 10) to the highest-scoring action whose `kind` ∈ `obs.legalActions`, with
   `wait` as the guaranteed floor — so even a net that argmaxes to an illegal action yields a
   legal move.
3. **`load()` / `decide(obs, memory?)`** — with trained weights, `decide` runs
   `featurize(obs, memory) → forward → mapNetOutputToAction`, threading the agent-owned
   `AgentMemory` belief block in so the net sees the memory-derived features it was trained
   on. `load` validates the net's input width equals `FEATURE_LENGTH` (`54`) and its output
   width equals `ACTION_ORDER.length` (`18`); a width mismatch throws rather than silently
   mispredicting. With no weights it stays inert.

When a trained net exists, drop its `*.weights.json` where `NeuralPolicy` loads it
(dev-only) and pass the policy to `runLetsplay` — the agent then "thinks" with the net (over
the same belief block the teacher used), the heuristic stays the default everywhere else,
and nothing reaches the prod bundle. Parity between the PyTorch export and the pure-TS
forward pass is pinned by `weightsContract.test.ts` (within `1e-5`).

### Shipped architecture: 54 → 256 → 128 → 18

The current `weights/player.weights.json` (`src/tests/playtest/letsplay/weights/`, see its
sibling `README.md` for full training details) is a 3-`nn.Linear`-layer net, retrained at the
widened three-year-campaign Task 10/11 shape:

```
input (54)  →  Linear(54, 256) + ReLU + Dropout(0.15)
            →  Linear(256, 128) + ReLU + Dropout(0.15)
            →  Linear(128, 18)                              → output logits (ACTION_ORDER)
```

≈49,298 parameters. Dropout is training-only — the exported JSON carries only the three
`nn.Linear` weight/bias pairs, since `mlp.ts`'s forward pass applies ReLU between every layer
except the last and has no dropout concept at inference. Trained via `tools/ai/train_player.py`
(N-layer/mini-batch/early-stopping support added Task 8) locally on Apple MPS:

```bash
python tools/ai/train_player.py \
  --data tools/ai/dataset/train.jsonl --hidden 256 128 --dropout 0.15 --epochs 500 --batch 512 \
  --lr 3e-4 --val-split 0.2 --patience 40 --seed 0 --device mps \
  --parity-out fixtures/player.io.json \
  --out src/tests/playtest/letsplay/weights/player.weights.json
```

Trained on 200 goal-less `MemoryHeuristicPolicy` sessions × 500 steps (100,000 rows at the
54-wide feature shape, exported in 4 memory-bounded chunks — see the weights `README.md`).
Converged early-stopped at epoch 448/500, **val_acc 0.968**, val_loss 0.083, no NaN. Unlike
the prior 50→16 net's dataset (8 of 16 action heads dead), this dataset populates every
reachable head including `arm-up`/`liberate`, so the net genuinely learned to select them —
but as a BC clone it can only **match, not exceed**, its teacher's own win rate: measured 4%
win-rate / 25 sessions vs. the teacher's ~18%, because most seeds hit a pre-existing
pure-argmax `PLANET↔TRADE` no-op collapse (`NeuralPolicy` has no anti-stagnation fallback —
see "Known Traps" below). The neural flag stays **off** in production.

## Oracle — the CI regression + balance gate (`letsplay:ci`)

The agent doubles as a **CI oracle**: every push/PR (and pre-push) plays `K` seeded
sessions × `N` steps on the real engine and **fails the build** on any crash, soft-lock,
always-actionable-invariant breach, or out-of-band balance signal — the regressions that
slip past the 2600-test unit suite but break the real loop
(`docs/plans/20260625-letsplay-ci-oracle.md`). Beside the *played* sessions, the same gate
runs a set of **static oddity assertions** (`src/tests/oddities/`) that catch the
non-crash *oddities* the standing rule (`feedback-letsplay-oddity-hunting`) demands —
balance cringe (a dominated gear item, a dead stat), missing/placeholder art, and visual
sameness like the all-yellow suns — over the real catalogs/manifest without booting an
engine.

| Layer | File | Role |
|-------|------|------|
| Session metrics | `sessionMetrics.ts` | Pure: folds one session's raw signals (errors, invariant breaches, the action transcript, an optional vitals series) into `SessionMetrics`, rolls `K` of them into the cross-session `RunMetrics`, and `evaluate(run, thresholds)` scores it → `{ ok, reasons }`. Hard faults (errors/soft-locks/vital invariants) default to a **zero** ceiling; balance bands are **optional** and skipped when omitted or value-less, so an unbaselined band never spuriously fails. |
| CI verdict | `ci.run.ts` | `runLetsplayCi(opts)` plays the real sessions and `evaluate`s them; `evaluateLetsplayRun(report)` is the **pure** verdict over a (real *or* synthetic) report, so the gate's pass/fail logic is unit-testable without an engine. `formatCiResult` renders the verdict + every breach for triage. `DEFAULT_CI_THRESHOLDS` = hard-faults-zero. |
| Oddity assertions | `src/tests/oddities/{balanceInvariants,assetCoverage,visualVariety}.test.ts` | Static, engine-free invariants run **in the same gate** (the script's second arg). **Balance:** no gear strictly dominated by a cheaper one; `cooldownTurns` is not a dead stat (cadence strictly monotonic, distinct cadences across the catalog); escape is reachable but upgrade-gated (best engine ≥ `npcSpeed`, starter below); delivery/artifact rewards bounded. **Asset coverage:** every production `pickVariant(category, prefix)` (planets/maps/surfaces/star_maps/ships/player_ships/portraits/nebula/station, mirrored against the live enums) resolves to ≥1 asset; no *orphan* art category (allowlist: `icons`, `stars`). **Visual variety:** ≥3 distinct star types with none >60%, and each art family ships ≥2 variants that `pickVariantKey` actually spreads ids across (guards type- and variant-collapse). Pure pixel checks stay manual via `window.__gameEngine` / autopilot. |
| Entry point | `ci.run.test.ts` + `src/tests/oddities` | `npm run letsplay:ci` (sets `LETSPLAY_CI=1`) runs **both** the played-session gate and the static oddity assertions (94 tests, ~2.5 s); `LETSPLAY_CI_SESSIONS`/`LETSPLAY_CI_STEPS` override the played `K`/`N` defaults (3×40). Determinism: each session is seeded `"LETSPLAY_CI-<i>"`, so a CI failure reproduces locally from the same seed. |

**Wired into CI** beside the playtest harness: the `letsplay-ci` **pre-push** command
(`lefthook.yml`) and the **`letsplay-ci` CI workflow** (`.github/workflows/letsplay-ci.yml`,
on push/PR to master/main/develop) both run `npm run letsplay:ci` — a distinct, named signal
so a loop-breaking change fails here, not in a beta-tester's browser.

**Triaging a failure.** The gate names *which* layer broke, so triage starts by reading the
failing test name:

1. **A `src/tests/oddities/*` test reds** ⇒ a static-catalog oddity, no engine involved.
   The assertion message points at the offending datum: `balanceInvariants` names the
   dominated gear / dead stat / unbounded reward; `assetCoverage` names the unresolved
   `category/prefix` (missing art or a typo'd prefix) or the new orphan category; `visualVariety`
   names the collapsed star type or art family. Fix the catalog/manifest, or — if the
   change is *intentional* — update the invariant's allowlist/band **in the same change**
   with a one-line reason. Re-run `npm run letsplay:ci`.
2. **A played-session breach (`ci.run.test.ts`) reds** ⇒ the agent hit a real crash,
   soft-lock, or invariant violation. The reason line carries the failing **seed**
   (`"LETSPLAY_CI-<i>"`); reproduce deterministically by setting `LETSPLAY_CI_SESSIONS=1`
   and seeding that single session, and read `formatCiResult`'s `GATE FAILURES:` block plus
   the appended `formatLetsplayReport` transcript (each step's belief-driven `reason`) to
   see what the agent did just before the fault. A soft-lock = a non-terminal scene that
   offered only `wait`; an error = a logged/thrown exception in the harness sink.
3. **A balance band reds** (once any band is baselined) ⇒ read the printed `balance:` line
   against the band in `DEFAULT_CI_THRESHOLDS`, then either fix the regression or rebaseline
   the band (next paragraph) if the move was a deliberate balance tune.

**Thresholds & rebaselining (read before tuning a band).** The default gate is
**hard-faults-zero + unscored balance bands** — and that is the *measured* baseline, not a
TODO. At the bounded headless budget the galaxy day never advances during flight
(`VitalsSample.day = galaxy.gameDays` stays 0 ⇒ `creditsPerDay` is `null`) and the dumb
heuristic never upgrades a hull (`daysToFirstUpgrade` is `null`); survival is a flat 100%. So
credits/day, days-to-upgrade, survival, and upgrade-rate **produce no value** to score, and
scoring a band around a never-produced value is a no-op. To rebaseline once a richer policy
or a larger budget makes a signal real:

1. Run `npm run letsplay:ci` (optionally bump `LETSPLAY_CI_SESSIONS`/`LETSPLAY_CI_STEPS`) and
   read the printed `balance:` line.
2. Set the band to the observed mean ± **generous headroom** in `DEFAULT_CI_THRESHOLDS`
   (`creditsPerDayBand: { min, max }`, `maxAvgDaysToFirstUpgrade`, `minSurvivalRate`,
   `minUpgradeRate`).
3. When a **deliberate** balance tune (a `balance.ts` change) moves the baseline, re-measure
   and widen/shift the band **in the same change** — the new economics should be the intended
   band, never a surprise red. Never tighten a band to chase a single-seed outlier.

## Autopilot — watch the agent play the *live, rendered* game (dev-only)

Where the headless harness above plays the engine as fast as a test loop can drive it, the
**autopilot** hands the *live* player ship to the same agent brain and lets the normal render
loop show it **playing the real, rendered game in real time** — the best way to eyeball visual
oddities (all-yellow suns, missing art, sameness) the headless agent can't see
(`docs/plans/20260625-dev-autopilot.md`). It reuses the agent core unchanged
(`observe → policy.decide → apply`); only the *live applier* + the dev toggle are new, and
**both stay dev-only** (under `src/tests/`, never in the prod bundle).

### Toggling it (dev build only)

In `npm run dev`, once the game is in flight:

- Press **`` ` ``** (Backquote — `AUTOPILOT_HOTKEY_CODE`) to engage/disengage, **or**
- Call `window.__autopilot.start()` / `.stop()` / `.toggle()` from the devtools console
  (`window.__autopilot.engaged` reports state; `.controller` is the underlying
  `AutopilotController` for advanced driving).

A small fixed **"● АВТОПИЛОТ"** pill appears top-centre while engaged. **Reclaim-on-input:**
the **first** genuine human pointer/key/wheel/touch disengages it instantly and hands control
back — the autopilot drives the scene through a port (never synthesised DOM events), so only a
real human event reaches the reclaim listener.

### How it is wired (and why prod is untouched)

| Piece | File | Role |
|-------|------|------|
| `applyLiveAction(action, obs, controller)` | `LiveApplier.ts` | Pure dispatcher: maps an `Action` onto a `LiveSceneController` verb (route/land/dock/warp/open-trade/take-quest/attack/flee/repair/tick). Illegal-for-the-scene actions are a **safe no-op**; the scene-aware two-step verbs (`move`/`trade`/`warp`) resolve exactly as the headless `PlayerAgent` applier does. Never imports PixiJS — unit-tested against a spy controller. |
| `AutopilotController` | `AutopilotController.ts` | The live loop: while engaged it `observe → updateMemory → policy.decide → applyLiveAction` once per tick (default `DEFAULT_AUTOPILOT_TICK_MS = 800`, slow enough to follow). Pure logic over injectable ports (scheduler, human-input source, indicator), carries a fresh per-engagement `AgentMemory` for policy parity, and **never throws** (tick faults route to `onError`). `start`/`stop` are idempotent; `stop` is the single reclaim path. |
| `installAutopilotHook(engine)` | `installAutopilotHook.ts` | Dev-only install: builds the concrete `LiveSceneController` over the real `GameEngine` (same `transitionTo` wiring the headless agent uses), constructs the controller with `() => observe(engine)` + the **feature-gated** policy (`selectPlayerPolicy()` — heuristic by default, `NeuralPolicy` when the neural toggle is on), publishes `window.__autopilot`, and binds the Backquote hotkey. |
| `attachDevAutopilot(isDev, engine, load, onError)` | `src/dev/devAutopilot.ts` | The **one production seam**. Returns immediately when `!isDev` (the test-observable contract that a non-DEV build attaches nothing); when DEV, it dynamically `load`s the hook and installs it. Deliberately injectable — it contains **no** `@/tests/...` import literal, so it can never pull the dev engine into the prod graph itself. |

The live applier mirrors the headless one, including its no-ops: verbs without a live executor
yet (`executeTrade`, `attack`/`flee`, `repair`) degrade to a safe no-op exactly as the headless
applier does, and `tick` is a no-op because the live rAF loop already advances frames between
decisions.

**Dev-only is enforced, not just convention.** The call site in `main.ts` writes the real
loader `() => import('./tests/playtest/letsplay/installAutopilotHook')` inside an
`if (import.meta.env.DEV)` block, which Vite/Rollup dead-code-eliminates in production, so the
dev chunk is **never emitted**. `letsplayDevOnly.test.ts` extends its guard to the autopilot:
no production module statically imports the dev engine; the `devAutopilot.ts` seam references
nothing from the dev engine (static or dynamic) except the one sanctioned DEV-gated dynamic
import; and the `npm run build` prod bundle is autopilot-free. No domain/schema/save change.

**Same toggle, smarter later.** The autopilot reads the policy through the identical
`selectPlayerPolicy()` gate the headless agent does, so when the trained `NeuralPolicy` lands
it flies the live ship through the same hook with zero wiring changes.

## Offline LLM oddity-judge + scenario-generator (deep sweep — manual/nightly, paid)

The fast oracle above (`letsplay:ci`) catches the *deterministic* oddities — crashes, soft-locks,
strictly-dominated gear, missing art. It cannot catch the open-ended **semantic** ones: the
2026-06-25 beta classes like "killed a pirate with 1000 cr and got nothing", "rep fell to −50
with no way back", "quest target 6 jumps away but the deadline is 30 days", stuck progression
with zero feedback. No hand-written invariant can encode "is this *absurd / unfair / a
dead-end*?". The offline LLM layer (`tools/ai/`, `docs/plans/20260627-llm-oddity-judge-and-scenario-generator.md`)
adds exactly that judgment by **running an LLM off the push hot-path** — it is **never a gate**
(LLM calls are slow, paid, and non-deterministic, which would make a gate flaky and expensive).

The pipeline is `play → transcript → judge → report`, plus a generator that widens what gets
played:

| Piece | File | Role |
|-------|------|------|
| Judge-ready transcript | `src/tests/playtest/letsplay/transcript.ts` | Pure: folds an `AgentRunResult` + the harness log sink into a serialisable `SessionTranscript` — per-step `{day, scene, action, vitalsDelta, notableLogs}` + a compact session summary (days elapsed, credits/rep curves, kills, deaths, quests taken/completed). Built **egocentrically** (like `observe`), so it carries only what the player could perceive. |
| LLM client port | `tools/ai/llmClient.ts` | The injectable boundary. `LlmClient.complete(messages, opts) → text` with a real `AnthropicLlmClient` (model + key from env, `opts.images` for the vision path) and a `FakeLlmClient` returning canned replies. The Anthropic SDK sits behind a **lazy dynamic import**, and a missing key degrades to a clear thrown error **only when invoked live** — never at import. Every test drives the fake, so the transcript builder, prompt assembly, and report parser are all deterministic and free. |
| Oddity judge | `tools/ai/oddityJudge.ts` | Assembles a judge prompt from a `SessionTranscript` + the explicit `ODDITY_RUBRIC` (the beta classes), then `parseOddityReport` turns the reply into a structured `OddityReport` (`{title, severity, evidence: step indices, rationale}`). Robust to a malformed reply — degrades to "no structured findings" + raw text, **never throws**. |
| Vision judge | `tools/ai/visionJudge.ts` | The visual sibling: `judgeFrames` attaches captured frames via `opts.images` and judges against `VISION_ODDITY_RUBRIC` (text overflow, missing art, sameness, a missing death explosion) — the classes the text transcript provably cannot see. Reuses `parseOddityReport`. `src/tests/fixtures/oddities/` holds committed pre-fix fixtures so the validation reproduces after the live bugs are gone. |
| Scenario generator | `tools/ai/scenarioGen.ts` | Asks the LLM for N diverse play scenarios and parses them into machine-readable configs `{name, seed?, goal, maxDays}` (`goal` ∈ a fixed enum: `go-broke`/`max-rep`/`ignore-overmind`/`hoard`/`free-explore`). An unknown goal is **dropped, not crashed**. The thin `GoalBiasedPolicy` (`src/tests/playtest/letsplay/goalBias.ts`) steers the agent to act out a goal; the default free-play policy is unchanged. |
| Offline runner | `tools/ai/runJudge.ts` + `judge.run.test.ts` | `runJudge({client, play, sessions, steps})` plays `K` sessions (optionally scenario-driven), judges each transcript, and consolidates the verdicts; `writeJudgeReport` writes `.letsplay/oddity-report.*` (gitignored). The engine-bound `makeLivePlay` boots the real `GameEngine` per spec. |

**Running it.** `npm run letsplay:judge` (sets `LETSPLAY_JUDGE=1`) plays `K`×`N` and judges live
with the real Anthropic client, writing the report. **With no `ANTHROPIC_API_KEY` it logs a
clear "set ANTHROPIC_API_KEY" and exits non-zero.** The same `judge.run.test.ts` file carries an
**always-on** check that plays a short real session and judges it through the `FakeLlmClient` — so
the wiring is exercised on every `npm test` with **no key and no live call**, while the live deep
sweep stays opt-in. `LETSPLAY_JUDGE_SESSIONS`/`LETSPLAY_JUDGE_STEPS`/`LETSPLAY_JUDGE_MODEL`/
`LETSPLAY_JUDGE_SCENARIOS` override the defaults.

**Dev-only is enforced, not just convention.** All of `tools/ai/` lives outside the `src/` build
root (the `tsc` rooted at `src/` forbids a `src/` file importing out-of-root `tools/ai/*`), and
`letsplayDevOnly.test.ts` extends its guard with a dedicated check: **no production module imports
the offline LLM judge tooling — static *or* dynamic** — so neither the judge nor the Anthropic SDK
can ever reach `npm run build`. The judge runner appears in **no** `lefthook.yml` pre-push command
and **no** CI workflow; the cheap deterministic `letsplay:ci` gate is untouched. No
domain/schema/save change.

### The three-tier oddity-finding model

The three layers compose into a cost/coverage ladder — cheap-and-deterministic runs on every
push, paid-and-semantic runs on demand:

| Tier | What | When | Catches | Cost |
|------|------|------|---------|------|
| **1. Fast deterministic gate** | `npm run test:playtest` + `npm run letsplay:ci` (played sessions + `src/tests/oddities/` static invariants) | **Every push** (pre-push `lefthook.yml` + CI) | crashes, soft-locks, always-actionable-invariant breaches, dominated gear, dead stats, missing/placeholder art, visual sameness | free, deterministic, ~5 s |
| **2. Playwright E2E** | `npm run test:e2e` (`playtest-regression.spec.ts`) | **Targeted** (CI + manual), per visual/interaction bug | real rendering + pointer interaction the headless harness can't see (layout, hit geometry, what's actually drawn) | cheap, deterministic, seconds |
| **3. Offline LLM judge + scenario-gen** | `npm run letsplay:judge` (transcript → Claude judge → report; scenario-gen widens coverage). A **vision** judge (`visionJudge.ts` + deterministic self-test) exists for visual oddities but is **not yet wired into the runner** — frame capture into `letsplay:judge` is a deferred follow-up (the plan's "Optional v2"). | **Deep sweep — manual / nightly** (never a gate) | open-ended *semantic* oddities — absurd/unfair/dead-end/no-feedback play. (Visual oddities once the vision path is wired in.) | **paid, non-deterministic** (needs `ANTHROPIC_API_KEY`) |

The lower a tier sits, the more it runs and the cheaper it is; the higher a tier sits, the deeper
its judgment and the more it costs. Tiers 1–2 are the regression safety net; tier 3 is the
exploratory oddity hunter that feeds new bug classes *back down* into tier-1 invariants once a
pattern is understood.

## Known Traps

Oddities found by playing the agent (headless or live) that were subtle enough to be worth
naming, so the next sweep doesn't have to rediscover them from scratch.

- **Warp stall on a stale/active combat pause.** `completeWarp()` in `PlayerAgent.ts` must
  distinguish a *stale* `combatPause.paused` (a fight already ended but `onCombatEnded` doesn't
  clear the flag) from a *live* one (`combatModule.isActive === true`) — clearing only the
  former. Clearing an active-combat pause would let the ship "warp through" a fight instead of
  resolving it; leaving a stale one paused would freeze the ship forever with nothing able to
  un-pause it. Fixed and guarded by the `isActiveCombat` branch (see the method's doc comment
  for the full reasoning); re-verified in the Task 6 sweep with a `bounty-hunter`-goal session
  (1206 real `attack` decisions across 8 sessions, zero stalls).
- **`waitOneDay()` freezing when an NPC engages mid-wait.** A combat pause during a course-less
  wait turn used to freeze the headless engine indefinitely (no day ever advances, no shots ever
  fire on either side). Fixed by resuming `combatPause` before each tick inside the wait loop, so
  the engagement actually resolves instead of sitting paused. Re-verified in the Task 6 sweep.
- **Ping-pong between two adjacent systems.** A memoryless `warp` target picker tends to pick
  `connections[0]`, which in the destination system is usually the link straight back to where
  the ship came from — an A→B→A→B loop. `PlayerAgent`'s warp applier tracks `lastSystemId` and
  prefers a connection that isn't it. Re-verified in the Task 6 sweep: an 8-session ×
  200-step `explorer`-goal run (1600 consecutive `warp` decisions, so the case that would show a
  ping-pong the most) produced zero A-B-A-B patterns.
- **CJM-C bounty-hunter's naive "sell whenever cargo > 0" drained a fresh run to near-zero
  credits (Task 6 finding, fixed).** The base memory-driven sequencing opportunistically buys
  low (`push("trade", "buy-low:...")`) even under a combat-focused goal, since a CJM branch only
  gets "first refusal" and otherwise defers to that base sequencing. Once `decideBountyHunter`
  saw `cargoUsed > 0` on the very next decision it fired `sell-cargo` unconditionally — including
  cargo just bought at the *same* planet, which sells back at a guaranteed loss (a planet's
  `sell` price is always strictly below its `buy` price). The result was a perpetual
  buy-then-instant-sell cycle burning the buy/sell spread every round: a real-engine session
  went from 1000 → 34 credits over 200 steps without a single `attack`, defeating the entire
  point of the "combat hunter" CJM (and silently starving Task 9's dataset of combat-labeled
  rows for that scenario slice). Fixed by gating the CJM's `sell-cargo` trigger on
  `profitIfSoldHere(obs, mem) <= 0` *only when* the memory has a tracked lot bought here
  (`mem.inventoryLots.length > 0`) — untracked cargo (loot, `buyPrice: 0`, no matching lot) still
  sells unconditionally, since it has nothing to lose. Regression: `cjm.test.ts` → "does not
  instant-sell cargo just bought here at a loss" / "still sells looted cargo bought elsewhere
  once a lot is profitable here". Post-fix the same scenario produced 1206 `attack` decisions
  across 8 sessions and zero pointless buy/sell cycling.
- **The default `HeuristicPolicy` never advances a galaxy day or leaves the starting planet at
  the headless budget — this is expected, not a bug.** It always ranks `land` above `dock`/`warp`
  in `SPACE_FLIGHT` and never emits `trade` while already inside the `TRADE` scene (its own
  design comment: "No buy/sell executor yet — leave the market rather than spin in it"), so a
  bare `npm run letsplay` session cycles `land → trade(open) → move(leave) → land` on the same
  planet with flat credits and `day = 0` for the whole run. This is the documented,
  already-rebaselined behaviour behind `letsplay:ci`'s **hard-faults-zero + unscored balance
  bands** default (see the Oracle section above) — do **not** "fix" it by changing
  `HeuristicPolicy`'s behaviour; the richer `MemoryHeuristicPolicy` (optionally goal-biased via a
  CJM) is the teacher that actually trades/explores/fights, and is what dataset generation
  (Task 9) uses.
- **Headless `flee`/`repair` no-op ⇒ an unwinnable fight can never be disengaged, starving every
  non-combat CJM of rows (Task 9 dataset-generation finding of the 20260701 plan; the executor
  no-ops themselves were fixed in three-year-campaign Task 7 — see "Long-horizon campaign wedges"
  below for that fix and the further soft-locks it uncovered).**
  At the time, `PlayerAgent.apply`'s `case "attack"` advanced a full day so `NpcShipManager`
  could resolve the fight (since the 20260709 garrison-growth plan Task 4, `attack` is *active*:
  `PlayerAgent.driveAttack` invokes the real «Атаковать» handler and drives 50 ms slices until
  one combat round resolves), but `case "flee"`/`case "repair"` intentionally "degrade to a tick"
  (no real navigate-away or repair-dock executor exists headlessly) — by design, since headless combat
  was expected to resolve within about a day against "a typical NPC". Against a heavily-garrisoned
  Overmind system (`garrison_ov_*`, observed spawning 6–10 hostile ships), the starter ship can
  neither win nor actually flee: hull dips just under the ~50% engage threshold (→ `flee`, a
  no-op tick), drifts back above it with no further damage taken (→ `attack` resumes), forever.
  Verified reproducible: two independent 2-session × 2000-step diagnostics (`gear-grinder`,
  `trade-magnate`) each spent >99% of all steps oscillating `attack`/`flee` after the first warp,
  never reaching a station/bank/quest/gear action; the same pattern shows up in the Task 9
  `train.jsonl` export, where `dock`/`take-quest`/`repair` and all 6 new economy actions
  (`buy-gear`/`upgrade-hull`/`buy-module`/`take-loan`/`repay-loan`) are **dead heads** (zero rows)
  across the whole scaled dataset. This is a real limitation in the Task 3 headless-applier design
  + the base survive sequencing's naive hull-fraction attack/flee gate (predates Task 9), not a
  bug in the dataset exporter itself — logging what the teacher actually does is Task 9's job, and
  this is what it actually does. **Not fixed here** (redesigning `flee`/combat-avoidance touches
  well-tested Task 3/4 code with a large blast radius, out of Task 9's scope). Before relying on
  the shipped `train.jsonl` for real training (Task 10), either regenerate at a much larger scale
  hoping for seeds that avoid early heavy garrisons, or — better — give the headless applier a
  real "disengage" executor (e.g. warp away when a fight is unwinnable) so `flee` stops being a
  no-op.
- **`take-quest` was silently dead the whole time (20260703 plan, Task 2 finding, fixed).**
  `observe.ts` read the static, always-empty `Planet.availableQuests` field instead of the real
  on-demand job board (`takeableBoardQuestCount`, the same filter `acceptBoardQuests` applies) —
  the ladder's `take-quest` was never a legal action. Fixing the read alone moved avg
  quests/session from ~0.17 to ~0.36 across a 100-run diagnostic.
- **One-directional `system.connections` hid real, immediately-warpable neighbours (20260703
  plan, Task 2 finding, fixed).** The nearest-neighbour galaxy-generation pass adds each edge on
  only ONE side of a pair, but the engine allows warping either direction — `observe.ts`'s
  `neighbors` (feeding `pickWarpNeighbor`) used to read the raw one-directional list, silently
  hiding legitimate warp targets including a carried quest's own one-hop target. Fixed via
  `reachableNeighbors` (`engineQueries.ts`), which unions both directions. The same one-directional
  assumption also bit `GalaxySimulator`'s Overmind second-seed neighbour search (see
  `.claude/docs/systems/overmind.md`) — check for this asymmetry before trusting `.connections`
  anywhere in new code.
- **The STAR_MAP fuel gate is fractional; the live warp gate is absolute (20260703 plan, Task 3
  finding, fixed).** `MemoryHeuristicPolicy`'s `fuelGate` checks `REFUEL_THRESHOLD` as a *fraction*
  of max fuel, but the live `StarMapScene.performWarpJump` gates the actual jump on the *absolute*
  fuel cost of the specific target. A shrunk tank (e.g. after an engine downgrade) can satisfy the
  fraction gate — so the ladder keeps choosing `warp` — while still being short of the real
  per-jump cost, so the live executor's call silently no-ops (a toast the autopilot can't see)
  with zero feedback to the ladder, repeating the same decision forever. Fixed via
  `AgentMemory.starMapStallFolds`/`MAX_STAR_MAP_WARP_STALLS`: once a `warp` decision on STAR_MAP
  produces no scene/fuel change for 2 consecutive folds, the tier stops emitting `warp` and falls
  through to the existing unconditional `move`/"back", returning to SPACE_FLIGHT where the
  fuel-critical `land` tier can refuel.
- **The live `openTrade` verb hardcoded sell-only, unlike the headless `PlayerAgent` (found in
  review of the 20260703 plan, fixed).** The 20260703 no-speculation fix redefined
  `executeMemoryAwareTrade(engine, planet, null)` from "blind-buy the cheapest good" to
  "sell-only" — `PlayerAgent.ts`'s TRADE-scene branch was updated to pass a real preferred good
  (the carried quest's cargo need, else the best known cross-planet margin's good), but
  `installAutopilotHook.ts`'s `createLiveSceneController.openTrade` was not, so the **live**
  autopilot (the backtick-key dev toggle) could only ever sell, never execute a `buy-low`/
  price-discovery buy the ladder had actually decided on. Fixed by threading a `getMemory: () =>
  AgentMemory` into `createLiveSceneController` (closing over `AutopilotController.currentMemory()`
  via a `controllerRef`, since the live controller is built before the `AutopilotController` that
  owns the memory) and mirroring `PlayerAgent`'s lookup in `openTrade` itself. Regression:
  `liveEconomyHeads.test.ts` → "live openTrade() consults the known cross-planet margin".

### Long-horizon campaign wedges (three-year-campaign Task 6/7/9, fixed)

Running sessions out to ~6000 steps (day ≥ 1080) for the first time surfaced a class of
soft-locks invisible at the old ~300-step/55-day budget — each froze the world (calendar/day
count stopped advancing) rather than crashing, so only a long-horizon run could find them. Full
root-cause writeups live in the plan's Task 6/7 notes; the durable lessons:

- **A fleeing ship's map back-out undid its own escape.** `avoid-danger-back` could route a
  ship that had just decided to flee straight back into the fight it was fleeing. Fixed by a
  `flee-escape-jump` tier that outranks back-out while the flee condition holds.
- **`completeWarp` left a live-fight combat pause frozen during transit**, so a "successful"
  escape was actually a frozen ship still eating the engagement's volleys every tick. Fixed by
  resuming the pause every tick during a committed warp (mirroring the `waitOneDay` discipline
  above) so a transiting ship keeps flying and combat honestly resolves or disengages.
- **An orphaned `pendingWarp` could trap the apply layer forever**, redirecting every action to
  `completeWarp` with no way out. Fixed by aborting the stuck jump once its step budget is
  exhausted (a live player would cancel/re-plot).
- **`CombatModule` fought a permanently-downed (GOD-floor) ship forever**, pinning the galaxy
  calendar indefinitely (a downed ship can't fire or flee, but nothing ended the engagement). A
  downed ship is no longer a valid combatant: `update()` ends an in-progress fight and
  `addCombatant` refuses to start one while downed.
- **Phantom combat stance**: a destroyed NPC sprite's `isCombatant` bookkeeping could stay `true`
  forever after the sprite itself was gone, freezing the HUD/pause state as if a fight were still
  live. Fixed by clearing combatant state on sprite destruction, not only on `endCombat`.
- **A DOWNED ship with a frozen calendar and `daysStagnant`-blocked buys could spin forever**
  between landing and take-off (neither `wait` nor the earn-landing path advanced the world).
  Fixed by a `stagnation-wait` tier: when the calendar is frozen and no warp fired, WAIT (always
  legal, always advances the world) outranks the earn-landing decision.
- **An NPC-only Overmind equilibrium could clear the front and fire a spurious win** with zero
  player participation. Fixed by gating the win condition on `(state.playerLiberations ?? 0) > 0`
  in addition to `engaged` — see `.claude/docs/systems/overmind.md`.

These are exactly the class of bug this section exists to name so a future long-horizon sweep
doesn't have to rediscover them from scratch — if a new campaign-length run wedges, check this
list before re-diagnosing from zero.
