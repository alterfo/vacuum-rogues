---
# Beta Bug Pass: Late-Game Recoverability — Reputation, Captured Systems, Combat Rewards, Quest Distances

## Overview
A beta-tester on the live build (day 1066, deeply-progressed save, 96k cr) reported a late game that
becomes unwinnable/frustrating. The *named* symptoms were four, but a thorough dig shows the real
root is **the galaxy gets captured over time and there is no recovery path** for the player:

1. **Reputation only decays; no recovery.** Over ~1000 days "all planets" went to −35 → −50 and
   demand bribes, with **no way to raise standing**.
2. **Killing pirates pays nothing** — drops *gear*, never the pirate's **credits**. "Why fight?"
3. **Pirate loot ("yellow dot") can't be collected** — pulled in only by a gravity tractor.
4. **Quest distance ≠ jump graph** — 1-2-jump quest, target 3-6 jumps away, 30-day deadline
   impossible → quests expire → the **expiry rep-penalty is one engine of #1**.

**Refined root cause (the thorough part).** Landing is **not** blocked by generic faction rep —
`landingAccess.ts` denies only `"overmind"` (captured) or `"pirate-rep"` (pirate-captured, needs
pirate rep ≥ threshold). The "bribe" is the pirate **«Откупиться»** (`comms.option.pay-tribute`). So
by day 1066: the Overmind/pirate front has captured most of 30 systems; on a captured planet the
controlling faction is Pirate/Overmind, so the player sees **their pirate/overmind rep (−50)**; and
there is **no source that raises pirate/overmind rep** (quests don't cover them, tribute/fighting
don't raise it). Counter-play partly exists (`OvermindBalance` recapture with negative feedback;
`GameEngine.liberateCurrentSystem()`/`tryLiberate`) but **pirates "churn normally" (no negative
feedback)** and the liberate path may be undiscoverable. So the real fix = **make captured access
recoverable** (pirate-rep recovery + a discoverable liberate) on top of the four named bugs — each
hardened against the new oddities it could introduce.

**User decisions:** (a) recover rep via **quests + fixing the decay**; bribe = one-time access + a
hint, not a rep sink. (b) **Full scope** including unblocking captured systems.

## Context (from discovery)
- **Reputation:** `Player.adjustReputation(factionId, delta)` (`src/domain/Player.ts:101`). Decrease
  only: quest expiry (`QuestManager.ts:436`), customs fine −20 (`PlanetScene.ts:764`), loan default
  −15 (`GameEngine.ts:283`), text-quest/encounter (`TextQuestRuntime.ts:93`). **No +reward found.**
- **Landing/captured:** `src/systems/galaxy/landingAccess.ts` (`overmind` / `pirate-rep`),
  `PIRATE_FACTION_ID`, `GOOD_PIRATE_REP_THRESHOLD`; the player's pirate rep `getReputation(PIRATE_…)`
  (`NpcShipManager.ts:1302`). The displayed planet relation = controlling faction
  (`planetTooltip.ts`). Pirate tribute option `comms.option.pay-tribute`.
- **Overmind/pirate spread:** `src/systems/overmind/overmindSpread.ts`, `OvermindBalance.ts`
  (recapture + negative feedback; pirates churn normally — *no* negative feedback),
  `GameEngine.liberateCurrentSystem()` → `galaxy.tryLiberate()`. Tuning in `balance.ts`
  (`OVERMIND_SPREAD_*`, `OVERMIND_LOSS_GRACE_DAYS`).
- **Quest distance:** `QuestGenerator.ts` `jumps = jumpDistances(systems, originSystemId)` (`:395`,
  real warp graph), reward+deadline scale by it; elite quests need `minReputation:50`, **normal
  quests `minReputation:0`** (so a −50 player can still take normal quests — no deadlock there). Nav
  resolver `questDestination.ts`.
- **Combat loot:** `NpcShipManager` `spawnLootForNpc` (~`:490`), glowing dot (`lootGraphics:295`),
  TTL despawn, grav-tractor-only pickup (`:368`). NPC credits (`NpcSimulator.ts:600/642`:
  pirates **100–1000 cr**, **respawn via garrison** → farm risk). Cargo pickup respects
  `cargoCapacityOf` (`:1190`).
- **Money rule:** credits move only through the ledger — salvage via `adjustPlayerCredits`
  (`src/systems/banking/economy.ts`), never `player.credits +=`.

