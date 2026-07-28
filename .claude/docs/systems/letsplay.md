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

**Resume-on-reload** (`docs/plans/20260713-autosave-autopilot-resume.md`): engagement now survives a reload/«Продолжить». Every scene-transition autosave records `SaveState.autopilotEngaged` (additive-optional boolean, no migration) via the `IAutopilotStateProvider` port (`src/core/ports/`, no-op default in `src/core/adapters/` — `GameEngine` never imports the letsplay tree). On load the DEV wiring re-engages: `loadGame` stashes the flag into `getLoadedAutopilotEngaged()`, and `attachDevAutopilot` — after installing the hook — injects the real provider (`setAutopilotStateProvider`) plus reads the boot-catch-up getter once and `start()`s if it was `true`. The boot auto-load runs *before* the hook exists (asymmetric with `continueGame`, where it already does), so both seams are needed. Silent resume — the existing `● АВТОПИЛОТ` HUD pill makes it discoverable, no separate notice. Proven end-to-end by `src/tests/playtest/autopilotResumeOnLoad.test.ts`.

**Reclaim-on-input is a real DOM listener, not a semantic "player acted" check** (`docs/plans/20260711-autopilot-reliability-fixes.md` Task 1): `makeDefaultInputSource` (`AutopilotController.ts:122-158`) attaches `pointerdown`/`keydown`/`wheel`/`touchstart` on `window` with no target filtering — any bubbled event disengages. A handled mouse-wheel zoom gesture is not player intent to reclaim, so `SpaceFlightScene.onWheel`/`StarMapScene.handleWheel` register with `{capture: true}` and call `stopImmediatePropagation()` on the handled-zoom path (order-independent across scene recreation on warp, unlike a bubble-phase `stopPropagation()` — both handlers share the same `window` node as the autopilot's listener, so bubble-phase suppression can't reach a sibling). `installAutopilotHook.ts`'s `tick()` also now mirrors `hud.closeModals()` (quest journal + accessibility panel) and `planetManager.closeInfoPanel()` alongside the pre-existing `npcManager.closeModals()`, so the autopilot doesn't idle silently behind an open panel.

**A manually-opened panel gets one grace tick before auto-dismiss** (`docs/plans/20260712-autopilot-live-tick-symptoms.md` Task 2): the unconditional close above raced a human who had just opened the quest journal / settings / planet-info panel — confirmed via a real-engine probe (`liveTickSymptomsProbe.test.ts`) to close on the very next tick with zero survival. `tick()` now tracks a controller-wide `tickCount` plus a per-panel grace flag (`questJournalGraceGiven`/`settingsPanelGraceGiven`/`planetInfoGraceGiven`) — a panel already open on the controller's very first-ever tick call closes immediately (the stale-leftover case this code exists for), but a panel that opens on a later tick survives that tick once before the idle-dismiss kicks in. (A "checked-before" per-panel variant was tried first but broke the probe's own regression tests — the help-panel flush consumes the controller's real first tick in every real session, so gating on "first time this specific check is reached" wrongly treated a human's fresh panel-open as stale; `tickCount` alone is deliberately correct here.) A fourth grace-gated surface, the in-flight system menu (`[МЕНЮ]`), was added by `docs/plans/20260727-autopilot-ui-parity-fixes.md` Task 1 — `tick()` now also mirrors `hud.isSystemModalOpen()` with a `systemMenuGraceGiven` flag and closes it via `hud.closeSystemMenu()` (a separate registry the bulk `closeModals()` never touches). This closes a real live-stall gap: the real engine's `SpaceFlightScene.isBlockingModalOpen()` treats the system menu as blocking, so an open menu would otherwise leave the live autopilot idling behind it forever. The quest journal and settings/accessibility panel are independently openable (neither toggle closes the other) but share one bulk `hud.closeModals()` call site with no per-panel granularity — `tick()` only actually invokes it once **both** panels' own due-to-close checks agree, deferring (and granting grace to whichever hasn't had it yet) if either is still mid-grace, so a fresh settings-panel open can't get destroyed as collateral damage of the journal's own overdue close (or vice versa). **Caveat: reachability via genuine mouse/keyboard input is unconfirmed** — the probe drives the panel-open calls directly (`hud.toggleQuestJournal()`/`planetManager.handlePlanetClick()`), not through real DOM dispatch, and (unlike the wheel-zoom fix above) none of the three panel-open input paths call `stopPropagation()`/`stopImmediatePropagation()` against the reclaim-on-input listener — so the same native event that opens one of these panels may also disengage the autopilot in that same synchronous dispatch, before any later `tick()` could ever race it. Task 1 of the same plan ruled out three other reported symptoms as not headlessly reproducible/not this module's bug: `land()`'s sprite-lookup fallback teleport (sprites are always populated synchronously by scene init, so the fallback branch was never taken), `takeQuest()` never firing (the executor works correctly — it's a decision-policy frequency effect, not a wiring bug), and warp-looping (inconclusive — no tight ping-pong reproduced, deferred to live-browser confirmation).

