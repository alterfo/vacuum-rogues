# Letsplay Engine & Dev Autopilot

`src/tests/playtest/letsplay/` — an agent that plays the game as the player on the real `GameEngine` for automated bug discovery. Reference: `docs/architecture/LETSPLAY_ENGINE.md`.

## Core loop

`observe(engine)` → pure `Observation` (scene, vitals, nearby planets/stations/NPCs, active quests, legal actions) → `PlayerPolicy.decide(obs) → Action` → `PlayerAgent` applies it onto the real engine.

`ACTION_ORDER` in `observe.ts` is the single source of truth for the action vocabulary (16 actions incl. 6 economy heads added by `docs/plans/20260701-letsplay-action-expansion-and-neural-scale.md`). `wait` is always legal.

## Policy hierarchy

| Policy | When used | State |
|--------|-----------|-------|
| `MemoryHeuristicPolicy` | Default live **and** headless autopilot | Carries `AgentMemory` belief (priceBook, inventoryLots, threatMap, knownOffers, `visitedSystemIds`, `consecutiveWarpsWithoutLanding`, `previousSystemId`) |
| `HeuristicPolicy` | Legacy stateless headless sessions | Stateless, survive→earn→explore |
| `NeuralPolicy` | When neural flag is on | Pure-TS MLP forward pass over `weights/player.weights.json` |

### Goal-less needs ladder (the shipped brain)

Both runners construct `MemoryHeuristicPolicy` with **no `goal`** — so the
competent play lives in the base ladder of `decideWithMemory(obs, mem)`, ranked
strictly by need (single source of truth; see the header comment there):

1. **Survival** — `fuelFraction < REFUEL_THRESHOLD` and a habitable planet
   in-system → `land` (refuels fully). Warp is **fuel-gated**: never emitted when
   `energy < ~2× fuelCost`, so the ship lands to refuel before it can strand.
2. **Threat / Overmind** — `nearOvermindCore || overmindShare > OVERMIND_THREAT_SHARE`
   with `hull < OVERMIND_THREAT_HULL_FRACTION` and no present hostile → `warp`
   away from the front. Present hostile → fight-or-flee by hull.
3. **Economy** — complete a known cross-planet margin (`go-sell` uses `bestHeld`,
   the margin restricted to *currently-held* goods; buy-side uses the unrestricted
   best). `land "discover-prices"` on an unvisited in-system planet fires **before**
   `warp "find-sell-destination"` — this is what broke the warp-forever loop.
   Anti-consecutive-warp cadence: base-ladder warps gate on
   `MAX_CONSECUTIVE_WARPS_WITHOUT_LAND` (2).
4. **Progression** — `questDeliveryHere` → land/dock to complete; affordable
   in-system hull/gear/module upgrade → buy.
5. **Explore** — `warp` to a **chosen** unvisited, non-Overmind neighbor
   (`pickWarpNeighbor`) only when healthy and hold-clear.
6. **`wait`** floor.

The `goal` branch (`decideExplorer`/`decideTrader`/…) is retained for BC scenario
diversity but is **not** on the shipped path.

## POMDP / memory design

`observe` is **egocentric** — market prices appear only on the *landed* `currentPlanet`. `AgentMemory` is reset fresh each game and updated *before* deciding. `FEATURE_LENGTH = OBS_FEATURE_LENGTH(30) + MEMORY_FEATURE_LENGTH(20) = 50`. Growing either block requires retraining + re-exporting weights JSON (the lockstep `load()` rejects a width mismatch).

## Neural policy / weights

