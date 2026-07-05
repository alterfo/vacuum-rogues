# Autopilot Overmind-slayer — drive the win rate up from 0%

## Overview

The dev autopilot (`MemoryHeuristicPolicy`) currently **never** defeats the
Overmind. Measured baseline (50 sessions × 200 steps, headless real engine):
**0/50 won, avg final Overmind share 0.56, 100% of games have an Overmind
presence.** The autopilot *avoids* the front (threat tier warps away from it) and
has no way to push it back, so the Overmind grows unopposed.

**The ask:** make the autopilot actually WIN the Overmind arc — as often as
possible. The user framed it as "100% of the time"; that exact guarantee is not
honestly achievable (combat RNG, seed variance, a race against the spread — some
seeds start the front too far along to catch), so the real goal of this plan is
**maximise the win rate, measured over 1000 runs, and report the achieved number
honestly** — not to claim 100%.

## Win condition (verified in code)

- The arc is **won** ("eradicated") in `overmindSpread.ts:186-190` when
  `engaged && overmindSet.size === 0 && peakThreat > 0` — i.e. **every**
  Overmind-held system has been liberated after genuine engagement. `EndgameController.showGameOutcomeScreen(true)` flips the sticky `won` status.
- A system is **liberated** the moment its hostile garrison is cleared:
  `canPlayerLiberate(view, systemId)` (`src/systems/galaxy/liberation.ts:58`) =
  `isHostileSystem(systemId) && hostileShipsPresent(npcShips, systemId) === 0`.
  The player drives it via `GameEngine.liberateCurrentSystem()` →
  `galaxy.tryLiberate(systemId)` (`GameEngine.ts:767`). There is ALSO autonomous
  NPC-convoy liberation, so the player doesn't have to clear literally every
  system alone — but with the current avoidant autopilot the net result is still
  a growing front (0% wins).

## The core conflict to resolve

The combat fix already on this branch makes the agent **flee** any hostile whose
`hullHP` exceeds the player's current hull (`flee-outmatched` in
`MemoryHeuristicPolicy.ts`) — and Overmind capture-fleet / garrison ships are
exactly those over-HP'd enemies. **To win, the agent must FIGHT and clear those
garrisons**, which it currently flees. So winning requires an economy→military
progression first (earn credits → upgrade hull/weapons/buy gear → become
battle-ready), and a slayer tier that overrides the flee-from-strong reaction
ONLY when the agent is genuinely battle-ready AND on a deliberate liberation
mission. When NOT battle-ready, the existing flee behaviour must stay (don't
regress the 0%-death combat fix).

## Observation surface already available

`observe.ts` exposes `overmindShare`, `nearOvermindCore`, per-system
`overmindHeld` (`Galaxy.isOvermindSystem`), and `galaxy.overmindSystems`. The
warp graph is UNDIRECTED (use `reachableNeighbors`/`systemHopDistances` in
`engineQueries.ts`, already used for quest routing). Frontier = systems adjacent
to an Overmind system (`frontierSystems` in `overmindSpread.ts`).

## Measurement gate (diagnostic harness)

`src/tests/playtest/letsplay/_autopilotDiag.run.test.ts` (TEMP, inert unless
`DIAG_SESSIONS` set) already reports an **Overmind outcome** block: WON (share
driven to 0), galaxy-fell, avg final share. Run the win-rate gate with LONG
sessions so the arc actually resolves:
`DIAG_SESSIONS=1000 DIAG_STEPS=300 npx vitest --run …_autopilotDiag.run.test.ts`.
(60-step sessions never resolve the arc — ~11 game-days pass, the front barely
moves. Budget 250–300 steps.) Delete this harness in the final task.

## Success criteria

- Overmind win rate over **1000 sessions × ~300 steps** driven as high as it will
  go; record the achieved % (and the before=0% baseline) in the final task. State
  the honest ceiling — do NOT weaken the metric to fake 100%.
- **No regression** of the landed fixes: 0% deaths, the `flee-outmatched` combat
  reaction still fires when NOT battle-ready, trading still nets positive, quests
  still complete, Overmind loss threshold stays 0.85.
- `npm run test:playtest`, `letsplay:ci`, `save-compat`, lint, tsc all green.

## What Goes Where (legend)

- Action vocab + legality → `observe.ts` (`PlayerActionKind`, `legalActionsForScene`)
- Policy ladder / slayer tier → `MemoryHeuristicPolicy.ts`
- Headless executor → `PlayerAgent.ts`; live executor → `installAutopilotHook.ts` / `LiveApplier.ts`
- Liberation seam → `GameEngine.liberateCurrentSystem`, `galaxy/liberation.ts`
- Balance (spread/garrison strength) → `src/config/balance.ts`