## Development Approach
- **Testing approach: TDD / regression-first.** Failing test first → fix → next.
- **Oddity-first hardening (the user's ask):** every gameplay-economy change ships with an explicit
  guard + a test that the guard holds (cap/anti-farm/radius/margin). A dedicated **long-horizon
  balance task** (Task 8) advances many galaxy days and asserts no new pathology — covering the
  letsplay oracle's known blind spot (it never advances a day, so it can't see these).
- **Blast-radius first** before editing `QuestManager`, `QuestGenerator`, `NpcShipManager`,
  `Player.adjustReputation`, `PlanetScene`, `landingAccess`, `OvermindBalance`, `overmindSpread`.
- **Money only through the ledger; never weaken existing test assertions; `scaledText` for panels.**
- **Save-safety:** balance/runtime/generation only — **no persisted-field change** (keep
  `save-compat` green). The reporter's −50 / captured save must load **and** become recoverable.

## Testing Strategy
- **Unit:** rep-reward math + clamp, deadline-vs-jumps formula, distance/jump-graph consistency,
  pirate-rep recovery step, liberate predicate, salvage-credit calc + anti-farm cap, pickup radius.
- **Real-engine playtest:** faction quest raises rep; pirate-rep recovery regains landing; liberate
  reclaims a captured system; pirate kill pays + drop collectible; deadlines reachable.
- **Long-horizon balance (Task 8):** advance N days and assert the equilibrium/economy invariants.

## Progress Tracking
- Mark `[x]` immediately; ➕ for discovered tasks; ⚠️ for blockers.

## What Goes Where
- **Implementation Steps:** code, tests, balance constants, UI hint.
- **Post-Completion:** manual confirmation on a progressed/−50/captured save.

## Implementation Steps

### Task 1: Quest deadlines achievable for the real jump route (one distance metric)
**Files:** Modify `src/systems/quests/QuestGenerator.ts`, `src/config/balance.ts`, maybe `questDestination.ts`; Create `src/tests/quests/questDeadlineReachable.test.ts`
- [x] failing test: for `jumps=N`, the deadline (days) ≥ a realistic travel budget for N hyperjumps + in-system legs — **but bounded** so near quests stay time-pressured (guard: deadline is `base + jumps×perJumpBudget`, not unbounded) — `questDeadlineReachable.test.ts` asserts `deadline ∈ [BASE+jumps×PER_JUMP+5, +10]` and that a 2-jump deadline strictly exceeds a 1-jump one
- [x] failing test: advertised jump count == the warp-graph distance the nav/star-map uses (no "1-2 advertised / 3-6 actual") — `jumpDistances(..., {undirected:true})` matches the star-map's either-direction warp; test asserts `q.jumps === navDist` including a one-way-edge target where directed would have said 2 but nav is 1
- [x] make the deadline scale from real `jumps` via a `balance.ts` constant with a margin; reconcile displayed distance with the nav graph; **reward stays tied to jumps so longer deadline ≠ free money** — `QUEST_DEADLINE_BASE_DAYS`/`PER_JUMP`/`BUFFER_*`; quest generator now uses the **undirected** `jumpDistances` for both advertised jumps and deadline; reward formula untouched
- [x] verify existing quest tests pass (re-diagnose if one reds) — full unit suite 3819 passed / 4 skipped
- [x] run tests — must pass before next task

