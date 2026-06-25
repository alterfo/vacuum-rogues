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
> module imports it** and that it **never statically imports `onnxruntime-web`** — the
> future neural policy loads ONNX via a **dev-only dynamic `import()`** so the runtime is
> never added to a bundleable edge. See `docs/plans/20260625-dev-letsplay-engine.md`.

## The loop: `observe` → `PlayerPolicy` → `PlayerAgent`

The agent closes a tiny loop each step — `observe → decide → apply → tick` — over the
real engine via `RealEngineHarness` (the same harness the real-engine playtest tier
uses: boots the real `GameEngine`/`GalaxyService`/`QuestManager`/`BankingService`, stubs
only PixiJS, advances frames deterministically, records logged/thrown errors in a sink).

| Piece | File | Role |
|-------|------|------|
| `observe(engine)` | `observe.ts` | Pure read of the live engine → a serialisable `Observation`: scene, player vitals (credits / hull / fuel / cargo / position), nearby planets + stations + NPCs, active quests, and the **set of legal player actions** for the current scene. Mutates nothing; never throws on a partially-initialised engine. |
| `PlayerPolicy` | `PlayerPolicy.ts` | The brain seam: `decide(obs) → Action`. Pure, total (never throws), and **legal** — the returned `Action.kind` is always in `obs.legalActions`. Two brains satisfy it interchangeably. |
| `HeuristicPolicy` | `HeuristicPolicy.ts` | The rule-based baseline: ranks candidates by **survive → earn → explore** (hostile + healthy hull ⇒ `attack`; low hull ⇒ `flee`/`repair`/`dock`; on a planet ⇒ `take-quest`/`trade`; idle ⇒ `warp`/`move`), then returns the first candidate the scene permits. Stateless, so one instance is shareable. |
| `PlayerAgent` | `PlayerAgent.ts` | Drives the loop: `observe`, ask the policy, then **apply** the chosen `Action` onto the real engine through the harness (`land`/`dock`/`trade`/`move` → genuine `transitionTo`; `warp` → star map then `performWarpJumpTo`; `take-quest` → accept registered board contracts; combat/`repair` degrade to a safe `tick`). Collects a transcript + the harness error sink; never throws. |

**Action vocabulary** (`PlayerActionKind`, ordered by `ACTION_ORDER` in `observe.ts`):
`move`, `warp`, `land`, `dock`, `trade`, `take-quest`, `attack`, `flee`, `repair`,
`wait`. The fixed order is a single source of truth shared by the legal-action surface
and the neural net's output head (`scores[i] → ACTION_ORDER[i]`). `wait` is legal in
every scene, so a policy always has a legal fallback and can never be stranded.

## Running it: `npm run letsplay`

```bash
npm run letsplay        # play sessions with the heuristic; non-zero exit on any failure
npm run test:playtest   # includes the fast in-suite letsplay session test (~3 s)
```

`letsplay.run.ts` exposes `runLetsplay({ sessions, steps, seedPrefix, policy })` — plays
**K sessions of N steps**, each on a freshly-booted real engine (independent and
reproducible from `"<seedPrefix>-<i>"`). It returns a `LetsplayReport` whose `failures`
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

## The pluggable neural policy seam (stub today)

`NeuralPolicy` (`NeuralPolicy.ts`) is the "нейросеть думает за игрока" brain behind the
identical `PlayerPolicy` contract. Training + ONNX export is **Post-Completion** (offline
self-play on the RTX 4090), so today it is a documented **stub** that keeps the heuristic
as the default while pinning down the seam:

1. **`featurize(obs)`** — a pure, fixed-width numeric feature vector (the net's input;
   deterministic, so it doubles as the self-play training encoder).
2. **`mapNetOutputToAction(scores, obs)`** — maps the net's output head (one score per
   `ACTION_ORDER` slot) to the highest-scoring action whose `kind` ∈ `obs.legalActions`,
   with `wait` as the guaranteed floor — so even a net that argmaxes to an illegal action
   yields a legal move.
3. **`load()`** — pulls `onnxruntime-web` via a **dev-only dynamic `import()`** (never a
   static edge — the guard test bans `import … from "onnxruntime-web"`). With **no
   `modelPath`** it throws "not trained yet" and `decide` stays inert, falling back to the
   `HeuristicPolicy`.

When a trained net exists, point `NeuralPolicy` at the exported ONNX (dev-only) and pass
it as the `runLetsplay` policy factory — the agent then "thinks" with the net, the
heuristic stays the default everywhere else, and nothing reaches the prod bundle.
