# Three-Year Campaign: Balance, Scenario, Autopilot 99%

## Overview

Transform the game from a ~90-day sprint (that the autopilot loses 100% of the time) into a
**2–3 in-game-year campaign** (1 year = 360 days; hard ceiling = 1080 days) that the autopilot
**wins in ≥ 99% of runs**, with difficulty that **adapts to the player's power** and escalates
as the player grows. Along the way: the scenario (Overmind arc + quest chain) is restructured to
support that pacing, quest content is rewritten/extended to "starred-problem presented as
life-and-death" quality, and the game gets a visual audit + one new art category.

**Win** = Overmind arc eradicated (`engaged && overmindSet.size === 0 && peakThreat > 0`) or
core-kill. **Loss** = Overmind share ≥ 0.85. These definitions do not change; the *pacing* does.

Key design decision (user-selected): **adaptive difficulty keyed to player power**, not fixed
day-based phases. The Overmind pressure (spread cadence, garrison strength) scales with a
`playerPowerIndex` derived from hull/weapon/capital/rank — gentle while the player is weak,
relentless once armed. Two guards make this compatible with a guaranteed 99% ≤ 1080-day outcome:

1. **Ratchet** — effective difficulty never decreases when player power drops (no rubber-band
   exploit, no oscillation). Peak power is persisted (optional additive field).
2. **Baseline creep** — regardless of player power, after a long dormancy the spread cadence
   has a slow floor, so a stalled run still resolves and the win gate is measurable.

This plan **supersedes** the two open plans:
- `20260705-autopilot-overmind-slayer.md` — Tasks 0–4 done; its open Tasks 5–6 (win-rate gate,
  cleanup) are absorbed into Tasks 1 and 8–9 here. Move it to `docs/plans/superseded/`.
- `20260627-letsplay-full-game-play-and-net-retrain.md` — the retrain half is absorbed into
  Tasks 10–11 here. Move it to `docs/plans/superseded/`.

## Context (from discovery)

- **Win-rate today**: 0/50 baseline; 0/40 battle-ready. Root cause: all-tech-1 galaxy generation
  (no buyable hull/weapon anywhere) — fix is **in progress, uncommitted on this branch**
  (`src/systems/galaxy/systemTechDistribution.ts`, `GalaxySimulator.ts` hook,
  reserve-gated refits in `MemoryHeuristicPolicy.ts`, `observe.ts` armUpCost + repair gate).
- **Balance levers maxed**: commit `b6fd2e5` concluded every config lever is at its
  test-constrained optimum (`overmindArc.test.ts` pins grace ≤ 6, interval ≤ 5). No config-only
  headroom — the pacing must be re-architected and those tests rewritten.
- **Difficulty is flat**: only ramp is the fixed Overmind spread; `OVERMIND_COMBAT_HP_MULT` /
  `OVERMIND_COMBAT_DAMAGE_MULT` are dead code (no in-flight consumer since hex combat removal).
- **Autopilot**: `MemoryHeuristicPolicy` needs-ladder with slayer tier (advance/clear/liberate),
  battle-ready signal (hull ≥ 200, weapon ≥ 30), arm-up, warp-reject folds. Neural net is a
  frozen 16-action BC clone (`50→256→128→16`) that cannot express liberate/arm-up.
- **Sessions are short**: 300 steps ≈ 55 game-days. 1080 days ≈ ~6000 steps — the harness has
  never run that long; perf/memory unproven.
- **Quests**: 12 branching text-quests (`src/systems/quests/scripts/`, `TextQuestRegistry.ts`),
  5-slot procedural boards across 7 `QuestType`s, meter-driven branching (params/critMin/critMax).
- **Calendar**: `src/utils/gameCalendar.ts` — 360-day year. Days advance from travel distance
  (`pixelsPerDay = 500`) via `DayTickController`.
- **Key files**: `src/config/balance.ts`, `src/systems/overmind/overmindSpread.ts`,
  `src/systems/DayTickController.ts`, `src/systems/combat/` (CombatModule),
  `src/tests/playtest/letsplay/*`, `src/systems/quests/*`, `src/validation/schemas.ts`.

## Authorizations granted for this plan (user-approved 2026-07-06)

