# Smart Autopilot Player — needs-based competent play

## Overview

The autopilot (live backquote + headless `letsplay`) plays stupidly: it warps
system-to-system, never lands, and warps until fuel runs out or the Overmind
overruns the galaxy. Root cause is **decision logic**, not missing seams — the
land/trade/refuel/quest executors all work end-to-end. Both runners share one
brain, `MemoryHeuristicPolicy`, and it warp-loops for five concrete reasons:

1. **The default autopilot passes NO `goal`** (`installAutopilotHook.ts:351`,
   `letsplay.run.ts:268`), so the entire goal layer — `decideExplorer`,
   `decideOvermindSlayer`, quest logic — is dead (gated by `if (goal)` at
   `MemoryHeuristicPolicy.ts:485`). Only the bare base ladder runs.
2. **Warp is ranked above land**: `warp "find-sell-destination"`
   (`MemoryHeuristicPolicy.ts:551-556`) precedes `land "earn"` (`:581-583`). Once
   the agent holds any cargo with only one planet known, `bestKnownMargin` is null
   (a margin needs two planets) → `holdingForOtherSystem` true → it warps to "find
   a seller," never lands, never learns a second planet's prices → **self-
   reinforcing warp loop**.
3. **Fuel refills only on landing** (`SpaceFlightScene.ts:852-855`); every warp
   burns fuel (`:1405-1408`). Warp-forever → never refuels → fuel death. No refuel
   action exists.
4. **Overmind is observed but ignored by default** (all reaction lives in the dead
   `decideOvermindSlayer`; base `avoidDanger` uses only hostile counts, not
   `overmindShare`).
5. **Live-only dead heads** (`installAutopilotHook.ts:272-320`): `repair`,
   `buy-gear`, `upgrade-hull`, `buy-module`, `take-loan`, `repay-loan`,
   `sell-cargo` are no-ops in LIVE (wired in headless), so the watched autopilot
   can't even repair/upgrade.

**Goal:** turn `MemoryHeuristicPolicy` into a **competent, goal-less, needs-based
player** — survive (fuel/hull) → handle threat/Overmind → earn → progress →
explore — that plays a real game loop. Because the shipped neural net **clones
this teacher**, fixing the heuristic fixes both the live autopilot *and* the net's
future teacher.

**Also in scope (chosen):** wire the 8 live dead heads; fix two game oddities the
agent surfaced (station docking should refuel; warp targets are chosen blind);
regenerate + retrain the net to clone the smarter teacher.

## Context (from discovery)

- **Shared brain:** `src/tests/playtest/letsplay/MemoryHeuristicPolicy.ts` — pure
  core `decideWithMemory(obs, mem, goal?)` (`:429-634`), priority-list, `wait`
  floor (`:623`). Base SPACE_FLIGHT sequencing `:523-593`.
- **Two runners / appliers:** live `installAutopilotHook.ts` +
  `AutopilotController.ts` (loop `:299-315`) driving `LiveSceneController`;
  headless `PlayerAgent.ts` (loop `:158-194`, applier `:223-447`) driving
  `RealEngineHarness`. Both construct `MemoryHeuristicPolicy` with **no goal**.
- **Action vocab (16):** `ACTION_ORDER` in `observe.ts:82-99`; legality
  `legalActionsForScene` `:280-382`; `Action` shape (`kind`+`targetId`+`reason`)
  `PlayerPolicy.ts:32-39`. Live dead heads `installAutopilotHook.ts:272-320`.
- **Observation:** `observe.ts:194-249/406-623`. Has fuel
  (`player.fuel/maxFuel/fuelFraction` from `ship.energy`), planets (+`isHabitable`),
  stations, `hasRepairDock`, `overmindShare`/`nearOvermindCore`, quests, loans.
  **Gap:** `system.connections` is a **count only** — no neighbor ids/contents, so
  warp targets are blind (`pickWarpTarget` `engineQueries.ts:53-63`).
