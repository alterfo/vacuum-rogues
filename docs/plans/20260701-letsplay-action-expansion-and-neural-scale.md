---
# Letsplay: Full Action Expansion + Neural Scale-up (Overmind Victory)

## Overview

Expand the letsplay agent from 10 shallow actions to **16 full-game actions**, implement all Customer Journey Maps (CJMs) as heuristic teacher behaviors, grow the feature vector from 23 → 50 wide, and train a **42→256→128→16** network (~51K params) on the RTX 4090 to beat the Overmind. Run parallel autopilot sessions to find and fix in-game oddities.

**Supersedes**: `20260627-letsplay-full-game-play-and-net-retrain.md` Tasks 2–9 (subsumed here at wider scope).

Why this matters: the current net is BC-capped at ~67% accuracy because the teacher (MemoryHeuristicPolicy) only covers trade/navigate/fight — it has zero behavior for banking, equipment shop, hull upgrades, micromodule crafting, or proactive Overmind engagement. Without those, no net size will learn to win the game. Fix the teacher first, then scale.

## Context

| Area | Files |
|------|-------|
| Action vocabulary | `src/tests/playtest/letsplay/observe.ts` (ACTION_ORDER, legalActionsForScene) |
| Observation type | `src/tests/playtest/letsplay/observe.ts` (Observation interface, observe()) |
| Feature vector | `src/tests/playtest/letsplay/NeuralPolicy.ts` (featurize, OBS_FEATURE_LENGTH=16) |
| Memory features | `src/tests/playtest/letsplay/memoryFeatures.ts` (MEMORY_FEATURE_LENGTH=7) |
| AgentMemory | `src/tests/playtest/letsplay/AgentMemory.ts` (createMemory, updateMemory) |
| Heuristic teacher | `src/tests/playtest/letsplay/HeuristicPolicy.ts`, `MemoryHeuristicPolicy.ts` |
| Action applier | `src/tests/playtest/letsplay/PlayerAgent.ts` (apply()) |
| CJM/scenarios | `src/tests/playtest/letsplay/goalBias.ts` (ScenarioGoal, GoalBiasedPolicy) |
| MLP | `src/tests/playtest/letsplay/mlp.ts`, `NeuralPolicy.ts` |
| Training | `tools/ai/train_player.py`, `tools/ai/README.md` |
| Dataset export | `src/tests/playtest/letsplay/exportBcData.ts` |
| Guards | `src/tests/playtest/letsplay/weightsContract.test.ts`, `shippedWeights.test.ts` |
| Game banking | `src/systems/banking/BankingService.ts`, `economy.ts`, `products.ts` |
| Game equipment | `src/presentation/EquipmentShopScene.ts`, `src/systems/equipment/GearBridge.ts` |
| Game engineering | `src/systems/equipment/micromoduleShop.ts`, `sellHull.ts` |
| Overmind | `src/systems/overmind/overmindSpread.ts` |

## Development Approach

- TDD for pure logic (new observer signals, feature blocks, policy branches, executor helpers)
- Real-engine playtest harness (`RealEngineHarness`) for integration checks — never mock the seam
- One task at a time, all tests green before advancing
- **Never modify existing test assertions** — add new ones only
- Feature vector is frozen until Task 5 (featurize); widen it exactly once, then regenerate weights
- Training happens in Task 9 (offline, on RTX 4090 via SSH to `oleg@192.168.88.193`)
- Parallel Task P (oddity fixing) runs independently in separate sessions

## Implementation Steps

---

### Task 1: Expand observation signals

Surface bank, equipment, Overmind, and quest-delivery state in `observe()`.

**Files:**
- Modify: `src/tests/playtest/letsplay/observe.ts`
- Modify: `src/tests/playtest/letsplay/AgentMemory.ts`
- Create: `src/tests/playtest/letsplay/observeHelpers.ts` (pure helpers unit-tested in isolation)