- **Test-modification license: FULL for pacing/behavior tests.** Tests that encode the OLD
  balance/pacing/autopilot behavior (`overmindArc.test.ts`, `combatLiberation.test.ts`,
  `sessionCompetence`, `competentSession`, `warpTargeting`, `exploreNoWarpLoop`,
  `exportBcData`, BC/weights gates, oddities bands) MAY be rewritten — **preserving their
  MEANING** (game is losable without engagement; agent is competent; parity holds), re-expressed
  against the new pacing. **Invariant tests stay untouchable**: save-compat/golden saves, money
  invariants, architecture guards, layer rules, manifest key parity.
- This overrides the standing "don't touch existing tests" rule **for this plan only**; every
  rewritten test must be listed in the progress notes of the task that rewrote it.

## Development Approach

- **Testing approach**: TDD for logic (balance, pacing, autopilot, engine seams — red test
  first per CLAUDE.md bug-fixing process); regular (content first, then validation tests) for
  quest prose/scripts.
- Complete each task fully before moving to the next; small focused changes.
- **CRITICAL: every task MUST include new/updated tests** for code changes in that task —
  separate checklist items, success + error paths.
- **CRITICAL: all tests must pass before starting next task** — where a task intentionally
  reds a legacy pacing test, the SAME task must rewrite it (license above); never leave the
  suite red between tasks.
- **CRITICAL: update this plan file when scope changes during implementation.**
- Money changes only via `adjustPlayerCredits`/`creditNpc`/`transfer`. Hull damage only via
  `applyDamageWithMode`. All new tunables live in `src/config/balance.ts` — never at call sites.
- **Save compatibility**: adaptive difficulty is derived (not persisted) except peak-power
  ratchet — persist as **optional additive field** (`.optional()` in schema, no migration,
  no version bump). Campaign quest chain uses catalog quests + existing QuestLog persistence
  (no new persisted fields). Run `npm run test:save-compat` after any schema touch.
- **Determinism**: generation and quest boards stay seed-deterministic; per-system independent
  seed streams (mirror `starTypeDistribution` pattern) so shared RNG streams stay byte-identical.

## Testing Strategy

- **Unit tests**: required for every task (see above).
- **Real-engine playtest** (`src/tests/playtest/`): integration/wiring changes (pacing consumer,
  combat scaling, autopilot tiers) are gated here, never in mocked unit tests.
- **E2E (Playwright)**: UI-visible changes (difficulty warnings, quest board texts, new art
  fallbacks) get/update specs in `e2e/`; visual fixes verified by screenshot per CLAUDE.md.
- **Tiered win gates** (heavy runs must NOT enter pre-push):
  - `letsplay:ci` stays fast (~3×40 steps) and gains **milestone proxies** (battle-ready /
    first-liberation by proxy deadlines), not full-campaign wins.
  - New env-gated `letsplay:campaign` script runs full 1080-day sessions; the **99% gate =
    ≥ 297 wins / 300 runs on NORMAL** (≤ 3 losses), run manually/nightly, results recorded in
    this plan.

## Progress Tracking

- Mark completed items `[x]` immediately when done.
- Add newly discovered tasks with ➕ prefix; blockers with ⚠️ prefix.
- Record measured win-rates/day-counts in the task notes as they land.

## What Goes Where

- **Implementation Steps** (`[ ]`): code/tests/docs achievable in this repo.
- **Post-Completion** (no checkboxes): ComfyUI art generation on the external GPU box, manual
  play-feel review, beta-tester save verification.
- Checkboxes only in Task sections.

## Implementation Steps

### Task 1: Land the tech-level generation fix (unblocks everything)
- [x] review + finish the uncommitted work: `src/systems/galaxy/systemTechDistribution.ts`
      (weights `[1,2],[2,3],[3,3],[4,2],[5,1]`, `HOME_SYSTEM_MIN_TECH = 3`,
      `GALAXY_MAX_TECH_FLOOR = 5`, independent per-system seeds), `GalaxySimulator.ts` hook,
      `MemoryHeuristicPolicy` trade-reserve refit gate, `observe.ts` armUpCost/repair gate
- [x] write unit tests for `assignSystemTechLevels` (distribution shape, home floor, max floor,
      seed determinism, RNG-stream isolation)
- [x] write/adjust playtest coverage for reserve-gated arm-up (no bankruptcy: credits stay
      ≥ reserve after refit) and repair no-op gate (no docked repair soft-lock)