- **Memory:** `AgentMemory.ts:80-119` (priceBook, inventoryLots, threatMap,
  visitedSystemIds, overmindDaysSeen, deadlock flags). `knownOffers` never
  populated. Live buy-accounting skew: `openTrade` returns to flight before
  `updateMemory` sees `currentPlanet`, recording lots at `buyPrice:0`
  (`installAutopilotHook.ts:266-271`, `AgentMemory.ts:270-274`).
- **Fuel/refuel:** warp deduct `SpaceFlightScene.ts:1405-1408`; **only** refuel is
  planet-land `:852-855`. Station dock repairs hull only (`engineQueries.ts:210-232`).
- **Net (clones this teacher):** `NeuralPolicy.ts` (`FEATURE_LENGTH=50` = OBS 30 +
  MEMORY 20), `mlp.ts` forward pass, `weights/player.weights.json`. Guards:
  `shippedWeights.test.ts` (loads at current width), `weightsContract.test.ts`
  (TS↔Python parity 1e-5). Training `tools/ai/train_player.py`, dataset
  `exportBcData.ts`.
- **Related plan:** this **supersedes Task 5 and absorbs Task 5b/6** of
  `docs/plans/20260627-letsplay-full-game-play-and-net-retrain.md` (its Tasks 1–4
  — movement/trade/combat/repair executors — are already done/committed). That
  plan's Task 7 (featurize widen to 72) is **explicitly deferred** here.
- **Memory:** `project-bc-player-net-ceiling` (net Bayes-capped ~67% from obs
  aliasing + 3-action teacher), `project-letsplay-flee-noop-deadhead` (dead action
  heads), `feedback-agent-is-diagnostic-fix-the-game`,
  `feedback-letsplay-oddity-hunting`, `feedback-do-not-touch-tests`.

## Development Approach

- **Testing: regression-first** (project-mandated). Each behavioral task starts
  with a **failing real-engine test** reproducing the bad behavior
  (warp-forever / fuel-death / Overmind-ignore), then fixes the policy until
  green. The bad play was invisible because the headless oracle only checks for
  engine errors — so the new tests assert **observable engine effects** (day
  advanced, fuel restored, ≥2 planets visited, credits earned, no fuel-death,
  agent leaves a rising-Overmind system).
- **Never modify existing tests** (`feedback-do-not-touch-tests`). Existing policy
  suites are the safety net. **⚠️ Ladder-reorder checkpoint:** before changing
  candidate ordering, grep `MemoryHeuristicPolicy.test.ts`/`heuristicPolicy.test.ts`
  for assertions on warp-vs-land order; if a change would red one, **STOP and
  surface to the user** — do not edit/weaken it.
- One tier per task; complete fully (green) before the next. Keep the agent
  dev-only (`letsplayDevOnly.test.ts` green). Tune via config/local policy
  constants, not scattered magic numbers.
- **Neural width is frozen at 50** for this plan — do NOT widen `featurize`
  (would red `shippedWeights`/`weightsContract`, which we may not edit). Retrain
  at width 50.

## Testing Strategy

- **Unit/policy tests:** deterministic `decideWithMemory` tests per tier with
  hand-built `Observation`+`AgentMemory` (copy fixtures from
  `MemoryHeuristicPolicy.test.ts`).
- **Real-engine session tests:** `letsplaySession`-style over `RealEngineHarness`
  asserting the observable multi-step outcome (the regression net).
- **Live-applier tests:** `LiveApplier.test.ts`-style for the newly-wired dead
  heads (each executes its real effect).
- **Game-change test:** station-refuel is a player-facing change → real-engine
  regression (dock → energy restored) + visual sanity (dev screenshot). No
  schema/migration change (behavior only) — `test:save-compat` unaffected.
- **Gates each phase:** `npm run letsplay`, `npm run letsplay:ci`,
  `npm run test:playtest`, `npm test -- --run`, `npm run lint`.

## Progress Tracking

