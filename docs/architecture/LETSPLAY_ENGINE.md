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

**Action vocabulary** (`PlayerActionKind`, ordered by `ACTION_ORDER` in `observe.ts`):
`move`, `warp`, `land`, `dock`, `trade`, `take-quest`, `attack`, `flee`, `repair`,
`wait`. The fixed order is a single source of truth shared by the legal-action surface
and the neural net's output head (`scores[i] → ACTION_ORDER[i]`). `wait` is legal in
every scene, so a policy always has a legal fallback and can never be stranded.

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

It is **per-run**: `createMemory()` starts a fresh notebook each new game (a human
starting over), and `PlayerAgent.reset()` re-creates it for an explicit re-run.

**3. Memory-derived features (`memoryFeatures.ts`).** The net never reads the raw notebook
— it reads a short *featurised summary*. `memoryFeatures(obs, mem)` is a pure,
`[0,1]`-normalised, `MEMORY_FEATURE_LENGTH = 6`-wide block, each component answering a
human, multi-step question the memoryless features can't:

1. **best known margin** — the best buy→sell arbitrage across the price book (`fraction`);
2. **direction** — am I standing on that best-margin *buy* planet right now? (`0/1`);
3. **profit-if-sold-here** — value of held lots at this market vs. what I paid (FIFO);
4. **cheapest-upgrade gap** — credits still needed for the cheapest known offer;
5. **route danger to goal** — remembered hostility of the system I'm heading toward;
6. **goal progress** — how far my credits have saved toward that upgrade.

An empty notebook (fresh run, or `featurize(obs)` called with no memory) degrades **every**
signal to its sane `0` default. `featurize` (`NeuralPolicy.ts`) appends this block after
the `OBS_FEATURE_LENGTH = 12` egocentric block, so the net input is
`FEATURE_LENGTH = 12 + 6 = 18` wide — **growing either block widens the MLP input and
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
generates the dataset the pure-TS MLP trains on (offline, Post-Completion) at the new
feature width.

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
   `OBS_FEATURE_LENGTH = 12` egocentric block followed by the `MEMORY_FEATURE_LENGTH = 6`
   belief block (`memoryFeatures` above). Deterministic, every component in `[0,1]`, so it
   doubles as the training encoder. With **no** `memory` the belief block degrades to zeros.
2. **`mapNetOutputToAction(scores, obs)`** — maps the net's output head (one score per
   `ACTION_ORDER` slot) to the highest-scoring action whose `kind` ∈ `obs.legalActions`,
   with `wait` as the guaranteed floor — so even a net that argmaxes to an illegal action
   yields a legal move.
3. **`load()` / `decide(obs, memory?)`** — with trained weights, `decide` runs
   `featurize(obs, memory) → forward → mapNetOutputToAction`, threading the agent-owned
   `AgentMemory` belief block in so the net sees the memory-derived features it was trained
   on. `load` validates the net's input width equals `FEATURE_LENGTH` (`18`); a width
   mismatch throws rather than silently mispredicting. With no weights it stays inert.

When a trained net exists, drop its `*.weights.json` where `NeuralPolicy` loads it
(dev-only) and pass the policy to `runLetsplay` — the agent then "thinks" with the net (over
the same belief block the teacher used), the heuristic stays the default everywhere else,
and nothing reaches the prod bundle. Parity between the PyTorch export and the pure-TS
forward pass is pinned by `weightsContract.test.ts` (within `1e-5`).