- [x] re-baseline the redded behavior/BC gates under the test license (expected:
      `competentSession`, `warpTargeting`, `exploreNoWarpLoop`, `sessionCompetence`,
      `exportBcData`; list every touched test in notes)
- [x] run full unit + playtest suites — green; commit; move
      `20260705-autopilot-overmind-slayer.md` and
      `20260627-letsplay-full-game-play-and-net-retrain.md` to `docs/plans/superseded/`

**Task 1 notes (2026-07-06):**
- Review findings fixed while landing: `_autopilotDiag.run.test.ts` read a nonexistent
  `vitals.cargo` (→ `cargoUsed`); a stale comment on `warpCadenceOk` in
  `MemoryHeuristicPolicy.ts` claimed a laden-hold scoping the code (correctly) does not
  implement — comment rewritten to match the validated behavior (comment-only change).
- **No existing test was rewritten or touched.** The expected-red gates (`competentSession`,
  `warpTargeting`, `exploreNoWarpLoop`, `exportBcData`, oddities bands) are all GREEN with the
  generation fix + the accompanying reserve/repair/discovery ladder changes — the uncommitted
  policy work already re-balanced them; the test-modification license was not needed here.
- New tests: `src/tests/galaxy/systemTechDistribution.test.ts` (12 tests — weighted shape,
  home/galaxy floors, per-seed determinism, `${seed}_tech_${i}` RNG-stream isolation, real
  `GalaxySimulator` integration incl. coordinates/starType/economy byte-parity across runs);
  `src/tests/playtest/letsplay/armUpReserve.test.ts` (13 tests — reserve-gated
  arm-up/upgrade-hull/dock-to-refit at the boundary, STATION repair no-op legality gate, and
  real-engine end-to-end: policy declines a reserve-breaking refit, accepts with surplus,
  `executeArmUp` leaves credits ≥ `MILITARY_SPEND_TRADE_RESERVE` and raises installed damage
  past `BATTLE_READY_WEAPON_DAMAGE`).

### Task 2: `playerPowerIndex` — the adaptive difficulty input
- [x] write red tests first: `src/tests/campaign/playerPower.test.ts` — index ∈ [0,1];
      starter ship (hull 130 / weapon 14 / 1000cr / rank 1) ≈ 0; battle-ready (hull ≥ 200,
      weapon ≥ 30) crosses a defined threshold; monotone in each component; pure/deterministic
- [x] implement `src/systems/campaign/playerPower.ts` — pure function of
      (maxHull, weaponDamage, credits, rank) with normalization constants in `balance.ts`
      (`POWER_INDEX_*`); reads loadout via `GearCatalog`/`ShipLoadout` (single source of truth)
- [x] implement the **ratchet**: `campaignPeakPower` — persisted optional additive field on the
      save state; schema `.optional()`, absent ⇒ derive from current loadout on load
- [x] update `src/validation/schemas.ts` for the optional field; write schema round-trip test
      (absent field tolerated, present field preserved)
- [x] run `npm run test:save-compat` + unit tests — must pass before Task 3

**Task 2 notes (2026-07-06):**
- New module `src/systems/campaign/playerPower.ts`: `playerPowerIndex` (weighted clamp01
  linear norms), `powerIndexFromLoadout` (reads `ShipLoadout.derivedStats()` — single source
  of truth), `ratchetPeakPower` (never decreases; clamps corrupted values), `restoredPeakPower`
  (present ⇒ clamp; absent ⇒ derive from loadout).
- Levers in `balance.ts`: `POWER_INDEX_WEIGHTS` (hull .35 / weapon .35 / credits .15 /
  rank .15), HULL 130→360, WEAPON 14→110, CREDITS 1000→50000, RANK_MAX 7,
  `POWER_INDEX_BATTLE_READY_THRESHOLD` 0.15 (starter ≈ 0.02, battle-ready floor ≈ 0.19).
- Persistence: optional additive `campaignPeakPower` on `SaveState` + `SaveStateSchema`
  (`.min(0).max(1).optional()`) — no migration, no version bump. `GameEngine`: ratchet on
  `saveGame`, restore/derive after loadout revalidation in `loadGame`, reset to null on new-game
  creation (no cross-run leak), read seam `get campaignPeakPower` for Tasks 3–4.
- Tests: 19 new in `src/tests/campaign/playerPower.test.ts` (bounds/anchors/monotonicity/
  purity, loadout path, ratchet, restore semantics, schema round-trip incl. out-of-range
  rejection). **No existing test touched.** Gates: full unit 4548 ✓, playtest 585 ✓,
  save-compat ✓, tsc ✓, lint (touched files clean) ✓.

