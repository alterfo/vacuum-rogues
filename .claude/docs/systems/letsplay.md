# Letsplay Engine & Dev Autopilot

`src/tests/playtest/letsplay/` — an agent that plays the game as the player on the real `GameEngine` for automated bug discovery. Reference: `docs/architecture/LETSPLAY_ENGINE.md`.

## Core loop

`observe(engine)` → pure `Observation` (scene, vitals, nearby planets/stations/NPCs, active quests, legal actions) → `PlayerPolicy.decide(obs) → Action` → `PlayerAgent` applies it onto the real engine.

`ACTION_ORDER` in `observe.ts` is the single source of truth for the action vocabulary — **18 actions**: the original 16 (incl. 6 economy heads added by `docs/plans/20260701-letsplay-action-expansion-and-neural-scale.md`) plus `arm-up`/`liberate`, promoted from the `LEGAL_ACTION_ORDER`-only tail into the vocabulary proper by `docs/plans/20260706-three-year-campaign.md` Task 10 (`LEGAL_ACTION_ORDER` is now an alias of `ACTION_ORDER`). `wait` is always legal.

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

1. **Survival** — `fuelFraction < REFUEL_THRESHOLD` (0.2) and a habitable planet
   in-system → `land` (refuels fully). Warp is **fuel-gated** by the same
   threshold: no `warp` candidate is emitted while `fuelFraction < REFUEL_THRESHOLD`,
   so the ship lands (or docks) to refuel before it can strand.
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

`observe` is **egocentric** — market prices appear only on the *landed* `currentPlanet`. `AgentMemory` is reset fresh each game and updated *before* deciding. `FEATURE_LENGTH = OBS_FEATURE_LENGTH(30) + MEMORY_FEATURE_LENGTH(20) + CAMPAIGN_FEATURE_LENGTH(4) = 54`. The campaign block (indices 50–53: `playerPowerIndex`, `battleReady`, hops-to-nearest-front normalised, `armUpCost` normalised) was appended at the tail by `docs/plans/20260706-three-year-campaign.md` Task 10 specifically so the historical 0–49 layout stayed byte-stable during the zero-extension migration. Growing any block requires retraining + re-exporting weights JSON (the lockstep `load()` rejects a width mismatch).

## Neural policy / weights

Currently shipped net: `weights/player.weights.json` — BC-cloned from the
**goal-less** `MemoryHeuristicPolicy` teacher above, retrained at the 54/18
shape (Task 11 of the three-year-campaign plan) on a 200-session/100k-row
dataset, **val_acc 0.968**. TS↔Python forward-pass parity ≤ 1e-5
(`weightsContract.test.ts` + `shippedParity.test.ts`). Dataset stratum:
`DEFAULT_SCENARIO_MIX` in `exportBcData.ts` is a single `goal: null` block.
Wired to dev autopilot via `selectPlayerPolicy({weights})` in
`installAutopilotHook`.