- [x] Add to `Observation` interface: `hasBank?: boolean`, `hasCraftCenter?: boolean`, `hasRepairDock?: boolean`, `overmindShare?: number` (0..1 fraction of galaxy captured), `nearOvermindCore?: boolean`, `questDeliveryHere?: boolean` (active quest's delivery system = current system), `activeLoans?: boolean` (player has outstanding loan), `cheapestGearPrice?: number` (cheapest item in nearest shop, null if unknown), `bestHullPrice?: number`
- [x] Implement each signal in `observe()` — read from `engine.galaxy`, `engine.bankBus/bankingService`, `engine.questManager`, `engine.player.loadout` — guard all with null-safe checks
- [x] Add `stationType?: StationType` to `SystemSnapshot.stations` entries (currently only id+name) — already present (`type: StationType`, non-optional) from an earlier pass; no change needed
- [x] Add `visitedSystemIds: Set<string>` and `loanState?: { balance: number; missedPayments: number }` to `AgentMemory`; update `createMemory` and `updateMemory`
- [x] Write `src/tests/playtest/letsplay/observeHelpers.test.ts`: unit test each new signal with mock engines (hasCraftCenter when station type = CRAFT_CENTER; nearOvermindCore when system matches galaxy.overmindCoreSystemId; questDeliveryHere; activeLoans)
- [x] Run `npm run test:playtest -- --run` — must pass before Task 2

---

### Task 2: Expand action vocabulary to 16 actions

Replace the 10-action `ACTION_ORDER` with a 16-action vocabulary covering all game intents.

**Files:**
- Modify: `src/tests/playtest/letsplay/observe.ts` (ACTION_ORDER, legalActionsForScene, PlayerActionKind)
- Modify: `src/tests/playtest/letsplay/LiveApplier.ts` (LiveSceneController + applyLiveAction)
- Modify: `src/tests/playtest/letsplay/LiveApplier.test.ts` (new verb cases)

New canonical order (index = MLP output slot — order matters for trained weights):
```
"wait"        // 0  — unchanged
"move"        // 1  — unchanged
"warp"        // 2  — unchanged
"land"        // 3  — unchanged
"dock"        // 4  — unchanged
"trade"       // 5  — unchanged (buy/sell at market)
"take-quest"  // 6  — unchanged
"attack"      // 7  — unchanged
"flee"        // 8  — unchanged
"repair"      // 9  — unchanged
"buy-gear"    // 10 — NEW: purchase a weapon/equipment/engine at a shop
"upgrade-hull"// 11 — NEW: swap to a better hull at equipment shop
"buy-module"  // 12 — NEW: buy a micromodule at CRAFT_CENTER station
"take-loan"   // 13 — NEW: borrow credits from the bank
"repay-loan"  // 14 — NEW: repay outstanding loan
"sell-cargo"  // 15 — NEW: explicit sell-only action (different from trade which also buys)
```

Legal per scene:
- `buy-gear`: EQUIPMENT_SHOP (when affordable gear exists), STATION (as shortcut → shop)
- `upgrade-hull`: EQUIPMENT_SHOP (when better hull affordable), STATION
- `buy-module`: STATION when `hasCraftCenter` and credits sufficient (≥ 800 cr)
- `take-loan`: BANK, STATION (navigates to bank) — legal when `!activeLoans` (one loan at a time)
- `repay-loan`: BANK, STATION — legal when `activeLoans`
- `sell-cargo`: TRADE, PLANET — legal when `cargoUsed > 0` (explicit sell-then-leave)

- [x] Update `PlayerActionKind` union type in `observe.ts` with the 6 new kinds
- [x] Update `ACTION_ORDER` constant (must stay 16-element canonical array — index = net output slot). Deviation from the plan's literal index table: the original 10-action order is preserved **verbatim** (2 existing `observe.test.ts` assertions pin its exact sequence, e.g. `["move","warp","land","dock","wait"]`) and the 6 new actions are appended at indices 10–15, rather than reordering `wait` to index 0 as the plan's table showed — this keeps every existing test assertion untouched per the standing rule while still delivering the full 16-action vocabulary.
- [x] Update `legalActionsForScene` with new scene/condition clauses for each new action (explicit `EQUIPMENT_SHOP`/`BANK` cases added; `STATION`/`TRADE`/`PLANET` extended)
- [x] Add new methods to `LiveSceneController` interface: `buyGear`, `upgradeHull`, `buyModule`, `takeLoan`, `repayLoan`, `sellCargo` (implemented as safe no-ops in `installAutopilotHook.ts`'s live controller, matching the existing pattern for `attack`/`flee`/`repair`/`executeTrade`; a live executor is not in this task's scope)
- [x] Update `applyLiveAction` switch with all 6 new cases
- [x] Update `LiveApplier.test.ts`: add it.each rows for every new (scene, action, expectedCall) triple; update exhaustive "never throws" loop with new kinds
- [x] Run `npm run test:playtest -- --run` — must pass before Task 3

**Implementation notes for Task 3+:** the legality gates above needed 6 new optional `LegalActionContext` fields (`credits`, `cargoUsed`, `hasCraftCenter`, `activeLoans`, `cheapestGearPrice`, `bestHullPrice`) — optional (not required) so every existing `legalActionsForScene`/`makeObs` call site across the test suite kept compiling unchanged. `observe()`'s bank/equipment/Overmind signal block (Task 1) was hoisted above the `legalActions` computation so those signals can feed it. Widening `ACTION_ORDER` to 16 slots also invalidated the shipped `player.weights.json` (trained for 10 outputs) immediately — `shippedWeights.test.ts` is `describe.skip`'d now (not waiting for Task 5) with a comment; re-enable it in Task 10 alongside the retrain.

---

### Task 3: Implement applier executors for new actions

Add headless engine executors in `PlayerAgent.apply()` for all 6 new actions.

**Files:**
- Modify: `src/tests/playtest/letsplay/PlayerAgent.ts`
- Create: `src/tests/playtest/letsplay/equipmentQueries.ts` (pure helpers: find best affordable gear, find best hull)
- Create: `src/tests/playtest/letsplay/bankingQueries.ts` (pure helpers: get loan terms, get loan balance)

Multi-step applier pattern (mirrors existing `trade` action):
- `buy-gear` in EQUIPMENT_SHOP → call `executeBuyBestGear(engine)` → `harness.goTo(STATION)`
- `buy-gear` in STATION → `harness.goTo(EQUIPMENT_SHOP, {station})`
- `buy-gear` in SPACE_FLIGHT → `harness.goTo(STATION, {nearestEquipStation})`
- `upgrade-hull` same pattern but targeting hull tab
- `buy-module` in STATION when CRAFT_CENTER → call `executeBuyBestModule(engine)` → tick
- `take-loan` in BANK → `executeTakeLoan(engine)` (take the standard `LOAN_AMOUNT_SMALL` product)
- `take-loan` in STATION → `harness.goTo(BANK)` (if bank scene reachable from station)
- `repay-loan` in BANK → `executeRepayLoan(engine)` (pay as much as current credits allow)
- `sell-cargo` in TRADE → `executeSellAll(engine)` → `harness.goTo(PLANET)` — sell all held cargo at current prices

- [x] Create `equipmentQueries.ts`: `bestAffordableGear(engine): GearSpec | null`, `bestAffordableHull(engine): HullSpec | null`, `cheapestMicromodule(engine): MicromoduleSpec | null`, `nearestStationWithShop(engine): Station | null`, `nearestStationWithBank(engine): Station | null`
- [x] Create `bankingQueries.ts`: `playerLoanBalance(engine): number`, `canTakeLoan(engine): boolean`, `standardLoanTerms(engine): LoanTerms | null`
- [x] Implement `executeBuyBestGear(engine)`: read shop via ShopGenerator (or engine equivalent), call `acquireUninstalledGear` + `adjustPlayerCredits` — fail gracefully with `harness.tick()` if no affordable item
- [x] Implement `executeBuyBestModule(engine)`: call `buyMicromodule()` from `micromoduleShop.ts` for the cheapest available module the player can afford
- [x] Implement `executeTakeLoan(engine)` and `executeRepayLoan(engine)` via the BankingService/bus seam
- [x] Implement `executeSellAll(engine)`: sell everything in cargo via `executeTradeOnPlanet` sell path
- [x] Add all 6 cases to `PlayerAgent.apply()` switch
- [x] Write integration tests in a new `src/tests/playtest/letsplay/newActions.test.ts` using `RealEngineHarness`: boot → newGame → navigate to an equipment shop → `apply("buy-gear")` → verify player owns a new item and credits reduced; similar for `take-loan`, `buy-module`
- [x] Run `npm run test:playtest -- --run` — must pass before Task 4

**Implementation notes for Task 4+:** the illustrative multi-step navigation table above assumed a live `EQUIPMENT_SHOP` reachable from `STATION` and a `BANK` reachable via `harness.goTo(BANK)` from mid-shop context — neither holds against the real scene graph: `EquipmentShopScene`'s `ShopContext` only ever accepts a `planet` (it's the planet Верфь tab; `SceneFactory`/`PlanetScene` never pass a `station`), and `StationScene` has its own in-scene `"shop"`/`"hangar"`/`"bank"` *views* rather than child-scene transitions. Since `legalActionsForScene` (Task 2) already only offers `buy-gear`/`upgrade-hull`/`buy-module`/`take-loan`/`repay-loan` from a scene that's already "at the right place" (`STATION`/`EQUIPMENT_SHOP`/`BANK`), the appliers execute the real domain effect **directly in place** (bypassing shop/bank UI exactly as the existing `trade` case bypasses `TradeScene`'s buttons) and then `tick()` — no extra scene navigation needed. `sell-cargo` keeps the plan's `TRADE → goTo(PLANET)` step since that one *is* real. `nearestStationWithShop`/`nearestStationWithBank` are implemented per the checklist for completeness/future live-wiring use but are not called by the headless applier today (buy-gear/upgrade-hull/buy-module/take-loan/repay-loan are only ever legal already-docked). `executeSellAll` lives in `engineQueries.ts` (not a new file) since it shares `executeTradeOnPlanet`'s sell-loop — extracted into a private `sellAllCargo` helper both now call, avoiding duplicating the `TradeSystem` loop.