### Task 3: Adaptive Overmind spread pacing (the 2–3-year clock)
- [x] write red pacing tests: `src/tests/campaign/adaptivePacing.test.ts` — weak player
      (index ≈ 0) ⇒ spread cadence ≈ `ADAPTIVE_SPREAD_SLOW_DAYS`; strong player ⇒
      ≈ `ADAPTIVE_SPREAD_FAST_DAYS`; ratchet never slows after peak; **baseline creep**: with a
      permanently idle player the galaxy still reaches loss share well before day 1080 (game
      always resolves); loss share 0.85 and `engaged` semantics unchanged
- [x] add `balance.ts` levers: `ADAPTIVE_SPREAD_SLOW_DAYS` (≈ 45), `ADAPTIVE_SPREAD_FAST_DAYS`
      (≈ 10), `ADAPTIVE_GRACE_DAYS` (≈ 90), `ADAPTIVE_CREEP_START_DAY`, `ADAPTIVE_CREEP_MIN_DAYS`
      — initial values sized so a competent run wins in year 2–3 (tune in Task 9)
- [x] rewire `advanceOvermind` / `DayTickController` to consume the adaptive schedule
      (function of day + ratcheted power) instead of fixed `OVERMIND_SPREAD_GRACE_DAYS` /
      `OVERMIND_SPREAD_INTERVAL_DAYS`; keep undirected `frontierSystems` and `freezeOvermind`
      contracts intact
- [x] rewrite `overmindArc.test.ts` under the license: same meanings (losable without
      engagement, containable with it, win requires engagement) on the new clock; delete the
      grace ≤ 6 / interval ≤ 5 pins; note the rewrite in this plan
- [x] run unit + playtest + save-compat suites — green before Task 4

**Task 3 notes (2026-07-06):**
- New pure module `src/systems/campaign/adaptivePacing.ts`: `adaptiveSpreadIntervalDays(day,
  dayZero, peakPower)` = `lerp(SLOW, FAST, clamp01(peakPower))`, floored at
  `ADAPTIVE_CREEP_MIN_DAYS` once `day ≥ dayZero + ADAPTIVE_CREEP_START_DAY` (unstarted clock
  anchors at the current day, so creep never fires pre-engagement); always ≥ 1 whole day.
- Levers landed at SLOW 45 / FAST 10 / GRACE 90 / CREEP_START 360 / CREEP_MIN 12. Idle
  24-system run resolves (lost) ≈ day 500 in the pure simulation — well inside 1080. The fixed
  `OVERMIND_SPREAD_GRACE_DAYS`/`OVERMIND_SPREAD_INTERVAL_DAYS` levers were **removed** from
  `GAME_BALANCE` (fully replaced by the adaptive schedule).
- Wiring: `DayTickController.advanceOvermindArc` builds the spread config from
  `ADAPTIVE_GRACE_DAYS` + `adaptiveSpreadIntervalDays`; new **optional** dep
  `updateCampaignPeakPower` (absent ⇒ 0 ⇒ slowest cadence — legacy DI sites keep compiling).
  `GameEngine` implements it via the extracted `ratchetCampaignPeakPower()` (shared with
  `saveGame`), so the ratchet now updates **every EOD tick**, not just on save.
  `frontierSystems` (undirected) and `freezeOvermind` untouched.