---

### Task 0 (PREREQUISITE): kill the land↔take-off churn

The user sees the live autopilot repeatedly land and immediately take off
("сел-взлетел"). Reproduced headlessly: **98% of sessions have ≥3 land/take-off
cycles, avg ~11/session** (`_autopilotDiag.run.test.ts` reports it). The slayer
needs clean navigation anyway, so fix this first.

**Precise root cause (already diagnosed — do NOT re-derive from scratch):** in
`MemoryHeuristicPolicy.ts` the SPACE_FLIGHT `land "earn"` candidate is
UNCONDITIONAL and ranked ABOVE the `explore` warp, so in an already-explored
system (nothing to buy/sell, no quests) the agent re-lands each planet instead
of warping onward. BUT `earn`-land is **load-bearing** and cannot simply be
demoted:
1. It is the **refuel path** (landing tops the tank).
2. It is the **break-out from a rejected warp**: the ladder's `fuelGate` is a
   *fraction* check (`REFUEL_THRESHOLD` 0.2), while the engine gates a jump on
   the *absolute* per-jump fuel cost (`StarMapScene.performWarpJump`). A tank
   that passes the fraction gate can still be rejected on absolute cost → the
   warp silently no-ops and the agent returns to SPACE_FLIGHT unchanged. Only
   `earn`-land (refuel) breaks that loop.

**Two blind attempts already failed** (reverted): demoting `earn`-land below the
`explore` warp — with or without an unconditional fallback — re-triggered a
`SPACE_FLIGHT|warp:explore` ×192 stall on the `competentSession` seed
(`LETSPLAY_HOLISTIC3`): warp keeps getting fuel-rejected while `earn`-land is
demoted, so it can't refuel. `competentSession`'s `longestStreak < 20` soft-lock
guard catches it, and its DELIVERY-quest completion also regressed.

**The clean fix (do this carefully, testing `competentSession` at each step):**
add a **warp-reject counter** to `AgentMemory` (mirror `starMapStallFolds`):
count consecutive SPACE_FLIGHT folds where the agent tried to leave but the
system id is unchanged (a rejected/failed warp), reset on system change or
landing. Then rank `explore` warp ABOVE `earn`-land, and fall back to
`earn`-land (refuel) ONLY once the warp-reject counter trips — so warp wins in a
genuinely explored, fuel-OK system (no churn), while a fuel-rejected warp still
routes to a refuel landing (no stall). Distinguishing "warp will succeed" from
"warp was rejected" is the crux — the pure ladder can't see it without this
counter.

- [x] Add the warp-reject counter to `AgentMemory`/`updateMemory` + reset logic.
      `AgentMemory.warpRejectFolds`: increments on a SPACE_FLIGHT fold that
      arrives straight from STAR_MAP with the system unchanged (a rejected/
      failed warp or a deliberate non-warp `back`); resets to 0 on landing or
      a genuine system change. Verified via instrumentation that it correctly
      tracks real rejected round-trips (climbed into double digits during a
      sustained `avoidDanger` STAR_MAP↔SPACE_FLIGHT dance) without ever
      resetting falsely.
- [x] Re-rank so `explore` warp beats `earn`-land except when the counter trips.
      Added `MAX_WARP_REJECT_FOLDS = 1` and gated the `early-explore` warp
      push on `mem.warpRejectFolds < MAX_WARP_REJECT_FOLDS`; `earn`-land stays
      the unconditional fallback below it. Verified by instrumentation: 114/114
      `early-explore` picks had `warpRejectTripped:false`, 0 had it `true` —
      the two tiers never invert.
