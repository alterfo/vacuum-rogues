# Campaign Win-Rate: Toward 100% Win Rate, Not Before Day 1000

## Overview

Direct continuation of `docs/plans/completed/completed/20260713-campaign-win-rate-architecture.md`
(the "garrison-discount" plan), which explicitly escalated to the user rather than keep tuning
blind: its downward garrison-count discount mechanism measured **4.0% win-rate at 50 sessions**
(median win day 231), inside the pre-existing 2–24% plateau band and below its own ≥50% interim
gate. That plan's own escalation note named two concrete, unexplored candidates for a follow-up:
(1) pirate-held-system garrisons are explicitly and permanently unscaled by design
(`garrisonPowerScaling.test.ts:99-103,110-114` pins `pirateGarrisonCount` identical at power 0 vs
1) — the most likely dominant early-death source, and (2) the shipped discount itself is a
**knife-edge bug, not a graded ramp**: `overmindGarrisonPowerDiscount(p) = Math.floor((1 -
clamp01(p)) * maxDiscount)` at `maxDiscount = 1` only returns a nonzero discount at the exact
literal `powerIndex === 0`, and `campaignPeakPower` (a monotone ratchet) leaves 0 within the first
in-game tick of normal play — so the discount is realistically a no-op for the entire `0.02–0.15`
power band where the death census places ~86% of early deaths.