The net's output head picks an action **kind** only; `mapNetOutputToAction`'s
`resolveNeuralTarget` resolves a habitable in-system planet for a `land` kind
(the applier's `land` case requires an explicit `targetId`), so the net can
actually land instead of stalling. Guards: `neuralSession.test.ts` (drives a real
session error-free, picks ≥3 distinct action kinds) + `neuralTargetResolution.test.ts`.

Net architecture: 3-layer `54→256→128→18` ≈ 49,298 params. Guard: `shippedWeights.test.ts` asserts it loads at current `FEATURE_LENGTH`/`ACTION_ORDER.length`; `weightsContract.test.ts` pins TS↔Python forward-pass parity (1e-5).

**⚠️ Known ceiling**: the net can only match, not exceed, its BC teacher —
measured **4% win-rate / 25 sessions** (Task 11) vs the teacher's own ~18%,
because most seeds hit a pre-existing pure-argmax `PLANET↔TRADE` no-op collapse
(`NeuralPolicy` has no anti-stagnation fallback; confirmed pre-existing, not a
retrain regression). The neural flag stays **off** in production. See
`docs/plans/20260706-three-year-campaign.md` Task 9/11 for the full
combat-survivability root-cause record — the teacher's win-rate is the actual
bottleneck, not the net.

## Campaign harness (`npm run letsplay:campaign`)

Env-gated long-horizon runner (`src/tests/playtest/letsplay/campaign.run.ts` +
`campaignMetrics.ts`) that plays full sessions to day ≥ 1080 or arc resolution,
day-boundary checkpointed (no per-step transcript) so memory stays bounded over
~6000 steps. Env knobs: `CAMPAIGN_SESSIONS`, `CAMPAIGN_DAYS`/`CAMPAIGN_STEPS`,
`CAMPAIGN_WALL_MS`, `CAMPAIGN_POLICY=neural` (default: the heuristic teacher).
Reports (win/loss/timeout, resolution day, peak power, milestone days,
stall/cycle detectors — phantom combat stance, repeat-action loops,
undocked day-frozen streaks) land in gitignored `.letsplay/`. Distinct from
`letsplay:ci`, which stays at its fast ~3×40-step budget with milestone
*proxies* (not full-campaign wins) and is the pre-push gate.

## Dev-only enforcement

- Engine lives wholly under `src/tests/`; `letsplayDevOnly.test.ts` asserts no production module imports it.
- `noOnnxRuntime.test.ts` asserts no `src/**` module imports `onnxruntime-web`.

## CI oracle (`npm run letsplay:ci`)

Runs K seeded sessions + static oddity assertions (`src/tests/oddities/`: `balanceInvariants`/`assetCoverage`/`visualVariety`). Hard faults gate at zero. `sessionMetrics.ts` now scores competence bands over the states the smart agent reaches: `maxFuelDeaths: 0`, `maxOvermindLosses: 0` (both scoped to an actual `GAME_OVER` under that condition), `minSurvivalRate: 0.8`, plus a `credits-nonnegative` invariant breach. Budget-dependent bands (`minDaysSurvived`, `minAvgDistinctSystemsVisited`) are scored separately in `src/tests/oddities/sessionCompetence.test.ts` against a properly-sized 3×40 session budget (tiny smoke budgets legitimately never leave the start system). `creditsPerDayBand`/upgrade-rate bands remain unscored — the agent isn't yet a net earner at short horizons (follow-up economy tune). Pre-push via `lefthook.yml` + `.github/workflows/letsplay-ci.yml`.

## Live autopilot

Press `` ` `` (Backquote) or `window.__autopilot.start()/.stop()/.toggle()` in `npm run dev`. Default policy: `MemoryHeuristicPolicy`. First real pointer/key reclaims control. Prod seam: `src/dev/devAutopilot.ts` (DEV-gated dynamic `import()` in `main.ts`).

**Reclaim-on-input is a real DOM listener, not a semantic "player acted" check** (`docs/plans/20260711-autopilot-reliability-fixes.md` Task 1): `makeDefaultInputSource` (`AutopilotController.ts:122-158`) attaches `pointerdown`/`keydown`/`wheel`/`touchstart` on `window` with no target filtering — any bubbled event disengages. A handled mouse-wheel zoom gesture is not player intent to reclaim, so `SpaceFlightScene.onWheel`/`StarMapScene.handleWheel` register with `{capture: true}` and call `stopImmediatePropagation()` on the handled-zoom path (order-independent across scene recreation on warp, unlike a bubble-phase `stopPropagation()` — both handlers share the same `window` node as the autopilot's listener, so bubble-phase suppression can't reach a sibling). `installAutopilotHook.ts`'s `tick()` also now mirrors `hud.closeModals()` (quest journal + accessibility panel) and `planetManager.closeInfoPanel()` alongside the pre-existing `npcManager.closeModals()`, so the autopilot doesn't idle silently behind an open panel.

**Flee-jump entry vector derives from the real exit point, not the stale plan-time vector** (same plan, Task 2): a genuine flee's exit point (`warpEdgePoint(..., fromMidSystem: true)`) is the boundary point nearest the ship, deliberately not toward the target. `SpaceFlightScene.performWarp()` used to mirror the *original straight-line* `exitVector` for the destination `entryVector` regardless — now `departureVectorFromExitPoint` (`flight/warpHeading.ts`) derives it from the actual captured exit point (`pendingWarpExitPoint`, set by `planWarpEdgeRoute` in `utils/flightGeometry.ts` when the route is planned), falling back to the straight-line vector only when no exit point was captured. Routine (non-flee) jumps are mathematically unchanged — their exit point already equals the straight-line direction.

The live controller (`createLiveSceneController`) routes:
- `land(planetId?)` — resolves to habitable planet only (never uninhabited fallback); refuels to max on landing
- `dock(stationId?)` — docks at a station; **refuels to max** on dock (mirrors `onLandOnPlanet`; see Task 7)
- `warp(systemId?)` — honors an explicit `action.targetId` (policy's `pickWarpNeighbor` chooses an unvisited non-Overmind neighbor), falls back to `pickWarpTarget`; anti-ping-pong via `visitedSystemIds`
- `tick()` — auto-dismisses encounter overlays (`closeModals()`) + drives pendingWarp route
- `attack(targetId?)` / `flee()` — delegate to `NpcShipManager.e2eEngageCombat`/`breakOffCombatPursuit`

**Headless `attack` is active, not passive** (garrison-growth plan Task 4):
`PlayerAgent.driveAttack` invokes the real «Атаковать» handler
(`NpcShipManager.onAttackNpc` — engage in weapon range, else intercept +
auto-follow), un-pauses each 50 ms tick, and ends the step after one completed
combat round (the policy's reaction window). An already-engaged fight is
*driven*, never re-targeted. `flee`/`repair` remain degraded ticks.

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