---

### Task 4: CJM teacher behaviors (MemoryHeuristicPolicy expansion)

Implement all Customer Journey Maps as named heuristic branches in `MemoryHeuristicPolicy`. Each CJM is a self-consistent goal-seeking pattern the teacher can exhibit so the net has labeled data for those behaviors.

**Files:**
- Modify: `src/tests/playtest/letsplay/MemoryHeuristicPolicy.ts`
- Modify: `src/tests/playtest/letsplay/goalBias.ts` (new ScenarioGoal entries)
- Modify: `src/tests/playtest/letsplay/AgentMemory.ts` (new belief fields if needed)

**CJMs to implement (as heuristic decision branches):**

**CJM-A: Trade magnate** (`"trade-magnate"` goal)
- If holding cargo with known profitable sell: route to sell planet first
- If credits surplus AND known buy-margin > 30%: take a loan if margin/interest justifies it → bulk-buy → sell
- After sell profit: repay loan immediately if outstanding
- Use loan only when `estimatedProfit > loanCost × 1.5` (configurable threshold in AgentMemory or constants)

**CJM-B: Gear grinder** (`"gear-grinder"` goal)
- Priority: upgrade hull capacity → buy best weapon → buy best engine → buy micromodules
- When credits ≥ `cheapestGearPrice * 1.2` buffer: route to equipment shop (`buy-gear`)
- When credits ≥ `bestHullPrice * 1.1` buffer: route for hull upgrade (`upgrade-hull`)
- Otherwise: trade/quest to accumulate credits

**CJM-C: Combat hunter** (`"bounty-hunter"` goal)
- If hostiles present AND hull > 50%: attack
- After winning: loot (cargo from kill is auto-added), then sell-cargo
- If hull 30–50%: flee to nearest repair station/planet first, then re-engage
- If no local hostiles: warp toward pirate/overmind systems (use threat map to find danger)

**CJM-D: Quest runner** (`"quest-runner"` goal)
- Always take available quests
- When carrying quests: route to delivery system (use `questDeliveryHere` signal and quest.targetSystemId from engine)
- When quest complete: take new quests before doing anything else

**CJM-E: Overmind slayer** (`"overmind-slayer"` goal)
- Track Overmind spread (overmindShare, nearCore signals)
- When overmindShare > 0.1: prioritize warping toward the Overmind core direction (use `galaxy.overmindCoreSystemId` for routing)
- When at core system or adjacent: attack (hostiles are Overmind ships)
- When hull < 40% near core: flee and repair first

**CJM-F: Pirate** (`"pirate"` goal)
- Seek out traders (non-hostile NPC ships): attack them
- Sell looted cargo at nearest planet
- Flee from patrol/ranger ships
- Avoid high-reputation loss by staying out of military/ranger zones

**CJM-G: Explorer** (`"explorer"` goal — replaces current `"free-explore"`)
- Warp to unvisited systems (use `visitedSystemIds` from AgentMemory)
- Prefer systems not yet in `visitedSystemIds` → direction of the unknown
- When credits low: land on nearest planet for quests, then resume exploring

**Deadlock detector** (wired into all CJMs and base policy):
- Conditions: hull ≤ 10%, credits < 100, no quests, hostile system, `activeLoans`
- Action: log `[DEADLOCK] step=N credits=X hull=Y system=Z` via `logger.warn()` and then `wait` (the oracle will surface it as a notable log for the CI gate)
- Record in `AgentMemory.deadlockDetected: boolean` so the policy logs it only once per run