**This plan's directive (user, 2026-07-13): push toward 100% win-rate within the existing ≤1080-day
ceiling, with wins landing no earlier than day 1000** — i.e. tighten the acceptance target on both
axes at once: nobody should die/lose/timeout by day 1080 (today's dominant outcome), AND the
campaign should not resolve as a trivial early stomp (today's dominant outcome is the opposite
failure — nobody survives long enough to threaten an early win, so this floor is currently
unmeasured/moot, but any survivability fix that overshoots must not accidentally trade one failure
mode for the other).

**Honesty check, stated up front**: literal 100%/300-session (`≥300/300 win, 0 death/loss/timeout`)
would be an unprecedented result for this codebase — five escalation rounds across two prior plans
never cleared even a 25% plateau. This plan targets 100% as the goal and uses **staged interim
gates** (mirroring the prior plan's own convention) so real progress is measured and reported
honestly at each stage rather than silently accepting a worse number or fabricating a pass. If a
staged gate plateaus **despite this plan's new, larger lever set**, the escalation clause below
still applies — but unlike the prior plan, the user has already pre-authorized touching the
previously-out-of-scope pirate-garrison invariant (Task 1 below formally records that reversal),
so the next escalation point (if reached) is expected to be substantially further along than 4%,
not an immediate repeat.

## Context (from discovery — already gathered by the prior plan, not re-discovered)

- **Root cause 1 (dominant, ~86% of sessions)**: early death before `battleReadyDay` fires, days
  63–136, peak power 0.02–0.15. `battleReadyDay` fires in only ~10-16% of runs.
- **Root cause 2 (secondary, less evidenced recently)**: a fully battle-ready ship
  (`BATTLE_READY_MAX_HULL=180`/`BATTLE_READY_WEAPON_DAMAGE=30`) still can't reliably solo the fixed
  `GARRISON_MIN=5` standing garrison — grind-to-death instead of contesting the front.
- **Garrison discount mechanism** (`src/systems/campaign/hostileScaling.ts:overmindGarrisonPowerDiscount`,
  wired in `src/systems/npc/NpcGarrisonCombat.ts` `fillGarrison()` `:499-` — Overmind-only today):
  `Math.floor((1 - clamp01(powerIndex)) * maxDiscount)`. `OVERMIND_GARRISON_POWER_MAX_DISCOUNT = 1`
  in `src/config/balance.ts` (currently a knife-edge; **needs `≥ 2` for `floor()` to have interior
  room**, and — because `1 - p` stays close to `1` across the whole `0.02–0.15` early-death band —
  a `maxDiscount` in the `3-4` range gives a **near-maximal, not marginal**, discount throughout
  that entire vulnerable window, not just at the literal start of a run). `GARRISON_DISCOUNT_FLOOR = 1`
  caps how far it can go (`GARRISON_MIN=5` floor 1 ⇒ max safe discount without hitting 0 is `4`).
- **GOD-mode regression from Task 2 of the prior plan**: `maxDiscount=2` starved GOD-mode
  combat-loot income (fewer garrison ships to kill ⇒ slower peak-power growth), timing out
  `sessionCompetence.test.ts`'s GOD-mode milestone probe (seed `CAMPAIGN-CAPACITY-0`, 200 days,
  gate `POWER_INDEX_BATTLE_READY_THRESHOLD=0.13`). GOD mode already floors hull above 0
  (`godMode.ts`) — it has **no survivability upside** to gain from a smaller garrison, only this
  downside. The prior plan shrank `maxDiscount` to dodge this; its own code-review addendum
  recommended the opposite fix — **exempt GOD mode**, keep `maxDiscount` large for NORMAL/HARD.
- **Pirate garrison scope reversal**: `garrisonPowerScaling.test.ts:99-103,110-114` currently pins
  `pirateGarrisonCount(power=0) === pirateGarrisonCount(power=1)` with an explicit header comment:
  "Pirate garrisons are NOT power-scaled — the pressure ramp is the Overmind's." This plan's Task 1
  formally reverses that design invariant (with the user's direction as the authorizing decision,
  matching this project's standing rule that pinned-test changes need an explicit recorded scope
  decision, not a silent weakening) — `fillGarrison(..., overmind=false)` currently always passes
  `powerBonus/discount = 0` (`NpcGarrisonCombat.ts`).
- **Diagnostic finding already ruled out**: `NEUTRAL_SCALING_WEAK_MULT` (0.4→0.15, a 62% cut to
  wandering-neutral-pack incoming damage) produced byte-identical session outcomes to baseline at
  N=50 — the dominant early-death mode is not neutral-space wandering-pack damage. Do not re-try
  this lever without new evidence.
- **Levers ruled out by existing pins** (do not touch without a fresh, explicit scope decision same
  as the pirate reversal above): `HOSTILE_SCALING_WEAK_MULT` (exact-value pin,
  `hostileScaling.test.ts:44`), `OVERMIND_GARRISON_POWER_MAX_BONUS` (greater-than-zero pin,
  `hostileScaling.test.ts:220`).
- **Adaptive pacing levers** (for the "not before day 1000" floor if survivability fixes overshoot):
  `src/systems/campaign/adaptivePacing.ts` — `ADAPTIVE_GRACE_DAYS=90` (no spread before grace),
  `adaptiveSpreadIntervalDays` lerps `ADAPTIVE_SPREAD_SLOW_DAYS=45`→`ADAPTIVE_SPREAD_FAST_DAYS=10`
  keyed on ratcheted `campaignPeakPower`; `ADAPTIVE_CREEP_START_DAY=360`/`ADAPTIVE_CREEP_MIN_DAYS=12`
  floor the cadence after day 360 regardless of power. If Task 4+'s measurement shows wins
  clustering well before day 1000 once survivability improves, these are the pacing-side levers to
  slow down, not more garrison-discount tuning.
- **Win invariants that must NOT change**: `src/systems/overmind/overmindSpread.ts` — `engaged`
  (`lastSpreadDay >= 0`) and `playerParticipated` (`playerLiberations > 0`) gates. This plan changes
  difficulty and pacing, never what counts as a legitimate win.
- **Campaign harness**: `npm run letsplay:campaign` (`src/tests/playtest/letsplay/campaign.run.ts` +
  `campaignMetrics.ts`), env knobs `CAMPAIGN_SESSIONS`/`CAMPAIGN_DAYS`/`CAMPAIGN_WALL_MS`. Reports
  win/loss/died/timeout, resolution day, `battleReadyDay`/`firstLiberationDay`, peak power land in
  gitignored `.letsplay/`.
- **Runtime note**: 300-session acceptance runs are slow (prior plan deferred them to
  Post-Completion). This plan's sibling
  `docs/plans/20260713-autosave-autopilot-resume.md` adds autosave/resume for the **live dev
  autopilot** (different code path — `AutopilotController`, not this harness); it does not speed up
  `letsplay:campaign` itself. If iteration wall-clock becomes the bottleneck, that is a separate,
  explicitly out-of-scope-here concern (the harness has its own `CAMPAIGN_WALL_MS` cutoff already).

## Development Approach

- **Testing approach**: Regular (measure → change → re-measure), same as both prior plans — this is
  a probabilistic multi-session metric, not a single failing assertion. Every task that changes
  production code still gets unit/playtest coverage for the new code paths.
- Complete each task fully before moving to the next.
- Make small, focused changes — no refactor bundled into any of these fixes.
- **CRITICAL: every task that touches production code MUST include new/updated tests.**
- **CRITICAL: all tests must pass before starting the next task** — no exceptions.
- **CRITICAL: update this plan file when scope changes during implementation** — near-certain, since
  each measurement round determines the next lever to try.
- Any Overmind pacing/garrison-count/combat-scaling lever lives in `src/config/balance.ts` ("tune
  levers, never at call sites" — standing project rule).
- **Pinned-test changes need an explicit recorded decision** (mirrors the prior plan's Task 1
  pattern) — this plan pre-authorizes exactly one such reversal (pirate garrisons, Task 1 below);
  any other pinned assertion encountered mid-plan needs its own fresh recorded decision, not a
  silent edit.
- **Escalation clause (same as the prior plan, adjusted)**: if a staged interim gate plateaus
  despite this plan's full lever set (garrison discount fixed + pirate garrisons + pacing levers),
  stop and report the honest measured numbers to the user rather than continuing to iterate blindly
  or loosening the win invariants to fake a better result. Given the user's explicit 100% directive,
  "report and ask" at that point should include a concrete recommendation for what architectural
  change (not parameter tuning) might be needed next — parameter-space within the existing
  garrison/combat-scaling mechanism appears close to exhausted after this plan's lever set.

## Testing Strategy

- **Unit tests**: for the retuned discount constant, the GOD-mode exemption, and the new
  pirate-garrison discount function (mirrors the existing Overmind one's test shape).
- **Real-engine / letsplay playtest**: `npm run letsplay:ci` must stay green throughout (fast
  pre-push gate; does not itself measure win-rate).
- **Campaign harness** (env-gated, the actual acceptance measure): small `CAMPAIGN_SESSIONS` (5-10)
  for fast in-task iteration, 50-session measures at each staged gate, the full 300-session
  acceptance run only once the final staged gate is stably met (Post-Completion, matches both prior
  plans' cadence).
- No new E2E coverage — headless balance/simulation change, no UI surface.

## Progress Tracking

- Mark completed items with `[x]` immediately when done.
- Add newly discovered tasks with ➕ prefix.
- Document issues/blockers with ⚠️ prefix.
- Update this plan if implementation deviates from original scope.

## What Goes Where

- **Implementation Steps** (`[ ]` checkboxes): the discount-mechanism fix, the pirate-garrison
  extension, the GOD-mode exemption, the pacing safety-check, and the staged measure/tune loop up to
  a defined final gate.
- **Post-Completion** (no checkboxes): the full 300-session acceptance re-run, and any live-browser
  feel-check of the now-more-frequent early liberations/wins.

## Implementation Steps

### Task 1: Confirm scope — pirate-garrison reversal, GOD exemption shape, and staged gates

- [x] Run `gitnexus impact` on `overmindGarrisonPowerDiscount`, `fillGarrison`, `GARRISON_MIN`,
      `OVERMIND_GARRISON_POWER_MAX_DISCOUNT`, and `pirateGarrisonCount` per root `CLAUDE.md`'s
      blast-radius rule; report risk before editing (expect a stale/partial index per the prior
      plan's own Task 1 finding — cross-check with direct grep if so).
- [x] **Record the formal scope decision**: pirate-held-system garrisons ARE now in scope for the
      downward discount, reversing `garrisonPowerScaling.test.ts`'s pinned invariant
      — authorized by the user's explicit 2026-07-13 directive to push toward 100% win-rate,
      informed by the prior plan's own diagnosis that pirate garrisons are the most likely dominant
      remaining early-death source. Test file's header comment updated to record the reversal (the
      pirate assertion itself flips in Task 3).
- [x] Decide and record the exact `OVERMIND_GARRISON_POWER_MAX_DISCOUNT` retune: raise from `1` to
      the largest value that keeps `GARRISON_DISCOUNT_FLOOR=1` meaningful (`GARRISON_MIN=5 - 4 = 1`,
      so `4` is the structural ceiling) — record why `4` (or a smaller value if Task 3's GOD-mode
      exemption still isn't enough headroom) is the starting point, not a guess.
- [x] Decide and record the GOD-mode exemption shape: `fillGarrison`'s discount lookup should pass
      `0` discount when `mode === GOD` (GOD already floors hull — no survivability upside, only the
      Task-2-of-the-prior-plan combat-loot regression risk) — confirm this is a cleaner fix than
      shrinking the constant, per the prior plan's own code-review addendum recommendation.
- [x] Decide and record staged interim gates (mirrors the prior plan's single-gate pattern, extended
      to multiple stages given the 100% target): **Gate A** (Task 4, 50 sessions) win-rate materially
      above the prior 4% plateau — target ≥ 40%; **Gate B** (Task 7, 50 sessions) ≥ 80% win-rate,
      median win day ≥ 1000; **Final gate** (Post-Completion, 300 sessions) ≥ 99% win-rate (≥
      297/300, matching the original three-year-campaign plan's own acceptance bar as the practical
      ceiling for "100%"), median win day within `[1000, 1095]`. Record here if these need
      revision after Gate A's actual measurement.
- [x] No code changes in this task — confirmation and decision-recording only (the one exception is
      the pinned test's *header comment*, updated to record the scope reversal per the item above;
      no assertions or production code touched).

#### Task 1 — Decisions recorded (2026-07-13)

**Blast radius (STANDING RULE 1).** The GitNexus workspace index is stale for the discount symbol
(`overmindGarrisonPowerDiscount` → "not found"), exactly as the prior plan's Task 1 predicted;
cross-checked with direct grep:
- `overmindGarrisonPowerDiscount` — **LOW risk**. Single production caller: `NpcGarrisonCombat.ts:508`
  inside `fillGarrison`. Defined `hostileScaling.ts:190`. Tests: `garrisonPowerScaling.test.ts`,
  `hostileScaling.test.ts`. No other consumers.
- `fillGarrison` — **LOW risk** (GitNexus `impact`, exact). 1 direct caller (`ensureGarrison`, both
  the `overmind=true` @484 and `overmind=false` @487 branches), module `Npc`, 0 execution flows.
- `GARRISON_MIN=5`, `GARRISON_MAX=10`, `GARRISON_DISCOUNT_FLOOR=1` — module-private consts in
  `NpcGarrisonCombat.ts:56/58/64`; only `fillGarrison` reads them. LOW risk.
- `OVERMIND_GARRISON_POWER_MAX_DISCOUNT=1` — `balance.ts:935`; consumed only as the default param of
  `overmindGarrisonPowerDiscount`. LOW risk.
- `pirateGarrisonCount` — test helper only (`garrisonPowerScaling.test.ts:68`), no production symbol.

**Note — the discount is wired in `NpcGarrisonCombat.ts`, not `NpcSimulator.ts`.** The plan's
Context section and the prior plan refer to `NpcSimulator.fillGarrison`; the live call site is
`NpcGarrisonCombat.ts::fillGarrison` (composed by `NpcSimulator` per CLAUDE.md's Overmind section).
`this.gameMode` is already in scope there (used at `:518` for `scaledGarrisonRange`), so the GOD
exemption needs no new plumbing.

**Decision — `OVERMIND_GARRISON_POWER_MAX_DISCOUNT = 4` (from 1).** Structural ceiling is `4`
(`GARRISON_MIN 5 − GARRISON_DISCOUNT_FLOOR 1`). Starting at the ceiling, not a smaller guess,
because: (a) `floor((1−p)·4)` gives a graded ramp `4→3→2→1→0` across `p∈[0,1)` — an interior step at
every `0.25` power band, so the whole `0.02–0.15` early-death band gets a near-maximal `3–4`-ship
discount (vs. the old knife-edge that only fired at literal `p===0`); (b) the sole prior reason to
stay small was the GOD-mode combat-loot regression, which the GOD exemption below removes outright,
so there is no remaining downside to keeping NORMAL/HARD at the full ceiling. If Task 4's Gate-A
measure shows over-softening (grind-to-death gone but wins landing far too early / no fight left),
step down `4→3` rather than re-shrinking blind.

**Decision — GOD-mode exemption shape: `discount = 0` when `this.gameMode === "GOD"` at the
`fillGarrison` call site** (`NpcGarrisonCombat.ts:508`), i.e. `const powerDiscount = overmind &&
this.gameMode !== "GOD" ? overmindGarrisonPowerDiscount(peakPower) : 0`. Confirmed cleaner than
shrinking the constant (the prior plan's code-review addendum's own recommendation): GOD already
floors hull above 0 (`godMode.ts`), so the discount has zero survivability upside there and only the
measured combat-loot-income downside; exempting GOD lets NORMAL/HARD keep the full `maxDiscount=4`.
The upward `overmindGarrisonPowerBonus` stays unchanged for GOD (it never regressed the loot probe).

**Decision — pirate discount reuses the Overmind shape and constant** (for Task 3): pirate systems
already fill to the same unscaled `[GARRISON_MIN 5, GARRISON_MAX 10]` baseline
(`NpcGarrisonCombat.ts:475`), so no pirate-specific constant is warranted. Task 3 makes the discount
apply to the `overmind=false` branch too — the simplest correct form is to drop the
`overmind ?`/`: 0` guard on `powerDiscount` (keeping only the GOD exemption) so both branches call
`overmindGarrisonPowerDiscount(peakPower)` with the same `maxDiscount=4`. Pirates get the GOD
exemption as well (same rationale — GOD hull floor). The upward `powerBonus` stays Overmind-only
(the pressure-ramp bonus is not part of this reversal). Rename/generalize the function name in Task 3
if the Overmind-specific name reads wrong once both branches use it.

**Decision — staged gates confirmed as written**, no revision pre-measurement: Gate A (Task 4, 50
sessions) ≥ 40%; Gate B (Task 7, 50 sessions) ≥ 80% win-rate & median win day ≥ 1000; Final
(Post-Completion, 300 sessions) ≥ 99% (≥ 297/300) & median win day ∈ `[1000, 1095]`. Revisit only if
Gate A's actual numbers demand it.

### Task 2: Fix the garrison-discount knife-edge + add GOD-mode exemption

- [x] Retune `OVERMIND_GARRISON_POWER_MAX_DISCOUNT` in `src/config/balance.ts` to Task 1's decided
      value; update the doc comment to describe the graded-ramp behavior (not the old knife-edge
      note) and reference this plan.
- [x] Add the GOD-mode exemption in `NpcGarrisonCombat.ts`'s `fillGarrison()` (or the discount
      lookup call site) per Task 1's decided shape.
- [x] Write tests: `overmindGarrisonPowerDiscount` at the new `maxDiscount` produces a graded
      (non-knife-edge) value across the `0.02-0.15` power band (extend `hostileScaling.test.ts`);
      GOD-mode fillGarrison path gets `0` discount regardless of power (extend
      `garrisonPowerScaling.test.ts`); confirm `sessionCompetence.test.ts`'s GOD-mode milestone probe
      stays green (this is the regression this exemption specifically targets).
- [x] Run affected unit tests — must pass before Task 3.

#### Task 2 outcome (implemented 2026-07-15)

`OVERMIND_GARRISON_POWER_MAX_DISCOUNT` raised `1 → 4` (`balance.ts`); GOD exemption added at the
`fillGarrison` call site (`NpcGarrisonCombat.ts`): `powerDiscount = overmind && this.gameMode !==
"GOD" ? overmindGarrisonPowerDiscount(peakPower) : 0`. **Fresh pinned-test decision** (not
pre-authorized by Task 1, per this plan's own "any other pinned assertion ... needs its own fresh
recorded decision" rule): `hostileScaling.test.ts`'s knife-edge-pinning test explicitly asserted the
OLD bug (`maxDiscount=1` ⇒ any power `> 0` reads as undiscounted) — user chose to replace it with a
graded-ramp assertion (`0.02`/`0.15`/`0.001`/`0.01` all discount by `maxDiscount − 1 = 3`) rather
than keep it pinned at an explicit `maxDiscount=1` in isolation. New GOD-exemption test added to
`garrisonPowerScaling.test.ts` (weak GOD player ⇒ undiscounted `[5,10]`). All 71 tests across the
affected files pass (`hostileScaling`, `garrisonPowerScaling`, `hostileGarrison`,
`garrisonPersistence`, `garrisonGrowth`, `combatLiberation`, `sessionCompetence`).

### Task 3: Add the pirate-garrison discount

- [x] Add `pirateGarrisonPowerDiscount` (or extend the existing function to take an `overmind: boolean`
      shape decided in Task 1) so `fillGarrison(..., overmind=false)` also receives a downward
      discount — mirror the Overmind function's exact graded-ramp shape unless Task 1 recorded a
      reason for pirates to scale differently (e.g. a different `maxDiscount` since pirate systems
      may have different baseline counts — check `fillGarrison`'s pirate branch before assuming
      identical constants).
- [x] Update `garrisonPowerScaling.test.ts`'s pirate assertions per Task 1's recorded reversal —
      pirate garrison count now varies with power, same shape as the Overmind-side test.
- [x] Write tests for the new/extended function's pirate-specific behavior (weak player → smaller
      pirate garrison, maxed player → today's undiscounted range, GOD-mode exemption if Task 1
      decided pirates also need it).
- [x] Run affected unit tests, `npm run letsplay:ci`, `npm run test:playtest` — all must pass before
      Task 4.

#### Task 3 outcome (implemented 2026-07-15)

Implemented Task 1's exact recorded shape: dropped the `overmind ? : 0` guard on `powerDiscount` in
`fillGarrison` (`NpcGarrisonCombat.ts`), keeping only the GOD-mode exemption — `powerDiscount =
this.gameMode !== "GOD" ? overmindGarrisonPowerDiscount(peakPower) : 0`, applied to both branches.
`overmindGarrisonPowerBonus` stays Overmind-only (unchanged). Updated `garrisonPowerScaling.test.ts`'s
pirate assertions per Task 1's pre-authorized reversal, plus new tests for the discount shape,
monotonicity, and GOD exemption on the pirate branch.

**Collateral fallout (blast radius wider than Task 1's LOW-risk call-graph estimate — draw-count
drift, not logic bugs):** raising the discount ceiling changes how many RNG draws `fillGarrison`
consumes per tick, which — via the shared sequential `SeededRNG` several unrelated tests reuse across
a tick/day/session — shifted downstream draw outcomes in 5 fixed-seed tests unrelated to garrison
discount:
- `captureEvent.test.ts` ("does not capture a defended system"): re-seeded the per-tick RNG
  (`def_hold` → `def_hold_1`, re-verified stable across a spread of alternates).
- `overmindAggression.test.ts` / `npcRoles.test.ts` (convoy assembly): both pinned their `NpcSimulator`
  at `attachCampaignPeakPower(() => 1)` (max ratchet, discount phases to 0) since neither test is
  about discount economics — the *unpinned* zero-power default was making a 2-system toy galaxy's
  only hostile system fully wipe out (permanently emptying `assembleConvoys`'/capture-fleet logic's
  only possible target) before its budget elapsed.
- `warpTargeting.test.ts`: the day-60 Overmind capture-fleet target-selection roll (a pre-existing,
  discount-unrelated `rng.nextInt` over all frontier borders) retargeted onto the player's OWN start
  system under the old harness seed, capturing home and killing the player mid-escape-warp — re-seeded
  the harness (`LETSPLAY_WARP_TARGETING_SESSION` → `_1`, re-verified stable across several variants).
  User-confirmed as RNG collateral, not a systemic new risk (target choice is uniform over frontier
  borders regardless of discount magnitude — only which upstream draws feed the roll shifted).
- `hardScaling.test.ts` ("NORMAL garrison stays within today's [5,10] baseline"): this one is NOT
  draw-count collateral — it directly pinned the exact invariant Task 1/3 intentionally reverses
  (pirate garrison at zero power, NORMAL mode). Updated to assert the new discounted range
  (`Math.max(1, 5-discount)` to `10-discount`), mirroring `garrisonPowerScaling.test.ts`'s pattern.

All fixes were pinned-test edits explicitly authorized by the user per-case (not silent), consistent
with this plan's "any other pinned assertion... needs its own fresh recorded decision" rule. Full
suite green after fixes: 5848 unit tests, `letsplay:ci` (108/108), `test:playtest` (766/775, 9 skipped).

### Task 4: First measured re-run (Gate A)

- [x] Run `npm run letsplay:campaign` with `CAMPAIGN_SESSIONS=50`; record win-rate, median win/death
      day, `battleReadyDay` rate, death taxonomy (early vs grind-to-death, Overmind-held vs
      pirate-held now that pirates are discounted too) in this plan.
- [x] Compare against Task 1's Gate A target (≥ 40%) and the prior plan's 4% baseline. If Gate A is
      not met, this task's own escalation applies **before** proceeding to Task 5/6: analyze
      whether the shortfall is early-death-dominant (Task 2/3's levers not enough) or a new failure
      mode (e.g. grind-to-death re-emerging now that garrisons are smaller but the player still
      dies fighting them slowly) — record findings, do not silently proceed to Task 5 without this
      analysis.
- [x] `npm run letsplay:ci` and `npm run test:playtest` must stay green (confirmed in Task 3's
      outcome note; unaffected by this measurement-only task).

#### Task 4 outcome (measured 2026-07-15) — Gate A NOT MET, escalating per this task's own clause

`npm run letsplay:campaign` with `CAMPAIGN_SESSIONS=50` (raw results: `.letsplay/campaign-report.json`):

| Metric | Result | Gate A target | Prior plan's baseline |
|---|---|---|---|
| Win rate | **2.0% (1/50)** | ≥ 40% | 4.0% (2/50) |
| Win day (the one win) | d98 | — | — |
| `battleReadyDay` rate | **4.0% (2/50)** | — | ~10–16% (context estimate) |
| Median peak power | 0.07 | ≥ 0.13 for battle-ready | — |
| Outcomes | 44 died, 4 timeout, 1 loss (Overmind won), 1 win | — | — |
| Median death day (44 died) | d186 | — | — |
| Deaths before day 200 | 25/44 (57%) | — | — |
| Deaths with **zero** liberations ever | 11/44 (days 62–125) | — | — |
| Deaths with **≥1** liberation before dying | 33/44 (75%) | — | — |

**Gate A target (≥ 40%) missed by a wide margin — 2.0% is not an improvement over the prior plan's
4.0% plateau, it's statistically indistinguishable (1 vs 2 wins out of 50) despite this plan's full
lever set** (discount raised to the structural ceiling `1→4`, GOD-mode exemption removing the prior
plan's only reason to shrink it, and the pirate-garrison reversal extending the same discount to the
other previously-unscaled garrison source).

**Diagnosis — this is a new failure-mode signature, not simply "early-death-dominant, levers not
enough":** 75% of deaths (33/44) happen **after** the player already achieved at least one
liberation — i.e. most runs get real early traction (consistent with the garrison discount helping
some), but then still die later (median day 186) without ever reaching strict battle-ready (96% never
do, median peak power stays at 0.07, well below the `POWER_INDEX_BATTLE_READY_THRESHOLD=0.13` floor).
Only 11/44 (25% of deaths) are the "zero liberation, pure early death" shape this plan's levers
directly targeted. This matches the **prior plan's root cause 2** ("a fully battle-ready ship still
can't reliably solo the fixed `GARRISON_MIN=5` standing garrison — grind-to-death instead of
contesting the front") generalized down a tier: even *sub*-battle-ready players who land one
liberation can't sustain the follow-on attrition, and keep dying well before accumulating enough
peak power to ever cross the battle-ready threshold. Garrison **count** at the moment of assault is
not this campaign's binding constraint — survivability of the ongoing campaign (repeated fights,
economy pressure, Overmind's own counter-expansion) is.

**Escalation (per this plan's own clause and Task 4's checklist): stopping here, not proceeding to
Task 5 blind.** Garrison-discount parameter space (this plan's entire lever set) appears exhausted —
maxing it out at the structural ceiling and extending it to pirates produced no measurable win-rate
movement. Recommendation for the user: the next lever is very likely **not** further
garrison-count/discount tuning but one of (a) `hostileScaling.ts`'s HP/damage multipliers
(`HOSTILE_SCALING_WEAK_MULT`, currently pinned — would need its own fresh scope decision) — the
actual in-combat lethality per engagement, not how many ships show up; (b) economy-side survivability
(credit/repair pacing so a weak player can actually recover between fights rather than accumulating
irreversible attrition); or (c) revisiting whether "one liberation, then die on the next one" is a
pacing problem in `adaptivePacing.ts`'s spread cadence outpacing the player's real recovery rate,
independent of any single-fight difficulty number. Awaiting user direction before touching any of
these (all currently out of this plan's authorized scope).

### Task 5: Escalation follow-up — per-fight lethality lever (`HOSTILE_SCALING_WEAK_MULT`)

Authorized by the user (2026-07-15) after Task 4's Gate A escalation: the garrison-count/discount
lever space is exhausted (Task 4's measurement), and the death taxonomy points at ongoing per-fight
lethality (not assault-time garrison count) as the binding constraint — 75% of deaths happen after
the player already landed ≥1 liberation, at a median peak power (0.07) where `hostileScaling()`'s
lerp is still close to `HOSTILE_SCALING_WEAK_MULT` (currently `0.9` — only a 10% gentling even at
literal power 0). This constant is **exact-value pinned** (`hostileScaling.test.ts:44`, listed in
this plan's Context section as a "levers ruled out by existing pins" item) — the user's authorization
here is the fresh scope decision required to touch it.

- [x] Run `gitnexus impact` on `HOSTILE_SCALING_WEAK_MULT` and `hostileScaling` per root `CLAUDE.md`'s
      blast-radius rule; report risk before editing.
- [x] **Record the formal scope decision**: `HOSTILE_SCALING_WEAK_MULT`'s pinned exact value (`0.9`)
      is now in scope for retuning downward — reversing the "levers ruled out by existing pins"
      status this plan's Context section originally recorded for it, authorized by the user's
      2026-07-15 direction following Task 4's escalation. Update the pinned test's assertion (and its
      header comment) to reflect the new value once chosen, not a silent edit.
- [x] Decide and record the new value: `hostileScaling()`'s lerp is `weakMult + (strong - weakMult) *
      clamp01(power)` — since median measured peak power is `0.07` (far below the `0.13` battle-ready
      floor), the effective multiplier most of a run is close to `weakMult` itself. Pick a value that
      meaningfully reduces per-fight lethality across the whole `0.02–0.15` early/mid band (e.g. in
      the `0.4–0.6` range, mirroring the neutral-system gentling's own magnitude in
      `NEUTRAL_SCALING_WEAK_MULT`) — record the chosen value and why, not a guess.

#### Task 5 — Decisions recorded (2026-07-15)

**Blast radius (STANDING RULE 1).** GitNexus's workspace index is stale for this symbol too (`impact`
returns "not found"), matching Task 1's own finding for the discount symbols; cross-checked with
direct grep: `HOSTILE_SCALING_WEAK_MULT` — **LOW risk**, single production consumer
(`hostileScaling.ts`'s `DEFAULT_HOSTILE_SCALING_CONFIG.weakMult`). `hostileScaling()` — **LOW risk**,
single production caller (`CombatModule.ts:145`). No other consumers of either symbol outside tests.

**Decision — `HOSTILE_SCALING_WEAK_MULT = 0.5` (from 0.9), revised from an initial `0.4`.** First
choice was an exact match to `NEUTRAL_SCALING_WEAK_MULT` (0.4), reusing this codebase's one validated
"gentle while weak" magnitude rather than inventing a second constant — but that literal match
collapsed `combatScaling`'s own pinned "held garrison is strictly harder than neutral wandering
combat" invariant at zero power (both landed on exactly 0.4, breaking
`toBeLessThan`). Held-system fights are a deliberately-engaged challenge and must stay harder than
incidental neutral-space combat, so `0.5` keeps that gradient intact while still delivering most of
the same cut. At `weakMult=0.5`, `damageMultStrong=1.5`: a literal-power-0 player takes 0.5× damage
(was 0.9×, a 44% cut) in held-system fights; at the median measured peak power (0.07), the lerped
multiplier is `≈0.57` (was `≈0.877`) — a real reduction across the exact `0.02–0.15` band Task 4
identified as where 86%+ of the campaign's difficulty pressure concentrates. `hpMult` is affected
identically (same lerp), so both incoming damage AND effective enemy HP soften together —
deliberately not splitting them, since Task 4's diagnosis was general "can't sustain ongoing
attrition," not specifically "enemies have too much HP" vs. "enemies hit too hard."
- [x] Apply the retune in `src/config/balance.ts`; update `hostileScaling.test.ts`'s pinned assertion
      (`toBeCloseTo(0.9, 5)` → the new value) and its surrounding doc comments. — landed:
      `HOSTILE_SCALING_WEAK_MULT = 0.5` (`balance.ts:1223`), test asserts `toBeCloseTo(0.5, 5)`
      (`hostileScaling.test.ts:48`). Verified in-tree 2026-07-25.
- [x] Write/extend tests: `hostileScaling()` at the new `weakMult` produces meaningfully reduced
      HP/damage multipliers across the measured early/mid power band; monotonicity and HARD-mode
      composition tests stay valid. — landed: `hostileScaling.test.ts` pins `hpMult`/`damageMult` at
      the new `weakMult` plus monotonicity, all green.
- [x] Run affected unit tests, `npm run letsplay:ci`, `npm run test:playtest` — must pass before
      re-measuring. — verified 2026-07-25: `hostileScaling.test.ts` + `garrisonPowerScaling.test.ts`
      green (34/34); full-suite/`letsplay:ci`/`test:playtest` green history recorded in the outcome
      notes below.
- [x] Re-run `npm run letsplay:campaign` with a small `CAMPAIGN_SESSIONS` (5–10) for fast directional
      feedback before committing to a full 50-session Gate A re-run — record whether death taxonomy
      shifts (fewer post-liberation deaths, higher battleReadyDay rate) in the expected direction.
- [x] Full 50-session re-measure against Gate A (≥ 40%) once directional signal looks right; record
      results here. If still short, apply this plan's escalation clause again rather than iterating
      blindly — this is now the *second* lever tried, and honesty about diminishing returns matters
      more than a third guess.

#### Task 5 outcome (measured 2026-07-15) — retune is a confirmed NO-OP for this seed set, not a plateau

Full 50-session re-measure: **byte-identical to the pre-Task-5 Gate A run** — same win rate (2.0%,
1/50, same seed `CAMPAIGN-14` at `d98`), same `battleReadyDay` rate (4.0%), same median death day
(185 vs 186), same per-session resolution days/steps/credits/peak-power down to the individual seed.
This is not measurement noise; it is byte-for-byte identical output, meaning `HOSTILE_SCALING_WEAK_MULT`
was **never actually exercised** by any of these 50 sessions.

**Root-cause investigation (dedicated sub-agent read, not guessed):** `hostileScaling()` (the
`HOSTILE_SCALING_WEAK_MULT`-driven function) only fires when the player is physically standing
**inside an already-captured Overmind/pirate system** (`combatScaling()`,
`src/systems/campaign/hostileScaling.ts:140-152`) — every other fight (including neutral-system
wandering hostiles/pirates) routes through the *different* `neutralScaling()`/
`NEUTRAL_SCALING_WEAK_MULT` path. The only place the heuristic policy deliberately picks a fight
inside a held system is the "Overmind-slayer" tier
(`MemoryHeuristicPolicy.ts:865-900`), gated on `isBattleReady()` (`maxHull ≥ 180`, `weaponDamage ≥
30`). Per `.claude/docs/systems/overmind.md`'s own measured history, **~86% of sessions die before
ever reaching battle-ready** (days 63–136, peak power 0.02–0.15) — i.e. before the code path this
lever touches is ever reached. The wiring (`isHostileSystem`/`getCampaignPeakPower`, verified live
in `combatModuleDeps.ts:111-115`) is correct; the lever is just structurally unreachable for the
dominant death population.

**This makes Task 5 the SECOND consecutive lever confirmed inert, not merely insufficient** — and for
a documented reason, not a mystery: this plan's own Context section already recorded that a
`NEUTRAL_SCALING_WEAK_MULT` sweep (the *other* combat-scaling half, which IS reachable this early)
"produced byte-identical session outcomes to baseline at N=50 — the dominant early-death mode is not
neutral-space wandering-pack damage." Between the two, both of this codebase's combat-lethality
levers are now empirically ruled out as touching the actual early-death mechanism.

#### Root cause found (2026-07-15) — NOT a balance constant, a combat-mechanics gap

Direct log analysis of every recorded death in the Gate A run (44/44 sampled `GameOverScene`
transitions, `.letsplay/`-adjacent session logs) shows a single, consistent, universal pattern
immediately preceding death: within the **same engine tick**, the player engages 1–5 already-present
hostile ships back to back (`In-flight combat: engaged <id>` × N), then dies instantly — no surviving
multi-tick exchange, ever. This happens whether arriving at an already-garrisoned held system or a
system a capture fleet just finished seizing.

Traced to two concrete mechanisms in the just-shipped Tactical Pause-and-Plan system
(`docs/plans/20260713-tactical-pause-combat-rework.md`), which was built specifically to prevent this
class of instant multi-hit kill:
1. **Synchronized fire timers**: `CombatModule.addCombatant()` resets every joining NPC's fire timer
   to `0` (`CombatModule.ts:440`). When N hostiles are already present on arrival (a standing garrison
   or a freshly-folded capture fleet, all already inside `weaponRange`), they are perfectly
   lock-stepped — all N cross the `combatFireIntervalMs=2500` threshold (`balance.ts:405`) on the
   exact same tick, guaranteeing a synchronized volley rather than a staggered one.
2. **Round budget checked per-combatant, not per-frame**: `roundBudgetSpent()`
   (`CombatModule.ts:634-643`) is checked before *each* NPC's attack is processed, but the budget
   (`combatRoundHullFraction: 0.34`, `balance.ts:435`) only trips *after* cumulative damage crosses it
   — by design "the shot that crosses the budget still lands in full" (`combatRounds.ts:59-63`).
   Several of N lock-stepped hits land within one `update()` call before the trip is even noticed.

The letsplay agent's own `PlayerAgent.driveAttack` (`PlayerAgent.ts:854-864`) compounds this by
calling `confirmPlanningIfOpen` before the first tick, collapsing the reaction window to zero ticks
of actual tactical decision-making — but mechanism (1) is a **production combat-mechanics gap**, not
an artifact of the harness: any player (human or agent) who confirms a plan against a multi-ship
garrison faces the same synchronized volley once EXECUTING starts, since the timers were already
zeroed at join time regardless of who's driving.

**Why this explains BOTH prior levers' no-op results**: reducing garrison ship COUNT (Task 2/3, down
to a floor of 1) still leaves ≥1 ship that can land its full hit; halving per-hit damage (Task 5)
doesn't help when 2–5 hits ALL land in the same ungated frame before the round budget can stop
anything. Neither lever touches "N synchronized hits landing in one frame" — the actual mechanism.

**Escalating per this plan's clause — this is an architectural change, not parameter tuning**, exactly
the kind of finding the plan's own escalation clause anticipated needing to name. Awaiting user
direction before touching production combat code (out of this plan's current authorized scope, and
touches the just-shipped pause-and-plan system from a separate completed plan).

#### Combat-mechanics fix #1 implemented (2026-07-15) — current-hull round budget, verified but measured as a THIRD no-op

User authorized going deeper. Found and fixed a real, distinct production bug:
`roundIsComplete()` (`src/systems/combat/combatRounds.ts`) computed the per-round incoming-damage
budget off the ship's **max** hull, never its **current** hull — a ship that entered a round already
damaged (the campaign-common case) got the same full-hull-sized allowance as a fresh ship, so a
volley sized to be "safe from full hull" could still exceed its actual remaining hull. Fixed:
`roundDamageBudget(Math.min(hull, maxHull), config)`. A **pre-existing pinned test**
(`combatRounds.test.ts:102`, `roundIsComplete(49, 51, 100, HALF)` expected `false`) locked the old,
buggy semantics — updated with a recorded rationale (fresh scope decision, authorized by the "go
deeper, implement whatever fix reveals" direction). Added a genuine real-engine regression,
`combatMultiHostileDamagedShip.test.ts` (verified RED without the fix — hull hits exactly 0 — GREEN
with it). Also corrected `combatRoundReaction.test.ts`'s misleading docstring: that file wires
`onPlayerUnderAttack`/`onRoundComplete` to a real `CombatPauseController`, but `combatModuleDeps.ts`
confirms those callbacks are **not wired in production** (superseded by the pause-and-plan loop) — the
file still validates a legitimate lower-level wiring contract, just not literal production wiring; its
claims were re-scoped, not deleted. Full suite green (5852 tests), `letsplay:ci` (108/108),
`test:playtest` (768/777).

**Measured (50 sessions): 2.0% win rate (1/50, same seed/day as before) — a THIRD consecutive no-op**,
statistically indistinguishable from both the pre-fix baseline and the two prior escalations
(garrison discount, per-fight lethality). `battleReadyDay` rate unchanged (4.0%), median death day
192 (was 185-186), deaths-with-≥1-liberation 33/44 (75%, unchanged). Direct log inspection of the
post-fix deaths shows the SAME signature as before: 2-6 hostiles engaging simultaneously immediately
preceding death, unchanged in kind.

**Why the fix didn't move the number**: it closes a real but comparatively NARROW gap (an
already-damaged ship's round budget). The dominant scenario in the logs is a ship that dies within the
**first round of a fresh encounter** — where hull starts at or near max, so the current-hull-vs-maxHull
distinction this fix targets doesn't apply. This points squarely at the **other** mechanism identified
in the original root-cause investigation and not yet touched: **synchronized fire timers**.
`CombatModule.addCombatant()` resets every joining NPC's fire timer to `0`
(`CombatModule.ts:440`); since `combatFireIntervalMs=2500 < COMBAT_ROUND_MS=3000`, N
simultaneously-joining hostiles (a standing garrison, a freshly-folded capture fleet — all already in
weapon range on arrival) are perfectly lock-stepped and ALL cross the fire interval within the SAME
execute window, regardless of starting hull. This is very likely the dominant, still-unaddressed
mechanism — the round-budget fix (however correct) can only ever reduce the SEVERITY of an
already-synchronized volley, not prevent the synchronization itself.

#### Combat-mechanics fix #2 implemented (2026-07-15) — fire-timer stagger on batch-join

User authorized continuing. Added `GAME_BALANCE.combatJoinFireStaggerMs = 300` and wired it into
`CombatModule.addCombatant()`: each joining NPC's initial fire timer is now `-(alreadyJoinedCount ×
300)` instead of a flat `0`. Only delays each NPC's FIRST shot — `advanceNpcTimers` resets to `0`
after every shot, so steady-state cadence is unchanged. With `combatFireIntervalMs=2500` and
`COMBAT_ROUND_MS=3000` (500ms headroom), this lets at most 2 already-present hostiles fire within the
first execute window (0ms, 300ms offsets → 2500ms, 2800ms, both `< 3000`); a 3rd+ joiner's first shot
lands in a LATER window, after `PLANNING` has reopened and the player got a real decision point.

Three pre-existing pinned tests explicitly locked the old lock-step behavior (fresh scope decisions,
per this plan's rule, all directly targeted by this escalation's own diagnosis):
`combatModule.test.ts`'s two "both fire together when the interval elapses" tests (rewritten as a
direct staggering demonstration — same final damage totals, now reached via two staggered ticks
instead of one synchronized tick) and `combatRoundReaction.test.ts`'s "fatal shot crosses budget"
regression (widened its tick by the stagger amount so the original two-hits-in-one-frame scenario
still constructs correctly). Full suite green (5852 tests), `letsplay:ci` (108/108), `test:playtest`
(768/777).

**Measured (50 sessions): 2.0% win rate — a FOURTH consecutive no-op**, but NOT byte-identical this
time (43 died vs. the baseline's 44, 5 timeout vs. 4 — some session outcomes did shift, just not the
aggregate win-rate). Same win day (98), same `battleReadyDay` rate (4.0%), same median death day
(186), same death-with-liberation ratio (32/43 ≈ 74%). 0 errors/violations throughout.

#### Status: stopping after four consecutive escalations — recommending a different diagnostic approach

This plan has now tried, in order, and **individually verified each as correct**: (1) garrison-count
discount raised to its structural ceiling + extended to pirates (Task 2/3), (2) per-fight
HP/damage lethality halved (Task 5), (3) a real production bug fix — round-damage budget scaled off
current hull instead of max hull, confirmed via a red-before/green-after regression test, and (4) a
real production bug fix — synchronized fire-timer lock-step broken via join-order staggering, also
verified correct. **None moved the campaign win-rate off its ~2% plateau**, which itself is
statistically indistinguishable from the ORIGINAL prior plan's 4% baseline from before this plan even
started (`docs/plans/20260713-campaign-win-rate-architecture.md`).

This pattern — every individually-correct, individually-verified fix measuring as a no-op on the one
metric that matters — is itself diagnostic: manual log archaeology (reading `GameOverScene`
transitions, correlating "In-flight combat: engaged" lines, hand-computing damage arithmetic against
`ROLE_STATS`/`balance.ts` constants) has now correctly identified two REAL bugs and still failed to
find whatever actually gates the win-rate. The honest conclusion is that manual log-reading has
reached its limit as a diagnostic method here. Per this plan's own escalation clause: stopping,
not attempting a fifth guess. Recommendation for the user: before any further combat/balance change,
add **structured death-cause telemetry directly to the campaign harness** (`campaignMetrics.ts` /
`campaign.run.ts`) — e.g. record the damage source (NPC id/role), the ship's hull fraction at
engagement start, and the number of simultaneously-engaged combatants, for every session-ending death
— so the next round of investigation works from exact per-session causal data instead of re-deriving
it from free-text logs session by session. Full lever/fix history and all four measured results are
recorded above for continuity.

**Small-N (10 sessions) directional check (2026-07-15):** 0/10 wins, 1 loss, 8 died, 1 timeout;
`battleReadyDay` rate **20% (2/10)** vs Gate A's 4% (2/50) — too small a sample to read as a real 5×
jump, but a positive direction with no red flags (0 errors/violations, no new stall/wedge patterns,
peak-power spread similar to before). Win-rate itself is uninformative at n=10 against a ~2% baseline
(0/10 is well within the expected range even at an unchanged rate) — proceeding to the full
50-session re-measure rather than over-reading this sample.

#### Structured death-cause telemetry implemented (2026-07-15) — the escalation's own recommended next step

User authorized implementing the diagnostic this plan's own escalation note asked for: per-death
causal data (killer NPC id/role, hull fraction at the fight's engagement start, and how many
hostiles were simultaneously engaged) instead of re-deriving it from free-text logs each round.

**Where it lives**: `CombatModule` (`src/presentation/flight/CombatModule.ts`) now tracks
`engagementStartHullFraction` (captured once per fresh engagement, `addCombatant`'s `isActive`
false→true branch) and exposes `lastDeathCause` (a `PlayerDeathCause`, set at the exact hull-reaches-0
hit in `fireNpcShot`, alongside the existing `playerDeathReported` guard — purely additive, no
existing behavior changed). `campaignMetrics.ts`'s `CampaignSessionReport` gained an optional
`deathCause` field (structural mirror `CampaignDeathCause`, not imported — same decoupling
`CampaignStepSignal` already uses) and `formatCampaignReport` renders both a per-session
`death[killer=... hull@engage=... vs=...]` tag and an aggregate `death causes (N/sessions): killer
roles [...], median hull@engage=..., median simultaneous combatants=...` footer.

**Real bug found and fixed while wiring the harness read (two rounds, not one)**: a naive "read the
live scene from the campaign loop after `agent.run(1)` returns" implementation measured
byte-for-byte `null` on every real death despite `CombatModule.lastDeathCause` being provably set
correctly (verified via direct instrumentation). Root cause, found in two layers:
1. `NpcShipManager.handlePlayerDeath` → `GameEngine.triggerPlayerDeath` → `EndgameController`'s
   `transitionToGameOver().catch(...)` is **fire-and-forgotten, never awaited** — so a caller polling
   the scene one loop iteration later can already see the new `GameOverScene`, having missed a
   same-`agent.run(1)`-call combat engagement/death entirely (a fresh capture-fleet/garrison
   engagement and the death can both occur inside a single agent step, invisible to an
   once-per-step poll).
2. Deeper: `GameEngine.transitionTo` runs `this.currentScene.destroy(); this.currentScene = null;`
   **synchronously, before its own first `await`** — so the scene swap happens *nested inside* the
   very same `CombatModule.update()` call that produced the fatal hit, not merely "soon after" it.
   Even reading `engine.currentScene` immediately after that `update()` call returns is already too
   late (it's `null`/already-reassigned).

**Fix**: `RealEngineHarness.tick()` (`src/tests/playtest/realEngineHarness.ts`, the shared entry
point every combat-driving tick in the letsplay engine funnels through) now captures the scene
reference **before** calling `.update()`, and reads `combatModule?.lastDeathCause` off that stable
local reference **after** `.update()` returns — immune to `engine.currentScene` being reassigned
mid-call, since only the engine's own pointer moves, not the local variable. Exposed as
`RealEngineHarness.lastDeathCause()`; `campaign.run.ts` reads it directly when it classifies a
"died" outcome (`!arcResolved(status) && scene === SceneType.GAME_OVER`), no scene-polling of its
own. Verified live on a 5-session run: both real deaths now populate correctly (e.g. one death at
`hull@engage=1.00` — a **full-health** ship still died to 2 simultaneously-engaged OVERMIND
garrison ships — a concrete data point the next diagnostic round should chase).

**Tests**: `src/tests/combat/playerDeath.test.ts` (new `CombatModule.lastDeathCause` describe block —
killer id/role/hull-fraction/combatant-count capture, engagement-start-not-fatal-hit semantics,
per-fresh-fight re-capture after `endCombat`), `campaignMetrics.test.ts` (new formatting/aggregation
describe block for the death-cause footer). Full suite green (5861 unit tests, `letsplay:ci`
108/108, `test:playtest` 772/781 — 9 pre-existing skips unchanged), `tsc --noEmit` and `eslint` clean
on every touched file. No domain/schema/save impact (all new state is in-memory dev/test telemetry).

**First telemetry-informed measurement (2026-07-15, 20 sessions, `.letsplay/campaign-report.json`,
raw data not committed — gitignored)**: 1 win / 1 loss / 16 died / 2 timeout (2 wedged), win-rate
5.0% — consistent with the ~2-5% plateau, but now with causal data on **every one of the 16
deaths**, not just aggregate counts:

| Finding | Value |
|---|---|
| Killer role breakdown | **OVERMIND = 16/16 (100%)** — zero pirate-caused deaths in this sample |
| Median hull fraction at engagement start | **0.83** |
| Deaths starting at FULL hull (1.00) | **8/16 (50%)** |
| Median simultaneous combatants at the fatal hit | **3.5** |
| Deaths with ≥3 simultaneous combatants | **12/16 (75%)** |
| Killer id pattern | mix of `garrison_ov_sys_*` (standing garrisons) and `capture_*_sys_*` (capture fleets) |

**This is a sharper, more specific finding than anything the four prior escalations produced**: half
of all deaths are NOT attrition/grind-death (the ship enters the fatal fight at **full hull**) — they
are overwhelmed by **3+ simultaneously-engaged Overmind ships** (never pirates) in a single
engagement, consistent with (but now with hard per-death evidence for) the "Root cause found"
section's synchronized-volley diagnosis above — and confirms it survives BOTH of that section's
combat-mechanics fixes (current-hull round budget, fire-timer stagger): staggering only spreads the
FIRST shot of each joiner across at most ~2 fire windows before `COMBAT_ROUND_MS` elapses, so a
group of 3-6 simultaneous hostiles still lands most of its collective damage inside one or two
rounds regardless. The prior four-lever sweep tuned GARRISON COUNT (discount) and PER-HIT damage
(`HOSTILE_SCALING_WEAK_MULT`) but never the THIRD variable this data now isolates: **how many
hostiles can be simultaneously engaged in one fight at all** (`GARRISON_MAX`/capture-fleet sizing),
independent of the discount's floor.

#### Combat-mechanics fix #3 implemented (2026-07-15) — simultaneous-combatant cap, measured as a FIFTH consecutive no-op

User authorized pursuing this lever. Added `GAME_BALANCE.combatMaxSimultaneousCombatants = 2` and a
guard in `CombatModule.addCombatant()`: a new joiner is refused once `combatants.size` reaches the
cap (same class of refusal as the existing downed/weaponless guards — the aggressor stays
"aggressive" and keeps retrying every frame via the existing garrison-aggro idempotent path,
joining the instant a slot frees). Value `2` matches the fire-stagger fix's own "at most 2
already-present hostiles fire within the first execute window" precedent. Full suite green (5863
unit tests — **zero pre-existing tests broke**, confirming no test depended on 3+-way simultaneous
engagement), `letsplay:ci` 108/108, `test:playtest` 772/781, new coverage in `combatModule.test.ts`
(cap enforcement + slot-frees-on-death re-admission).

**Measured (20 sessions, same seeds as the telemetry baseline above): outcomes byte-for-byte
IDENTICAL to the pre-fix run** — every session resolved on the exact same day, with the exact same
win/loss/died/timeout classification and step count (1 win/1 loss/16 died/2 timeout, win-rate 5.0%
unchanged). The ONLY thing that changed was the reported `simultaneousCombatants` value itself
(median 3.5 → 2.0, max 6 → 2 — confirming the cap IS being enforced structurally) plus minor
killer-NPC-id drift on a few sessions (RNG draw-count collateral, the same class already documented
in Task 3's outcome — not a new risk).

**Diagnosis**: capping *peak* concurrency does not reduce *total* incoming damage over a committed,
multi-round engagement — a refused aggressor doesn't leave, it queues and takes the very next open
slot (the instant a combatant dies, is pruned, or a round ends), so the same pool of attackers cycles
through 2 at a time instead of hitting all at once, delivering essentially the same cumulative damage
over the fight's real duration. The fatal-hit snapshot's `simultaneousCombatants` was *correlated*
with lethality (more attackers present at the kill moment) but not *causally* driving it — sustained
pressure across the whole engagement is the actual mechanism, not instantaneous alpha-strike burst.
This is the **fifth** consecutive individually-correct, individually-verified lever (after garrison
discount, per-fight lethality, the round-budget current-hull fix, and the fire-timer stagger) to
measure as a no-op on the one metric that matters, and the most cleanly-isolated one yet (byte-exact
outcome equivalence, not just "no measurable difference within noise").

**Stopping here — not attempting a sixth guess, per this plan's own escalation clause.** The
telemetry has now ruled out concurrency-at-the-moment-of-death as the mechanism; the remaining
unexplored dimension is the engagement's total **duration/round count survived** before death (this
plan's telemetry does not yet capture "how many rounds did this fight go" — only the fatal snapshot).
Awaiting user direction before adding that deeper instrumentation or trying a different lever
class entirely (e.g. the still-untouched economy-recovery/spread-cadence directions from Task 4's
original escalation).

#### Round-count telemetry added (2026-07-15) — decisive finding: this is attrition the agent never escapes, not a burst kill

User authorized adding the duration dimension. `CombatModule` now tracks `roundsThisEngagement`
(incremented by every {@link beginCombatRound} call **while a fight is already active** — guarded so
routine per-step calls between fights, e.g. `PlayerAgent.waitOneDay`'s own unconditional call while
just flying around, don't inflate the NEXT fight's count before it even starts), surfaced as
`roundsSurvived` on `PlayerDeathCause`/`CampaignDeathCause`/`RecordedPlayerDeathCause` (the same
three-file structural-mirror pattern as the prior two fields) and rendered in both the per-session
`death[...]` tag and the aggregate footer (`median rounds survived=N`). Full suite green (5865 unit
tests, 2 new), `letsplay:ci` 108/108, `test:playtest` 772/781.

**Measured (20 sessions, same seeds): median 6 rounds survived, range 4–9 across all 16 deaths —
zero round-1 kills.** This is the single most decisive finding of this plan's entire investigation:
**every recorded death is a sustained, multi-round war of attrition, never a burst/alpha-strike
kill** — directly contradicting the "Root cause found" section's original synchronized-volley
hypothesis (which motivated the round-budget and fire-stagger fixes) and explaining in one stroke
why all five prior levers (garrison discount, per-fight lethality, round-budget-current-hull,
fire-timer-stagger, simultaneous-combatant cap) measured as no-ops: none of them touch the actual
mechanism, which is that **the ship keeps re-engaging the same fight round after round instead of
escaping**. `combatRoundHullFraction = 0.34` was explicitly "sized BELOW the policy's
`LOW_HULL_FRACTION` flee threshold (0.35) so a weak ship reaches a reaction window inside the flee
band and escapes" (this plan's own Technical Details section, unmodified) — hull should cross that
0.35 threshold within 2–3 rounds from full health (round-by-round: ~66% → ~44% → ~29%), so by round
4–9 the flee condition has been true for several ROUNDS already, yet the fight continues to a kill
every single time. The reaction window between rounds is exactly where a flee decision should fire —
it isn't firing, or it's firing and failing to actually disengage (pursuit/escape-range mechanics).

**Stopping here again, per the same clause** — this is a sharp, specific, high-confidence lead
(the flee decision/execution path during an ongoing multi-round fight, not any further combat-damage
tuning) but investigating and fixing it is new scope beyond this round's telemetry work. Awaiting
user direction on whether to pursue it.

#### Round-budget "one round per crossing" fix implemented and verified (2026-07-15) — mechanism confirmed fixed, win-rate STILL a no-op: a new bottleneck exposed, not solved

User authorized fixing the round-budget bug. First implementation attempt used the wrong signal
(comparing `plan.destination` across windows) — `planningDriver.ts`'s own documented convention is
"destination untouched" (`plan.destination` stays `null`) for a continuing course, relying on the
ship's already-in-flight physics path instead, so the destination-comparison never matched in real
play and the campaign re-measure showed byte-for-byte the same result as before the fix (caught before
reporting a false result). **Corrected fix**: `CombatExecutionController.beginWindow()`
(`combatExecution.ts`) now skips re-arming the round budget only when `plan.destination === null` AND
`ExecutionShipPhysics.isMoving === true` — an unredirected, already-in-flight continuation, not a
fresh tactical decision. An explicit new destination, or no destination while stationary (standing to
fight), still arms a fresh round exactly as before. Single production wiring site
(`SpaceFlightScene.ts`), shared identically by live and headless play. Three new regression tests in
`combatRoundRearmOnConfirm.test.ts` (continuing/redirected/stationary cases) all pass; full suite
green (5868 unit tests, `letsplay:ci` 108/108, `test:playtest` 775/784).

**Measured (20 sessions, same seeds): win-rate STILL 5.0% (1/20) — byte-identical to before this
fix — but the death shape changed completely.** Every one of the 16 deaths now shows
`roundsSurvived=1` (down from median 6, max 9) — confirming the mechanism fix works exactly as
designed: no more multi-round grinds during a single crossing. But `hull@engage` collapsed to
near-zero (median **0.05**, several sessions showing **0.00–0.11**) — ships are now surviving each
INDIVIDUAL crossing (bounded to one round's damage, as intended) but arriving at the START of the
very NEXT engagement already critically wounded, and dying in that fight's first round instead. The
fix correctly closed the mechanism it targeted (one round per committed crossing) without changing
the aggregate outcome, because it exposed the NEXT bottleneck: **a wounded ship gets no recovery
window between back-to-back encounters in hostile-dense space** — at 5–10% hull, literally any
further hit is fatal, so the war of attrition simply moved from "many rounds within one fight" to
"many separate near-fatal fights in a row with no repair opportunity between them."

**Stopping here — sixth escalation, per this plan's own clause.** This is qualitatively different
from the five prior no-ops: the fix is verified correct and the round-budget mechanism genuinely
changed (rounds-per-death dropped from 6 to 1), but the survivability bottleneck simply moved one
level up, to inter-engagement recovery. The next candidate lever this points at is economy/repair
pacing (already named as an untried direction back in Task 4's original escalation) — specifically
whether a wounded ship has any real chance to reach a repair dock before the next hostile finds it —
not any further combat-round mechanics. Awaiting user direction.

#### Repair-recovery investigation (2026-07-15) — root cause CONFIRMED via live trace, fix attempted, REVERTED after a regression the test suite caught

User authorized investigating then carefully fixing. Direct real-engine trace (temporary per-step
debug log, seed `CAMPAIGN-16`, days 69–75) confirmed the hypothesis precisely: the ship chose
`flee`→`warp` for 5 consecutive decision steps **with a station present in `legal` the entire
time** (`legal=move,warp,land,dock,attack,flee,wait` — `dock` never taken), hull draining
0.68→0.46→0.25→0.14→0.00 across exactly those steps (each interrupted warp attempt still spending a
round's ~34%-of-current-hull budget). `MemoryHeuristicPolicy`'s survive block (`hurt || outmatched ||
outgunned`) pushes `flee`/`attack` unconditionally whenever any hostile-flagged NPC is present —
`obs.hostiles` includes ships a garrison-aggro shield has already suppressed from actually engaging,
not just active attackers — and never considers `dock` as an alternative, even though `dock` is
legal regardless of hostile presence and is a guaranteed one-step scene exit (no boundary-crossing
retry loop, unlike `flee`/`warp`).

**Fix attempted**: added a `dock`-to-repair-escape candidate, pushed before `flee`, gated on
`legal.has("dock")` + a station present + `canAffordRepair !== false` (mirroring the existing
lower-priority repair tier's own affordability guard). **Caught by the existing test suite before
being reported as a success**: `longGameCompetence.test.ts` and `sessionCompetence.test.ts` — both
pre-existing, both untouched — immediately failed their `calendarWedged` gate on the GOD-mode
capacity probe (seed `CAMPAIGN-CAPACITY-0`). Root cause: docking removes the ship from danger and
lets it repair, but **the fix never made the ship actually LEAVE the hostile system** — undocking
returns it to the exact same spot, next to the exact same standing garrison, which re-engages
immediately, making it `hurt` again, triggering another `dock`, forever — a repair-then-immediately-
re-engage loop that never advances the calendar (GOD mode's hull floor means this never resolves via
death either, so the wedge persists indefinitely instead of ending the session). This is the same
class of pathology as the already-documented "dock-to-repair broke ping-pongs" bug for the *broke*
case, but for a *garrison-held-system* case the affordability guard doesn't touch.

**Reverted cleanly** (`MemoryHeuristicPolicy.ts` back to zero diff, confirmed via `git diff`) rather
than patching around the regression blind. Full suite re-confirmed green (5868 unit tests,
`letsplay:ci` 108/108, `test:playtest` 775/784) after the revert.

**What a correct fix needs, recorded for the next attempt**: `dock` alone is not a safe substitute
for `flee` in a garrison-held system — it must be paired with an explicit "now actually leave this
system" follow-up once repaired (e.g., prioritizing `warp` immediately after a repair-triggered dock,
rather than falling back to ordinary economy/exploration ladder tiers that could route the ship right
back into the same hostiles), or scoped to only fire when the hostile is a non-standing threat (a
wanderer that will eventually leave) rather than a fixed garrison. This needs its own careful design
pass, not a quick guard addition — a second attempt without addressing the "then what" after docking
would very likely reproduce the same wedge class. Awaiting user direction: this plan has now spent
seven investigation rounds (five no-op combat levers + one genuinely-fixed-but-insufficient combat
mechanism + one reverted policy attempt) in a single session — a natural point to pause and let the
user decide the next step with fresh eyes, per this plan's own standing escalation discipline.

#### Root cause of the multi-round attrition FOUND (2026-07-15) — the round-budget's "one round per crossing" protection for a warp-flee is silently defeated

User authorized investigating the flee path. Traced via a temporary per-step debug trace on a real
death (`CAMPAIGN-4`, died d130, `roundsSurvived=9`, `hull@engage=1.00`): the player's hull vitals
stayed at **130/130 through every single prior decision step** (no active fight observed at any
`waitOneDay`/`driveAttack` step) — the fatal engagement started AND ended entirely inside **one**
`warp` action's own execution (`PlayerAgent.completeWarp`), i.e. the ship was ambushed by a capture
fleet WHILE fleeing to the system boundary via hyperjump, not while sitting still.

**The mechanism, traced exactly**: `completeWarp` calls `beginCombatRound()` **once**, before its
2000-tick loop, with the explicit comment "a committed flee/warp crossing is ONE round — incoming
fire is bounded to a single round's budget for the whole traverse... Begun once here, NOT per tick,
so the budget spans the crossing." **This is no longer true.** The SAME loop also calls
`confirmPlanningIfOpen(flightScene)` on every tick (needed to keep the ship flying through the
tactical pause-and-plan freeze — PLANNING re-opens after every execute window while hostiles remain,
per this codebase's own combat-rework documentation) — and confirming a fresh planning window calls
`CombatExecutionController.beginWindow()` (`combatExecution.ts:303-305`: "Each confirmed window is
one combat round — reset the damage budget" → `this.host.beginRound?.()` →
`CombatModule.beginCombatRound()`). So **every re-confirmed execute window during a warp-flee
re-arms a fresh `combatRoundHullFraction` (0.34) budget**, exactly like a stationary fight — the "one
round for the whole crossing" protection `completeWarp`'s own comment describes was silently
overridden by the later tactical pause-and-plan rework's own per-confirm round-reset, and nothing
in `completeWarp` accounts for that interaction. This is universal, not a headless-harness artifact:
`confirmPlanningIfOpen` (`planningDriver.ts`) mirrors "live autopilot `attack()`/`flee()`/`warp()`
heads — same shapes over the rendered scene" per its own doc header, and the underlying
`beginWindow()`/`CombatModule` wiring is production code a live player's manual warp-to-edge flight
goes through identically — a human player fleeing toward the boundary while still in weapon range is
exposed to the exact same repeated-round grind, not just the letsplay agent.

**This is the root cause the round-count telemetry was built to find**: `roundsSurvived` (median 6,
up to 9) is literally counting how many execute-windows/rounds ticked by DURING the (attempted)
warp escape before the ship died en route — each one taking its own ~34%-of-current-hull bite,
compounding to zero over enough windows, with the ship never reaching the jump boundary. This
explains why all five prior combat-tuning levers were no-ops: none of them touch "how many rounds a
fleeing ship survives before either escaping or dying," which is governed by this round-budget/
confirm-window interaction, not garrison count, per-hit damage, or simultaneous-combatant count.

**Not yet fixed** — this is a genuine design-intent question, not a one-line bug: is the correct fix
(a) restoring `completeWarp`'s original "one round for the whole crossing" guarantee (e.g. skip the
round-reset on re-confirms during an ALREADY-committed crossing), or (b) accepting the current
per-window-reset semantics as the intended post-rework model and instead giving the fleeing ship a
faster/more reliable way to actually reach the boundary (so fewer rounds are needed), or (c) some
combination. This touches the just-shipped tactical pause-and-plan system
(`docs/plans/20260713-tactical-pause-combat-rework.md`) at a load-bearing point (`beginWindow`'s
round-reset is core to ALL combat, not warp-specific) — a wrong fix here risks regressing ordinary
stationary combat's own round-budget protection. Awaiting user direction before touching production
code.

#### Option (a) chosen and hardened (2026-07-16) — the `isMoving`-only signal was wrong; real plumbing added

User chose option (a) after a scope check surfaced a real problem with the fix as it stood in the
working tree: `beginWindow`'s `continuingCourse` check (`plan.destination === null &&
physics.isMoving === true`) cannot actually tell a genuine flee apart from ORDINARY standing
combat. Verified live (a fresh real-engine test, no manual state stubbing): engaging a static
hostile with no destination ever plotted still leaves `physics.isMoving === true` by the end of the
first execute window, because the auto-pursuit orbit-strafe (`CombatPursuitController.
steerCombatOrbit`) calls `physics.setPath()` every unfrozen frame to hold weapon range — by design,
per `flight/CLAUDE.md`. So the exemption, as measured, was landing on ANY multi-window fight, not
just literal border crossings — consistent with (and now explaining precisely) the "`roundsSurvived
= 1` for all 16/16 deaths" measurement above, which is broader than the code's own doc comments
("ordinary combat is unaffected") claimed.

`pursuitSuspended` (`CombatPursuitController`) is the real signal — true only while the auto-pursuit
is actually yielding to a player/agent route — but it had a gap of its own: a hostile that ambushes
an ALREADY-in-flight ship engages via `startInFlightCombat` → `CombatModule.addCombatant` directly
(`CombatPursuitController.tickAggressor`), which never touched `pursuitSuspended` — so a genuine
mid-flee ambush (the exact `completeWarp` scenario this investigation is about) would ALSO have read
`pursuitSuspended === false`, and gating on it naively would have undone the fix for the case it was
built for while only incidentally fixing the standing-combat over-application.

**Real plumbing added**: `tickAggressor` now checks, right before engaging a fresh (`!isInCombat()`)
ambush, whether the player ship is already mid-flight on a genuinely plotted route
(`physics.isMoving && physics.isFollowingRoute()`) — since no fight is active yet at that exact
point, this can only be a real route (the auto-orbit never runs before a fight exists), never a
false positive from the orbit itself. If so, `pursuitSuspended = true` is set immediately, so the
pre-existing route survives the ambush instead of being silently hijacked by the fresh engagement's
auto-pursuit. `beginWindow`'s `continuingCourse` now requires BOTH `isMoving` AND
`isPursuitSuspended()` (wired through a new `NpcShipManager.isPursuitSuspended()` →
`ExecutionNpcManager` → `CombatExecutionHost` chain, the same host-pattern every other flight module
uses). Player-initiated attacks (`launchCombatWithNpc`) keep deliberately resetting
`pursuitSuspended = false` — choosing to fight overrides any prior flee intent, unchanged.

**Test fallout, all in the established "downstream collateral from a correct fix" class** (per
Task 3's own precedent above, not new territory): one existing test's SETUP was itself wrong, not
its claim — `combatRoundRearmOnConfirm.test.ts`'s "continuing course" test used
`launchCombatWithNpc` (the player-attack path, which deliberately resets `pursuitSuspended`) to
simulate a scenario it described as a flee/warp-crossing continuation; corrected to establish the
route through the real `combatPlanning.setDestination` + `breakOffCombatPursuit` seam instead — the
assertion (a committed crossing costs ONE round) is unchanged, just now exercised correctly. Two new
tests added alongside it: ordinary standing combat re-arms every window despite the real auto-orbit
setting `isMoving = true` on its own (the regression this hardening fixes, proven with NO manual
stubbing), and three new `CombatPursuitController.tickAggressor` unit tests for the ambush-preserves
/ no-route-no-suspend / already-in-combat-no-touch cases. One unrelated real-engine test
(`exploreNoWarpLoop.test.ts`, seed `LETSPLAY_EXPLORE`) needed its own fix: its consecutive-warp
cadence counter didn't reset on a flee-motivated hop, and the hardened fix let an ambushed ship
successfully flee a hostile system straight into fleeing the Overmind front again (two genuine,
back-to-back danger-avoidance jumps) instead of getting stuck orbiting the first hostile — correct,
safer behavior that the counter's own stated intent (catch the *blind economic* warp-forever loop,
not danger-avoidance) never accounted for; fixed by resetting the streak on any `mem:flee*`-reasoned
action, matching the counter's documented purpose.

**Verified**: full unit suite green (5872 tests, +4 net new), `letsplay:ci` 108/108, `test:playtest`
776/785 (9 pre-existing skips), `tsc --noEmit` and `eslint` clean on every touched file.

#### Second wedge found and fixed during re-measurement (2026-07-16) — pre-existing STAR_MAP/SPACE_FLIGHT ping-pong, exposed (not caused) by the hardening

A 10-session directional re-measure immediately after the hardening pass showed 3/10 sessions WEDGED
(day-frozen streak hitting the 300-step ceiling) — up from the pre-hardening baseline's 1/10. Traced
live (real-engine step trace, seed `CAMPAIGN-1`): NOT combat-related — at the freeze point
`pursuitSuspended=false`, `combatActive=false`, no fight involved at all. The session was stuck
alternating `move mem:avoid-danger-back` (decided in STAR_MAP) and `warp mem:find-sell-destination`
(decided in SPACE_FLIGHT) forever, matching this codebase's own already-documented "flee↔avoid-
danger-back ping-pong" wedge class (`campaign.run.ts`'s `CAMPAIGN_WEDGE_STEP_LIMIT` doc comment).

**Root cause**: `MemoryHeuristicPolicy`'s STAR_MAP tier re-derives the SPACE_FLIGHT tier's
`find-sell-destination` intent (the documented "same conditions, same priority order" two-step-warp
parity, ranked above `avoid-danger-back` specifically so a legitimate sell-route warp isn't vetoed by
the current system's own remembered danger) — but the STAR_MAP re-derivation had an EXTRA gate
(`sellRouteSystem !== undefined`) the SPACE_FLIGHT push never had. When the sell destination's system
was never seen (`sellRouteSystem` genuinely `undefined` — the flight tier's own documented "blind"
case), STAR_MAP's push silently didn't fire, falling through to `avoid-danger-back` (true whenever the
current system is remembered-dangerous) — bouncing back to SPACE_FLIGHT, which immediately re-opens
the map with the SAME blind intent. Fixed by dropping the extra gate so the STAR_MAP push exactly
mirrors the flight tier's (`holdingForOtherSystem && !avoidDangerAhead`), letting the blind case win
over `avoid-danger-back` too, same as the targeted case already did.

**Why the hardening exposed it more**: before hardening, this class of session more often died to the
ambush-hijack bug before ever reaching the state that triggers this unrelated ping-pong. This is
downstream consequence, not a flaw in the round-budget fix — confirmed the wedge reproduces
byte-identically with the round-budget fix reverted too (it's just reached less often).

**Verified**: the exact repro (seed `CAMPAIGN-1`, 2600-step trace) no longer wedges — the session
proceeds past day 423 to a normal `GAME_OVER` resolution. Full unit suite green (5872 tests, unchanged
count — no new tests added, this is a decision-logic fix in already-covered territory), `letsplay:ci`
108/108, `test:playtest` 776/785, `tsc --noEmit` and `eslint` clean.

**Re-measured (10 sessions, both fixes in place): 0 win / 9 loss / 0 died / 1 timeout (1 wedged,
win-rate 0.0%).** The remaining wedge (`CAMPAIGN-7`) is a byte-identical, pre-existing, DIFFERENT
stall class (`repeat=2@SPACE_FLIGHT|attack` — a literal repeated-action stall, not a day-frozen
ping-pong) present in every measurement throughout this plan, unrelated to either fix here.

**The headline result: zero deaths across 10 sessions** — a first in this entire investigation
(every prior measurement, from the original Task 4 baseline through the five-lever combat-mechanics
sweep, showed deaths as the dominant resolution, 74–100% of sessions). All 9 non-wedged sessions
resolved as `LOSS` — the Overmind arc itself resolving `"lost"` (the spread front wins outright), not
a player death, not a day-budget timeout. This is a genuinely different bottleneck than the one Task
5's "back-to-back fights with no recovery window" escalation targeted (which was specifically about
survival/death) — it now looks like a pacing/engagement-rate problem (the player isn't liberating
fast enough to outpace the Overmind's own spread), the same territory Task 4's original garrison-
discount work targeted, but now measurable without death noise masking the signal. Awaiting user
direction on whether Task 2 (the repair/recovery fix, motivated by the now-apparently-resolved death
bottleneck) is still the right next target, or whether the Overmind-outpaces-the-player pacing angle
deserves the next round of investigation instead.

#### Pacing bottleneck traced decisively (2026-07-16) — the player-agent almost never liberates anything

User authorized chasing the pacing angle. Direct `overmindArc` state trace across 6 full sessions
(seeds `CAMPAIGN-0..5`, real engine, logged every ~50 days): **`playerLiberations` stayed at 0 for
5 of 6 sessions, for the ENTIRE session** (the 6th reached exactly 1, around day ~91–106, then also
stayed flat for the remaining 300+ days). Meanwhile `overmindSystems` grows on an almost metronomic
cadence, completely independent of anything the player does — `2/12 → 11/12` (91.7% share, the
`lossShare` threshold) by day 386–460 across all 6 seeds, `lastSpreadDay` advancing roughly every
40–90 days regardless of the player's `peakThreat`/economy state. The Overmind is not "out-pacing" a
player who's fighting back and losing the race — the player is not fighting it at all; the spread
front runs on its own clock to an inevitable 92%-share loss in every sample.

**This is not a new finding — it is a direct, now-decisively-confirmed instance of the root cause
CLAUDE.md's Overmind Arc section already names**: "the plan's 99%-win-rate gate is a known, measured,
open gap... root cause is the arming-up path." Peak power stayed low (0.05–0.21, mostly below the
0.13 battle-ready floor) in the earlier 10-session measurement, and `MemoryHeuristicPolicy`'s own
"Overmind-slayer" offensive tier is gated on `isBattleReady()` (`maxHull ≥ 180, weaponDamage ≥ 30`,
per root `CLAUDE.md`) — a gate the agent rarely clears within the session. Today's two fixes (the
round-budget hardening + the ping-pong wedge) removed combat-death and wedge noise that was
previously masking this signal; they did not touch the arming-up pacing at all.

**This is squarely the same open gap Task 2–4 of this plan already spent significant effort on**
(the garrison-discount escalation, which plateaued at 4.0%/50 sessions per the Known-unmet gate
section) — not a fresh bug. Two structurally different explanations remain unseparated by today's
data alone: (a) **agent-policy under-aggression** — `MemoryHeuristicPolicy` (dev-only letsplay code)
itself never prioritizes assaulting/liberating Overmind systems even when capable, an artifact of the
heuristic's own tuning rather than a real-player-representative constraint; or (b) **genuine game
pacing** — the arming-up economy is simply too slow relative to the spread cadence for ANY reasonable
play style, a production balance issue. These need different fixes (dev-only policy tuning vs.
production `balance.ts` levers) and, per this plan's own standing discipline of recording a scope
decision before touching pinned/production behavior, the distinction matters before choosing either.
Stopping here to get direction — this is a new, still-open, previously-flagged investigation front,
not a continuation of the round-budget hardening this session's authorization covered.

#### Diagnostic resolved (2026-07-16): the agent structurally never reaches battle-ready — an economic-pacing stall, not a refusal to fight

User authorized separating the two hypotheses before choosing a fix. Traced `maxHull`/`weaponDamage`/
`credits` every ~40 days across 3 full sessions (real engine), plus the top-15 most-frequent decision
reasons over each session's whole run:

- **Hull growth: one upgrade, then a 150–300+ day flat line.** Every session buys exactly ONE hull
  upgrade (130 → 140 HP — `hull_corvette`, 3000cr, per `GearCatalog.ts`) around day 250–300, then
  `maxHull` never moves again for the rest of the session (400+ days). `isBattleReady()` requires
  `maxHull ≥ 180` (root `CLAUDE.md`) — the cheapest hull that clears it is `hull_freighter` (180 HP,
  4500cr — since trimmed to 3900cr, see Task 2b below; the 4500-based math in this diagnostic
  snapshot is preserved as-written) or `hull_warden` (220 HP, 7000cr). `credits` after the first upgrade oscillate in a
  ~1000–2000cr band for the remainder of the session, never re-accumulating enough for the second
  upgrade (`canAffordRefit` needs `credits − cost ≥ MILITARY_SPEND_TRADE_RESERVE` (1000), i.e.
  ≥5500cr for the cheapest next tier) — `battleReady` is never reached again after this point.
- **Action-count dominance confirms the mechanism**: `mem:take-off`/`mem:earn` account for
  40–97% of ALL decisions across the 3 traces (up to 1991/3000 steps in one session) — a
  land(earn)→take-off→land(earn) loop that doesn't meaningfully grow capital. `mem:go-battle-ready`
  (the dock-and-upgrade action) never appears in ANY session's top-15 most-frequent reasons — it
  fires at most once or twice a session (the single hull buy), never repeatedly, because its own
  affordability gate essentially never re-trips after the first purchase.

**Conclusion: this is (a), not (b) so far as CAN'T-vs-WON'T goes** — the agent is not "capable but
refusing to attack"; it structurally never becomes capable within the session length the campaign
gate measures. `slayer-advance` (the tier that would route it toward the Overmind front) requires
`battleReady`, which requires `maxHull ≥ 180` — a threshold crossed once by luck of an early cheap
upgrade and then never again for hundreds of remaining days. Whether the CORRECT fix is dev-only
(the letsplay policy should earn/save more efficiently — e.g. hold cargo for genuinely profitable
trade routes instead of repeatedly landing for a low-value "earn" quest, or bias spending toward the
NEXT hull tier once affordable) or production (`balance.ts` — earn-quest payouts, hull-tier pricing,
or the `isBattleReady` threshold itself may simply be paced for a faster economy than this game's
early-mid trade loop can support for ANY player) is still open — today's trace narrows the search to
the arming-up ECONOMY specifically (not the offensive decision logic, which was never reached to be
tested), not a random walk over the whole balance surface. Awaiting user direction on which side to
fix.

#### Dev-only policy tuning chosen — mechanism pinpointed, NOT yet fixed (2026-07-16)

User authorized tuning `MemoryHeuristicPolicy`'s economic behavior (not production balance). Traced
what actually happens on every `PLANET` visit across 1500 steps (seed `CAMPAIGN-1`): **648 of 651
landings (99.5%) produced ZERO net credit change** — the ship lands "to earn," finds nothing to do,
and immediately takes off again. `take-quest` fired only 11 times in the same 1500 steps.

Two concrete, distinct contributors identified, not yet fixed:

1. **`earnPlanetId()` (line 482) doesn't verify there's anything to do before landing** — it prefers
   a planet with `availableQuests > 0`, but falls back to `habitable[0]` (arbitrary) when none do.
   Since quests are evidently scarce galaxy-wide (only 11 accepts in 1500 steps even before the
   ceiling below applies), the fallback fires often, guaranteeing a no-op landing purely for the
   fuel top-up its own doc comment names as the ACTUAL justification — it was never meant to be an
   income source, but it dominates the action distribution as if it were one, because nothing ranked
   above it in the ladder is finding an actionable margin/quest often enough to preempt it.
2. **A genuine gating gap, likely the bigger lever**: `take-quest` is suppressed once
   `obs.overmindShare > QUEST_ACCEPT_OVERMIND_SHARE_CEILING` (0.6) — "a new multi-warp obligation has
   no business starting when most of the galaxy is already hostile" — but the `earn` LAND push that
   targets a quest-bearing planet in the first place has NO such gate. Given the traced sessions
   cross 0.6 share around day 200–300 (well before the ~day 400+ loss), the ship keeps performing the
   land-hoping-for-quest ritual for the entire back third to half of every session, even though the
   quest-accept path it's chasing is already permanently disabled for the rest of the run.

**Why no code change landed today**: verified that `earnPlanetId`'s only alternative signal
(unpriced-planet preference) would NOT meaningfully help — this codebase's own price-book fold
learns a landed planet's market "for free" regardless of which specific planet is chosen (per the
PLANET case's own comment), so re-ordering the fallback doesn't create new income, only marginally
faster price discovery. The (2) gating gap is the more promising, better-isolated lever (skip the
`earn` land push once quests are structurally unavailable for the rest of the run, same threshold
`take-quest` already uses, freeing the ladder to fall through to `early-explore`/other tiers instead
of a landing that's provably pointless for both quest AND already-explored-price reasons) — but this
still needs its own careful before/after campaign re-measurement to confirm it actually grows credits
faster rather than just relocating the same idle time elsewhere, which this session did not have the
remaining scope to do safely. Recording the precise mechanism here (not a guess) for the next round:
this is genuinely a substantial, open-ended agent-economy-tuning problem, not a one-line fix, and
deserves its own focused session with room for the same measure→adjust→re-measure discipline this
plan has used throughout, rather than a rushed change at the tail of this one.

#### Quest-gating fix implemented and Gate A re-measured (2026-07-17) — death is now SOLVED (12%, was 88%), but Overmind-outpaces-player LOSS is the new dominant failure; win-rate still far below Gate A

Continued the "dev-only policy tuning" lever this plan's own prior entry recorded as the next step,
not yet implemented at that point. Implemented gap (2) exactly as recorded: the "earn" land push in
the base ladder's `SPACE_FLIGHT` case (`MemoryHeuristicPolicy.ts:1846-1847`, unconditional fallback)
is now suppressed once `(obs.overmindShare ?? 0) >= QUEST_ACCEPT_OVERMIND_SHARE_CEILING` (the same
`0.6` threshold `take-quest` above it already gates on) **AND** `alreadyVisited` (this planet's
prices already known) both hold — a landing that's provably pointless for both quest AND
price-discovery reasons. Critical-fuel refuelling is unaffected (a separate, higher-priority
`refuel-critical` push, `MemoryHeuristicPolicy.ts:1049-1053`, unconditional on this gate). Three new
unit tests in `MemoryHeuristicPolicy.test.ts` (`earn-land suppressed once quests are structurally
unavailable`) pin all three branches: below-ceiling still lands, unpriced-here still lands,
above-ceiling-and-priced does not land. Full suite green (5875 unit tests, +3 new), `letsplay:ci`
108/108, `test:playtest` 779/788 (9 pre-existing skips), `tsc --noEmit` and `eslint` clean.

**Infra note**: the 50-session run first hit `ERR_WORKER_OUT_OF_MEMORY` twice in a row (default
`vitest` `pool: 'threads'` worker heap ceiling, unaffected by raising `NODE_OPTIONS
--max-old-space-size` since worker-thread `resourceLimits` don't inherit it) — worked around with
`npm run letsplay:campaign -- --pool=forks` (separate OS processes, no shared worker heap ceiling).
Infra-only; not a code regression from this change.

**Measured (50 sessions, `.letsplay/campaign-report.json`, gitignored)**: **2 win / 37 loss / 6 died /
5 timeout (5 wedged), win-rate 4.0%** — median win day **205** (wins at d98, d312), battle-ready rate
**8% (4/50, avg d223)**, liberation rate 100% (avg d102), avg peak power 0.11.

| Metric | This measurement | Task 4's original Gate A baseline (50 sessions) |
|---|---|---|
| Win rate | 4.0% (2/50) | 2.0% (1/50) |
| **Died** | **12% (6/50)** | **88% (44/50)** |
| Loss (Overmind wins arc) | 74% (37/50) | 2% (1/50) |
| Timeout/wedged | 10% (5/50) | 8% (4/50) |
| Battle-ready rate | 8% (4/50) | 4% (2/50) |

**This is a fundamentally different failure distribution than Gate A's original baseline, not just a
noisy repeat of the same one.** Death — the dominant outcome throughout this entire plan's
investigation until now (88% at Task 4, 74–100% through the five-lever combat-mechanics sweep) — is
now a minor outcome (12%). The six deaths that remain match the already-diagnosed residual pattern
exactly (median hull@engage 0.11, median rounds survived 1 — a ship arriving at a fresh engagement
already critically wounded from a prior one, the known bottleneck the round-budget rearm-on-confirm
fix exposed but didn't fully close). **LOSS (the Overmind arc itself resolving `"lost"`, 92% territory
share) is now the overwhelmingly dominant outcome (74%)** — confirming, at full 50-session scale, the
10-session finding already recorded above ("Pacing bottleneck traced decisively" /
"the agent structurally never reaches battle-ready"): the player is not losing a fight, the Overmind's
spread simply outruns whatever economic/military progress the ship makes in the vast majority of runs.

**Today's fix did not move this needle** — 4.0% is statistically indistinguishable from Task 4's 2.0%
(1 vs 2 wins out of 50), and battle-ready rate (8%) is only marginally above Task 4's 4%, nowhere near
the shift needed to clear Gate A's ≥40% target. This confirms the fix's own recorded caveat at the
time it was designed: skipping a *provably pointless* landing relocates idle time (more `move`/`warp
early-explore` instead of a no-op `land`) but doesn't itself manufacture new income — the deeper
economy-pacing problem (one hull upgrade around day 250–300, then credits plateau in a
1000–2000cr band for the rest of the session, per the prior "Diagnostic resolved" trace) is
untouched by this lever alone.

**Gate A (≥40%) not met — escalating per this plan's own clause, this time with the clearest picture
yet.** Death is functionally solved; the sole remaining, now-isolated blocker is **pacing**: the
Overmind's spread cadence (`adaptivePacing.ts` — `ADAPTIVE_GRACE_DAYS=90`,
`ADAPTIVE_SPREAD_SLOW_DAYS=45`→`ADAPTIVE_SPREAD_FAST_DAYS=10` keyed on ratcheted `campaignPeakPower`,
`ADAPTIVE_CREEP_START_DAY=360`/`ADAPTIVE_CREEP_MIN_DAYS=12` cadence floor) runs on close to a fixed
clock regardless of the player's real economic progress, while the player's own arming-up economy is
structurally slow (one lucky early hull buy, then a multi-hundred-day plateau). This plan's Context
section named these levers only for the *opposite* direction (slowing an over-fast win down toward the
day-1000 floor) — using them to *widen* the player's early runway (e.g. raising `ADAPTIVE_GRACE_DAYS`,
or slowing the pre-`ADAPTIVE_CREEP_START_DAY` cadence) is a different application of the same levers,
not pre-authorized by anything recorded so far, and directly touches the same "known, measured, open
gap" `CLAUDE.md`'s Overmind Arc section already flags. Per this plan's own standing discipline
(explicit scope decision before touching a new production lever direction; stop-and-report rather than
a further guess after a fix measures as inert), **stopping here to report the honest numbers and get
direction** rather than retuning `adaptivePacing.ts` unilaterally. Concrete recommendation for the next
round: either (a) widen the early grace/slow-spread window in `adaptivePacing.ts` so a structurally
slow economy has more runway before the front outruns it, or (b) continue the dev-only economy-tuning
thread (today's fix was one narrow slice of it — the bigger lever, per the "Diagnostic resolved" trace,
is the second-hull-tier affordability wall, not the no-op-landing waste this fix removed).

#### Re-measured after an unrelated fuel-stagnation wedge fix (2026-07-19) — wedge rate down 5×, win-rate unmoved

A separate live-session bug hunt that day fixed a different wedge class entirely: `MemoryHeuristicPolicy`'s
anti-stagnation escalation used to jump to `warp` to break a proven fight standoff even when the fuel tank
was already critical, and the live engine silently rejects a fuel-blocked jump every time — producing an
unbreakable `STAR_MAP↔SPACE_FLIGHT` ping-pong that pins the calendar (commit `0bb3989`, see
`docs/plans/20260719-autopilot-combat-coverage-and-campaign-pacing.md` for the fuller writeup). This is
continuing that plan's Task 1: re-measure this plan's own Gate A baseline now that the fix is in place,
before touching any pacing lever, since `CAMPAIGN-7`'s `repeat=2@SPACE_FLIGHT|attack` wedge (flagged above
on 2026-07-16 as "unrelated to either fix here") looked like the same fuel-stagnation class.

**Measured (50 sessions, `--pool=forks`): 2 win / 38 loss / 8 died / 2 timeout (1 wedged), win-rate 4.0%** —
median win day 205, battle-ready rate 8% (4/50, avg d214), liberation rate 100% (avg d102), avg peak power
0.11.

| Metric | This measurement | 2026-07-17 baseline |
|---|---|---|
| Win rate | 4.0% (2/50) | 4.0% (2/50) |
| Died | 16% (8/50) | 12% (6/50) |
| Loss (Overmind wins arc) | 76% (38/50) | 74% (37/50) |
| Timeout/wedged | 4% (2/50, **1 wedged**) | 10% (5/50, **5 wedged**) |
| Battle-ready rate | 8% (4/50) | 8% (4/50) |

**Confirmed: `CAMPAIGN-7` no longer wedges** — it now runs the full 1080-day budget to a clean `TIMEOUT`
with `share=0.00` (Overmind fully cleared, arc just never resolves `"won"` per the engaged/participation
gate). **Wedge rate dropped 5× (10%→2%)**, but this is an orthogonal fix — it does not touch economy or
Overmind-spread pacing at all, so win-rate is, as expected, statistically unchanged (2/50 both times). One
residual wedge remains (`CAMPAIGN-36`, day 53, `dayFrozen=298` — a much earlier, lower-power session than
the fixed class; not chased further here, tracked separately).

**This confirms Gate A is still not met and the blocker is exactly the pacing bottleneck already diagnosed
above** — proceeding with option (a) (widen the adaptive-pacing runway) next, per
`docs/plans/20260719-autopilot-combat-coverage-and-campaign-pacing.md` Task 2.

#### Option (a) applied — `ADAPTIVE_SPREAD_SLOW_DAYS` widened 45→55 (2026-07-19) — win-rate 3× (4.0%→12.0%), Gate A still not met

Two wider attempts (`SLOW_DAYS`/`GRACE_DAYS` 65/120, then 55/105) both broke `sessionCompetence.test.ts`'s
Task 7 day-200 milestone identically (peak power 0.16→0.076, under the 0.13 floor). Isolated by testing each
lever alone: `SLOW_DAYS` alone tests clean; `GRACE_DAYS` alone reproduces the break by itself. Root cause:
delaying the Overmind's first appearance also delays `MemoryHeuristicPolicy`'s own urgency to arm up (its
"Threat/Overmind" tier is keyed off Overmind proximity/share) — within that test's fixed 200-day window this
trades away more early-milestone progress than it buys the player. Landed with `GRACE_DAYS` **unchanged**
(90) and only `ADAPTIVE_SPREAD_SLOW_DAYS` widened 45→55 (`src/config/balance.ts`, tests in
`src/tests/campaign/adaptivePacing.test.ts`). Full unit suite (620 files/5893 tests), `letsplay:ci`
(108/108), and `sessionCompetence.test.ts` all green with this single-lever change.

**Measured (50 sessions, `--pool=forks`): 6 win / 31 loss / 11 died / 2 timeout (1 wedged), win-rate 12.0%**
— median win day 355, battle-ready rate **12%** (6/50, avg d248, up from 8%), liberation rate 100% (avg
d101), avg peak power 0.11.

| Metric | This measurement | Previous (fuel-fix only) |
|---|---|---|
| Win rate | **12.0% (6/50)** | 4.0% (2/50) |
| Died | 22% (11/50) | 16% (8/50) |
| Loss (Overmind wins arc) | 62% (31/50) | 76% (38/50) |
| Timeout/wedged | 4% (2/50, 1 wedged) | 4% (2/50, 1 wedged) |
| Battle-ready rate | 12% (6/50) | 8% (4/50) |

**A real, meaningful improvement (3×) from a single conservative lever, but Gate A (≥40%) is still far off.**
Died ticked up (more battle-ready ships now engaging and sometimes losing that fight) while Loss (arc
resolving against the player) dropped correspondingly — consistent with more sessions actually reaching a
contest instead of just running out the clock unarmed. `GRACE_DAYS` remains a known, deliberately-untouched
lever (see the widening's doc comment in `balance.ts`) for a future round, alongside Task 2b's economy-tuning
thread (the second-hull-tier affordability wall) — **stopping here to report** rather than continuing
straight into Task 2b unchecked, per this plan's own escalation discipline and the tension option (a) just
surfaced between "give the player more time" and "keep enough Overmind pressure to motivate arming up."

#### Task 2b applied — freighter price 4500→3900 (2026-07-25) — a confirmed **no-op on win-rate** in a clean same-HEAD A/B; the credits-bound premise has aged out

Per `docs/plans/20260719-autopilot-combat-coverage-and-campaign-pacing.md` Task 2b, took the economy option:
eased the "second-hull-tier affordability wall" the 2026-07-16 "Diagnostic resolved" trace named. The
battle-ready hull is the `hull_freighter` (180 hp, `BATTLE_READY_MAX_HULL`); trimmed its price 4500→3900 —
the deepest cut that still preserves every gear-curve invariant (stays strictly above the corvette so it
never *dominates* it, keeps the corvette the best HP/cr hull, stays inside the locked tech-3/4 2000–5000
band). That lowers the net upgrade wall from the corvette from 4300cr to 3700cr
(`price − 0.4×3000 trade-in + 1000 reserve`). Pinned in `src/tests/balance/gearCurve.test.ts`.

Ran a **clean same-HEAD A/B** (both 50 sessions, `--pool=forks`, identical seed set `CAMPAIGN-0..49`, only
the freighter price differing):

| Metric | 3900 (Task 2b) | 4500 (baseline, same HEAD) |
|---|---|---|
| Win rate | **18.0% (9/50)** | **18.0% (9/50)** |
| Died | 10% (5/50) | 8% (4/50) |
| Loss (arc) | 72% (36/50) | 74% (37/50) |
| Battle-ready rate | 18% | 18% |
| Battle-ready avg day | d223 | d239 |

**Win-rate and battle-ready rate are identical — the price lever is a no-op on Gate A.** The only movement is
battle-ready reached ~16 days sooner (d223 vs d239, small-n), so the change is kept as a minimal,
invariant-safe, zero-regression pacing improvement rather than reverted, but it does **not** move the gate.

The measurement also shows **the original credits-bound premise has substantially aged out** since the
2026-07-16 diagnostic: many LOSS sessions now bank far more than the ~5500cr the second hull ever needed
(`CAMPAIGN-2` peakCredits 53716, `CAMPAIGN-46` 63558, `CAMPAIGN-26` 23200, `CAMPAIGN-42` 16479) yet still lose
at `share=0.92`, and sessions that reach battle-ready *early* (`CAMPAIGN-46` at d119 with 63k peak credits)
still LOSS. Credits are no longer the binding constraint — the intervening trade/quest/reputation fixes
(Tasks 6–10 of the sibling plan) fixed the plateau. **The binding constraint is now the Overmind spread
outrunning the player regardless of wallet or arming** — i.e. squarely back in option (a) (spread-pacing)
territory, which Task 5 above could only partially open (`SLOW_DAYS` 45→55; `GRACE_DAYS` still blocked by
`sessionCompetence.test.ts`). Note also the current-HEAD baseline is **18%**, well above Task 5's 12% —
the sibling plan's Tasks 6–10 lifted it further on their own. Gate A (≥40%) still not met; recommend the next
round target spread-pacing / arming-behavior, not further hull pricing.

#### Task 9b probed — arm-up-priority quest gate is a confirmed **net-negative** in a clean same-HEAD A/B; not landed (2026-07-25)

Per `docs/plans/20260719-autopilot-combat-coverage-and-campaign-pacing.md` Task 9b, took the "decline
new board work once arming up is behind schedule" option: a candidate lever
`ARMUP_PRIORITY_OVERMIND_SHARE = 0.35` gating the `take-work` tier off for a not-yet-battle-ready ship
once the Overmind share crosses 0.35, so its remaining travel budget funds the refit instead of a fresh
sourcing/delivery detour. The premise (from Task 9) was that genuine quest sourcing had *halved*
win-rate 12.0% → 6.0% and needed recovery.

Ran a **clean same-HEAD A/B** (both 50 sessions, `--pool=forks`, identical seed set `CAMPAIGN-0..49`,
only the MHP quest-gate differing):

| Metric | With arm-up-priority gate | Baseline (gate reverted, same HEAD) |
|---|---|---|
| Win rate | **14.0% (7/50)** | **18.0% (9/50)** |
| Died | 8% (4/50) | 10% (5/50) |
| Avg quests completed / session | 4.40 | 4.72 |
| Battle-ready rate | 18% (avg d230) | 20% (avg d239) |
| Solo-liberation rate | 24% (avg d365) | 30% (avg d364) |

**Every metric moves the wrong way with the gate** — win-rate, quest-completion (the very thing Task 9's
correctness fix restored), battle-ready rate, and solo-liberation all regress slightly. The gate suppresses
quest-taking activity for no win-rate gain. Reverted; not landed.

The measurement also confirms **Task 9b's motivating premise has aged out**: Task 9's 12%→6% halving was
measured on an *older* HEAD, before Task 2b (freighter 3900) and the intervening reputation-faction /
`planetApproachPoint` fixes (sibling plan Task 10). On the current HEAD the same-HEAD baseline is **18%** —
Task 9's regression has already been fully absorbed by later work, so there is no 6% regression left to
recover from. Recommend the next round target the true binding constraint identified in Task 2b above —
Overmind **spread-pacing / arming behavior** (option (a)), not further autopilot quest-gating heuristics.

- [x] Based on Task 5's re-measured death taxonomy, iterate remaining unpinned levers (record every
      sweep and result, mirroring the prior plan's sweep-log format): candidates include further
      `HOSTILE_SCALING_WEAK_MULT` tuning, `NEUTRAL_AGGRO_POWER_THRESHOLD` (gates whether wandering
      neutral packs chase a weak ship at all — raising it extends the "not hunted while weak"
      window), economy-recovery pacing, or Overmind spread-cadence pacing (the two runner-up
      directions from Task 4's escalation, if Task 5's single lever isn't sufficient alone). Do not
      re-try `NEUTRAL_SCALING_WEAK_MULT` (already diagnostically ruled out) or
      `OVERMIND_GARRISON_POWER_MAX_BONUS` (still categorically pinned) without a fresh scope
      decision. — **candidate levers analyzed against the current (2026-07-25) taxonomy and all
      found blocked or evidence-ruled-out; escalated, no blind sweep run — see outcome below.**
- [x] After each sweep, check the **pacing** side too: if median win day is trending well below
      1000 as win-rate climbs, note it now (don't wait for Task 7) — the fix is an
      `adaptivePacing.ts` lever (`ADAPTIVE_GRACE_DAYS`/spread interval), not a further difficulty
      cut, since a too-fast win is this plan's other named failure mode. — **noted: the 9 current
      wins land far too early (e.g. `CAMPAIGN-1` d325) — but this is moot while win-rate is 18%, and
      the day-1000 floor is a pacing concern to revisit only once survivability actually crosses the
      gate. Recorded, not acted on.**
- [x] Run 50-session measures per sweep; run `letsplay:ci`/`test:playtest` after each production
      change — must stay green throughout. — **no production change made this round (escalation, not
      a sweep); the current 50-session baseline (18.0%, `.letsplay/campaign-summary.txt`, measured
      today by the sibling plan's Task 2b same-HEAD A/B) is the reference. No tree change to
      validate.**

#### Task 6 outcome (2026-07-25) — sweep-tune lever set exhausted; escalating per this plan's clause, no blind sixth+ guess

Before running any sweep I re-grounded Task 6's four candidate levers in the **current** failure
taxonomy (today's `.letsplay/campaign-summary.txt`, the sibling plan's fresh same-HEAD 50-session
baseline), rather than the stale Task-4/Task-5-era death census the checkbox text was written
against. The taxonomy has shifted decisively since then:

| Metric (current HEAD, 50 sessions) | Value |
|---|---|
| Win rate | **18.0% (9/50)** |
| **Loss (Overmind wins the arc)** | **72% (36/50)** — the dominant mode |
| Died (combat) | 10% (5/50) |
| Timeout / wedged | 0% |
| LOSS resolution day (representative) | **d417–459 at `share=0.92`** (loss-share 0.85 already crossed) |
| battle-ready reached on a LOSS session | never (`battleReady=-` on the sampled losses) |

**The binding constraint is unambiguously Overmind spread-pacing, not survivability.** The dominant
outcome is now LOSS (72%), not death (10%) — the front reaches loss-share (`0.92 > 0.85`) around
**day ~450**, which is exactly where the creep floor bites (`ADAPTIVE_CREEP_START_DAY=360` measured
from `dayZero ≈ 90`, then interval collapses `~50 → 12` days). Sessions that bank tens of thousands
of credits still LOSS at `share=0.92` (`CAMPAIGN-2`: peakCredits 53716, LOSS d458) — confirming the
2026-07-25 finding that **credits/arming are no longer binding; the spread outruns the player
regardless of wallet.**

Each candidate lever, checked against this taxonomy:
- **Overmind spread-cadence pacing (the evidence-indicated lever)** — every `ADAPTIVE_*` constant is
  **value-pinned** in `src/tests/campaign/adaptivePacing.test.ts` (`SLOW_DAYS=55`@:103,
  `GRACE_DAYS=90`@:104, `FAST_DAYS=10`@:108, `CREEP_START_DAY=360`@:109, `CREEP_MIN_DAYS=12`@:110).
  The single highest-leverage move — pushing the creep floor later so the front doesn't collapse to
  a 12-day cadence at day ~450 — is *doubly* blocked: the value-pin at :109 **and** the idle-loss
  invariant (`resolvedDay < 900`, :219) which a later creep would violate. `GRACE_DAYS` is
  additionally blocked by `sessionCompetence.test.ts` (two prior widening attempts, recorded
  2026-07-19). Touching any of these is a fresh pinned-test scope decision, which this plan reserves
  to the user (only the pirate-garrison reversal was pre-authorized).
- **`NEUTRAL_AGGRO_POWER_THRESHOLD`** — not value-pinned (only referenced in
  `neutralAggroGating.test.ts`), so technically sweepable, **but it only touches the 10% DIED
  population** (it gates whether wandering neutral packs hunt a weak ship). It structurally cannot
  close a gate dominated by the 72% LOSS mode — even converting *every* death to a win caps at ~28%,
  short of Gate A's 40%. Sweeping it would be a blind guess against the evidence.
- **`HOSTILE_SCALING_WEAK_MULT`** — Task 5 already proved this lever structurally unreachable for the
  dominant population (only fires inside already-held systems, gated on battle-ready, which LOSS
  sessions never reach). Further tuning is ruled out with evidence.
- **Economy-recovery pacing** — the current data (banking 53k and still LOSS) confirms credits are
  not the binding constraint; ruled out with evidence (consistent with sibling Task 2b's freighter
  no-op).

**Conclusion — escalating per this plan's escalation clause.** The balance-constant sweep space that
is this plan's actual authorized scope ("any Overmind pacing/garrison-count/combat-scaling lever
lives in `balance.ts`") is now exhausted: the one lever the current evidence points at (spread
cadence, specifically the creep floor) is fully pinned by a recently- and deliberately-set known-good
test, and every other candidate is either evidence-ruled-out or structurally unable to close a
LOSS-dominant gate. No sweep run — running a 50-session measure with no production change would only
re-confirm today's already-measured 18% baseline for zero new information, and touching the pinned
spread-pacing tests autonomously would violate the standing "never weaken an existing assertion; STOP
and ask" rule.

**Recommendation for the user (concrete, per the escalation clause's requirement to name an
architectural direction, not another parameter guess):** the next round needs a scope decision on
one of —
1. **Authorize a pinned spread-pacing scope decision** (mirroring Task 1's pirate reversal): push the
   creep floor out (`ADAPTIVE_CREEP_START_DAY` and/or `ADAPTIVE_CREEP_MIN_DAYS`) so the front does
   not collapse to a 12-day cadence at ~day 450, re-pinning `adaptivePacing.test.ts` and re-scoping
   the idle-loss `<900` invariant. This is the single change the current data most directly implicates
   and is the recommended first move. (Note: this also naturally serves the day-1000 *floor* — a
   slower creep pushes both LOSS and WIN resolution later.)
2. **Player liberation throughput** (architecture, sibling-plan territory): the LOSS sessions land a
   `firstLib` (~d98) but never a *solo* liberation and never battle-ready — the player clears one
   assisted system then stalls. Improving how fast the autopilot actually contests/clears the front
   is a `MemoryHeuristicPolicy`/combat-coverage problem, not a `balance.ts` constant; Task 9b showed
   quest-gating tweaks are net-negative, so this needs a real coverage/targeting change, not another
   heuristic gate.

Awaiting user direction before touching either (both out of this plan's currently-authorized scope).

### Task 7: Measure against Gate B

- [x] Run `npm run letsplay:campaign` with `CAMPAIGN_SESSIONS=50`; record win-rate, median win day,
      death taxonomy. Compare against Gate B (≥ 80% win-rate, median win day ≥ 1000). — measured
      2026-07-25: **18.0% win-rate, median win d325 — Gate B missed on both axes** (see outcome below).
- [x] If median win day is below 1000 despite a high win-rate, apply the pacing-lever fix identified
      in Task 6 and re-measure — this is expected to be a real, needed step given every prior
      measurement in this codebase's history has the opposite problem (dying too early, never
      winning too early), so Gate B's day-1000 floor is genuinely un-tested territory once
      survivability actually improves. — **NOT reachable**: the conditional's premise ("high win-rate,
      low win day") does not hold — win-rate is 18% (low), not high. And the pacing lever Task 6
      identified (spread-cadence / creep floor) is fully value-pinned and reserved to the user (Task 6
      escalation), so it cannot be applied autonomously. The day-1000 floor stays moot while win-rate
      is 18% — nobody wins early enough to threaten it; the dominant outcome is LOSS at day ~428.
- [x] If Gate B is not met after reasonable iteration (record what was tried), apply this plan's
      escalation clause — report to the user with the honest measured numbers and a concrete
      next-step recommendation, do not silently loosen the gate. — **escalating** (see outcome below):
      no reasonable iteration is available inside authorized scope (Task 6 exhausted the balance-lever
      space; the one evidence-indicated lever is user-reserved-pinned), so this measure re-confirms the
      escalation rather than iterating blindly.
- [x] `npm run letsplay:ci` and `npm run test:playtest` must stay green. — `test:playtest` **GREEN**
      (817 passed, 10 pre-existing skips). `letsplay:ci` was **RED and the prior close-out
      MISDIAGNOSED it as "pre-existing on clean HEAD"** — that verification only stashed the *sibling
      branch's uncommitted* CRUISER/schema changes, which left the *committed* spawn-heading change
      (`b70f50d`, "ship faces the sun on context-less system entry", #19) in place, so the red
      reproduced and was wrongly read as master-side drift. **Root cause (code review 2026-07-25):**
      that commit is the actual cause — `ShipPhysics` uses arc-only steering, so the new context-less
      sun-facing default (`ctx?.arrivalHeading ?? Math.atan2(centerY-entryY, centerX-entryX)`) changed
      the GOD-seed `CAMPAIGN-CAPACITY-0`'s flight *path* and slipped first-liberation d185→d196,
      timing out at ~d201 past the pinned `firstLiberationDay ≤ 190` proxy. Reverting *only* that one
      line to `?? 0` turns `sessionCompetence.test.ts` green (3/0), proving causation. **Fixed** by
      reverting the #19 spawn-heading change (and its branch-new `systemEntryOrientation.test.ts`);
      warp arrivals still thread their own sun-facing heading via `ctx.arrivalHeading`, so the visual
      is unaffected on the path that matters. `letsplay:ci` now GREEN.

#### Task 7 outcome (measured 2026-07-25) — Gate B NOT MET; escalation clause applied, no blind iteration

Fresh 50-session `npm run letsplay:campaign` on current HEAD (`.letsplay/campaign-summary.txt`,
gitignored):

| Metric | Result | Gate B target |
|---|---|---|
| Win rate | **18.0% (9/50)** | ≥ 80% |
| Median win day | **d325** (wins span d98–d422) | ≥ 1000 |
| **Loss (Overmind wins the arc)** | **74% (37/50)** — dominant mode | — |
| Died (combat) | 8% (4/50) | — |
| Timeout / wedged | 0% | — |
| LOSS resolution day | median ~**d428** (range d409–486) | — |
| Milestones | battle-ready 20% (avg d229), liberation 100% (avg d90), solo-lib 26% (avg d332) | — |
| Avg peak power | 0.12 | — |
| Death causes | OVERMIND = 4/4 (100%), median hull@engage 0.10, median 1 simultaneous combatant | — |

**Gate B missed on both axes by a wide margin** (18% vs ≥80%; median win d325 vs ≥1000). This is a
byte-for-byte reproduction of Task 6's same-HEAD baseline (Task 6 measured 9 win / 36 loss / 5 died;
this run 9 win / 37 loss / 4 died — statistically identical, the ±1 died/loss is one session
re-classified), confirming the campaign is exactly where Task 6 left it: the balance-lever space this
plan is authorized to touch is exhausted, and the single evidence-indicated remaining lever (Overmind
spread-cadence / creep floor) is fully value-pinned in `adaptivePacing.test.ts` and reserved to the
user by this plan's own "one pre-authorized reversal only" rule.

**The failure taxonomy is unchanged from Task 6 and remains pacing-bound, not survivability-bound:**
the dominant outcome is LOSS (74%) — the front reaches loss-share (~0.85+) around day ~428, exactly
where the creep floor collapses the spread cadence to a 12-day interval after `ADAPTIVE_CREEP_START_DAY`.
Combat death is a minor mode (8%), and even those 4 deaths are late (hull@engage 0.10, i.e. already
ground down, single combatant — not the multi-ship instant-volley signature the earlier escalations
chased). Wins that DO happen land early (median d325, well below the day-1000 floor) — but that floor
is moot while 82% of sessions never win at all.

**letsplay:ci regression — MISDIAGNOSED as pre-existing, actual cause found & fixed (code review
2026-07-25):** the `sessionCompetence.test.ts` GOD-mode milestone proxy (`firstLiberationDay ≤ 190`)
was RED on committed HEAD — the seed `CAMPAIGN-CAPACITY-0` liberated at d195–196 and TIMEOUTed at
d201, whereas the test's own comment records it resolving a real win at d185 on 2026-07-19. This was
**NOT pre-existing master drift**: the earlier "reproduces with the sibling branch's uncommitted
changes stashed" check only stashed the *working tree*, so the *committed* spawn-heading change
`b70f50d` (#19, "ship faces the sun on context-less system entry") stayed in place. Because
`ShipPhysics` steers arc-only, that commit's sun-facing initial heading altered the seed's flight
path and pushed first-liberation past the day-190 proxy. Verified by reverting just that one line
(`?? 0`) → `sessionCompetence.test.ts` green (3/0). **Resolution:** the #19 change and its branch-new
`systemEntryOrientation.test.ts` were reverted, restoring the green gate; this is unrelated to the
LOSS-taxonomy pacing question (that remains open/escalated below).

**Escalating per this plan's escalation clause** (and Task 6's already-recorded recommendation, which
this measurement re-confirms rather than supersedes): the next round needs a **user scope decision**,
not another autonomous lever guess. Concretely, the two candidates Task 6 named still stand, in
priority order:
1. **Authorize a pinned spread-pacing scope decision** (mirroring Task 1's pirate reversal): push the
   creep floor out (`ADAPTIVE_CREEP_START_DAY` / `ADAPTIVE_CREEP_MIN_DAYS`) so the front does not
   collapse to a 12-day cadence at ~day 450, re-pinning `adaptivePacing.test.ts` and re-scoping the
   idle-loss `<900` invariant. This is the single change the LOSS-dominant data most directly
   implicates, and it naturally also serves the day-1000 *floor* (a slower creep pushes both LOSS and
   WIN resolution later). Fixing the letsplay:ci `sessionCompetence` red is downstream of this same
   decision. **Recommended first move.**
2. **Player liberation throughput** (architecture, sibling-plan territory, `MemoryHeuristicPolicy` /
   combat-coverage — not a `balance.ts` constant): LOSS sessions land an assisted `firstLib` (~d90)
   but 74% never reach a *solo* liberation and never battle-ready — the player clears one assisted
   system then stalls while the front outruns them. Task 9b already showed heuristic quest-gating
   tweaks are net-negative, so this needs a real coverage/targeting change.

Awaiting user direction before touching either (both out of this plan's currently-authorized scope).
`test:playtest` stays green; the `letsplay:ci` red is the pre-existing, in-scope-for-escalation
pacing regression documented above.

### Task 8: [Final] Verify acceptance criteria and update documentation

- [x] Verify Gate B was met (or the escalation happened and the user gave further direction — update
      this task's scope accordingly if so). — **Gate B was NOT met (18%, Task 7) and the escalation
      clause was applied**; no further user direction has been given, so this task's scope is the
      honest close-out below (run the gates, record measured results, update docs), not a certification
      of a passed gate. The plan remains **open, escalated to the user** for a spread-pacing scope
      decision.
- [x] Run full unit suite, `tsc --noEmit`, `npm run lint`, `npm run test:playtest`,
      `npm run letsplay:ci`, `npm run test:save-compat` — all must be green. — **run 2026-07-25**:
      `tsc --noEmit` GREEN, `npm run lint` GREEN, `test:playtest` GREEN (817 passed / 10 skipped),
      `test:save-compat` GREEN (22 passed). Unit suite **624 passed / 1 failed** and `letsplay:ci`
      **108 passed / 1 failed** — the single failure in both is the **same, documented pre-existing**
      `sessionCompetence.test.ts > Task 7 — campaign milestone proxies` regression (`expected 196 to be
      less than or equal to 190`, seed `CAMPAIGN-CAPACITY-0` liberates d196 / TIMEOUTs d200). This is
      exactly the pacing-drift Task 7 recorded as pre-existing on clean HEAD and out of this plan's
      authorized scope — fixing it requires either editing a pinned assertion (forbidden by the
      standing rule) or moving the user-reserved spread-pacing levers. No production code was changed
      in this documentation task, so this is not a new regression; reported honestly, not marked green.
- [x] Update `.claude/docs/systems/overmind.md`'s "Known-unmet gate" section with this plan's
      measured results — add to the existing dated history (2026-07-07 → 2026-07-13 garrison
      discount → this plan's dated entry), do not delete prior honest numbers. — **done**: appended a
      "2026-07-25 Gate B outcome + plan close-out" addendum recording the six verified escalations,
      the 18% Gate B miss, and the death→LOSS taxonomy flip; prior dated entries left intact.
- [x] Update `CLAUDE.md`'s Overmind Arc section if the pirate-discount lever or the day-1000 pacing
      floor becomes a named invariant worth calling out. — **done**: corrected the stale "pirate
      garrisons stay unscaled by design" line (Task 3 reversed it) — the discount now covers both
      Overmind- and pirate-held garrisons with a GOD-mode exemption, and the binding constraint is
      recorded as Overmind spread-cadence / the creep floor, not garrison count.
- [x] Record final lever values and measured results (all gates, all sweeps) in this plan's
      Technical Details section. — **done**: Technical Details now lists every landed lever value and
      the full per-escalation measurement progression (4% → 2% → 18% → Gate B 18% miss).

#### Task 8 outcome (2026-07-25) — plan closed out honestly, gate NOT met, escalated to the user

This plan is **complete as a documentation/verification close-out**, not as a met acceptance gate.
Gate B measured 18% (Task 7) against a ≥80% target; the balance-lever space this plan was authorized
to touch is exhausted across six individually-verified escalations (garrison discount 1→4 + pirate
reversal + GOD exemption, `HOSTILE_SCALING_WEAK_MULT` 0.9→0.5, current-hull round budget, fire-timer
stagger, death-cause telemetry), none of which moved the win-rate off its ~2–18% band. The failure
mode has flipped from death-dominant to **LOSS-dominant** (the Overmind front outruns the player at
~day 428 as the creep floor collapses the spread cadence), so the single evidence-indicated remaining
lever is Overmind spread-cadence / the creep floor — value-pinned in `adaptivePacing.test.ts` and
reserved to the user per this plan's "one pre-authorized reversal only" rule. **The plan remains open,
escalated to the user** for a scope decision on either (1) a pinned spread-pacing reversal (recommended
first move, also serves the day-1000 floor) or (2) player liberation-throughput architecture in
`MemoryHeuristicPolicy`/combat-coverage. Gate battery re-run 2026-07-25: `tsc`/`lint`/`test:playtest`
(817)/`test:save-compat` (22) all green; the one red — `sessionCompetence.test.ts`'s GOD-milestone
proxy — was recorded here as pre-existing pacing drift. **Correction (revert `0d67fda`, same day):**
that red was NOT pre-existing — it was self-inflicted by the committed #19 sun-facing spawn-heading
change (`b70f50d`), which perturbed the `CAMPAIGN-CAPACITY-0` seed's arc past the day-190 proxy.
Reverting the `?? 0` heading line restored the gate: `letsplay:ci`/`sessionCompetence` is now **green**
(see the "letsplay:ci regression — MISDIAGNOSED" note above). The out-of-scope conclusion in the
second Task 8 checkbox is therefore superseded — no remaining known red. Documentation updates landed
in `.claude/docs/systems/overmind.md` and `CLAUDE.md`. The
300-session final acceptance run stays deferred in Post-Completion (interim Gate B was never stably
met, so running it would only re-confirm the ~18% plateau).

## Technical Details

- **Graded discount formula** (unchanged shape from the prior plan, retuned constant):
  `overmindGarrisonPowerDiscount(p, maxDiscount) = Math.floor((1 - clamp01(p)) * maxDiscount)`.
  Structural ceiling: `GARRISON_MIN=5`, `GARRISON_DISCOUNT_FLOOR=1` ⇒ `maxDiscount ≤ 4`.
- **GOD-mode exemption**: `mode === GOD ⇒ discount = 0` at the `fillGarrison` call site — GOD's hull
  floor already prevents the death this discount targets, so it has nothing to gain and (per the
  prior plan's Task 2 finding) a real combat-loot-income downside to lose.
- **Pirate-garrison discount**: implemented per Task 1's recorded shape — the `overmind ? : 0` guard
  on `powerDiscount` in `NpcGarrisonCombat.ts::fillGarrison` was dropped, so **both** branches call
  `overmindGarrisonPowerDiscount(peakPower)` with the same `maxDiscount=4`, keeping only the GOD-mode
  exemption (`powerDiscount = this.gameMode !== "GOD" ? overmindGarrisonPowerDiscount(peakPower) : 0`).
  The upward `overmindGarrisonPowerBonus` stays Overmind-only (the pressure-ramp bonus was not part of
  the reversal). No pirate-specific constant — pirate systems fill to the same `[GARRISON_MIN 5,
  GARRISON_MAX 10]` baseline.
- **Day-1000 floor**: primarily a **measurement/tuning target** (median win day within
  `[1000, 1095]` at the final gate), not a new mechanical win-block coded into
  `overmindSpread.ts` — record here if Task 7 finds this interpretation insufficient (e.g. if
  individual sessions win dramatically early, like day 300-400, even though the *median* lands
  correctly) and a harder per-session floor becomes necessary; that would be new engine logic and
  its own scope decision, out of this plan's default assumption.
- **Final lever values (landed, in `src/config/balance.ts` unless noted)**:
  - `OVERMIND_GARRISON_POWER_MAX_DISCOUNT = 4` (was `1`) — graded ramp `4→3→2→1→0` across `p∈[0,1)`.
  - GOD-mode discount exemption at `NpcGarrisonCombat.ts::fillGarrison` call site (both branches).
  - Pirate-garrison discount enabled (guard dropped — see Pirate-garrison discount above).
  - `HOSTILE_SCALING_WEAK_MULT = 0.5` (was `0.9`) — Task 5; kept above `NEUTRAL_SCALING_WEAK_MULT=0.4`
    to preserve the "held-system harder than neutral" gradient.
  - `combatJoinFireStaggerMs = 300` (new) — Task 5 fix #2; staggers batch-join fire timers.
  - Round-damage budget computed off **current** hull (`combatRounds.ts::roundIsComplete`) — Task 5 fix #1.
  - Structured death-cause telemetry: `PlayerDeathCause` on `CombatModule`, surfaced via
    `RealEngineHarness.lastDeathCause()`, aggregated in `campaignMetrics.ts` — dev/test only, no
    domain/schema/save impact.
- **Measured results (all `npm run letsplay:campaign`, 50 sessions unless noted)**:
  - Prior-plan baseline (before this plan): **4.0%** (2/50).
  - Gate A after Task 2/3 (garrison discount + pirate reversal): **2.0%** (1/50) — MISS (target ≥40%).
  - After Task 5 `HOSTILE_SCALING_WEAK_MULT` 0.9→0.5: **2.0%** — no-op (lever structurally unreachable
    for the pre-battle-ready death population).
  - After combat fix #1 (current-hull round budget): **2.0%** — no-op.
  - After combat fix #2 (fire-timer stagger): **2.0%** — no-op (not byte-identical; taxonomy shifted).
  - After sibling-plan pacing (`ADAPTIVE_SPREAD_SLOW_DAYS` 45→55, freighter price trim): **18.0%**.
  - **Gate B (Task 7): 18.0%** (9/50), median win **d325** — MISS on both axes (targets ≥80%, ≥d1000).
  - **Final gate (300 sessions, ≥99%): NOT RUN** — deferred; interim Gate B was never stably met, so
    the plan escalated instead of proceeding to the acceptance run.
- **Escalation outcome**: the balance-constant lever space this plan is authorized to touch is
  exhausted. Failure mode flipped death-dominant → **LOSS-dominant** (front outruns the player at
  ~day 428). The one evidence-indicated remaining lever — Overmind spread-cadence / creep floor
  (`ADAPTIVE_CREEP_START_DAY`/`_CREEP_MIN_DAYS`) — is value-pinned in `adaptivePacing.test.ts` (`:109`,
  `:110`) and doubly-blocked by its idle-loss `resolvedDay < 900` invariant (`:219`), reserved to the
  user. Next round needs a user scope decision (spread-pacing pin reversal, or liberation-throughput
  architecture in `MemoryHeuristicPolicy`), not another autonomous parameter guess.

## Post-Completion

**Full acceptance re-run** (matches both prior plans' cadence, deliberately deferred since slow):
- 300-session `letsplay:campaign` acceptance gate (≥ 297/300 wins, median win day in `[1000,1095]`,
  0 deaths) — only once the Task 7 interim gate is stably met, not before.
- 100-session neural-policy re-run if the heuristic gate improves enough to matter (the neural
  teacher clones whatever the heuristic does — a much-improved heuristic win-rate is worth
  re-checking against the net's own ceiling, previously measured far below the teacher's).

**Live-browser feel-check** (manual, informational): watch a live autopilot session engage a
now-pirate-discounted held system at low power to confirm the reduced garrison still reads as a
real fight, not a trivial mop-up — headless win-rate numbers alone can't judge whether the new
difficulty curve feels fair to a human player. (This check can use the resumed-autopilot feature
from the sibling `docs/plans/20260713-autosave-autopilot-resume.md` if that plan has landed by
then, to more easily observe a long session across multiple sittings — not a hard dependency.)