### Task 2: Quest completion grants faction reputation (recovery loop) — capped
**Files:** Modify `src/systems/QuestManager.ts`, `src/config/balance.ts`; Create `src/tests/quests/questReputationReward.test.ts`
- [x] failing test: completing a quest calls `adjustReputation(factionId, +reward)` (mirror of the expiry penalty, opposite sign), keyed by the **same** `factionId` the board/landing gate read — `questReputationReward.test.ts` asserts `forceCompleteQuest`/`claimReturnReward` raise rep on `quest.factionId || quest.planetId` (the exact key `applyFailurePenalty` subtracts from)
- [x] grant a **modest** +rep on success (config constant) so honest play climbs out of −50 over several quests — **not** in one (guard: small amount + the existing rep clamp; assert it can't overshoot) — `QUEST_REPUTATION_REWARD = 5` granted in the shared `grantReward`; test asserts `0 < reward < 50`, a single completion from −50 stays negative (−45), and a completion from 99 clamps to 100 (no overshoot)
- [x] verify the expiry-penalty path is unchanged (failures still cost rep) — test asserts an expired quest still drops rep by `reputationLoss` (−10 → −25), no reward fired; full unit suite 3825 passed / 4 skipped
- [x] run tests — must pass before next task — quest suite + playtest + full unit suite + lint (0 errors) all green

### Task 3: Pirate-rep recovery — regain access to pirate-captured systems
**Files:** Modify `src/systems/comms/commsOptions.ts` (tribute), `src/systems/galaxy/landingAccess.ts`, `src/config/balance.ts`, ru/en; Create `src/tests/galaxy/pirateRepRecovery.test.ts`
- [x] failing test: there is **at least one** repeatable way to *raise* pirate reputation toward `GOOD_PIRATE_REP_THRESHOLD` (e.g. «Откупиться» grants a small +pirate-rep, or an anti-pirate/escort action does) — today only decreases/none-up exist — `pirateRepRecovery.test.ts` asserts `grantPirateTributeRep` raises pirate rep by the fixed gain and a `−50` player climbs back to landable over repeated payoffs
- [x] implement the chosen recovery (smallest viable: tribute grants a capped +pirate-rep, OR a dedicated action), so a −50 pirate-rep player can climb back to landable — **guard: per-interaction cap + credit cost stays meaningful** (no free/farmed rep) — `«Откупиться»` (`onPayTribute`) now calls `grantPirateTributeRep` (+`PIRATE_TRIBUTE_REP_GAIN = 3`, well below `GOOD_PIRATE_REP_THRESHOLD = 30`, clamp-bounded so no overshoot); the `shakedownTribute` credit cost is unchanged (rep is bought, not free); test asserts a single payoff is NOT enough and the +100 clamp never overshoots
- [x] surface it in the denial/tooltip text (the player learns *how* to regain access), localized ru/en — `landingDenialMessage` now routes through i18n keys `landing.denial.overmind`/`landing.denial.pirateRep` (ru/en lockstep); the pirate-rep line carries the «Откупайтесь от пиратов, чтобы её поднять» recovery hint; cyrillic baseline regenerated (landingAccess literals migrated to keys)
- [x] run tests — must pass before next task — pirate-rep recovery + landingAccess + planetTooltip + full i18n suite + playtest (265) + full unit suite (3832 passed / 4 skipped) + lint (0 errors) all green

### Task 4: Make liberating a captured system discoverable + working for pirate systems
**Files:** Modify `src/systems/GameEngine.ts` (`liberateCurrentSystem`/`tryLiberate`), `src/systems/galaxy/*` (galaxy liberate), `src/presentation/flight/*` (surface the action), tests
- [x] failing test: `tryLiberate`/`liberateCurrentSystem` reclaims a **pirate-captured** system (not just overmind) under the intended condition (e.g. after a fight / good standing), so the front is genuinely reversible mid-game — `playerLiberate.test.ts` (unit, pure predicate over both pirate+overmind capture) and `playtest/playerLiberate.test.ts` (real engine: a cleared pirate- AND overmind-captured current system both liberate; `liberateCurrentSystem` was dead code, never called)
- [x] ensure pirate captures aren't a one-way ratchet (they "churn normally" today): give them recapture/decay analogous to the overmind negative feedback OR a player-driven liberate, **guard: it converges to an equilibrium, not auto-clears the whole map** — added the **player-driven liberate** (the "after a fight" path): `canPlayerLiberate(galaxy, systemId)` = system is hostile AND its hostile garrison is fully cleared (mirrors `NpcSimulator.countGarrisonPresent`); `GameEngine.liberateCurrentSystem` is now gated on it. Single-system + fight-gated by design, so it frees at most the one system the player stands in — **cannot auto-clear the map** (test asserts a defended system refuses, and liberation acts on one system only); the existing `stepOwnershipTick` negative-feedback recapture still churns pirates toward equilibrium
- [x] surface the liberate action/hint in flight (the player can act on a captured system they're in) — `NpcShipManager.handleInFlightDeath` calls `maybeLiberateClearedSystem()` (clearing the last defender frees the system + a «Система … освобождена!» toast); entering a captured system shows `maybeShowLiberationHint()` («Уничтожьте всех захватчиков, чтобы освободить её»). i18n keys `flight.systemLiberated`/`flight.liberationHint` (ru/en lockstep); optional-method guarded for partial test-host engines
- [x] run tests — must pass before next task — new unit + playtest green; full unit suite 3844 passed / 4 skipped; playtest 269/271; i18n + flight/presentation suites green; lint 0 errors

### Task 5: Pirate kills pay — salvage the NPC's credits (ledger) with an anti-farm cap
**Files:** Modify `src/presentation/flight/NpcShipManager.ts`, `src/systems/banking/economy.ts` usage, `src/config/balance.ts`; Create `src/tests/combat/pirateSalvageCredits.test.ts`
- [ ] failing test: killing a credit-carrying NPC awards a salvage payout via `adjustPlayerCredits` (balanced ledger transfer, whole credits) — never `player.credits +=`
- [ ] credit a **fraction** of the NPC's credits (config) — **guard against farming**: a per-day or per-engagement salvage cap so respawning pirates can't be an infinite credit faucet; assert the cap holds over many kills
- [ ] toast «Трофей: +N ₡»; verify ledger projection stays consistent (no validation error)
- [ ] run tests — must pass before next task

### Task 6: Loot collectible by proximity (not tractor-only) — bounded
**Files:** Modify `src/presentation/flight/NpcShipManager.ts`; Create `src/tests/combat/lootPickup.test.ts`
- [ ] failing test: flying within a pickup radius collects a floating drop **without** a grav tractor; the tractor still extends the radius (no double-collect)
- [ ] proximity auto-pickup with a **bounded radius** + a toast «Подобрано: <item>»; gear → the canonical bag/`ownedGearIds` seam; **guard: a full/over-capacity case doesn't corrupt inventory**, dot/graphic cleaned up (no leak), TTL still despawns abandoned drops
- [ ] run tests — must pass before next task

### Task 7: Customs bribe = one-time access + a "how to raise standing" hint (no rep dead-end)
**Files:** Modify `src/presentation/PlanetScene.ts`, `src/systems/galaxy/landingAccess.ts`, ru/en; Create `src/tests/presentation/bribeAccess.test.ts`
- [ ] failing test: paying the customs fee grants the one-time access **without** dropping reputation further (remove the −20 dead-end) — **guard: the credit cost stays meaningful** so smuggling/bribing isn't consequence-free
- [ ] surface the recovery hint on low standing / denial ("выполняйте задания фракции"; for pirate systems, the pirate-rep path from Task 3), localized
- [ ] run tests — must pass before next task

### Task 8: Long-horizon balance/oddity guard (covers the oracle's day-blind spot)
**Files:** Create `src/tests/oddities/lateGameRecoverability.test.ts` (and/or extend `src/tests/oddities/balanceInvariants.test.ts`)
- [ ] advance the real engine **many galaxy days** (e.g. simulate to ~day 1000) and assert: the Overmind/pirate front reaches a **non-terminal equilibrium** (some faction systems remain / are regainable) — not a total wipe
- [ ] assert the **anti-farm** cap holds: a player farming pirates can't exceed a sane credits/day from salvage
- [ ] assert reputation is **recoverable but not trivial**: repeated quest success raises faction rep toward 0+ over a bounded number of quests (no overshoot, no one-shot)
- [ ] assert quest deadlines generated across the run are reachable for their jump distance
- [ ] run tests — must pass before next task

### Task 9: Verify acceptance criteria
- [ ] verify the reporter's loop is fixed end-to-end: faction quests raise rep; pirate-rep/liberate regains captured access; deadlines reachable; pirate kills pay + drop collectible; bribe explains the path up — **and** no new oddity (Task 8 green)
- [ ] run full unit suite (`npm test -- --run`), playtest (`npm run test:playtest`), letsplay oracle (`npm run letsplay:ci`), linter
- [ ] confirm no domain/schema/save change; `npm run test:save-compat` stays green (the reporter's progressed/captured save loads and is now recoverable)

## Technical Details
- One distance metric (`jumpDistances`, the warp graph) for both the quest's advertised distance and
  the deadline budget — never a second metric.
- Reputation gains/losses key by the **same** `factionId` the board + landing gate read; stay within
  the rep clamp; pirate rep is its own `PIRATE_FACTION_ID` axis vs `GOOD_PIRATE_REP_THRESHOLD`.
- Salvage credits = balanced NPC→player ledger transfer, whole credits, with a per-day/engagement cap.
- Pirate spread must gain a negative-feedback/liberate path so it converges (like the overmind arc),
  not an unbounded ratchet — but must NOT auto-clear the galaxy (equilibrium, not erase).
- Proximity pickup is a bounded pure predicate (distance ≤ radius); the tractor widens it.

## Post-Completion
**Manual verification (clean reload, ideally on a progressed/−50/captured save):**
- Complete a faction quest → standing rises; a low-standing planet shows the hint.
- Regain access to a pirate-captured planet via the pirate-rep path and/or liberate.
- Take a multi-jump quest → deadline actually reachable.
- Kill a pirate → credit payout + flying over the drop collects it; confirm farming is capped.