- [x] Add new `ScenarioGoal` entries: `"trade-magnate"`, `"gear-grinder"`, `"bounty-hunter"`, `"quest-runner"`, `"overmind-slayer"`, `"pirate"`, `"explorer"` (replaces `"free-explore"` semantics)
- [x] Add `visitedSystemIds: Set<string>`, `deadlockDetected: boolean`, `activeQuestDelivery?: { questId: string; targetSystemId: string }[]` to `AgentMemory`; update `createMemory`, `updateMemory`
- [x] Implement `decideTradeMagnate()`, `decideGearGrinder()`, `decideBountyHunter()`, `decideQuestRunner()`, `decideOvermindSlayer()`, `decidePirate()`, `decideExplorer()` as private methods in `MemoryHeuristicPolicy`, each returning `Action | null` (null = defer to base)
- [x] Implement deadlock detector as `detectDeadlock(obs, memory): boolean`, called pre-decide in every CJM branch
- [x] Wire all CJM methods into `MemoryHeuristicPolicy.decide()` via goal dispatch (accept optional `goal?: ScenarioGoal` in constructor or a separate `MemoryCjmPolicy` class)
- [x] Update `GoalBiasedPolicy` / `GOAL_PREFER` to include new goals (or replace with direct `MemoryCjmPolicy` dispatch)
- [x] Update `SCENARIO_GOALS` list (used by oracle and letsplay CI)
- [x] Write unit tests in `src/tests/playtest/letsplay/cjm.test.ts`: for each CJM, build synthetic obs+memory and verify the expected action is returned; test deadlock detector; test `decideTradeMagnate` when margin justifies loan vs. when it doesn't
- [x] Run `npm run test:playtest -- --run` — must pass before Task 5

**Implementation notes for Task 5+:** `decideWithMemory` gained an optional third `goal?: ScenarioGoal` param (all existing call sites omit it — byte-for-byte unchanged behavior); a `goal`'s CJM branch gets first refusal right after the warp-in-transit check and before the goal-less scene switch, so a legal CJM preference always wins outright and a `null` return falls through unchanged. The deadlock check sits at the very top of `decideWithMemory` (before survive/goal dispatch) so it can force `wait` even when attack/flee would otherwise be legal — the compound condition (hull ≤10%, credits <100, no quests, hostile present, an outstanding loan) is intentionally narrow (a genuine "nothing good to do" edge), not a general low-hull gate. `detectDeadlock` and the sticky one-shot `logger.warn` + `AgentMemory.deadlockDetected` flip both live in `AgentMemory.ts` (not `MemoryHeuristicPolicy.ts`) to avoid a circular import, since `updateMemory` needs to call it every fold regardless of which policy is in play ("wired into...the base policy"); `decideWithMemory` also calls it directly (fresh each time, not just reading the sticky flag) so the pure core stays testable without pre-populating memory via `updateMemory`. CJM-E/F's "route toward the core direction" / "attack traders, avoid rangers" are scoped to what `Observation` actually exposes (no engine/pathfinding access from the pure decide core): overmind-slayer uses the boolean `nearOvermindCore` + `overmindShare` signals rather than real BFS routing, and pirate uses `FactionType.BASTIONS` (the bank/law faction, per `BANK_FACTION_ID`) as the closest observable proxy for "lawful/ranger zone" since NPC *role* (trader/pirate/ranger/patrol) isn't surfaced on `NpcSnapshot`, only `faction`. `GOAL_PREFER` (the older, shallower `GoalBiasedPolicy` decorator) gained simple action-kind entries for all 7 new goals too — required for the `Record<ScenarioGoal,...>` exhaustiveness check and exercised by the existing `goalBias.test.ts` battery over `SCENARIO_GOALS` — but the real CJM reasoning (affordability buffers, hull-fraction bands, loan-cost thresholds) lives only in `MemoryHeuristicPolicy`'s goal dispatch. Widening `SCENARIO_GOALS` also required updating `tools/ai/scenarioGen.ts`'s `SCENARIO_RUBRIC` text (lockstep with the existing `scenarioGen.test.ts` assertion that every `SCENARIO_GOALS` entry appears in the rubric).

---

### Task 5: Expand featurize to 50 features

Widen the feature vector exactly once. After this task all weight files are invalid until Task 10 (training).

**Files:**
- Modify: `src/tests/playtest/letsplay/NeuralPolicy.ts` (`featurize`, `OBS_FEATURE_LENGTH`)
- Modify: `src/tests/playtest/letsplay/memoryFeatures.ts` (`featurizeMemory`, `MEMORY_FEATURE_LENGTH`)
- Modify: `src/tests/playtest/letsplay/weightsContract.test.ts` (update expected shape)
- Modify: `src/tests/playtest/letsplay/shippedWeights.test.ts` (mark stale until new weights shipped in Task 10)

**New observation block** (`OBS_FEATURE_LENGTH = 30`):