**Flee-jump entry vector derives from the real exit point, not the stale plan-time vector** (same plan, Task 2): a genuine flee's exit point (`warpEdgePoint(..., fromMidSystem: true)`) is the boundary point nearest the ship, deliberately not toward the target. `SpaceFlightScene.performWarp()` used to mirror the *original straight-line* `exitVector` for the destination `entryVector` regardless — now `departureVectorFromExitPoint` (`flight/warpHeading.ts`) derives it from the actual captured exit point (`pendingWarpExitPoint`, set by `planWarpEdgeRoute` in `utils/flightGeometry.ts` when the route is planned), falling back to the straight-line vector only when no exit point was captured. Routine (non-flee) jumps are mathematically unchanged — their exit point already equals the straight-line direction.

The live controller (`createLiveSceneController`) routes:
- `land(planetId?)` — resolves to habitable planet only (never uninhabited fallback); refuels to max on landing
- `dock(stationId?)` — docks at a station; **refuels to max** on dock (mirrors `onLandOnPlanet`; see Task 7)
- `warp(systemId?)` — honors an explicit `action.targetId` (policy's `pickWarpNeighbor` chooses an unvisited non-Overmind neighbor), falls back to `pickWarpTarget`; anti-ping-pong via `visitedSystemIds`
- `tick()` — runs `dismissBlockingModal()` (which now *resolves* blocking modals, not just closes them: an exploration-encounter prompt via `applyEncounterChoice("engage")`; the PlanetScene customs modal via `applyCustomsChoice` — bribe when affordable, else dump; the **OVERMIND-core boss prompt** and **pirate-shakedown hail** now take real decisions — see below; other contact-panel overlays still `closeModals()`) + drives pendingWarp route
- `attack(targetId?)` / `flee()` — delegate to `NpcShipManager.e2eEngageCombat`/`breakOffCombatPursuit`

**Headless `attack` is active, not passive** (garrison-growth plan Task 4):
`PlayerAgent.driveAttack` invokes the real «Атаковать» handler
(`NpcShipManager.onAttackNpc` — engage in weapon range, else intercept +
auto-follow), un-pauses each 50 ms tick, and ends the step after one completed
combat round (the policy's reaction window). An already-engaged fight is
*driven*, never re-targeted. `flee`/`repair` remain degraded ticks.

**Combat now drives the full variant range, not just fire-and-close**
(`docs/plans/20260719-autopilot-combat-coverage-and-campaign-pacing.md` Task 7):
`ConfirmPlanningOptions` (`planningDriver.ts`) gained optional
`afterburner`/`consumableId`/`commsAction`/`weaponClassAwareTargeting` fields —
all default-off, so every pre-existing caller keeps byte-for-byte behavior (locked
by a dedicated regression test). `PlayerAgent.driveAttack` builds these once per
kill-decision via a **one-shot** `buildCombatOptions()` closure (flags set once per
`driveAttack` call, never recomputed per round — recomputing broke Task 5's
loot-linger by re-offering surrender every tick): afterburner while still closing
on a fresh target, a shield-cell consumable below 30% hull, and a demand-surrender
comms action below 30% hull as a last-ditch move — all reusing
`MemoryHeuristicPolicy`'s existing hull-fraction signals, no new threat arithmetic.
Missile-class weapons route to the farthest combatant when ≥2 hostiles are present;
single-hostile fights are unaffected. Tests: `planningDriver.test.ts` (13 cases,
incl. the untouched-by-default lock) + real-engine wiring in
`playtest/letsplay/combat.test.ts`.

**Planet quest-taking opens the real scene UI, not just a domain call**
(same plan, Task 8): `takeQuest()` (`installAutopilotHook.ts`) now drives
open→accept-each→close through `PlanetScene`'s dev-only
`e2eOpenJobBoard`/`e2eAcceptBoardQuest`/`e2eCloseJobBoard` seams when the scene
supports them (mirroring the `e2eTakeOff` convention), falling back to the direct
`acceptBoardQuests` domain call unchanged for headless/test doubles — selection
logic stays in one place (`engineQueries.ts` gained an optional visual-accept
callback), never duplicated into production code. `openTrade()` was originally
**left as a domain-only bypass** here, but that gap is now closed — see the
UI-parity section below. "Info-bureau browsing"
does not exist as an autopilot action and was dropped from scope.

**Autopilot UI-parity fixes** (`docs/plans/20260727-autopilot-ui-parity-fixes.md`):
a follow-up audit found four surfaces where the live/headless autopilot did not
see or resolve the same modals a real player does. All four are now closed:

1. **System-menu blocking-modal gap** (Task 1) — described in the grace-tick
   block above.
2. **OVERMIND-core boss prompt** (Task 2) — `dismissBlockingModal()` now checks
   `scene.npcManager.isOvermindPromptOpen` (a new additive `NpcShipManager`
   getter forwarding `OvermindBossController.isOpen`) **before** the generic
   `hasOpenModal()` branch, and decides «Атаковать ядро» vs «Отступить» by
   reusing `MemoryHeuristicPolicy`'s existing `isBattleReady` + hull-fraction
   signals: battle-ready **and** healthy hull → `spawnOvermindCoreCombatant()`
   (the real win-condition fight); otherwise falls through to the safe-default
   `closeModals()` retreat. Previously the generic branch always retreated.
3. **Pirate-shakedown hail** (Task 3) — `ContactPanelManager` gained a public
   `context` getter and `NpcShipManager` a public `openContactNpc`
   (`{npc, context}`) getter, so `dismissBlockingModal()` can tell a
   `"pirate-shakedown"` hail apart from a regular contact panel. It now calls
   the real `onAttackNpc` (healthy/battle-ready) / `onFleeShakedown`
   (fast/damaged) / `onPayTribute` (affordable) handlers, falling back to the
   pre-existing `closeModals()` + `e2eStartTurn()` re-arm only when none apply.
   Previously the generic branch always declined (closed) the panel.
4. **Trade now drives the real `TradeScene`** (Task 4) — the live
   `executeTrade()` seam (formerly a `"No live market executor yet"` no-op) is
   implemented: when the scene exposes `e2eBuyItem`/`e2eSellItem` (a new
   `e2eSellItem` mirrors the existing `e2eBuyItem`) it drives the real buy/sell
   through the opened scene via a shared `runLiveTrade` helper, then leaves back
   to `SPACE_FLIGHT` (mirroring the headless applier's `goTo(...)`-after-trade)
   — leaving the market after each trade is what breaks the land↔trade spin that
   originally forced the domain-only bypass.

**Live-head parity:** the seven previously no-op economy heads in
`installAutopilotHook.ts` (`repair`, `buy-gear`, `upgrade-hull`, `buy-module`,
`take-loan`, `repay-loan`, `sell-cargo`) are wired to the same headless executors
(`engineQueries.ts`), so the watched autopilot repairs/upgrades/trades exactly as
the headless runner does. Buy-price accounting recovers the real market price via
`AgentMemory.lastCurrentPlanetId` (the trade returns to SPACE_FLIGHT before
`updateMemory` sees the landed `currentPlanet`).

Since `docs/plans/20260727-autopilot-ui-parity-fixes.md` (Tasks 5–6) these heads
also drive the **real scene UI** when it's present, not just the domain seam:
- **Hangar actions** (`repair`/`buy-gear`/`upgrade-hull`/`buy-module`) route
  through the shared `runInHangarPanel(engine, mutate)` helper (`engineQueries.ts`),
  which opens the real `HangarPanel` via `StationScene.e2eOpenHangar()`, performs
  the mutation, and closes it via the sibling `e2eCloseHangar()` — the refit
  decision + credit move stay in the letsplay layer (single source of truth); the
  seam only makes open→mutate→close watchable, and only wraps a genuine mutation so
  a no-op never flickers the panel. Falls back to the direct domain call for
  headless doubles that don't expose the seam.
- **Bank actions** (`take-loan`/`repay-loan`) drive the real `BankScene` via
  `e2eTakeLoan()`/`e2eRepayLoan()` (the latter added as the sibling seam, one
  `REPAY_STEP` per press through the real `doRepay()` handler) when available,
  falling back to the direct `takeLoan`/`repayLoan` bank-bus calls otherwise.

Regression coverage: `autopilotTradeExecutor.test.ts`, `hangarPanelSeam.test.ts`
(8 cases), `bankSceneSeam.test.ts` (7 cases) — each locks both the real-seam path
and the unchanged domain-only fallback.

**Warp targeting:** `Observation.system.neighbors` is
`{systemId, visited, overmindHeld}[]` (from real `StarSystem.explored` +
`Galaxy.isOvermindSystem`). `pickWarpNeighbor` scores each (lower wins) weighing
`overmindHeld` (4), `visitedSystemIds`/`threatMap` (3 each), `previousSystemId`
(2), and the raw `visited` flag (1) — not featurized (net width frozen at 50).

## Adding CJM behaviors

CJM teacher behaviors live in `MemoryHeuristicPolicy.ts`. Key methods: `decide(obs, memory)` → routes through `decideExplorer`/`decideTrader`/`decideSurvivor`/`decidePirate`/etc. Each CJM branch calls `cjmAction(branch, kind, reason, targetId?)`. The BC dataset is generated by `exportBcData.ts` and trained by `tools/ai/train_player.py`.