- Mark `[x]` immediately when done; ➕ for new tasks; ⚠️ for blockers.
- Keep this file in sync; if a ladder change collides with an existing test,
  record the ⚠️ and stop for the user.

## What Goes Where

- **Implementation Steps** (`[ ]`): policy/executor/observation/game code + tests +
  gates — agent-automatable. The retrain's Python step is automatable on the RTX
  4090 host but gated behind the teacher being final.
- **Post-Completion** (no checkboxes): live visual verification, memory updates,
  deferred featurize-widen follow-up.

## Implementation Steps

### Task 1: Fuel-survival tier — land to refuel, never fuel-death
- [x] `gitnexus impact({target:"decideWithMemory", direction:"upstream", repo:"vacuum-rogues"})` + read `MemoryHeuristicPolicy.test.ts` for existing ordering assertions
- [x] RED: `src/tests/playtest/letsplay/fuelSurvival.test.ts` — a seeded session that today warps until `fuel` hits 0; assert the agent **lands to refuel before energy reaches 0** and never enters a fuel-dead stall (currently fails)
- [x] add a **survival/fuel tier at the top** of the base ladder in `decideWithMemory`: if `fuelFraction < REFUEL_THRESHOLD` and a habitable planet is in-system → `land` (refuels fully); **fuel-gate warp** — do not emit `warp` when `energy` would strand the ship (< ~2× a typical `fuelCost`); land first
- [x] add `REFUEL_THRESHOLD` as a local policy constant (dev-only file; documented)
- [x] GREEN + `npm run letsplay` + `npm run letsplay:ci` stay green

  Also fixed a wiring gap surfaced by the real-engine test: `PlayerAgent.apply`'s
  `land` case teleport-lands (skipping `SpaceFlightScene.onLandOnPlanet`'s
  refuel side effect), so headless landing never actually restored fuel —
  the fix's payoff was invisible in the harness. Added the same refuel-to-max
  there, mirroring the live behavior.

### Task 2: Break the warp-forever loop — land-before-warp economy tier
- [ ] RED: `src/tests/playtest/letsplay/exploreNoWarpLoop.test.ts` — agent holding cargo with single-planet knowledge; assert over a budget it **lands (discovers a 2nd planet / sells)** and does NOT warp more than K times consecutively without landing; asserts ≥2 distinct planets visited
- [ ] ⚠️ **checkpoint:** grep policy tests for an assertion that `warp` outranks `land` in the holding-cargo case; if reordering would red it, STOP + surface (do not edit the test)
- [ ] reorder the ladder: `land "earn"/"discover-prices"` and in-system `land "go-sell"` fire **before** `warp "find-sell-destination"`; only warp-to-explore when the hold is clear AND no in-system commerce remains; add an anti-consecutive-warp cadence (reuse `visitedSystemIds`)
- [ ] fix the "warp to find seller but never learns prices" trap: prefer landing on an **unvisited in-system planet** to populate `priceBook` before leaving the system
- [ ] GREEN