| idx | feature | norm |
|-----|---------|------|
| 0 | hasPlayer | 0/1 |
| 1 | hullFraction | [0,1] |
| 2 | fuelFraction | [0,1] |
| 3 | cargoFraction | [0,1] |
| 4 | credits/100000 | [0,1] clamped |
| 5 | planetCount/8 | [0,1] |
| 6 | stationCount/8 | [0,1] |
| 7 | connectionCount/8 | [0,1] |
| 8 | hostileCount/8 | [0,1] |
| 9 | questCount/8 | [0,1] |
| 10 | activeQuestCount/8 | [0,1] |
| 11 | legalActions/16 (new max) | [0,1] |
| 12 | scene==FLIGHT | one-hot |
| 13 | scene==PLANET | one-hot |
| 14 | scene==STAR_MAP | one-hot |
| 15 | scene==STATION | one-hot |
| 16 | scene==EQUIPMENT_SHOP | one-hot |
| 17 | scene==BANK | one-hot |
| 18 | scene==TRADE | one-hot |
| 19 | scene==TEXT_QUEST | one-hot |
| 20 | scene==GAME_OVER | one-hot |
| 21 | warpInTransit | 0/1 |
| 22 | hasCraftCenter | 0/1 |
| 23 | hasBank | 0/1 |
| 24 | activeLoans | 0/1 |
| 25 | questDeliveryHere | 0/1 |
| 26 | overmindShare | [0,1] fraction of galaxy captured |
| 27 | nearOvermindCore | 0/1 |
| 28 | cheapestGearFraction (cheapestGearPrice/10000, clamped) | [0,1] or 0 if unknown |
| 29 | questsCompleted/20 | [0,1] clamped |

**New memory block** (`MEMORY_FEATURE_LENGTH = 20`):

| idx | feature | norm |
|-----|---------|------|
| 30 | bestMarginFraction | [0,1] |
| 31 | atBuyPlanet | 0/1 |
| 32 | profitIfSoldHere/10000 | [0,1] |
| 33 | gapFraction (credits needed/cheapest offer) | [0,1] |
| 34 | routeDangerToGoal/8 | [0,1] |
| 35 | goalProgress (credits/cheapest offer) | [0,1] |
| 36 | holdingForOtherSystem | 0/1 |
| 37 | loanBalance/100000 | [0,1] |
| 38 | debtPressure (missed payments/5) | [0,1] |
| 39 | deadlockDetected | 0/1 |
| 40 | visitedSystemFraction (visited/total reachable) | [0,1] |
| 41 | questDeliveryProgress (quests with known delivery/activeQuests) | [0,1] |
| 42 | nearestThreat/8 (hostile count in adjacent system) | [0,1] |
| 43 | cargoValue/50000 (estimated sell value of held cargo) | [0,1] |
| 44 | daysWithoutProgress/30 | [0,1] clamped (stagnation signal) |
| 45 | repRangerFraction (ranger rep / 100 + 0.5) | [0,1] |
| 46 | repPirateFraction (pirate rep / 100 + 0.5) | [0,1] |
| 47 | overmindDaysPressure (spread days/100) | [0,1] |
| 48 | equipQuality (loadout value / 50000) | [0,1] |
| 49 | (reserved, zero-padded) | 0 |

**`FEATURE_LENGTH = 30 + 20 = 50`**

- [x] Set `OBS_FEATURE_LENGTH = 30` in `NeuralPolicy.ts`; update `featurize()` with new 30-feature block (null-safe for every new field)
- [x] Set `MEMORY_FEATURE_LENGTH = 20` in `memoryFeatures.ts`; update `featurizeMemory()` with new 20-feature block
- [x] Add tracking state to `AgentMemory` needed for new features: `daysWithoutCreditGain`, `creditYesterday`, `overmindDaysSeen`; update `updateMemory()`
- [x] Update `weightsContract.test.ts`: assert `FEATURE_LENGTH === 50` and `ACTION_ORDER.length === 16`; temporarily mark `shippedWeights.test.ts` as skipped with `.todo` (weights will be invalid until Task 9)
- [x] Write `src/tests/playtest/letsplay/featurize.test.ts`: for each new feature slot, assert value is in `[0,1]`, never NaN, correct for a mock observation; assert total length === 50
- [x] Run `npm run test:playtest -- --run` — must pass (shippedWeights skipped is fine) before Task 6