- [x] `DISCOVERY_LANDINGS_PER_SYSTEM` (already added, =2) caps discovery landings
      — kept as-is (no tuning needed).

      **Gate result (honest accounting):** `DIAG_SESSIONS=50 DIAG_STEPS=60`
      (and again at `DIAG_STEPS=150`): avg `landTakeoffCycles` 11.38 → 10.68
      (~6%), still ≥3 cycles in 96% of sessions — nowhere near the ≤4 target.
      Root-caused with instrumentation (removed before commit): of the "earn"
      picks with `alreadyVisited:true` (the exact churn this task targets),
      0% had `warpRejectTripped:true` — the diagnosed fuel-rejection stall is
      real (confirmed it fires and correctly reorders explore-vs-earn when it
      does) but empirically rare at these budgets; ~85% of those cases instead
      had `explorationSafe:false` because `warpCadenceOk` had tripped
      (`MAX_CONSECUTIVE_WARPS_WITHOUT_LAND = 2`, a separate, pre-existing,
      deliberate anti-blind-warp heuristic, not part of this task's diagnosed
      root cause and not touched here). The rest of the `landTakeoffCycles`
      metric is inflated by legitimate multi-trade stays (PLANET↔TRADE bounces
      within a single landing) and first-visit discovery landings, neither of
      which is the "сел-взлетел" bug. Added a `pureMoveReland` /
      `earnLandActions` breakdown to the diagnostic to make this visible; it
      reads 0.00 pure-move re-lands in both before/after runs, i.e. the
      diagnostic's blanket metric was never actually isolating this task's
      specific symptom. The prescribed fix is implemented and verified correct
      against its diagnosed root cause; hitting ≤4 on the raw metric needs
      touching the cadence cap and/or the trade-bounce counting, which is
      out of this task's scope — flagging for the user rather than silently
      re-deriving a different root cause or tuning unrelated constants.
      No regression: `competentSession`, `letsplay:ci` (105 passed),
      `test:playtest` (534 passed), full unit suite (4466 passed), lint, tsc
      all green.

### Task 1: `liberate` action + engine seam
- [x] Add a `liberate` verb to the action vocab (`observe.ts` `PlayerActionKind`)
      and make it legal only where `canPlayerLiberate(engine, sys)` holds
      (current system is Overmind-held with its garrison cleared).
      **Deliberate deviation from the literal wording:** `liberate` is appended
      to a new `LEGAL_ACTION_ORDER` (`ACTION_ORDER` + `"liberate"`), NOT into
      `ACTION_ORDER` itself. `ACTION_ORDER` is also the frozen neural-net output
      vocabulary — `weightsContract.test.ts` pins `ACTION_ORDER.length === 16`
      and `shippedWeights.test.ts` pins the shipped `player.weights.json`'s
      output width to it; growing it needs a PyTorch retrain + re-export (the
      repo's own precedent: `shippedWeights.test.ts`'s comment shows this exact
      10→16 migration happened once already). That retrain is out of scope for
      this task and touching those two hardcoded assertions would violate the
      standing "never touch existing test assertions" rule. `legalActionsForScene`
      now filters through `LEGAL_ACTION_ORDER` so `liberate` is a real, ordered,
      legal action for `MemoryHeuristicPolicy` (which reads `obs.legalActions`
      directly) — `mapNetOutputToAction` still only ranks `ACTION_ORDER` slots,
      so the trained net simply never scores `liberate` (falls through to the
      next-best legal action, same as before this change — no neural regression).
      Gated to SPACE_FLIGHT only (`ctx.canLiberate`).
