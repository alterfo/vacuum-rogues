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
- [x] write red tests: in-flight combat vs Overmind-held systems applies HP/damage scaling as a
      function of ratcheted power (weak ⇒ ~0.9×, strong ⇒ up to `OVERMIND_COMBAT_*_MULT`);
      all damage routed through `applyDamageWithMode`; GOD floor respected
- [x] wire the scaling into `CombatModule` (the "no production consumer" gap) via a pure
      `hostileScaling(powerIndex, gameMode)` helper in `src/systems/campaign/`; HARD-mode
      multipliers compose from `DIFFICULTY_HOSTILE_SCALING`, never at call sites
- [x] scale garrison count/strength on Overmind systems by ratcheted power (gentle early,
      hard late) — generation-independent so existing saves are safe
- [x] rewrite `combatLiberation.test.ts` under the license: same meaning (scout must lose,
      top loadout must win) at the scaling endpoints
- [x] run unit + playtest suites — green before Task 5

**Task 4 notes (2026-07-06):**
- New pure module `src/systems/campaign/hostileScaling.ts`: `hostileScaling(powerIndex, mode)`
  = `lerp(HOSTILE_SCALING_WEAK_MULT, OVERMIND_COMBAT_*_MULT, clamp01(power)) ×
  DIFFICULTY_HOSTILE_SCALING[mode].hostileCombatMultiplier` (new config field: GOD/NORMAL 1.0,
  HARD 1.25 — additive, so the pinned NORMAL≡GOD equality in `hardScaling.test.ts` holds);
  `scaleHostileDamage` (whole hits, positive-hit floor 1, zero stays 0);
  `overmindGarrisonPowerBonus` (floor(power × OVERMIND_GARRISON_POWER_MAX_BONUS), max +2).
  Levers in `balance.ts`: `HOSTILE_SCALING_WEAK_MULT` 0.9, `OVERMIND_GARRISON_POWER_MAX_BONUS` 2.
- `CombatModule` consumes it via two new **optional** deps (`isHostileSystem`,
  `getCampaignPeakPower` — absent ⇒ neutral 1.0, legacy DI sites byte-identical): incoming NPC
  damage × `damageMult` (still routed through `applyDamageWithMode`, GOD floor verified);
  player shots divide by `hpMult` (effective enemy HP). `SpaceFlightScene` wires both from
  `galaxy.isHostileSystem(player.currentSystemId)` + `gameEngine.campaignPeakPower`
  (SpaceFlightScene at 1893 lines, under the 1898 guard).
- Garrison count: `NpcSimulator.fillGarrison` shifts the Overmind `[GARRISON_MIN, GARRISON_MAX]`
  range up by the power bonus (pirate garrisons NOT power-scaled); the ratchet reaches it via
  `attachCampaignPeakPower(provider)` wired once in the GameEngine constructor (new game resets
  the value ⇒ no cross-run leak). Spawn-time only ⇒ generation-independent, existing saves safe
  (garrison *strength* scaling is the CombatModule fight-time path — one source, no
  double-application on spawned stats).
- **Tests rewritten under the license**: `src/tests/galaxy/combatLiberation.test.ts` difficulty
  section — meaning preserved at the endpoints the player actually faces (scout cannot liberate:
  the GARRISON_MIN=5 standing garrison overwhelms it even at its gentle 0.9× scaling; top
  loadout beats a full-1.5× garrison ship); new intentional behaviour locked: a LONE weak-scaled
  patrol is survivable 1v1 (gentle early). The `tryLiberate` section and the mult>1 pins kept
  verbatim.
- New tests: 17 in `src/tests/campaign/hostileScaling.test.ts` (endpoints, clamp, monotonicity,
  HARD composition, NORMAL≡GOD, damage rounding, garrison-bonus steps), 10 in
  `src/tests/combat/hostileScalingCombat.test.ts` (real CombatModule: weak/strong/neutral/legacy
  incoming + outgoing scaling, HARD composition, GOD floor on a scaled lethal volley, NORMAL
  death), 4 in `src/tests/npc/garrisonPowerScaling.test.ts` (power 0 ≡ legacy [5,10], power 1
  ⇒ exact +bonus shift, sub-step power unchanged, pirates unscaled).
- Docs: `src/systems/galaxy/CLAUDE.md` "no production consumer" limitation replaced with the
  adaptive wiring; stale `OVERMIND_COMBAT_*_MULT` "PINNED" comment in `balance.ts` and the
  capture-fleet comment in `MemoryHeuristicPolicy.ts` updated.
- Gates: full unit 4594 ✓, playtest 585 ✓, letsplay:ci 105 ✓, save-compat 22 ✓, tsc ✓,
  lint 0 errors ✓.

### Task 5: Escalation feedback to the player (difficulty is *felt*, not silent)
- [x] write red tests: crossing power/pressure thresholds emits news/warning events
      (reuse `OVERMIND_WARNING_THRESHOLD` machinery); events fire once per threshold, are
      i18n-keyed (RU/EN), and appear in the info feed
- [x] implement threshold notifications ("the Overmind has noticed you", "front hardening",
      "final push available") driven by ratcheted power + share bands — systems layer only,
      UI via existing ports (no `systems/ → presentation/` import)
- [x] add i18n keys RU/EN for all new strings
- [x] add/update a Playwright spec asserting the warning surfaces in the info feed
- [x] run unit + playtest + e2e regression — green before Task 6 (4 PRE-EXISTING e2e
      failures excluded, see ⚠️ note)