- **Tests rewritten/adjusted under the license** (meanings preserved):
  - `src/tests/playtest/overmindArc.test.ts` — REWRITTEN for the adaptive clock; grace ≤ 6 /
    interval ≤ 5 pins deleted; dormancy/creep windows fast-forwarded via manual `gameDays`/arc
    state (the file's pre-existing technique); "ignored ⇒ lost" now runs on the creep floor and
    additionally asserts resolution < day 1080.
  - `src/tests/playtest/overmindNoSpuriousVictory.test.ts` — engagement scenario fast-forwards
    the 90-day dormancy; grace constant switched to `ADAPTIVE_GRACE_DAYS`; assertions unchanged.
  - `src/tests/playtest/overmindOutcome.test.ts` — "lost" scenario clock moved past the adaptive
    grace (day 96 → 97); assertions unchanged.
  - `src/tests/oddities/lateGameRecoverability.test.ts` — "reversible front" neglect window now
    starts the arc clock then fast-forwards grace; growth assertion re-anchored to the OVERMIND
    front (the equilibrium may simultaneously liberate pirate systems, so the hostile union was
    not a monotone measure); reclamation assertions unchanged.
  - `src/tests/playtest/letsplay/competentSession.test.ts` — the pinned `.fails`
    "sell-for-profit" regression HEALED: under the old clock this seed's 6-system galaxy went
    mostly Overmind-held mid-session and `galaxyEffectivelyLost` blocked the route; with 90-day
    grace the ladder provably reaches `sell-for-profit` again ⇒ `.fails` → `it` (the exact
    healing condition its comment demanded).
- New tests: 14 in `src/tests/campaign/adaptivePacing.test.ts` (cadence endpoints, clamping,
  monotone in power, ratcheted-sequence never slows, whole-day floor, creep floor on/off/min,
  custom-config purity, idle-run resolves ≈ day 500 < 900, strong-run resolves sooner, loss
  share 0.85 + never-engaged-no-win semantics).
- Gates: full unit 4562 ✓, playtest 585 ✓, letsplay:ci 105 ✓, save-compat 22 ✓, tsc ✓,
  lint 0 errors ✓.

### Task 4: Adaptive garrison & combat scaling (revive the dead levers)
- [ ] write red tests: in-flight combat vs Overmind-held systems applies HP/damage scaling as a
      function of ratcheted power (weak ⇒ ~0.9×, strong ⇒ up to `OVERMIND_COMBAT_*_MULT`);
      all damage routed through `applyDamageWithMode`; GOD floor respected
- [ ] wire the scaling into `CombatModule` (the "no production consumer" gap) via a pure
      `hostileScaling(powerIndex, gameMode)` helper in `src/systems/campaign/`; HARD-mode
      multipliers compose from `DIFFICULTY_HOSTILE_SCALING`, never at call sites
- [ ] scale garrison count/strength on Overmind systems by ratcheted power (gentle early,
      hard late) — generation-independent so existing saves are safe
- [ ] rewrite `combatLiberation.test.ts` under the license: same meaning (scout must lose,
      top loadout must win) at the scaling endpoints
- [ ] run unit + playtest suites — green before Task 5

### Task 5: Escalation feedback to the player (difficulty is *felt*, not silent)
- [ ] write red tests: crossing power/pressure thresholds emits news/warning events
      (reuse `OVERMIND_WARNING_THRESHOLD` machinery); events fire once per threshold, are
      i18n-keyed (RU/EN), and appear in the info feed
- [ ] implement threshold notifications ("the Overmind has noticed you", "front hardening",
      "final push available") driven by ratcheted power + share bands — systems layer only,
      UI via existing ports (no `systems/ → presentation/` import)
- [ ] add i18n keys RU/EN for all new strings
- [ ] add/update a Playwright spec asserting the warning surfaces in the info feed
- [ ] run unit + playtest + e2e regression — green before Task 6

### Task 6: Long-horizon harness (1080-day sessions must be runnable)
- [ ] write a red perf/capacity test: one seeded session runs to day ≥ 1080 (or arc resolution)
      headless without error, within a wall-clock budget and bounded memory
      (AgentMemory/priceBook/threatMap growth capped or pruned)
- [ ] profile + fix whatever breaks at ~6000 steps (unbounded maps, O(n²) scans, log spam);
      add pruning/caps with tests
- [ ] add `letsplay:campaign` npm script — env-gated (`CAMPAIGN_SESSIONS`, `CAMPAIGN_STEPS`),
      reports per-session: win/loss/timeout, resolution day, peak power, milestone days
      (battle-ready day, first-liberation day), deaths — building on `_autopilotDiag`
- [ ] keep `letsplay:ci` at its fast budget; verify it still passes untouched
- [ ] run unit + playtest suites — green before Task 7

### Task 7: Autopilot long-game competence (economy + combat executors)
- [ ] write red playtest tests: (a) flee executor actually disengages (not a no-op);
      (b) attack executor lands damage over ticks; (c) over a 200-day horizon the agent
      completes quests at a positive rate and ends credit-positive
- [ ] fix the deferred flee/attack executor no-ops in the letsplay apply layer
      (real engine seams, no engine behavior forks for the agent)
- [ ] tune the economy tier for long horizons: quest acceptance/delivery cadence, trade-reserve
      interplay with refits, price-discovery vs exploitation balance
- [ ] extend milestone proxies in `sessionCompetence`/oddities (under the license): battle-ready
      by proxy-day P1, first liberation by proxy-day P2 on seeded medium sessions
- [ ] run unit + playtest + letsplay:ci — green before Task 8

### Task 8: Slayer-tier tuning against adaptive pressure
- [ ] write red seeded playtest: on a medium galaxy the agent reaches battle-ready, clears a
      garrison, liberates ≥ 1 system, and arc share declines over a 400-day window
- [ ] tune `MemoryHeuristicPolicy` slayer constants (`BATTLE_READY_*`,
      `SLAYER_RETREAT_HULL_FRACTION`, advance/clear/liberate ordering, warp-reject folds) for
      the adaptive clock; add hysteresis so the agent doesn't yo-yo between economy and war
- [ ] handle the endgame: once share is falling, press the advantage (no drifting back to
      trading with 2 systems left); core-kill path exercised in at least one seeded test
- [ ] verify deaths stay at 0% and fuel-deaths at 0 on the CI bands
- [ ] run unit + playtest + letsplay:ci — green before Task 9

### Task 9: Balance iteration to the 99% gate (the core deliverable)
- [ ] run `letsplay:campaign` at 50 sessions; record win-rate, median resolution day, loss
      taxonomy (what killed the losses) in this plan
- [ ] iterate `balance.ts` adaptive levers (spread slow/fast/grace/creep, garrison scale,
      economy rewards) — config-table changes only — until 50-session win-rate = 100% and
      median win lands in year 2–3 (day ~540–1080, per the chosen pacing)
- [ ] scale up: 300-session campaign run; **gate: ≥ 297/300 wins (99%), all wins ≤ 1080 days,
      0 deaths**; record final numbers + final lever values in this plan
- [ ] promote the tuned pacing into a fast seeded regression test (accelerated proxy asserting
      the pacing SHAPE: dormant→pressure→resolution ordering) so future edits can't silently
      break the campaign clock
- [ ] run all suites (unit, playtest, letsplay:ci, save-compat) — green before Task 10

### Task 10: Neural action-space expansion (liberate + arm-up)
- [ ] extend `ACTION_ORDER` 16 → 18 (`liberate`, `arm-up`) and grow the observation block with
      the campaign features the teacher actually uses (overmind share, hops-to-front,
      battle-ready, armUpCost, power index) — new `FEATURE_LENGTH`, documented in CLAUDE.md
- [ ] update `featurize` / `mapNetOutputToAction` / `mlp.ts` plumbing; regenerate the
      weights-contract fixtures for the new shapes (under the license — parity MEANING kept)
- [ ] write tests: featurizer emits the new features correctly on crafted observations;
      action mapping round-trips all 18 slots; legality masking still filters illegal actions
- [ ] update `exportBcData` to emit the new schema; export a smoke dataset from the winning
      teacher and validate shape/coverage (all 18 actions represented)
- [ ] run unit + playtest suites — green before Task 11 (shipped 16-slot weights remain the
      live default until Task 11 swaps them)

### Task 11: Retrain the net on the winning teacher, ship, gate
- [ ] export the full BC dataset from `MemoryHeuristicPolicy` campaign runs (hundreds of
      sessions across seeds; include mid-game and endgame slices so liberate/arm-up aren't rare)
- [ ] update `tools/ai/train_player.py` for the new in/out dims; train; export
      `weights/player.weights.json`; verify TS-vs-PyTorch parity ≤ 1e-5 (`weightsContract`)
- [ ] run `letsplay:campaign` with `NeuralPolicy` at 100 sessions; **target ≥ 99 wins**; if BC
      plateaus below target, run DAgger-style iterations (relabel teacher on student states,
      retrain) until the gate passes — record each iteration's win-rate here
- [ ] write/refresh shipped-weights behavioral gate at the new action space (neural flag on ⇒
      NeuralPolicy drives; off ⇒ heuristic; default remains off)
- [ ] run all suites — green before Task 12

### Task 12: Overmind campaign quest chain (scenario spine)
- [ ] design a 5–6 step chain keyed to **player milestones, not days** (fits adaptive
      difficulty): first-contact distress → recon the front → requisition run (arm-up assist) →
      first liberation support → counteroffensive → core assault; each step is a catalog quest
      (`QuestScript` or board quest) gated on overmind state + prior-step completion in
      QuestLog — **no new persisted fields, no migration**
- [ ] implement chain gating in the quest offer path (`getQuestBoard`/registry predicate);
      chain steps pay meaningfully and hand the player toward the next milestone
- [ ] write the step texts RU (life-and-death framing, readable, EN keys where the UI needs
      them) — prose quality bar: a reader should *want* to accept
- [ ] write tests: chain steps unlock in order and only in order; completing the chain tracks
      the arc (seeded playtest: milestones fire as the agent progresses); save/load mid-chain
      resumes correctly (golden-save gate stays green)
- [ ] run unit + playtest + save-compat — green before Task 13

### Task 13: Rewrite the 12 existing text quests (prose + puzzle sharpening)
- [ ] audit all 12 scripts (`customs, gravity-slalom, investigation, cargo-sort, reactor,
      auction, derelict-salvage, smuggling-run, hostage-rescue, sabotage-heist, first-contact,
      plague-crisis`): per script note the puzzle core and where stakes/prose are flat
- [ ] rewrite prose pass 1 (6 scripts): life-and-death framing in the setup, concrete sensory
      detail, choices that read as decisions (not menu items), endings that acknowledge the
      path taken; keep script IDs/params/graph shape stable (catalog data — no migration)
- [ ] rewrite prose pass 2 (remaining 6 scripts), same bar
- [ ] sharpen 3–4 weakest puzzles: the optimal path should require actual reasoning
      (meter arithmetic, ordering, deduction) while a survivable non-optimal path exists
- [ ] write/refresh graph-validation tests: every ending reachable, no orphan locations, all
      transitions legal, meter effects within bounds; run full quest test suite — green

### Task 14: New text quests, batch 1 (3–4 puzzle scripts)
- [ ] write 3–4 new `QuestScript`s in distinct puzzle genres, e.g.: logistics routing under
      deadline (evacuation scheduling), deduction/whodunit aboard a sealed station, resource
      optimization (triage with too few doses), negotiation under pressure (hostile boarding
      party, trust/heat meters) — each a "starred problem" wrapped in a life-and-death story
- [ ] register in `TextQuestRegistry`/`ALL_QUEST_SCRIPTS`; RU prose to the Task 13 bar
- [ ] write graph-validation + smoke-playthrough tests per script (best path, worst path,
      one mixed path; success and failure endings both reachable)
- [ ] verify board integration: new scripts appear via TEXT_ADVENTURE issuance, dedup holds
- [ ] run quest + playtest suites — green before Task 15

### Task 15: New text quests, batch 2 (3–4 more)
- [ ] write 3–4 more scripts in genres not yet covered (e.g. signal-decoding first-contact
      variant, orbital-mechanics escape, courtroom/tribunal defense, plague-ship quarantine
      dilemma) — no genre repeats within the new 6–8
- [ ] register + RU prose to bar; EN keys where UI requires
- [ ] write graph-validation + smoke-playthrough tests per script
- [ ] run quest + playtest suites — green before Task 16

### Task 16: Procedural board text variety
- [ ] write seeded template-variant system for board quests: ≥ 4 phrasing variants per
      `QuestType` (DELIVERY/BOUNTY/ESCORT/DIPLOMACY/EXPLORATION/DEFENSE), picked
      deterministically by seed; texts read as живые объявления, not dry templates
- [ ] thread faction/system/cargo details into the variants so no two boards read identical
- [ ] write tests: determinism (same seed ⇒ same text), variant coverage (all variants
      reachable), no broken interpolations, dedup still holds
- [ ] update e2e quest-board spec if visible texts changed
- [ ] run quest + e2e regression suites — green before Task 17

### Task 17: Visual audit + targeted fixes
- [ ] sweep a full campaign session visually: letsplay live (`` ` ``) + Playwright screenshots
      across scenes (flight, station, equipment, quest board, text quest, combat, endgame);
      collect a concrete cringe list (sameness, misalignment, missing art, dead space)
- [ ] fix the found issues, targeted (screenshot-verified per CLAUDE.md; no blur filters in
      flight scene; PixiJS masks must be addChild'd)
- [ ] add e2e regression specs for the fixed visual bugs (real-pointer where hit geometry
      is involved)
- [ ] run e2e regression suite — green before Task 18

### Task 18: New art category — text-quest illustrations + Overmind front
- [ ] define the category: 1 illustration per text quest (~20 incl. new scripts) + 3–5
      Overmind-front mood pieces; write prompts to `asset_prompts.json` (ComfyUI pipeline
      convention), keyed by quest/script id via `pickVariant` by id
- [ ] implement integration: `TextQuestScene` (and Overmind info surfaces) mount the
      illustration when the texture exists, with a graceful no-art fallback; category added to
      `LAZY_PREFIXES` (will exceed 10 MB), `pickVariantKey` + `loadTextureAsync` pattern
- [ ] write tests: fallback path renders without the assets; manifest key-parity snapshot
      updated only for keys that exist; lazy-load path covered
- [ ] add an e2e spec: text quest scene renders correctly in both with-art and no-art states
- [ ] run unit + e2e suites — green (actual generation on the GPU box → Post-Completion)

### Task 19: Verify acceptance criteria
- [ ] re-run the **300-session campaign gate**: ≥ 99% wins, all ≤ 1080 days, median in year 2–3,
      0 deaths, credits non-negative — record final numbers in this plan
- [ ] re-run the 100-session neural gate — record
- [ ] verify difficulty escalates within winning runs (early-game pressure metrics < late-game;
      assert from campaign telemetry)
- [ ] run full unit suite, `npm run test:playtest`, `npm run letsplay:ci`,
      `npm run test:save-compat`, `npm run test:e2e:regression`, `npm run lint` — all green
- [ ] load a pre-plan golden save into the new build: loads, migrates, playable (gate green)

### Task 20: [Final] Update documentation
- [ ] update `.claude/docs/systems/overmind.md` (adaptive pacing, ratchet, creep, new invariants)
      and `.claude/docs/systems/letsplay.md` (campaign harness, 18-action net, gates)
- [ ] update CLAUDE.md neural section (new FEATURE_LENGTH / action count / weights) and balance
      section (adaptive levers); update `src/systems/quests/scripts/README.md` (new count, prose bar)
- [ ] record final lever values + measured win-rates in this plan; note all rewritten tests
- [ ] update `docs/requirements`/`docs/design` if the scenario description changed

## Technical Details

- **Power index**: `powerIndex = clamp01(wH·norm(maxHull) + wW·norm(weaponDamage) +
  wC·norm(credits) + wR·norm(rank))`, weights + norms in `balance.ts`. Ratchet:
  `campaignPeakPower = max(campaignPeakPower, powerIndex)` updated on EOD tick; persisted as
  optional field (absent ⇒ recompute from loadout).
- **Adaptive spread**: `nextSpreadInterval = lerp(SLOW, FAST, peakPower)` after
  `ADAPTIVE_GRACE_DAYS`; creep floor: after `ADAPTIVE_CREEP_START_DAY`,
  `interval = min(interval, ADAPTIVE_CREEP_MIN_DAYS)`. Loss share 0.85, `engaged`,
  `frontierSystems` (UNDIRECTED), `freezeOvermind` all unchanged.
- **Steps↔days**: ~300 steps ≈ 55 days today ⇒ 1080 days ≈ ~6000 steps; campaign harness must
  hold that budget (Task 6).
- **Statistical note**: 99% gate = ≤ 3 losses in 300 runs; a true 99% process passes this
  ~65% of the time, a true 97% process almost never — good discrimination at feasible cost.
- **Neural**: 18 actions, wider obs; BC first, DAgger fallback; frozen-16 contract fixtures
  regenerated (license); default policy flag stays off in production.
- **Quest chain**: availability = pure predicate over (overmind state, QuestLog completions);
  no new persisted state.

## Post-Completion

**External art generation (user-driven):**
- Generate the Task 18 assets on the ComfyUI box (oleg@192.168.88.193, RTX 4090) from
  `asset_prompts.json`; run through `tools/optimize-assets.ts` (WebP); drop into
  `src/assets/`; manifest snapshot will need the key additions committed.

**Manual verification:**
- Human play-feel session: does year 1 feel like growth, year 2 like war, year 3 like the
  final push? Do the rewritten quests read as life-and-death? (Autopilot metrics can't judge prose.)
- Live autopilot watch (`` ` `` in dev) for one long session — pacing oddities the headless
  harness can't see (combat-pause class of bugs).
- Beta-tester save spot-check on a deployed build (load + play a progressed save).