- [x] Wire it headless (`PlayerAgent.apply`) → `engine.liberateCurrentSystem()`,
      and live (`installAutopilotHook.ts`'s `createLiveSceneController` +
      `LiveApplier.ts`'s `LiveSceneController`/`applyLiveAction`) → the same seam.
- [x] Regression tests for legality + the executor calling `tryLiberate`:
      `observe.test.ts` (pure `legalActionsForScene` gating + a real-harness
      cleared-vs-defended-capture case), `LiveApplier.test.ts` (dispatch),
      `installAutopilotHook.test.ts` (`createLiveSceneController.liberate()` →
      `engine.liberateCurrentSystem()`), and a new `liberateExecutor.test.ts`
      (real-engine `PlayerAgent` executor: frees a cleared Overmind capture,
      safe no-op while a defender remains). Confirmed the sole pre-existing
      caller of `liberateCurrentSystem()` is `NpcShipManager`'s automatic
      post-kill hook (`gitnexus impact` on `liberateCurrentSystem`, LOW risk,
      1 direct caller) — this task adds a second, deliberate, policy-driven path
      to the same seam, not a replacement.
      Full suite (4473 passed), lint (0 errors, pre-existing warnings only),
      tsc clean.

### Task 2: military progression — become battle-ready
- [x] Make the ladder build combat strength before slaying: earn credits, then
      prioritise hull/weapon upgrades + gear at stations/shops (executors already
      exist: `executeUpgradeHull`/`executeBuyBestGear`/`executeBuyBestModule`).
      Define a "battle-ready" signal (hull max + weapon tier above a threshold)
      distinct from the current full-hull `BATTLE_READY_HULL_FRACTION`.

      **Done.** New capability signal `isBattleReady(obs)` in
      `MemoryHeuristicPolicy.ts` gates on the loadout's DERIVED stats —
      `maxHull >= BATTLE_READY_MAX_HULL (200)` AND
      `weaponDamage >= BATTLE_READY_WEAPON_DAMAGE (30)` — deliberately distinct
      from the health-fraction `BATTLE_READY_HULL_FRACTION` (0.99, "am I patched
      up"). Exposed installed `weaponDamage` on `PlayerSnapshot`
      (`derivedStats().weaponDamage`). **Deviation from the literal wording (the
      three listed executors are not enough):** `executeBuyBestGear` only
      *acquires* gear into the owned store (its unit test pins that) — it never
      installs, so installed `weaponDamage` can't rise through it. Added a new
      `arm-up` action (buy the strongest affordable in-system gun, then INSTALL
      it into a free/weaker weapon slot) via `executeArmUp`/`planArmUp`/`canArmUp`
      in `equipmentQueries.ts`, appended to `LEGAL_ACTION_ORDER` (NOT
      `ACTION_ORDER` — same frozen-neural-vocab reasoning as Task 1's `liberate`,
      so `weightsContract`/`shippedWeights` stay green and the net never scores
      it). Wired headless (`PlayerAgent`), live (`LiveApplier`/
      `installAutopilotHook`). Ladder now, while `!isBattleReady`, prioritises
      `arm-up` → `upgrade-hull` at STATION/EQUIPMENT_SHOP **and PLANET** (every
      planet fields a Верфь — the source of `bestHullPrice`/`cheapestGearPrice`,
      both "planet-only"; the agent lands often but docks rarely, so refit had to
      be legal at PLANET) and dock-to-refit from flight (`go-battle-ready`) when a
      concrete, affordable upgrade exists. All additive + behavior-neutral in
      real (tech-1) galaxies (the new tiers are gated off when no shop stocks
      gear). Tests: `armUp.test.ts`, `battleReady.test.ts`, plus new cases in
      `observe.test.ts`/`LiveApplier.test.ts`/`liveEconomyHeads.test.ts`. Full
      unit suite 4490 passed, lint 0 errors, tsc clean.
- [x] Gate: agent reliably reaches battle-ready within a session on most seeds.

      **Honest accounting — NOT achieved, root-caused to a GAME defect.**
      Diagnostic (`DIAG_SESSIONS=40 DIAG_STEPS=250`): **0% reached battle-ready,
      0 arm-ups, peak maxHull 130, peak weaponDamage 14** (starter values), and
      **0% deaths preserved**. Root cause (instrumented probe): `GalaxySimulator`
      never sets `system.techLevel`, so EVERY system generates at the
      `StarSystem` default `techLevel = 1`; `ShopGenerator` filters out all gear
      above the system's tech, and the cheapest hull + weapon are BOTH techLevel
      2 — so **no hull or weapon is buyable in ANY system's Верйь in a fresh
      game** (the agent hoards ~9k credits with nothing combat-related to spend
      them on). The machinery is proven correct in unit tests (with a
      tech-boosted harness `executeArmUp`/`arm-up` raises installed
      `weaponDamage`). **The enabling fix (varied system techLevel at
      generation) reds 8 known-good behavioral/BC gates** (`competentSession`,
      `warpTargeting`, `exploreNoWarpLoop`, `sessionCompetence`, `exportBcData`)
      — even with a side-RNG that keeps topology byte-identical, because
      activating shops changes the agent's emergent behavior on those seeds. Per
      the standing "never red an existing test" rule I did NOT force it and
      reverted the generation change (suite back to green). **Flagged for the
      user / Task 4** (which authorizes updating old-expectation tests): the
      real battle-ready rate needs (a) varied techLevel generation + authorized
      updates to the 8 behavioral gates, (b) routing to high-tech shop systems
      (Task 3), and (c) a "save toward battle-ready gear" bias instead of eager
      cheap-gear buys. See memory `project-alltech1-blocks-battleready`.

### Task 3: Overmind-slayer decision tier
- [x] When battle-ready, seek the nearest frontier / Overmind-held system
      (`overmindHeld`, `frontierSystems`, hop distances), route there, engage and
      **clear the garrison** (fight — override `flee-outmatched` ONLY here, ONLY
      when battle-ready), then `liberate`. Repeat toward share 0.

      **Done.** Added the full slayer tier to `MemoryHeuristicPolicy.ts`:
      - **Advance** (§1.6): a battle-ready ship with no local fight and fuel to
        spare pushes `warp:slayer-advance`, targeted by the new
        `pickFrontwardNeighbor` (mirror of `pickWarpNeighbor`) — an
        `overmindHeld` neighbour wins outright, else the neighbour with the
        smallest `hopsToOvermindFront`. Fed by a new observation surface:
        `overmindFrontHopDistances` (multi-source BFS over the UNDIRECTED warp
        graph, `engineQueries.ts`), stamped per-neighbour as
        `SystemSnapshot.neighbors[].hopsToOvermindFront` and the current-system
        flag `Observation.overmindHeldHere` (`observe.ts`, seed set mirrors the
        per-neighbour `overmindHeld`, core counts as held before its garrison
        catches up).
      - **Clear the garrison** (§0.5): the ONE place `flee-outmatched` is
        overridden — `attack:slayer-clear-garrison`, gated strictly on
        `isBattleReady && overmindHeldHere && hostiles.length>0 &&
        hull >= SLAYER_RETREAT_HULL_FRACTION (0.4)`. Below the floor it drops the
        push so the survive block's flee/repair reclaims control.
      - **Liberate** (§0.5): `liberate:slayer-liberate` wins outright whenever
        legal (garrison cleared) — ungated by battle-ready, a downside-free step
        toward share 0 (also frees NPC-cleared systems the ship passes through;
        the diagnostic logged a real "Player liberated system sys_6").
      Tests: new `overmindSlayer.test.ts` (14 cases — BFS, advance targeting,
      stand-and-fight override, retreat-floor break-off, liberate, plus the
      not-battle-ready / no-front / survival-outranks negatives).
- [x] Preserve flee-from-strong when NOT battle-ready / not on a mission (no
      death regression). Verify with the diagnostic: deaths stay 0%.

      **Verified.** Pure tests pin: a NOT-battle-ready ship in a held system with
      an over-HP'd garrison still returns `flee:flee-outmatched` (never `slayer`);
      a NOT-battle-ready ship never emits `slayer-advance`. Diagnostic
      (`DIAG_SESSIONS=40 DIAG_STEPS=250`): **died 0/40 (0%)**, 0 harness errors.
      **Honest accounting:** battle-ready is still reached 0/40 (the all-tech-1
      generation defect flagged in Task 2 — see `project-alltech1-blocks-battleready`),
      so in real tech-1 sessions the fight/advance tiers are behavior-neutral
      (never fire); WON stays 0% at the engine level until Task 4 enables varied
      techLevel generation. The tier's machinery is proven correct by the pure
      tests over battle-ready fixtures; exercising it end-to-end in a real session
      needs the Task 4 generation fix + high-tech-shop routing.
- [x] Respect fuel/repair survival tiers between engagements.

      **Done.** `slayer-advance` is ranked below every survival tier
      (present-hostile reaction, low-hull repair, fuel-critical refuel,
      front-flee) and carries the `!fuelGate` guard, so a fuel-critical ship
      refuels first (test: `refuel-critical` wins over the advance) and a chance
      hostile en route gets the ordinary fight-or-flee reaction before any march
      to the front (test). The garrison-fight break-off at
      `SLAYER_RETREAT_HULL_FRACTION` hands a genuinely hurt ship back to the
      survive block's flee/repair sequencing.
      Gates: full unit suite 4504 passed, `letsplay:ci` 105, `test:playtest` 572,
      lint 0 errors, tsc clean.

### Task 4: balance so liberation can outpace the spread
- [ ] If liberation can't keep up on most seeds, tune (config-only in
      `balance.ts`): garrison strength/size, `OVERMIND_SPREAD_*` cadence,
      liberation reward — WITHOUT dropping below the locked arc-test constraints
      (grace ≤ 6, interval ≤ 5; loss share stays 0.85). Any test that encodes the
      OLD 0%-win expectation may be updated (user-authorized for this rework —
      see memory `project-autopilot-rework-2026-07`).

### Task 5: 1000-run win-rate gate + honesty
- [ ] `DIAG_SESSIONS=1000 DIAG_STEPS=300` — record the achieved win rate and the
      full outcome block. Iterate Tasks 2–4 to push it up. Do NOT claim 100% if
      the data doesn't show it; report the real ceiling and the seeds that resist.

### Task 6: final gate + cleanup
- [ ] Full suite, lint, tsc, playtest, letsplay:ci, save-compat green; all landed
      fixes preserved (combat/flee, trading, quests, fuel, 0.85 threshold).
- [ ] Record before(0%)/after win-rate table; **delete `_autopilotDiag.run.test.ts`** and its MEMORY.md pointer.

## Related open items (not this plan — flag for the user)
- Live autopilot auto-disabling after landing (reclaim-on-input) — needs a live
  repro; the combat-pause Fire fix may already have removed the trigger.

*Note: ralphex automatically moves completed plans to `docs/plans/completed/`.*