### Task 3: Threat & Overmind-avoidance tier
- [ ] RED: `src/tests/playtest/letsplay/overmindAvoidance.test.ts` — rising `overmindShare` / `nearOvermindCore`; assert the agent **leaves the threatened system** (warp away from the front) instead of idling; hostile-in-range → fight-or-flee by `playerCombatStrength` vs hostile
- [ ] add a **threat tier** below survival: use `overmindShare`/`nearOvermindCore` (not just `threatMap`) — flee/relocate when the front is near and the player is weak; engage only when strong and cornered
- [ ] bias warp-target selection **away from Overmind** (feeds Task 5's target logic)
- [ ] GREEN

### Task 4: Progression tier + holistic competence (goal-less full loop)
- [ ] RED: `src/tests/playtest/letsplay/competentSession.test.ts` — over a fixed budget the goal-less agent **survives longer, earns net credits, completes ≥1 buy→sell cycle, completes/advances ≥1 quest delivery, and does not fuel-die** (a single session-level competence assertion)
- [ ] add **economy + progression tiers**: complete a known cross-planet margin (sell held where profitable → buy cheap); `quest delivery here` → land/dock to complete; affordable in-system hull/gear upgrade → buy; `broke` (credits low) → `land "earn"`
- [ ] ensure the full ladder reads coherently: survival → threat/Overmind → economy → progression → explore → wait; document the order in a header comment
- [ ] GREEN + `npm run test:playtest`

### Task 5: Smart warp-target selection (fix blind warp — observation enrichment)
- [ ] RED: `src/tests/playtest/letsplay/warpTargeting.test.ts` — assert the agent warps toward an **unvisited** connected system and **away from** an Overmind-held neighbor, not a blind pick
- [ ] enrich `Observation`: replace/extend `system.connections` count with neighbor entries (`{ systemId, visited, overmindHeld }`) in `observe.ts` (do NOT featurize — policy uses richer obs than the net; keep `FEATURE_LENGTH=50`)
- [ ] policy emits `warp` with a chosen `targetId` (unvisited, non-Overmind); appliers honor `action.targetId` on warp (`PlayerAgent` `performWarpJumpTo`, live `performWarpJumpTo`) — fall back to `pickWarpTarget` when absent
- [ ] extend `observe.test.ts`-adjacent coverage in a **new** test file (don't modify `observe.test.ts`)
- [ ] GREEN

### Task 6: Wire the 8 live dead heads (LIVE autopilot parity)
- [ ] RED: extend `LiveApplier.test.ts` pattern in a **new** `liveEconomyHeads.test.ts` — assert each of `repair`, `buy-gear`, `upgrade-hull`, `buy-module`, `take-loan`, `repay-loan`, `sell-cargo` produces its real effect in live (hull up / credits change / cargo change)
- [ ] wire the 7 no-op heads in `installAutopilotHook.ts:272-320` to the real executors (reuse the headless `engineQueries.ts` executors: `executeRepair`, `executeBuyBestGear`, `executeUpgradeHull`, `executeBuyBestModule`, `executeTakeLoan`, `executeRepayLoan`, `executeSellAll`)
- [ ] fix the live buy-accounting skew: record the lot at the **real buy price** (capture price before `openTrade` returns to flight) so `AgentMemory` margins are correct
- [ ] GREEN + a dev-session smoke check that live no longer stalls

### Task 7: Game oddity — station docking refuels
- [ ] RED: `src/tests/.../stationRefuel.test.ts` (real-engine) — dock at a station with `energy < maxEnergy`; assert `ship.energy` is restored on dock (currently only planet-landing refuels)
- [ ] make station dock refuel energy (mirror `onLandOnPlanet` refuel at the dock/`StationScene` entry); behavior-only change, **no schema/migration** (energy is existing ship state)
- [ ] confirm no persisted-field change ⇒ `test:save-compat` unaffected; run it anyway to be safe
- [ ] GREEN + visual sanity screenshot of the station dock (per the visual-verify rule)

### Task 8: Session oracle — score the now-reachable competent play
- [ ] add oddity/oracle assertions over the states the smart agent now reaches
  (`src/tests/oddities/` + `ci.run.ts`/`sessionMetrics.ts`): no fuel-death, no
  negative credits, survives ≥ threshold days, galaxy not lost to Overmind while
  the agent is idle-competent, ≥N distinct systems visited
- [ ] re-baseline the balance bands (credits/day, days-to-upgrade, survival) now
  that the agent plays a full loop; `npm run letsplay:ci` gates on them
- [ ] GREEN — `npm run letsplay:ci`

### Task 9: Retrain the net to clone the smart teacher (offline, width 50)
- [ ] regenerate the BC dataset from the now-competent teacher: `GEN_BC=1 npm run letsplay` (target ≥ 30 sessions, broad 16-head coverage)
- [ ] ⚠️ **checkpoint:** confirm dropping new weights does not red an existing
  `NeuralPolicy.test.ts` assertion tied to the *shipped* weights' specific outputs;
  if it would, STOP + surface (do not edit the test)
- [ ] retrain at **width 50** (`tools/ai/train_player.py`, unchanged `NUM_FEATURES=50`) on the RTX 4090; re-export `weights/player.weights.json`
- [ ] `weightsContract.test.ts` (parity 1e-5) + `shippedWeights.test.ts` (loads at 50) green; run neural-flag-on session and assert the net picks the full action repertoire
- [ ] if BC val accuracy is **capped by observability** (the known ~67% aliasing ceiling persists under the smart teacher), record it as ⚠️ and defer the featurize-widen (06-27 Task 7) to a follow-up — do NOT widen here

### Task 10: Verify acceptance + docs/memory
- [ ] verify all Overview goals: goal-less agent survives (no fuel-death), lands/trades/refuels, avoids Overmind, live heads wired, station refuels, net retrained
- [ ] full gates: `npm test -- --run`, `npm run lint`, `npm run test:playtest`, `npm run letsplay:ci`, `npm run test:save-compat`
- [ ] `gitnexus detect_changes({scope:"compare", base_ref:"master"})` — scope matches policy/appliers/observe + the station-refuel game file + weights
- [ ] update `.claude/docs/systems/letsplay.md` (new needs-ladder brain, live-head parity, station refuel, warp targeting)

## Technical Details

- **Needs ladder (single source, goal-less):** in `decideWithMemory`, build the
  base candidate list in this priority — (1) **survival**: fuel < threshold → land
  to refuel, hull critical → repair/flee; (2) **threat/Overmind**: near front &
  weak → warp away, hostile in range → fight-or-flee by strength; (3) **economy**:
  complete known margin / broke → land to earn; (4) **progression**: quest-delivery
  here → land/dock, affordable upgrade → buy; (5) **explore**: warp to a *chosen*
  unvisited non-Overmind neighbor only when healthy & hold-clear; (6) `wait` floor.
  Keep the existing `goal` branch intact (still usable for BC scenario diversity)
  — this task makes the **no-goal** path competent, not a rewrite of the goal path.
- **Fuel gate:** warp only when `energy ≥ ~2× fuelCost`; landing refuels fully at
  no fuel cost, and every planeted system is reachable in-system, so this fully
  removes fuel-death.
- **Warp targeting:** `Observation` gains neighbor `{systemId, visited,
  overmindHeld}`; policy emits `warp.targetId`; appliers honor it. Not featurized
  (net width frozen at 50).
- **No persisted-field changes.** Station-refuel is behavior-only. If any step
  appears to need a schema/migration/save bump, STOP — out of scope.
- **Neural lockstep frozen:** `FEATURE_LENGTH=50`, `ACTION_ORDER` unchanged. The
  retrain re-clones the smarter teacher at the same width.

## Post-Completion

*Informational — no checkboxes.*

**Manual verification:**
- Watch the LIVE autopilot (`` ` `` in `npm run dev`) for a few minutes: confirm it
  lands, refuels, trades, repairs/upgrades, avoids the Overmind front, and does NOT
  warp-die. Screenshot the flight + station scenes (visual-verify rule).

**Memory updates (after retrain):**
- Update `project-bc-player-net-ceiling` with the new teacher + retrain result and
  whether the aliasing ceiling moved.
- Update `project-letsplay-flee-noop-deadhead` if the dead-head trap is resolved by
  the competent teacher.

**Deferred (YAGNI / lockstep-heavy — separate plan):**
- Featurize widen (06-27 Task 7: OBS 30→42, MEMORY 20→30 = 72) + a larger net —
  only if Task 9 proves the ~67% BC ceiling is observability-bound under the smart
  teacher.
- Headless `attack` fidelity (today it advances a day for auto-resolve rather than a
  targeted shot) — refine only if competence tests show it matters.