Currently trained net: `weights/player.weights.json` — BC-cloned from the
**goal-less** `MemoryHeuristicPolicy` teacher above at **val_acc 0.997**. The old
~67% aliasing ceiling was **not** observation-bound: it came from goal-**mixed**
training data labelling the same obs with conflicting actions across goals (the
`goal` isn't featurized). Cloning the *single* deterministic goal-less policy the
net actually deploys removed the aliasing — no featurize-widen needed
(`FEATURE_LENGTH` stays frozen at 50). Dataset stratum: `DEFAULT_SCENARIO_MIX`
in `exportBcData.ts` is a single `goal: null` block. Wired to dev autopilot via
`selectPlayerPolicy({weights})` in `installAutopilotHook`.

The net's output head picks an action **kind** only; `mapNetOutputToAction`'s
`resolveNeuralTarget` resolves a habitable in-system planet for a `land` kind
(the applier's `land` case requires an explicit `targetId`), so the net can
actually land instead of stalling. Guards: `neuralSession.test.ts` (drives a real
session error-free, picks ≥3 distinct action kinds) + `neuralTargetResolution.test.ts`.

Net architecture: 3-layer `50→256→128→16` ≈ 51,328 params. Guard: `shippedWeights.test.ts` asserts it loads at current `FEATURE_LENGTH`/`ACTION_ORDER.length`; `weightsContract.test.ts` pins TS↔Python forward-pass parity (1e-5).

## Dev-only enforcement

- Engine lives wholly under `src/tests/`; `letsplayDevOnly.test.ts` asserts no production module imports it.
- `noOnnxRuntime.test.ts` asserts no `src/**` module imports `onnxruntime-web`.

## CI oracle (`npm run letsplay:ci`)

Runs K seeded sessions + static oddity assertions (`src/tests/oddities/`: `balanceInvariants`/`assetCoverage`/`visualVariety`). Hard faults gate at zero. `sessionMetrics.ts` now scores competence bands over the states the smart agent reaches: `maxFuelDeaths: 0`, `maxOvermindLosses: 0` (both scoped to an actual `GAME_OVER` under that condition), `minSurvivalRate: 0.8`, plus a `credits-nonnegative` invariant breach. Budget-dependent bands (`minDaysSurvived`, `minAvgDistinctSystemsVisited`) are scored separately in `src/tests/oddities/sessionCompetence.test.ts` against a properly-sized 3×40 session budget (tiny smoke budgets legitimately never leave the start system). `creditsPerDayBand`/upgrade-rate bands remain unscored — the agent isn't yet a net earner at short horizons (follow-up economy tune). Pre-push via `lefthook.yml` + `.github/workflows/letsplay-ci.yml`.

## Live autopilot

Press `` ` `` (Backquote) or `window.__autopilot.start()/.stop()/.toggle()` in `npm run dev`. Default policy: `MemoryHeuristicPolicy`. First real pointer/key reclaims control. Prod seam: `src/dev/devAutopilot.ts` (DEV-gated dynamic `import()` in `main.ts`).

The live controller (`createLiveSceneController`) routes:
- `land(planetId?)` — resolves to habitable planet only (never uninhabited fallback); refuels to max on landing
- `dock(stationId?)` — docks at a station; **refuels to max** on dock (mirrors `onLandOnPlanet`; see Task 7)
- `warp(systemId?)` — honors an explicit `action.targetId` (policy's `pickWarpNeighbor` chooses an unvisited non-Overmind neighbor), falls back to `pickWarpTarget`; anti-ping-pong via `visitedSystemIds`
- `tick()` — auto-dismisses encounter overlays (`closeModals()`) + drives pendingWarp route
- `attack(targetId?)` / `flee()` — delegate to `NpcShipManager.e2eEngageCombat`/`breakOffCombatPursuit`

**Live-head parity:** the seven previously no-op economy heads in
`installAutopilotHook.ts` (`repair`, `buy-gear`, `upgrade-hull`, `buy-module`,
`take-loan`, `repay-loan`, `sell-cargo`) are wired to the same headless executors
(`engineQueries.ts`), so the watched autopilot repairs/upgrades/trades exactly as
the headless runner does. Buy-price accounting recovers the real market price via
`AgentMemory.lastCurrentPlanetId` (the trade returns to SPACE_FLIGHT before
`updateMemory` sees the landed `currentPlanet`).

**Warp targeting:** `Observation.system.neighbors` is
`{systemId, visited, overmindHeld}[]` (from real `StarSystem.explored` +
`Galaxy.isOvermindSystem`). `pickWarpNeighbor` scores each (lower wins) weighing
`overmindHeld` (4), `visitedSystemIds`/`threatMap` (3 each), `previousSystemId`
(2), and the raw `visited` flag (1) — not featurized (net width frozen at 50).

## Adding CJM behaviors

CJM teacher behaviors live in `MemoryHeuristicPolicy.ts`. Key methods: `decide(obs, memory)` → routes through `decideExplorer`/`decideTrader`/`decideSurvivor`/`decidePirate`/etc. Each CJM branch calls `cjmAction(branch, kind, reason, targetId?)`. The BC dataset is generated by `exportBcData.ts` and trained by `tools/ai/train_player.py`.