**Task 5 notes (2026-07-06):**
- New pure module `src/systems/campaign/escalationNotices.ts`: `activeEscalationStages(inputs)`
  derives the crossed bands — `NOTICED` (ratcheted power ≥ `ESCALATION_NOTICED_POWER`, tied to
  the battle-ready threshold 0.15), `HARDENING` (Overmind share ≥ `OVERMIND_WARNING_THRESHOLD`
  0.35 — the exact star-map warning band), `FINAL_PUSH` (arc status machine derived
  `contained` — front peaked and was pushed back); terminal `won`/`lost` suppress all.
  `EscalationNoticeTracker` guarantees fire-once per run: keyed by galaxy id, the FIRST
  observation seeds already-crossed stages silently (a loaded mid-game save never spams
  retroactive news), lapse-and-re-cross never re-fires. Nothing persisted.
- Wiring: `DayTickController.emitEscalationNotices` runs right after `advanceOvermindArc`
  (reads the same ratcheted `peakPower` the adaptive schedule just used) and emits a new
  `CAMPAIGN_ESCALATION` news event into `galaxy.newsFeed` — the feed the Info Center renders —
  anchored to the player's current system so the partial-observability filter always shows it.
  Systems layer only; no new ports needed (news feed is the existing seam).
- NewsEvent lockstep (per `src/systems/galaxy/CLAUDE.md` convention, doc updated): type union
  in `src/types/index.ts`, Zod enum in `schemas.ts` (additive — no migration/version bump,
  save-compat 22 ✓), `NEWS_TYPE_COLOR` in `InfoCenterScene.ts`, i18n keys
  `news.type.CAMPAIGN_ESCALATION` + `news.escalation.{NOTICED,HARDENING,FINAL_PUSH}` in BOTH
  ru/en (parity gate green). Descriptions emitted via `t()` (RumorDirector precedent).
- New tests: 13 in `src/tests/campaign/escalationNotices.test.ts` (band boundaries, terminal
  suppression, escalation ordering, purity, custom config; tracker fire-once / silent seed /
  no re-fire / per-galaxy reset), 6 in `src/tests/campaign/escalationNoticesWiring.test.ts`
  (real DayTickController + real Galaxy: NOTICED/HARDENING/FINAL_PUSH each fire exactly once
  with i18n'd descriptions, won-arc suppression, loaded-mid-game silent seed, below-band
  negative path). New e2e in `playtest-regression.spec.ts`: drives the REAL EOD pipeline
  (baseline tick → capture 45% of systems → tick) and asserts the warning text renders in the
  Info Center feed. **No existing test touched** (license not needed).
- Gates: full unit 4613 ✓, playtest 585 ✓, letsplay:ci 105 ✓, save-compat 22 ✓, tsc ✓,
  lint 0 errors ✓. E2E regression: 26/26 ✓ including the new spec.
- ⚠️ 4 PRE-EXISTING e2e regression failures on this branch, all verified unrelated via
  `git stash` (they fail identically WITHOUT this task's changes): "PlanetScene menu buttons
  respond to REAL mouse hover + click" (cursor stays default), "changing the font size keeps
  the ship in place", "mouse wheel scrolls the equipment-shop list", "a TRADE_OPPORTUNITY
  rumor renders in the Info Center news tab". Environmental/branch drift — candidates for the
  Task 17 visual/e2e sweep; NOT fixed here (one concern per commit).

### Task 6: Long-horizon harness (1080-day sessions must be runnable)
- [x] write a red perf/capacity test: one seeded session runs to day ≥ 1080 (or arc resolution)
      headless without error, within a wall-clock budget and bounded memory
      (AgentMemory/priceBook/threatMap growth capped or pruned)
- [x] profile + fix whatever breaks at ~6000 steps (unbounded maps, O(n²) scans, log spam);
      add pruning/caps with tests
- [x] add `letsplay:campaign` npm script — env-gated (`CAMPAIGN_SESSIONS`, `CAMPAIGN_STEPS`),
      reports per-session: win/loss/timeout, resolution day, peak power, milestone days
      (battle-ready day, first-liberation day), deaths — building on `_autopilotDiag`
- [x] keep `letsplay:ci` at its fast budget; verify it still passes untouched
- [x] run unit + playtest suites — green before Task 7

**Task 6 notes (2026-07-06):**
- **Harness delivered**: `campaignMetrics.ts` (pure fold/classify/bounds/aggregate/format core,
  17 unit tests on synthetic data) + `campaign.run.ts` (`runCampaignSession`/`runCampaign`/
  `writeCampaignReport` — no per-step transcript, day-boundary checkpoints, structural
  memory-bounds evidence, calendar-wedge detector `CAMPAIGN_WEDGE_STEP_LIMIT=300`) +
  `campaign.run.test.ts` two tiers behind `LETSPLAY_CAMPAIGN` (`npm run letsplay:campaign`;
  env knobs `CAMPAIGN_SESSIONS`/`CAMPAIGN_DAYS`/`CAMPAIGN_STEPS`/`CAMPAIGN_WALL_MS`):
  **capacity** (one GOD-mode session to day 1080 or arc resolution, wall/heap/bounds gated)
  and **campaign run** (NORMAL telemetry sessions; win-rate deliberately NOT gated — Task 9).
  Reports land in gitignored `.letsplay/`. `_wedgeProbe.run.test.ts` kept as an env-gated
  inert diagnostic (it found every wedge below; Tasks 7–9 keep burning wedges with it).
- **What actually broke at ~6000 steps was never memory** (belief structures are world-bounded
  by construction — asserted via `checkMemoryBounds`): it was a chain of five behavioral/apply
  soft-locks, each surfaced by the wedge probe and fixed at its root:
  1. *flee↔avoid-danger-back ping-pong* (8000 steps frozen at day 94): a fleeing ship's map
     back-out returned it to the fight. Fixed by the `flee-escape-jump` map tier (escape
     outranks back-out while the flee condition holds).
  2. *combat-pause freeze made escapes fake* — `completeWarp` left a LIVE-fight pause frozen;
     the engagement volley still landed per attempt (~27 hull, zero movement) so NORMAL ships
     died by retries and "survivors" were really frozen. Fixed: `completeWarp` resumes the
     pause every tick (same discipline as `waitOneDay`) — a transiting ship keeps flying,
     combat resolves/disengages honestly.
  3. *orphaned `pendingWarp` trap* (day-229 wedge, 300× dock no-ops): a stuck hyperjump made
     the apply-layer intercept redirect EVERY action to `completeWarp` forever. Fixed: on
     budget exhaustion the orphaned jump is aborted (a live player would cancel/re-plot).
  4. *unaffordable-repair loops* (day-189/190 wedges): `executeRepair` no-ops when broke, so
     "repair" (at STATION) and "dock-to-repair" ping-ponged. Fixed: repair legality +
     `dock-to-repair` gated on `canAffordRepair` (new `repairCost()` single-sources the bill).
  5. *stagnation deadlock*: a DOWNED (GOD-floor) ship can't warp and `daysStagnant` blocks
     buys, so land(earn)→take-off spun a frozen day forever. Fixed: `stagnation-wait` —
     when the calendar is frozen and warps didn't fire, WAIT (always legal, advances the
     world) outranks the earn-landing.
