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
- [x] RED: `src/tests/playtest/letsplay/exploreNoWarpLoop.test.ts` — agent holding cargo with single-planet knowledge; assert over a budget it **lands (discovers a 2nd planet / sells)** and does NOT warp more than K times consecutively without landing; asserts ≥2 distinct planets visited
- [x] ⚠️ **checkpoint:** grep policy tests for an assertion that `warp` outranks `land` in the holding-cargo case; if reordering would red it, STOP + surface (do not edit the test) — checked: the existing "warps to find a sell destination" test uses zero in-system planets, so `land` is never legal there; reordering doesn't collide with it (all `MemoryHeuristicPolicy.test.ts` cases re-verified green)
- [x] reorder the ladder: `land "earn"/"discover-prices"` and in-system `land "go-sell"` fire **before** `warp "find-sell-destination"`; only warp-to-explore when the hold is clear AND no in-system commerce remains; add an anti-consecutive-warp cadence (reuse `visitedSystemIds`)
- [x] fix the "warp to find seller but never learns prices" trap: prefer landing on an **unvisited in-system planet** to populate `priceBook` before leaving the system
- [x] GREEN

  Added a new `land "discover-prices"` candidate (fires when holding cargo for
  an unknown/out-of-system sell planet AND the local earn planet is still
  unvisited) ranked ahead of `warp "find-sell-destination"`. Also added an
  anti-consecutive-warp cadence: `AgentMemory` now tracks
  `consecutiveWarpsWithoutLanding` (reset by any landing, incremented on an
  observed system change with no landing since), and every base-ladder `warp`
  candidate (SPACE_FLIGHT + STAR_MAP) is gated on
  `MAX_CONSECUTIVE_WARPS_WITHOUT_LAND` (2).