**Implementation notes for Task 6+:** the plan's feature table needed 4 signals not yet on `Observation`/`PlayerSnapshot` — `gameDay` (galaxy.gameDays, so the pure `AgentMemory` fold can detect day-boundary transitions for `daysWithoutCreditGain`/`overmindDaysSeen` without an engine handle), `questsCompleted` (`questManager.getCompletedQuestIds().length`), and `reputationBastions`/`reputationSyndicate` (the game has no literal Ranger/Pirate faction — reused BASTIONS/SYNDICATE as the closest analogues, the same substitution Task 4's CJM-F already made for an identical reason). All four are optional additions to `observe.ts`/`PlayerSnapshot`, so every existing fixture across the suite kept compiling unchanged — a deliberate, minimal deviation from Task 5's stated file list, mirroring the precedent Tasks 2-4 set. `equipQuality`/`repRangerFraction`/`repPirateFraction` are computed from `AgentMemory` (new `lastMaxHull`/`lastReputationBastions`/`lastReputationSyndicate` fields, mirrored from `obs.player` every fold, same pattern as `loanState`) rather than reading `obs.player` directly inside `memoryFeatures` — reading `obs.player` there would have broken the existing `memoryFeatures.test.ts`/`featurize.test.ts` "a fresh notebook zeroes the whole memory block" contract, since the test's default player fixture has non-zero `maxHull`/`credits` regardless of memory state. `visitedSystemFraction`'s "total reachable" denominator uses a local `TOTAL_SYSTEMS_SCALE = 30` constant (mirrors `GAME_BALANCE.DEFAULT_SYSTEM_COUNT`) rather than a new cross-layer import, matching the existing `CREDIT_SCALE`/`DANGER_SCALE` local-constant pattern. `nearestThreat` is the worst danger remembered anywhere in the threat map (not literal graph adjacency — `Observation` doesn't expose neighbouring-system ids to the pure decide layer). Two existing width-pin assertions (`memoryFeatures.test.ts`'s "pins the concrete feature widths" test, hardcoding `16`/`7`/`23`) were deliberately updated to `30`/`20`/`50` — this is the exact, designated widening those literals' own comment calls out ("changing a width here is a deliberate act... so pin the numbers"), not a weakened behavioural assertion.

---

### Task 6: Parallel oddity-hunting sessions (run concurrently with Tasks 1–5)

Run the live autopilot and headless sessions, log any weirdness, file fixes as they're found.

**Files:** whatever the bugs touch (no pre-set list)

Known oddities from prior sessions to tackle first:
- Warp stall when `combatPause.paused=true` and `combatModule.isActive=true` — ship never reaches edge → infinite warpInTransit loop (partial fix in current PR; verify it handles the case where hostile NPCs in the destination system engage immediately on entry)
- Agent ping-ponging A→B→A across two connected systems (`lastSystemId` fix shipped; verify in live autopilot)
- `waitOneDay()` not advancing the calendar when a fight is active (now clears combat pause per tick; verify NPC kills are actually happening)

Oddity-hunt checklist:
- [x] Run `npm run letsplay -- --run` for 10 sessions, capture stderr to a file, scan for `<<CYCLE>>` patterns, DEADLOCK logs, error traces (ran `LETSPLAY_SESSIONS=10 npm run letsplay` at both the 40-step default and a 150-step stretch: zero errors, zero invariant violations, zero `DEADLOCK` logs, no `<<CYCLE>>` marker exists in the codebase to scan for. Also ran two additional 8-session × 200-step sweeps with the richer `MemoryHeuristicPolicy` under the `explorer` and `bounty-hunter` CJM goals — specifically to stress warp-heavy and combat-heavy play, since the default `HeuristicPolicy` never leaves the starting planet — to re-verify the three known-oddity fixes (warp stall on combat pause, A↔B ping-pong, `waitOneDay` freeze) under real multi-system/multi-fight play: 1600 consecutive `warp` decisions produced zero ping-pong patterns and days advanced to 22; the bounty-hunter run produced 1206 real `attack` decisions with no stalls)
- [x] Run live autopilot (`` ` `` in browser) for 5 minutes of real time; log any visual oddities via screenshots — skipped: this headless CLI environment has no browser/render loop to drive (see memory `browser-debugging-spacerangers`: screenshots fail against this project's render loop even when attempted); not automatable here, left for a manual dev-machine pass
- [x] Fix any newly discovered bugs (each gets its own commit with a failing regression test first) — found and fixed a real credit-drain bug in CJM-C `decideBountyHunter` (`MemoryHeuristicPolicy.ts`): it fired `sell-cargo` unconditionally on any `cargoUsed > 0`, including cargo the base sequencing had just bought at the *same* planet (a guaranteed loss, since a planet's `sell` is always below its `buy`) — a real-engine session drained 1000 → 34 credits over 200 steps with zero combat, defeating the CJM's purpose and starving future dataset generation of combat-labeled rows. Fixed by gating the trigger on `profitIfSoldHere(obs, mem) <= 0` only when a tracked lot exists for this planet; untracked/looted cargo (`buyPrice: 0`) still sells unconditionally. Regression tests added to `cjm.test.ts` (red before the fix, green after); re-verified in the real engine — the same scenario now produces 1206 real `attack` decisions and no pointless buy/sell cycling
- [x] Verify `npm run letsplay:ci -- --run` exits zero after fixes (confirmed both pre-fix baseline and post-fix: exit 0, 103/103 tests passed)
- [x] Document fixed oddities in `docs/architecture/LETSPLAY_ENGINE.md` → "Known Traps" section (new section added: the three previously-shipped fixes re-verified under this sweep, the new bounty-hunter fix, and the documented-not-a-bug shallow-`HeuristicPolicy` plateau)

---

### Task 7: Live oddity flagging (player → oracle feedback loop)

Let a human watching the live autopilot mark anomalies in real time so they become reproducible oracle cases.

**Files:**
- Modify: `src/tests/playtest/letsplay/AutopilotController.ts` (add `flag()` method + `Shift+F` hotkey)
- Modify: `src/dev/devAutopilot.ts` (expose `flag` on `window.__autopilot`)
- Create: `src/tests/playtest/letsplay/oddityFlags.ts` (pure flag store: write/read localStorage + export)
- Modify: `src/tests/oddities/oddityFlags.test.ts` (gate: flagged oddities from last session are surfaced in CI output)

**How it works:**

During live autopilot, the player spots something weird and calls `window.__autopilot.flag("описание")` in the browser console (or presses `Shift+F` for a silent flag). Each flag records:
```ts
{ timestamp, step, scene, obs: Observation, lastAction: Action, note?: string }
```
persisted to `localStorage("autopilot_oddity_flags")` as a JSON array (capped at 100 entries, rolling).

`window.__autopilot.exportFlags()` returns the array as JSON (copy-paste into a file for analysis).

Long-term: the captured `(obs, action)` pairs with an "oddity" label enter the training dataset as negative examples — the teacher should NOT repeat what the agent did there.

- [x] Create `oddityFlags.ts`: pure `flagOddity(obs, step, note?)` (appends to localStorage, max 100 rolling), `readFlags()`, `clearFlags()`, `exportFlags(): string` (JSON serialized). Storage-guarded (no-op when localStorage unavailable).
- [x] Add `flag(note?: string)` method to `AutopilotController`: calls `flagOddity(lastObs, currentStep, note)` where `lastObs`/`currentStep` are already tracked by the controller loop
- [x] Exclude `Shift+F` from the reclaim-on-input source: extend `defaultInputSource` in `AutopilotController.ts` to accept an optional `ignoreKey?: (e: KeyboardEvent) => boolean` predicate; pass `(e) => e.shiftKey && e.key === 'F'` from `installAutopilotHook` so flagging never stops the autopilot
- [x] Wire `Shift+F` hotkey in `installAutopilotHook` (inside the DEV-gated `keydown` listener that also handles Backquote toggle): when autopilot is active + `event.shiftKey && event.key === 'F'`, call `controller.flag()` and briefly flash the «● АВТОПИЛОТ» pill text to «⚑ ОТМЕЧЕНО» for 1 s (visual confirmation)
- [x] Expose on `window.__autopilot`: `flag(note?: string)` and `exportFlags(): string`
- [x] Create `src/tests/oddities/oddityFlags.test.ts`: reads `localStorage("autopilot_oddity_flags")` at the start of the CI oracle run and prints each entry as a `console.warn("[ODDITY FLAG] step=N scene=X note=Y")` line — surfaced in CI output so they're not silently dropped. The test always passes (informational only); a non-zero flag count is a signal to investigate, not a gate failure.
- [x] Write unit tests in `src/tests/playtest/letsplay/oddityFlagsStore.test.ts`: `flagOddity` appends correctly; cap at 100 rolls the oldest; `clearFlags` empties; export round-trips; storage-unavailable degrades gracefully
- [x] Run `npm run test:playtest -- --run` — must pass before Task 8

**Implementation notes for Task 8+:** `flagOddity`'s real signature is `(obs, step, lastAction, note?, store?)` — the plan's illustrative 3-arg form omitted `lastAction`, but the entry contract two paragraphs up explicitly requires it, and `AutopilotController` already tracks a `lastAction` field alongside `lastObs`/`step` (added this task, reset in `start()`, updated every `tickOnce()`) — so `flag()` passes it straight through. `window.__autopilot.flag`/`exportFlags` are exposed from `installAutopilotHook.ts` (which already owns `AutopilotWindowHook`/`window.__autopilot`), not `src/dev/devAutopilot.ts` — that file only lazy-loads and calls `installAutopilotHook(engine)`, it has never touched the window hook shape itself, so there was nothing there to change. `flagOddity`'s own store write is wrapped in its own try/catch (storage-guarded like `keymap.ts`), so a blocked/full store never throws out to `AutopilotController.flag()`'s defensive `guard()` wrapper — covered by both `oddityFlagsStore.test.ts` (module-level) and a same-scenario `AutopilotController.test.ts` case (integration-level, asserting `onError` correctly does *not* fire since the failure is fully absorbed one layer down).

---

### Task 8: Scale training pipeline for RTX 4090

Update `tools/ai/train_player.py` to support N-layer nets, mini-batches, validation, dropout, and GPU.

**Files:**
- Modify: `tools/ai/train_player.py`
- Modify: `tools/ai/README.md`

Architecture for RTX 4090: **50 → 256 → 128 → 16** (≈ 51,328 parameters)
- Layer 0: Linear(50, 256) + ReLU + Dropout(0.15)
- Layer 1: Linear(256, 128) + ReLU + Dropout(0.15)
- Layer 2: Linear(128, 16) — output logits

Training config:
- `--hidden 256 128` (list, N layers)
- `--epochs 500` with early stopping (patience=30 on val loss)
- `--batch 512`
- `--dropout 0.15`
- `--lr 3e-4` (Adam with cosine annealing)
- `--val-split 0.2`
- `--device cuda` (auto-detect: cuda → mps → cpu)
- `--num-workers 0` (dataset fits in RAM)

Export format stays identical (`{"layers": [...]}` — only `nn.Linear` layers, no dropout in export).

- [ ] Refactor `build_model()` to accept `hidden: list[int]` (e.g. `[256, 128]`) and `dropout: float`; build `nn.Sequential` dynamically with N hidden layers + dropout
- [ ] Add mini-batch DataLoader with `batch_size` arg; switch from full-batch Adam to mini-batch
- [ ] Add 80/20 val split; track val loss; implement early stopping with patience param
- [ ] Add cosine annealing LR scheduler
- [ ] Add `--device cuda|mps|cpu` arg with auto-detection fallback
- [ ] Export: iterate only `nn.Linear` layers; skip `nn.ReLU`, `nn.Dropout` (they are implicit in `mlp.ts`)
- [ ] Update `NUM_ACTIONS = 16` and `in_dim` read from first data row (not hardcoded)
- [ ] Write a smoke test in `tools/ai/test_train.sh` that generates 200 random training rows and runs 3 epochs to verify the pipeline doesn't crash
- [ ] Update `tools/ai/README.md` with new CLI, architecture, and SSH training instructions for 4090

---

### Task 9: Generate comprehensive dataset (200 sessions × 500 steps)

Run `exportBcData.ts` with the expanded teacher across all CJM scenarios.

**Files:**
- Modify: `src/tests/playtest/letsplay/exportBcData.ts`
- Create: `tools/ai/dataset/` (gitignored — large JSONL)

Dataset strategy:
- **Teacher**: `MemoryHeuristicPolicy` (belief-aware, full CJM repertoire from Task 4)
- **Scenario mix** (stratified, ~100K rows total):
  - 30 sessions × `"trade-magnate"` (trading + banking CJM)
  - 30 sessions × `"gear-grinder"` (equipment + hull upgrade CJM)
  - 30 sessions × `"bounty-hunter"` (combat + loot CJM)
  - 20 sessions × `"quest-runner"` (quest delivery CJM)
  - 20 sessions × `"overmind-slayer"` (Overmind engagement)
  - 20 sessions × `"pirate"` (attack traders)
  - 20 sessions × `"explorer"` (unvisited system preference)
  - 30 sessions × base `MemoryHeuristicPolicy` (no goal bias — general play)
- **Steps per session**: 500
- **Seeds**: deterministic range 0..N so the dataset is reproducible

- [ ] Update `exportBcData.ts` to accept `scenarioMix: Array<{goal: ScenarioGoal | null, sessions: number, steps: number}>` so each batch can be generated and appended to a single JSONL
- [ ] Add `--output tools/ai/dataset/train.jsonl` flag; create `tools/ai/dataset/.gitignore`
- [ ] Run `npx tsx src/tests/playtest/letsplay/exportBcData.ts` (locally on M1 or 4090) — generates `train.jsonl` (~100K rows × 50 features = ~15 MB)
- [ ] Validate dataset: assert every row has `features.length === 50` and `action` in `[0, 15]`; compute action distribution histogram to verify all 16 actions appear (not dead heads)
- [ ] Add `tools/ai/dataset/validate_dataset.py` script that prints action distribution and feature stats (mean, std, min, max per column) — catch constant/NaN features early
- [ ] Document dataset generation command in `tools/ai/README.md`

---

### Task 10: Train on RTX 4090 and export weights

Run training remotely, validate parity, ship the weights JSON.

**Files:**
- Create: `src/tests/playtest/letsplay/weights/player.weights.json` (replace existing)
- Modify: `src/tests/playtest/letsplay/shippedWeights.test.ts` (re-enable, update FEATURE_LENGTH assertion)

Training commands (run on `oleg@192.168.88.193`):
```bash
scp tools/ai/train_player.py oleg@192.168.88.193:/tmp/
scp tools/ai/dataset/train.jsonl oleg@192.168.88.193:/tmp/
ssh oleg@192.168.88.193 "cd /tmp && python train_player.py \
  --data train.jsonl \
  --hidden 256 128 \
  --dropout 0.15 \
  --epochs 500 \
  --batch 512 \
  --lr 3e-4 \
  --val-split 0.2 \
  --device cuda \
  --out player.weights.json"
scp oleg@192.168.88.193:/tmp/player.weights.json \
  src/tests/playtest/letsplay/weights/player.weights.json
```

Expected training time: < 60 seconds on RTX 4090 for 100K rows × 500 epochs. Target: val accuracy > 80% (with 16 actions and ambiguous states, perfect accuracy is impossible).

- [ ] SCP `train_player.py` and `train.jsonl` to `oleg@192.168.88.193`
- [ ] Run training with the command above; capture stdout to `tools/ai/dataset/training_log.txt`
- [ ] Verify training converges (val accuracy climbing, no NaN loss); if not, reduce LR or check dataset
- [ ] SCP the output `player.weights.json` into `src/tests/playtest/letsplay/weights/`
- [ ] Re-enable `shippedWeights.test.ts`: update `FEATURE_LENGTH` assertion to `50`, `NUM_ACTIONS` to `16`
- [ ] Run `npm run test:playtest -- --run` — `weightsContract.test.ts` and `shippedWeights.test.ts` must both pass
- [ ] Run live autopilot in browser (`` ` ``) and record 2-minute GIF of the neural agent playing; verify it exhibits multiple distinct behaviors (not just warping in circles)

---

### Task 11: Verify acceptance criteria and update docs

- [ ] Run `npm run test:playtest -- --run` — all 34+ tests green, zero skipped
- [ ] Run `npm run letsplay:ci -- --run` — CI oracle exits zero
- [ ] Run `npm run test:save-compat -- --run` — golden saves intact (no schema touched)
- [ ] Run `npm test -- --run` — full unit suite green
- [ ] Verify `npm run lint` — zero errors
- [ ] Update `docs/architecture/LETSPLAY_ENGINE.md`: feature table (50 features), architecture diagram (50→256→128→16), new ACTION_ORDER, CJM scenario list, training command for 4090
- [ ] Update `src/tests/playtest/letsplay/weights/README.md` (create if absent): document FEATURE_LENGTH=50, NUM_ACTIONS=16, training config, val accuracy achieved

## Technical Details

### Action vocabulary design principle
Each action is at the "intent" level, not the "click" level. The applier is responsible for multi-step execution (navigate → open scene → transact → return). This keeps the policy output simple while allowing complex behavior.

### Feature vector design principle
Every feature is in `[0,1]` (binary flags or linearly-normalized scalars). No feature should be constant across all states (would become dead weight). The `daysWithoutProgress` signal is the key stagnation detector — it feeds directly into the deadlock detector and helps the net learn to break loops.

### CJM interaction
CJMs are not mutually exclusive in execution — the teacher selects a scenario at session start (`ScenarioConfig`), and the `MemoryCjmPolicy` biases its decisions throughout. The net is trained on labeled `(feature_vector, action_index)` pairs from all CJM sessions mixed together, so the net learns to infer the appropriate behavior from the feature state (not from a one-hot goal input). Goal conditioning is deliberately NOT part of the net's input — the features themselves carry enough state for the right action to be determinable (e.g., high `overmindShare` → prefer Overmind-combat actions; large `loanBalance` → prefer repay; etc.).

### MLP multi-layer support in mlp.ts
`mlp.ts` already handles variable-depth via the `layers` array. The forward pass applies ReLU after every layer except the last. No change needed for a 3-layer net. `NeuralPolicy.load()` validates only the first (input width) and last (output count) layers — intermediate layer validation (hidden dimension consistency) should be added.

### RTX 4090 SSH workflow
Training happens on `oleg@192.168.88.193` (the game's ComfyUI host, RTX 4090). SCP the script + dataset over, run headless with `nohup ... &`, verify via `/proc/<pid>/status` or `nvidia-smi`. Dataset fits easily in 24 GB VRAM. No shared GPU concerns since it's the private host.

## Post-Completion

**Manual validation**: run 10 autopilot sessions with the neural policy enabled (settings panel → НЕЙРОСЕТЬ ВКЛ), record typical session length (should be longer than heuristic baseline), observe whether the agent visits the bank, equipment shop, or combat Overmind systems at all.

**Training iteration**: if val accuracy < 75%, investigate: (a) check action distribution histogram for class imbalance → add weighted loss, (b) check feature stats for dead/saturated columns → re-normalize, (c) extend dataset to 300 sessions, (d) increase `--hidden 512 256 128`.

**Architecture docs stale after this plan**: `LETSPLAY_ENGINE.md` says `FEATURE_LENGTH = 18 = 12+6` (written at v1 of the system) — this plan is the authoritative correction.