- **Downed (GOD floor) is now observable + legality-filtered**: `PlayerSnapshot.downed`
  (`isDowned`), and `observe` removes `warp`/`attack`/`flee` from `legalActions` while downed
  (engine truth: StarMapScene blocks the jump, downed ships can't fire) — every policy incl.
  the neural mask inherits it. NORMAL/HARD unaffected by construction.
- **Kill-time calculus** (`flee-outgunned`): hostile snapshots now carry `damage`; the policy
  flees BEFORE contact when total hostile hull × damage exceeds player hull × weapon damage
  (cross-multiplied, zero-safe; absent field ⇒ legacy decisions). The old hull-compare fired
  one volley too late vs equal-hull/harder-hitting ships, and post-contact flees die to
  pursuit. Pirate dens are now observation-parity too: `NeighborSnapshot.pirateHeld`
  (star map renders them orange) weighs like `overmindHeld` in warp targeting, and the
  applier's blind pick avoids `pirateSystems` alongside `overmindSystems`.
- **GAME bug found & fixed (agent-as-diagnostic): quest boards sold courier runs into
  hostile-held systems.** Seed LETSPLAY_CI-0: the board issued «Цепь курьеров» targeting a
  NINE-pirate garrison den two hops from home; the agent (or any honest player) flies to its
  own quest marker and is annihilated. Fix in production code: `BoardOptions.hostileSystems`
  filters the routine/chain/elite target pool at the source (`generateQuestBoard`), wired from
  `GameEngine.getQuestBoard` with `overmindSystems + pirateSystems`. Additive param, default
  `[]` ⇒ legacy boards byte-identical; DEFENSE/finale war-quests untouched. 4 new tests in
  `src/tests/quests/questHostileSystems.test.ts`.
- **Capacity result (M-series laptop, jsdom+pixi-stub)**: CAMPAIGN-CAPACITY-0 (GOD) runs
  wedge-free to a NATURAL arc resolution — loss at day 355 (share 0.92), 2296 steps, 10.6 s
  wall, +102 MB heap, 0 errors / 0 violations / 0 memory-bounds breaches. NORMAL telemetry
  sessions die honestly at day 63–94 (weak ship, adaptive pressure) — the Task 7–9 baseline.
- **Tests rewritten under the license** (meanings preserved): `competentSession.test.ts` —
  the blanket `endScene !== GAME_OVER` pin was satisfied only by the combat-pause FREEZE
  exploit (a "surviving" ship was a frozen soft-lock this file's own header scopes out).
  Now: incompetence deaths (fuel/soft-lock/bankruptcy) still hard-fail unconditionally; an
  honest WAR casualty is tolerated iff late (day ≥ 120) in a war-consumed galaxy
  (share ≥ 0.35); the soft-lock streak guard measures LIVING steps only (dead sessions idle
  to the step budget). No other existing test touched; deferred frontier-avoidance policy
  experiments were reverted after they redded `exploreNoWarpLoop`/`fuelSurvival` — that
  competence work belongs to Tasks 7–8.
- Gates: full unit suite ✓, playtest 585 ✓, letsplay:ci 105 ✓ (survival 100% now honest —
  min-days-survived rose 21→28, systems-visited 3.3→4.3), letsplay:campaign capacity ✓,
  save-compat 22 ✓, tsc ✓, lint ✓.

### Task 7: Autopilot long-game competence (economy + combat executors)
- [x] write red playtest tests: (a) flee executor actually disengages (not a no-op);
      (b) attack executor lands damage over ticks; (c) over a 200-day horizon the agent
      completes quests at a positive rate and ends credit-positive
- [x] fix the deferred flee/attack executor no-ops in the letsplay apply layer
      (real engine seams, no engine behavior forks for the agent)
- [x] tune the economy tier for long horizons: quest acceptance/delivery cadence, trade-reserve
      interplay with refits, price-discovery vs exploitation balance
- [x] extend milestone proxies in `sessionCompetence`/oddities (under the license):
      first-liberation by proxy-day P2=190 + ratcheted-power battle-ready-band proxy gated;
      ➕ scope note: the STRICT battle-ready-day P1 gate (hull ≥ 200 AND weapon ≥ 30 by a
      deadline) moved to Task 8, whose first checkbox red-tests exactly that — reaching it
      needs slayer/economy tuning, not executor work; gating it here would pin a
      known-unreached state
- [x] run unit + playtest + letsplay:ci — green before Task 8

**Task 7 notes (2026-07-06):**
- **Gates delivered** (`longGameCompetence.test.ts`, real engine): (a) flee→escape-jump leaves
  the contested system; (b) consecutive attack steps keep landing damage across ticks; (c) the
  200-day GOD seeded session (`CAMPAIGN-CAPACITY-0`, the campaign harness's own capacity seed)
  completes ≥ 3 quests and ends net-credit-positive; (d) a committed escape jump completes even
  when the GOD floor trips mid-transit. Milestone proxies in `sessionCompetence.test.ts`
  (letsplay:ci): first liberation ≤ d190 (measured d155) + ratcheted power crosses the
  battle-ready band `POWER_INDEX_BATTLE_READY_THRESHOLD` (measured 0.16 at d200 vs 0.02 start).
- **Quest economy re-architected around measured failure modes** (200-day probe: 1 quest
  completed, 3 of 5 accepted contracts DOOMED at accept time by the buy tier's own
  reward-covered rule, wallet stranded at 45cr mid-collection):
  - accept-time viability filter (`isTakeableBoardQuest`): base-price × 0.75
    (`QUEST_SOURCING_PRICE_ESTIMATE`, sized from the market model `base × baseline² × jitter`)
    must stay under the reward — reproduces all five probe ground truths; shared by
    `takeableBoardQuestCount` so take-quest never retries an unacceptable board;
  - `planetSystems` gazetteer in `AgentMemory` (planet → system seen in) enables ROUTED trips:
    `go-deliver` (completable quest target), `go-stock` (unmet quest cargo from a remembered
    stockist, reward-covered like the buy tier), `go-restock` (A↔B margin farming),
    targeted `find-sell-destination`; each re-derived in STAR_MAP for the two-step warp's
    second half, ranked above `avoid-danger-back` (whose stale-threatMap veto spun the measured
    1907-cycle go-stock↔back-out wedge — the back-out still protects the blind exploratory warp);
  - the applier resolves a non-adjacent `targetId` as a DESTINATION (hop-routing via
    `systemHopDistances`, mirrored in `installAutopilotHook`), never steering at hostile-held
    systems: new `Observation.hostileSystemIds` (star-map-parity, galaxy-wide) refuses captured
    destinations at the policy level and the applier level both;
  - thin margins (`MIN_FARM_MARGIN_FRACTION` 0.25) are never farmed (measured net-negative);
    `MAX_COMPLETED_DELIVERY_QUESTS` 5 → 50 (campaign-horizon lifetime cap);
  - trade-reserve interplay: executor-truth spend fields (`buyGearCost`/`buyModuleCost`/
    `upgradeHullCost` — `executeBuyBestGear` buys the PRICIEST affordable, the old
    cheapest-price gate let one step spend 3179cr against a 980cr check), all discretionary
    shopping reserve-gated + debt-frozen + battle-ready-gated (hull-first: pre-battle-ready
    gear buys starved the 7000cr hull purchase), `repay-loan-surplus` STATION tier, and a
    downed-and-broke `loan-for-repair` rescue (debt-free-gated — a second loan is illegal);
  - result on the probe seed: 8/8 accepted quests completed (7–28-day cycles), credits
    419 → 3055 → 5171 across the horizon, final 2987 net with zero debt.
- **Three GAME soft-locks found & fixed (agent-as-diagnostic — fix the game, not the agent).**
  All three composed into "pinned at a garrison forever" (measured day-255/306 capacity wedges;
  even a live player's only exit was load-save):
  1. `SpaceFlightScene.performWarp` cancelled a COMMITTED jump when the GOD floor tripped
     mid-transit — repair→jump→intercepted→cancelled ran until bankruptcy (27 failed escapes).
     Now reaching the edge means escape; initiating while downed stays blocked (StarMapScene
     gate untouched); NORMAL/HARD unaffected (only GOD derives `downed`).
  2. the low-hull (< 30%) safety auto-stop halted engines and CLEARED the escape route during a
     committed hyperjump run — now skipped while `pendingWarp` is set.
  3. `CombatModule` fought a permanently-downed ship forever — the fight pins the galaxy
     calendar (US-070 #5), freezing the whole session. A downed ship is not a combatant:
     `update()` ends the engagement and `addCombatant` refuses one while downed (same class as
     the weaponless no-op; the every-frame aggro path re-engages naturally after repair).
  Plus `mem:deadlock` now shelters on a planet (landing is legal downed and advances the world)
  instead of waiting inside a live fight (3181-step frozen-calendar wedge).
- **Capacity re-verified**: the 1080-day GOD session now resolves NATURALLY — loss at day 361
  (share 0.92), 582 steps, 0 errors/violations/wedges, credits 1505, loan repaid (Task 6's
  pre-Task-7 baseline was loss at d355 with a starved economy). NORMAL 400-day sessions die
  honestly at d94–267 with 4–13 quests completed and positive credits — the Task 8 baseline.
- **Tests rewritten under the license** (meanings preserved, each noted in-file):
  - `godModeIntegration.test.ts` "repairing above the floor re-enables auto-fire" — resume now
    flows through the aggro path's re-engage (downed ships refuse engagement outright);
  - `competentSession.test.ts` progression tier: gear/module buys re-expressed on a
    battle-ready ship with the reserve intact (+ new "defers gear shopping while not yet
    battle-ready" pin for the hull-first discipline);
  - `MemoryHeuristicPolicy.test.ts` "does NOT warp to sell destination when the route is
    remembered as dangerous" — split into the live-hostile suppression (kept meaning) and a new
    "stale threat alone no longer pins the sell route" pin (the removed behavior was the
    measured 126-step earn-churn trap);
  - `warpTargeting.test.ts` — "never the held neighbor" meaning kept; the one-specific-clean-
    neighbor pin relaxed (the economy tier now settles into a profitable A↔B farm through a
    different clean neighbor, which is smarter play, not worse targeting);
  - `cyrillicBaseline.json` regenerated downward (the removed downed-jump toast — ratchet win).
- Gates: full unit 4659 ✓, playtest 623 ✓, letsplay:ci 106 ✓ (incl. the new milestone-proxy
  session), letsplay:campaign capacity ✓ (natural resolution d361), save-compat 22 ✓, tsc ✓,
  lint 0 errors ✓.

### Task 8: Slayer-tier tuning against adaptive pressure
- [x] write red seeded playtest: on a medium galaxy the agent reaches battle-ready, clears a
      garrison, liberates ≥ 1 system, and arc share declines over a 400-day window
- [x] tune `MemoryHeuristicPolicy` slayer constants (`BATTLE_READY_*`,
      `SLAYER_RETREAT_HULL_FRACTION`, advance/clear/liberate ordering, warp-reject folds) for
      the adaptive clock; add hysteresis so the agent doesn't yo-yo between economy and war
- [x] handle the endgame: once share is falling, press the advantage (no drifting back to
      trading with 2 systems left); core-kill path exercised in at least one seeded test
- [x] verify deaths stay at 0% and fuel-deaths at 0 on the CI bands
- [x] run unit + playtest + letsplay:ci — green before Task 9

**Task 8 notes (2026-07-06):**
- **Root cause the agent never became battle-ready** (measured pre-Task-8: `battleReadyDay`
  fired in 0% of sessions across all seeds/modes, hull peaked at 180 / weapon at 49 with
  6698cr banked): TWO bugs, both fixed at the root.
  1. **Hull affordability was priced gross, not net** (`bestAffordableHull`/`bestHullPrice`
     in `equipmentQueries.ts`/`observeHelpers.ts`). Installing a replacement hull trades the
     old one in, so the wallet only covers `price − trade-in` — the real shop UI
     (`EquipmentShopScene.buyHull`) already gates on exactly that net, but the dev-only
     autopilot query gated on the GROSS listing, so it judged a battle-ready hull unaffordable
     one upgrade before a real player at the same wallet could buy it. Fixed: `bestAffordableHull`
     + new `hullUpgradeNetCost` price at net; `systemShopPrices` threads the fitted hull's
     trade-in so the `upgrade-hull` LEGALITY gate (`credits ≥ bestHullPrice`) is net too
     (else the net-affordable candidate is pruned as illegal). Pure dev-layer correctness fix,
     matches production, no overdraft (the executor already charges gross-then-credits, which
     the shipping shop UI proves the ledger tolerates). No production/schema/save change.
  2. **`BATTLE_READY_MAX_HULL` (200) was unreachable-by-catalog.** The `GearCatalog` has NO hull
     between the `hull_freighter` (180 hp, tech-4, common) and the `hull_warden` (220 hp,
     tech-5, rare + ~55% stock), and the next up (`hull_bastion`, 360 hp) is tech-7 — above
     `GALAXY_MAX_TECH_FLOOR` (5), never stocked. Reaching 200 needs a dedicated "hunt the
     rare tech-5 warden shop" router (Task 9/10). Lowered to **180** (the plan authorizes
     moving `BATTLE_READY_*`) — the tech-4 freighter now completes battle-ready, and the
     campaign agent crosses the STRICT gate at **day 191** on the capacity seed (was: never).
     Task 9 re-tunes if 180 proves too soft against the adaptive garrison scaling.
- **Slayer tuning + hysteresis** (`MemoryHeuristicPolicy`): (a) a capability-BATTLE-READY ship
  no longer flees a hostile-free rising front (`flee-overmind-front` gated `!battleReady`) —
  the weak-ship survival reflex ceded ground the slayer-advance tier is trying to reclaim;
  a battle-ready ship holds so advance/clear/liberate can press (the hull-based flee from an
  ACTUAL fight is untouched — no death regression). (b) Endgame quest hysteresis: a battle-ready
  ship in an ENGAGED galaxy (`share > OVERMIND_THREAT_SHARE`) stops taking new courier work —
  the economy already funded the refit, so from here the slayer tiers own the ship's time and
  it doesn't yo-yo between a delivery run and the war ("no drifting back to trading with 2
  systems left"). Advance/clear/liberate ordering + `SLAYER_RETREAT_HULL_FRACTION` kept.
- **Core-kill path**: the existing slayer close-in (`slayer-clear-garrison` in a held system) +
  `slayer-liberate` already resolve the core — a battle-ready agent standing on the engaged
  Overmind core liberates it and the next EOD arc tick reads `won` (coreBroken). Exercised in a
  seeded real-engine test (no new mechanic needed).
- New tests: `src/tests/playtest/letsplay/slayerCampaign.test.ts` — 4 pure endgame-press
  decisions (battle-ready holds the front / weak ship still flees; battle-ready suppresses
  courier work / weak ship still takes it) + 3 real-engine loop gates (battle-ready ship clears
  a forced aggressor to death over ticks; the REAL `MemoryHeuristicPolicy` liberates a cleared
  held system, dropping the Overmind count = share declines; core-kill → arc `won`). Plus a new
  Task 8 block in `src/tests/oddities/sessionCompetence.test.ts` (letsplay:ci): the campaign
  proxy now crosses the STRICT `battleReadyDay` (Task 7 explicitly deferred it here) AND
  liberates ≥ 1 with `died === false` (the deaths-stay-0 CI band). **No existing test assertion
  was modified** — the test-modification license was not needed; all touched constants are
  referenced by symbol in the fixtures, so lowering `BATTLE_READY_MAX_HULL` kept them
  self-consistent.
- **Scope split honored (Task 8 = behaviors, Task 9 = the 99% win rate).** The full-session
  ORGANIC 400-day win where share declines to zero on every seed is NOT achieved here and is
  Task 9's config-table iteration: a lone battle-ready 180/49 ship cannot solo the 5-defender
  `GARRISON_MIN` standing garrison (the `combatLiberation` arithmetic), and in GOD the 5%
  hull floor keeps it "downed" (can't fire/jump) at the front. The behaviors compose end-to-end
  (clear → liberate → core-kill → won) in the constructed real-engine loop and the agent
  reaches battle-ready + liberates on the seeded campaign horizon — the Task 8 deliverable.
  Task 9 tunes the adaptive spread/creep + garrison levers so the organic session wins.
- Gates: playtest 630 ✓, letsplay:ci 107 ✓, save-compat 22 ✓, tsc ✓, lint 0 errors ✓,
  slayerCampaign 7 ✓, sessionCompetence 3 ✓. ⚠️ **Pre-existing unrelated failure**: the full
  unit suite has 1 red — `moduleContracts.test.ts` SpaceFlightScene `< 1900`-line guard, which
  the committed HEAD (Task 7 commit `1f383bb`) already breaks at exactly 1900 lines. Verified
  identical WITH my changes stashed; Task 8 touches none of that file. Not fixed here (one
  concern per commit; the line guard is its own careful extraction task per standing rule #6).

### Task 9: Balance iteration to the 99% gate (the core deliverable)
- [x] run `letsplay:campaign` at 50 sessions; record win-rate, median resolution day, loss
      taxonomy (what killed the losses) in this plan
- [x] ➕ **(i) extend power-keyed adaptive gentling to neutral-system combat** (user-approved
      2026-07-07, see decision record below): weak ship takes reduced hits *everywhere* —
      neutral-system wandering packs included — ramping to full damage as `campaignPeakPower`
      grows. Red tests first; rewrite the Task-3/4 pins (`hostileScaling.test.ts` weak-mult,
      `garrisonPowerScaling` [5,10], `adaptivePacing` slow=45) under the plan's test license,
      preserving meaning (scout loses to garrison; top loadout wins; game losable)
- [ ] ➕ **(ii) if (i) alone doesn't reach the gate: mid-combat agent reaction** (user-approved
      2026-07-07): let the agent act between combat rounds inside a single headless step (flee
      before a multi-round resolution lands) — parity with what a live player can do; harness
      seam, no engine behavior fork
- [ ] iterate `balance.ts` adaptive levers (spread slow/fast/grace/creep, garrison scale,
      economy rewards) on top of (i)/(ii) until 50-session win-rate = 100% and
      median win lands in year 2–3 (day ~540–1080, per the chosen pacing)
- [ ] scale up: 300-session campaign run; **gate: ≥ 297/300 wins (99%), all wins ≤ 1080 days,
      0 deaths**; record final numbers + final lever values in this plan
- [ ] promote the tuned pacing into a fast seeded regression test (accelerated proxy asserting
      the pacing SHAPE: dormant→pressure→resolution ordering) so future edits can't silently
      break the campaign clock
- [ ] run all suites (unit, playtest, letsplay:ci, save-compat) — green before Task 10

**Task 9 notes (2026-07-06) — baseline measured; ⚠️ config-only path BLOCKED, escalating:**
- **50-session baseline (`npm run letsplay:campaign` NORMAL, committed HEAD levers):**
  win-rate **18.0 %** (9 win / 1 loss / **40 died** / 0 timeout), median win **d98**,
  battle-ready reached in only **14 %** of runs, liberation-proxy **46 %**. The dominant
  outcome is **DEATH (80 %)**, not galaxy-loss (2 %) or timeout. Report artifact:
  `.letsplay/campaign-summary.txt`.
- **Loss taxonomy (diagnostic `_deathDiag.run.test.ts`, DEATH_DIAG-gated, since removed):**
  the ship dies from **full hull (130 → 0) in a SINGLE agent step** — a combat one-shot, never
  a gradual wear-down. A 20-seed death-location census split the deaths **≈50 / 50**:
  - **held-system garrisons** (`isHostileSystem` = true) — the agent warps into / is caught in
    an Overmind/pirate-captured system's standing garrison;
  - **wandering faction/pirate packs in NEUTRAL systems** — `nHost` 3–5 hostiles (observed
    factions: PARADOXES pirate-role packs, and the player's own OUTLANDERS turning
    reactive-hostile) that fire at **full base damage**. `hostileScaling`/garrison levers do
    **not** apply outside held systems, so this half of the deaths is **outside the reach of
    every Task-9-listed config lever** (spread pacing, garrison scale, economy rewards).
- **Config iterations tried (all measured at 50 sessions):**
  1. garrison 3-5, `HOSTILE_SCALING_WEAK_MULT` 0.6, `ADAPTIVE_GRACE_DAYS` 150, slow 55 →
     **16 %** win (grace 150 back-fired: the arc never *engages* when NPCs clear the initial
     Overmind seed during the long grace ⇒ unresolvable **share-0 timeouts**, +3 wedges over
     the longer sessions). Reverted grace to 90.
  2. garrison **2-3**, `HOSTILE_SCALING_WEAK_MULT` **0.35**, slow **70** → **22 %** win
     (11 win / 4 loss / **34 died** / 1 timeout). **Liberation-proxy leapt 46 % → 82 %** — the
     smaller garrison makes the front genuinely clearable — **but the win-rate barely moved
     because deaths still dominate (68 %)**: the front gets cleared, yet the weak ship dies
     before the arc resolves to `won`.
- **Root cause (why config plateaus ≈ 18–22 %):** the 99 % gate requires **weak-ship combat
  survivability**, which the config-table levers cannot deliver. Two structural reasons:
  (a) ≈half the deaths are neutral-system packs the held-system scaling never sees; (b) a
  single headless `agent.run(1)` step resolves **many** engine combat rounds (the step spans
  days), so even at 0.35× held-system scaling a 3–4-ship group deals ~130 damage in ONE step —
  the agent never gets a turn to flee. Softening damage far enough to matter (≈0.1×) would
  trivialise all early combat and break the Task-3/4 behavior tests
  (`hostileScaling.test.ts` pins weak-mult ≈0.9; `garrisonPowerScaling` pins [5,10];
  `adaptivePacing` pins slow=45).
- **⚠️ ESCALATION — Task 9 as specified ("config-table changes only") cannot reach 100 %/99 %.**
  The proper fix is weak-ship combat survivability — either (i) extend the plan's own
  power-keyed adaptive gentling (Task 4's `hostileScaling`) to **neutral-system** combat so a
  weak ship takes reduced hits *everywhere*, ramping to full as it arms (this is the Overview's
  stated "gentle while weak, relentless once armed" design, currently only wired to held
  systems); and/or (ii) a harness/policy change so the agent can act **mid-combat** (flee before
  the multi-round step lands). Both are **outside Task 9's config-only method** and touch
  Task-4/6/7/8 code marked done — a scope/architecture decision left to the user rather than
  changed unilaterally in an autonomous pass (broad combat-balance blast radius; standing "don't
  weaken existing tests" rule). The experimental config was **reverted** so the suite stays
  green; the baseline finding above is the deliverable of this pass.

**✅ DECISION (user, 2026-07-07): approved BOTH — (i) first, then (ii) if the gate is still
unmet.** Rationale: (i) is literally the plan's chosen design ("gentle while weak, relentless
once armed") applied consistently — it was an implementation narrowing that it only reached
held systems, and it benefits live players; (ii) restores agent/human parity (a live player can
flee mid-fight, the headless agent can't). Both carry the plan's full test-modification license
for the affected behavior pins (meaning preserved: scout still loses to a garrison, top loadout
still wins, game still losable without engagement). Sequence: implement (i) → re-measure
50 sessions → add (ii) only if < 100%; then resume the lever iteration and the 300-run gate.

**Task 9 (i) landed (2026-07-07) — neutral-system gentling wired; measured insufficient ALONE
(as predicted → (ii) required):**
- New pure functions in `src/systems/campaign/hostileScaling.ts`: `neutralScaling(power, mode)`
  (incoming-damage mult lerps `NEUTRAL_SCALING_WEAK_MULT` → `NEUTRAL_SCALING_STRONG_MULT` = 1.0;
  offense UNSCALED — `hpMult` 1 — so armed ships face byte-identical neutral combat on NORMAL/GOD;
  HARD composes its config mult) and `combatScaling(power, mode, isHostile)` (the single dispatch
  point: held ⇒ `hostileScaling` 0.9→1.5, neutral ⇒ `neutralScaling`). Levers in `balance.ts`:
  `NEUTRAL_SCALING_WEAK_MULT` 0.4, `NEUTRAL_SCALING_STRONG_MULT` 1.0.
- `CombatModule.hostileMults` now dispatches through `combatScaling`, gated on the
  `getCampaignPeakPower` dep being wired (legacy DI sites — dep absent — stay byte-identical
  neutral 1.0). `SpaceFlightScene` already wires all three deps (Task 4), so the headless campaign
  harness picks the neutral gentling up automatically.
- **No existing pin rewritten**: the Task-4 `hostileScaling` endpoints (held) are untouched; the
  one neutral CombatModule pin (`hostileScalingCombat.test.ts` "neutral applies no scaling even at
  max power") holds verbatim because neutral at index 1 = 1.0 by construction. The listed
  `garrisonPowerScaling`/`adaptivePacing` pins did NOT need rewriting (the change is additive — a
  new neutral path, not a re-tuning of the held pins). Test-modification license was not consumed.
- New tests: 11 in `hostileScaling.test.ts` (`neutralScaling` endpoints/monotonicity/clamp/
  NORMAL≡GOD/HARD-compose/purity; `combatScaling` dispatch, neutral<held, maxed baseline) + 4 in
  `hostileScalingCombat.test.ts` (real CombatModule: weak/mid neutral gentling, offense unscaled,
  GOD floor on scaled neutral volley). Full unit suite green except the pre-existing
  SpaceFlightScene line-guard red (1901 `split` length; unmodified file, HEAD-red from Task 7 —
  verified via `git stash`; deferred to its own extraction per standing rule #6, as Task 8 did).
- **50-session re-measure (NORMAL, `NEUTRAL_SCALING_WEAK_MULT` 0.4):** win-rate **18.0 %**
  (9 win / 2 loss / 39 died) — statistically unchanged from the 18 % baseline. **Root cause
  confirmed** exactly as the escalation predicted: a single `agent.run(1)` step ticks up to 4
  combat frames (`PlayerAgent.waitOneDay`) and lands a MULTI-round volley before the agent gets a
  turn — so per-round gentling to 0.4× still accumulates past a 130-hull starter in one step. The
  weak ship never gets to flee. ⇒ **(ii) mid-combat agent reaction is required** to reach the
  gate; proceeding to it next per the approved sequence.

**Task 9 (ii) attempted + measured (2026-07-07) — ⚠️ INSUFFICIENT and self-defeating; the
win-rate gate is a genuine architectural blocker, ESCALATING to the user:**
- **(ii) implemented** as a harness seam (`PlayerAgent.ts`, no engine fork, agent/human parity):
  a non-combat-intent step (`waitOneDay(combatReactive)` / `executeMove`) now **breaks out the
  instant `combatModule.isActive` flips true**, returning control to `observe→decide` so the
  policy's outgunned-flee block gets a turn before the multi-round volley accumulates; plus an
  escape-transit `executeRouteTo` beeline in `completeWarp`. Paired with a **decoupled hostile
  weak-endpoint** (`HOSTILE_SCALING_HP_WEAK_MULT` 0.9 vs `HOSTILE_SCALING_DAMAGE_WEAK_MULT` 0.3 —
  gentle incoming fire without softening the garrison's effective HP, so "scout still loses to
  garrison" holds).
- **Measured 50-session sweeps (NORMAL):** the damage weak-endpoints are **not** the driver —
  deaths hold at ~33–37/50 regardless:
  - `0.3` held / `0.4` neutral (working-tree): **18 %** (37 died, 0 wedged)
  - `0.2` / `0.2`: **20 %** (36 died, 0 wedged)
  - `0.1` / `0.1`: **24 %** (33 died, **2 wedged**) — over-gentling **trades deaths for
    soft-lock wedges**: an immune-but-unwinnable weak ship can neither die nor out-DPS a
    garrison, so the fight never resolves and the calendar freezes (churn-timeout).
- **Root cause of the plateau (confirmed, not per-shot damage):** the deaths are **escape-crossing
  EXPOSURE**, not one-shots. `completeWarp` flies the ship across the whole system to the jump
  edge (up to 2000×`tick(50)`); NPCs fire every `combatFireIntervalMs` (2500 ms) the entire
  crossing. The pursuers that catch a fleeing weak ship are **interceptor-class**
  (`npcSpeed` 0.2 > starter 0.11 — overmind craft + pirate-role packs), which by the economy
  balance note are **deliberately un-outrunnable until the engine is upgraded**. So a weak ship
  cannot break weapon range mid-crossing and eats ~40 volleys — per-shot gentling only delays it,
  and gentling far enough to survive 40 volleys (~0.04×) just converts the death into an
  unresolvable frozen fight.
- **(ii) also REGRESSES an invariant** (root-cause signal, not a test to rewrite): the flee
  break-out makes the agent **flee→STAR_MAP→warp→arrive-into-a-fresh-fight→flee** churn — 7
  consecutive warps vs the cap of 2 — reddening `exploreNoWarpLoop.test.ts` (GREEN at committed
  HEAD, RED with the (ii) seam). Fixing the churn (respect the warp cadence) does **not** save the
  ship, because the crossing-exposure death is independent of the churn. So (ii) as a bounded
  harness change is **net-negative** (regression + no win-rate gain).
- **⚠️ ESCALATION (decision for the user):** the approved bounded mitigations — (i) neutral
  gentling, (ii) mid-combat reaction, and the full `balance.ts` lever iteration — **provably
  plateau at ~18–24 %**, confirming the prior escalation. Reaching 99 % requires a decision
  **outside an autonomous config/harness pass** (broad combat blast radius, reserved to the user
  per the plan's own escalation record above):
  1. **combat-exposure / NPC-aggro redesign** — e.g. gate wandering interceptor aggro on player
     power (a weak ship isn't hunted by neutral-space packs), or let a committed flee-jump fire
     from the near edge (short exposure) instead of a full-system crossing; and/or
  2. **the neural half (Tasks 10–11)** — but the net is a BC clone of the `MemoryHeuristicPolicy`
     teacher, so it can only match, not exceed, the teacher's ~18–24 %; the teacher must win first.
- **State left clean & green:** the buggy (ii) working-tree WIP was **reverted** (branch at
  committed HEAD `9b63771`, `exploreNoWarpLoop` green again; WIP preserved in `git stash@{0}` if
  the user wants to resume it). No existing test assertion was modified. The Task-9 gate
  checkboxes stay **unchecked** — marking them would misreport an unmet gate. The empirical
  finding above IS the deliverable of this pass; the win-rate gate awaits the user's architectural
  decision.

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