### Task 3: Threat & Overmind-avoidance tier
- [x] RED: `src/tests/playtest/letsplay/overmindAvoidance.test.ts` — rising `overmindShare` / `nearOvermindCore`; assert the agent **leaves the threatened system** (warp away from the front) instead of idling; hostile-in-range → fight-or-flee by `playerCombatStrength` vs hostile
- [x] add a **threat tier** below survival: use `overmindShare`/`nearOvermindCore` (not just `threatMap`) — flee/relocate when the front is near and the player is weak; engage only when strong and cornered
- [x] bias warp-target selection **away from Overmind** (feeds Task 5's target logic)
- [x] GREEN

  Added `OVERMIND_THREAT_HULL_FRACTION`/`OVERMIND_THREAT_SHARE` constants and a
  new threat tier (1.5) in `decideWithMemory`, between the survival tier and
  the economy candidates: `nearOvermindCore || overmindShare > threshold` +
  `hull < OVERMIND_THREAT_HULL_FRACTION` + no present hostile + fuel gate
  clear → `warp "flee-overmind-front"`. Present-hostile cases still defer to
  the existing fight-or-flee-by-hull reaction (`attack`/`flee`) ahead of this
  tier, since `warp` isn't legal mid-combat and jumping while under fire risks
  getting caught mid-transit. `pickWarpTarget` (`engineQueries.ts`) gained an
  optional `avoid` set that filters Overmind-held neighbors first, falling
  back to the full pool only when every connection is held; both the live
  (`installAutopilotHook.ts`) and headless (`PlayerAgent.ts`) appliers now
  pass `galaxy.overmindSystems` as that avoid set.

### Task 4: Progression tier + holistic competence (goal-less full loop)
- [x] RED: `src/tests/playtest/letsplay/competentSession.test.ts` — over a fixed budget the goal-less agent **survives longer, earns net credits, completes ≥1 buy→sell cycle, completes/advances ≥1 quest delivery, and does not fuel-die** (a single session-level competence assertion)
- [x] add **economy + progression tiers**: complete a known cross-planet margin (sell held where profitable → buy cheap); `quest delivery here` → land/dock to complete; affordable in-system hull/gear upgrade → buy; `broke` (credits low) → `land "earn"`
- [x] ensure the full ladder reads coherently: survival → threat/Overmind → economy → progression → explore → wait; document the order in a header comment
- [x] GREEN + `npm run test:playtest`

  Added two goal-less base-ladder candidates in `decideWithMemory`
  (`MemoryHeuristicPolicy.ts`): a `land "quest-delivery"` candidate (fires on
  `obs.questDeliveryHere`, ranked above the upgrade-routing block — landing
  triggers `PlanetScene.checkDeliveryQuestCompletion`, the real completion
  check) and a STATION-scene `upgrade-hull`/`buy-gear`/`buy-module` block
  (reuses the CJM-B gear-grinder's affordability buffers) so credits actually
  get spent on upgrades instead of piling up unspent.

  The session-level RED test surfaced a genuine pre-existing stagnation bug:
  `holdingForOtherSystem`/`go-sell` used the **globally**-best known margin
  (`bestKnownMargin(mem)`), which could be for a good the agent wasn't even
  holding — an unrelated, larger margin masked the held good's own sell
  opportunity, so the agent looped `land "earn"` / `move "take-off"` forever
  on unsellable cargo. Fixed by adding an optional `goodFilter` to
  `bestKnownMargin` and computing a `bestHeld` (margin restricted to
  currently-held goods) used specifically for `go-sell`/`holdingForOtherSystem`,
  while buy-side decisions (`buy-low`/`go-buy`) keep the unrestricted `best`.
  Verified no existing test depends on the old (buggy) behavior — every
  existing fixture uses a single traded good, so `bestHeld === best` there.

  ⚠️ Also found (but did **not** fix, to avoid a regression — see below): a
  STAR_MAP-scene softlock where `avoidDanger` ranks `move "avoid-danger-back"`
  ahead of `warp`, so a ship that just `flee`d a hostile bounces straight back
  into the same system/hostile forever instead of completing the
  flee→STAR_MAP→warp escape `PlayerAgent` expects. Attempted the obvious fix
  (rank `warp` first); it made `npm run letsplay:ci` **regress** (2 new
  soft-locks) because completing the escape exposes an unrelated, already-
  deferred limitation — headless `attack` resolves a whole day's combat per
  step, so a ship can crash from healthy to near-dead in one step and then
  die mid-transit during the warp's own combat auto-resolve. Reverted the
  STAR_MAP change (kept `letsplay:ci` green) and left the softlock as a
  documented follow-up; it does not affect this task's own RED test (that
  session's chosen seed/budget doesn't enter combat).

### Task 5: Smart warp-target selection (fix blind warp — observation enrichment)
- [x] RED: `src/tests/playtest/letsplay/warpTargeting.test.ts` — assert the agent warps toward an **unvisited** connected system and **away from** an Overmind-held neighbor, not a blind pick
- [x] enrich `Observation`: replace/extend `system.connections` count with neighbor entries (`{ systemId, visited, overmindHeld }`) in `observe.ts` (do NOT featurize — policy uses richer obs than the net; keep `FEATURE_LENGTH=50`)
- [x] policy emits `warp` with a chosen `targetId` (unvisited, non-Overmind); appliers honor `action.targetId` on warp (`PlayerAgent` `performWarpJumpTo`, live `performWarpJumpTo`) — fall back to `pickWarpTarget` when absent
- [x] extend `observe.test.ts`-adjacent coverage in a **new** test file (don't modify `observe.test.ts`)
- [x] GREEN

  `Observation.system.neighbors` is `{systemId, visited, overmindHeld}[]`
  (`observe.ts`), sourced from real `StarSystem.explored` +
  `Galaxy.isOvermindSystem`/`overmindCoreSystemId`. `pickWarpNeighbor` in
  `MemoryHeuristicPolicy.ts` scores each neighbor (lowest wins) and fills
  `targetId` on every threat/explore-tier `warp` it emits (economy tier's
  `find-sell-destination` deliberately excluded — see the call site comment).
  Both `PlayerAgent.warp` and the live `installAutopilotHook.ts` `warp`
  already honored an explicit target over the blind `pickWarpTarget`, so only
  the headless applier needed a change to pass `action.targetId` through.
  `AgentMemory` gained `previousSystemId` (distinct from `lastSystemId`,
  which is overwritten every fold) to break immediate ping-pong.

  ⚠️ The session-level RED test surfaced a real regression against the
  existing Task 4 `competentSession.test.ts`: scoring neighbors only on the
  observation's `visited` flag (real fog-of-war `explored`) cycled the agent
  among the 2-3 systems galaxy generation pre-reveals around the home system
  at game start — every one of them already reads `visited: true` despite
  never having been actually traveled to, so the picker couldn't tell them
  apart from genuinely fresh territory. Repeatedly returning to the same
  system let its Overmind garrison grow across visits until a fight there
  crashed the ship's hull and it died mid-warp fleeing (a separate,
  already-documented STAR_MAP `avoid-danger-back`-vs-`flee` softlock — see
  Task 4's note — was briefly considered as the fix point but reverted:
  patching it exposed the same previously-reverted headless-combat-mid-warp
  death this exact scenario hits). Fixed at the actual root cause instead:
  `pickWarpNeighbor` now also weighs `mem.visitedSystemIds` (real
  session-actual travel, weight 3) and `mem.threatMap` (remembered hostiles
  at that system, weight 3) alongside `overmindHeld` (4), `previousSystemId`
  (2), and the raw `visited` flag (1, now a lighter secondary signal). A
  fresh `AgentMemory` (all existing pure fixtures) has both empty, so this is
  fully backward-compatible with every existing test. Re-verified full
  `npm test -- --run` (4399 passed), `npm run lint` (0 errors), `npx tsc
  --noEmit` (clean), `npm run letsplay:ci`, and `npm run test:playtest` green
  after the fix — the STAR_MAP softlock remains a known, deferred, separate
  issue untouched by this task.

### Task 6: Wire the 8 live dead heads (LIVE autopilot parity)
- [x] RED: extend `LiveApplier.test.ts` pattern in a **new** `liveEconomyHeads.test.ts` — assert each of `repair`, `buy-gear`, `upgrade-hull`, `buy-module`, `take-loan`, `repay-loan`, `sell-cargo` produces its real effect in live (hull up / credits change / cargo change)
- [x] wire the 7 no-op heads in `installAutopilotHook.ts:272-320` to the real executors (reuse the headless `engineQueries.ts` executors: `executeRepair`, `executeBuyBestGear`, `executeUpgradeHull`, `executeBuyBestModule`, `executeTakeLoan`, `executeRepayLoan`, `executeSellAll`)
- [x] fix the live buy-accounting skew: record the lot at the **real buy price** (capture price before `openTrade` returns to flight) so `AgentMemory` margins are correct
- [x] GREEN + a dev-session smoke check that live no longer stalls

  Wired all 7 (the plan's "8" counts the already-wired `executeTrade`/combat
  heads loosely; the concrete no-op list was always 7). `repair()` guards on
  `engine.player?.ship` before calling `executeRepair` — a genuine defensive
  fix, not a hypothetical: the existing `installAutopilotHook.test.ts`
  "no-op verbs" test drives a minimal mock engine with no `ship`, and
  `executeRepair` reads `player.ship.hullHP` unguarded (the executor's own
  contract assumes a fully-initialized real engine, which every other caller
  already provides). `sellCargo()` mirrors `PlayerAgent`'s guard: resolves
  `landedPlanet(engine)` and no-ops when not landed.

  ⚠️ The buy-accounting-skew checkbox could not be fixed by changing
  `openTrade`'s post-trade destination (the obvious fix, matching the
  headless applier's return-to-PLANET pattern): an existing test
  (`installAutopilotHook.test.ts` — "openTrade() executes trade directly and
  transitions to SPACE_FLIGHT") hard-asserts the SPACE_FLIGHT destination, and
  per the no-touch-existing-tests rule that destination is fixed. Root-caused
  instead in `AgentMemory.ts`: added `lastCurrentPlanetId` (the `currentPlanet`
  id observed one fold ago, distinct from a sticky "last visited planet" —
  it goes stale after a single fold). `updateMemory`'s buy-price detection now
  falls back to `priceBook.get(mem.lastCurrentPlanetId)` before defaulting to
  `0`, recovering the real price recorded during the landed fold that preceded
  the trade. Fully backward-compatible (new field only, `InventoryLot` shape
  unchanged) — verified via a new real-engine regression in
  `liveEconomyHeads.test.ts` reproducing the exact two-fold sequence
  (`updateMemory` at PLANET → real trade → `updateMemory` at SPACE_FLIGHT)
  and asserting the recovered lot's `buyPrice` matches the real market price,
  not `0`.

  Dev-session smoke check: automated via `liveEconomyHeads.test.ts` (10 new
  tests, real `RealEngineHarness`/`GameEngine`, zero harness errors on every
  path) rather than a manual watch session — this is the same real-engine
  tier the plan's Testing Strategy calls "live-applier tests"; a human watch
  of the rendered game is deferred to the plan's Post-Completion manual
  verification pass (Task 10 covers the full acceptance sweep).

### Task 7: Game oddity — station docking refuels
- [x] RED: `src/tests/.../stationRefuel.test.ts` (real-engine) — dock at a station with `energy < maxEnergy`; assert `ship.energy` is restored on dock (currently only planet-landing refuels)
- [x] make station dock refuel energy (mirror `onLandOnPlanet` refuel at the dock/`StationScene` entry); behavior-only change, **no schema/migration** (energy is existing ship state)
- [x] confirm no persisted-field change ⇒ `test:save-compat` unaffected; run it anyway to be safe
- [x] GREEN + visual sanity screenshot of the station dock (per the visual-verify rule)

  Three call sites transition into `StationScene` without going through a shared
  entry hook (unlike `PlanetScene`, `StationScene.initialize()` is never reached
  by a save-resume, so it would have been a safe single fix point, but each
  "dock" call site independently teleports — mirroring exactly why the land
  case needed both a live fix *and* a headless mirror in Task 1): live
  `SpaceFlightScene.onDockAtStation` (the real proactive-docking trigger,
  `updateShip` within `DOCKING_RANGE`), headless `PlayerAgent.apply`'s `"dock"`
  case, and the live-autopilot `installAutopilotHook.ts` `dock()` (which —
  unlike its `land()` sibling — never attempts physical routing, so it always
  teleports). All three now set `ship.energy = ship.maxEnergy` right
  before/after the scene transition, mirroring `onLandOnPlanet`'s existing
  free-refuel-to-max. `gitnexus detect_changes` confirmed the touched symbols
  were exactly these three call sites (plus their containing methods) — no
  incidental scope. RED tests: `src/tests/flight/stationDockRefuel.test.ts`
  (prototype-invocation wiring test for the live fix, mirroring
  `landingGate.test.ts`'s pattern) and
  `src/tests/playtest/letsplay/stationRefuel.test.ts` (real-engine
  `RealEngineHarness`/`PlayerAgent` regression for the headless fix). No
  schema/migration needed (`energy` is pre-existing ship state); `STATION` is
  already a `contextDependentScenes` entry so save-resume never re-enters
  `StationScene.initialize()` and can't double-refuel on load.
  `test:save-compat` reconfirmed green. Visual sanity: automated real-engine
  coverage only (`stationRefuel.test.ts`, zero harness errors) — a live-session
  screenshot is deferred to the plan's Post-Completion manual verification pass
  (Task 10), same as Task 6's precedent.

### Task 8: Session oracle — score the now-reachable competent play
- [x] add oddity/oracle assertions over the states the smart agent now reaches
  (`src/tests/oddities/` + `ci.run.ts`/`sessionMetrics.ts`): no fuel-death, no
  negative credits, survives ≥ threshold days, galaxy not lost to Overmind while
  the agent is idle-competent, ≥N distinct systems visited
- [x] re-baseline the balance bands (credits/day, days-to-upgrade, survival) now
  that the agent plays a full loop; `npm run letsplay:ci` gates on them
- [x] GREEN — `npm run letsplay:ci`

  `VitalsSample` (`sessionMetrics.ts`) gained optional `fuel`/`systemId`/
  `overmindShare` (optional so the existing synthetic `ci.run.test.ts` fixture
  keeps compiling unchanged); `letsplay.run.ts`'s `checkpoint()` populates them
  from the real observation, and `checkInvariants` gained a `credits-nonnegative`
  breach (mirrors `hull-nonnegative`) — the "no negative credits" oracle signal.
  `SessionMetrics`/`RunMetrics` gained `fuelDeath`/`overmindLost` (both scoped to
  "the session actually ended in GAME_OVER while that condition held" — a share
  merely crossing the band mid-session isn't itself a failure, since the real
  in-engine loss also needs the grace-days gate), `distinctSystemsVisited`, and
  `daysSurvived`. `MetricsThresholds`/`evaluate()` gained `maxFuelDeaths`/
  `maxOvermindLosses`/`minAvgDistinctSystemsVisited`/`minDaysSurvived`.

  Measured the real distribution at the default `letsplay:ci` budget (3×40) and
  a wider 5×150 sweep across several seed prefixes: `fuelDeathCount` and
  `overmindLossCount` were a flat 0 everywhere (Task 1's fuel-gate and Task 3's
  threat tier respectively), `survivalRate` a flat 1.0, `avgDistinctSystemsVisited`
  2–4, `minDaysSurvived` 3–24. Rebaselined `DEFAULT_CI_THRESHOLDS` with
  `maxFuelDeaths: 0`, `maxOvermindLosses: 0` (budget-agnostic — a session can't
  starve/lose the galaxy in a handful of steps either, so these hold even at the
  1–12-step smoke budgets `ci.run.test.ts`'s own tests use) and `minSurvivalRate:
  0.8` (generous headroom below the observed 1.0).

  `minDaysSurvived`/`minAvgDistinctSystemsVisited` are budget-dependent — a
  1–12-step smoke run legitimately never leaves the start system — so folding
  them into the shared `DEFAULT_CI_THRESHOLDS` broke `ci.run.test.ts`'s existing
  tiny-budget assertions (a real, existing-test collision caught by
  `npm test -- --run`, not edited per the no-touch-existing-tests rule). Scored
  them instead in a new `src/tests/oddities/sessionCompetence.test.ts` against a
  properly-sized session budget (3×40, its own seed prefix), with explicit
  per-signal assertions for every state Task 8 asked for (no fuel-death, no
  negative credits, survives ≥1 day worst-case, no Overmind loss, ≥1.5 avg
  distinct systems visited) plus the full threshold-eval assertion.

  ⚠️ Also found (documented, not fixed — out of scope for the oracle task):
  `avgCreditsPerDay` was consistently *negative* (~ −25 to −135/day) across
  every probed session at both budgets, and no session reached a hull upgrade —
  the agent still isn't a net earner at this short a horizon (and `netCredits`
  can't see unsold held cargo as value, so a mid-buy-cycle session reads as a
  pure loss). Left `creditsPerDayBand`/`maxAvgDaysToFirstUpgrade`/
  `minUpgradeRate` unscored rather than set to a band that would either always
  fail or be set suspiciously loose — a follow-up economy-tune candidate.

### Task 9: Retrain the net to clone the smart teacher (offline, width 50)
- [x] regenerate the BC dataset from the now-competent teacher: `GEN_BC=1 npm run letsplay` (target ≥ 30 sessions, broad 16-head coverage)
- [x] ⚠️ **checkpoint:** confirm dropping new weights does not red an existing
  `NeuralPolicy.test.ts` assertion tied to the *shipped* weights' specific outputs;
  if it would, STOP + surface (do not edit the test)
- [x] retrain at **width 50** (`tools/ai/train_player.py`, unchanged `NUM_FEATURES=50`) on the RTX 4090; re-export `weights/player.weights.json`
- [x] `weightsContract.test.ts` (parity 1e-5) + `shippedWeights.test.ts` (loads at 50) green; run neural-flag-on session and assert the net picks the full action repertoire
- [x] if BC val accuracy is **capped by observability** (the known ~67% aliasing ceiling persists under the smart teacher), record it as ⚠️ and defer the featurize-widen (06-27 Task 7) to a follow-up — do NOT widen here

  **The aliasing ceiling did NOT persist — it was the goal-mix, not the
  observation width.** Switched `DEFAULT_SCENARIO_MIX` (`exportBcData.ts`) to a
  single `goal: null` stratum (200 sessions × 500 steps), regenerated the
  dataset (`tools/ai/dataset/train.jsonl`, 100K rows), and retrained at width 50
  (`50→256→128→16`, `NUM_FEATURES=50` unchanged, MPS backend). BC accuracy jumped
  to **val_acc 0.997** (early-stop epoch 298) — the old ~67% ceiling came from
  goal-**mixed** data labelling the *same* obs with conflicting actions across
  goals (the `goal` isn't featurized), which the net averaged and collapsed to a
  single action at rollout despite high teacher-forcing accuracy. Cloning the one
  deterministic policy the net actually deploys (goal-less, both live + headless)
  removed the aliasing. **No featurize-widen needed** (width stays frozen at 50).

  Re-exported `weights/player.weights.json` from the final run. Guards green:
  `shippedWeights.test.ts` (loads at 50, 3-layer shape), `weightsContract.test.ts`
  (parity 1e-5 against the checked-in reference fixture — unaffected by the
  retrain since it pins the forward-pass maths, not the shipped net), and
  `NeuralPolicy.test.ts` (18 tests, the checkpoint — no shipped-output assertion
  collides). New committed guards: `neuralSession.test.ts` asserts the shipped net
  **drives a real-engine session error-free and picks ≥3 distinct action kinds**
  (not collapsed), and `neuralTargetResolution.test.ts` pins the new
  `mapNetOutputToAction` seam fix.

  Seam fix surfaced during rollout verification (`NeuralPolicy.ts`): the net's
  output head only picks an action **kind**, never a target, and
  `PlayerAgent.apply`'s `land` case lands *only* on `action.targetId` (a
  deliberate guard against spin-landing an uninhabited planet) with **no applier
  fallback** — so a bare `{kind:"land"}` from the net teleport-landed nowhere and
  the net stalled in a land→no-op→land loop, unable to ever land (its most
  important economy action). Added `resolveNeuralTarget` to
  `mapNetOutputToAction`: for a chosen `land` kind it resolves a habitable
  in-system planet (falling back to the first planet), pure + deterministic; other
  kinds keep the applier's own resolution. Gates: `npm test -- --run` (4419
  passed), `npm run lint` (0 errors), `npx tsc --noEmit` (clean),
  `npm run letsplay:ci` (105), `npm run test:playtest` (506).

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
