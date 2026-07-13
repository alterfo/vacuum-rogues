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
      above the prior 4% plateau — target ≥ 40%; **Gate B** (Task 6, 50 sessions) ≥ 80% win-rate,
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
sessions) ≥ 40%; Gate B (Task 6, 50 sessions) ≥ 80% win-rate & median win day ≥ 1000; Final
(Post-Completion, 300 sessions) ≥ 99% (≥ 297/300) & median win day ∈ `[1000, 1095]`. Revisit only if
Gate A's actual numbers demand it.

### Task 2: Fix the garrison-discount knife-edge + add GOD-mode exemption

- [ ] Retune `OVERMIND_GARRISON_POWER_MAX_DISCOUNT` in `src/config/balance.ts` to Task 1's decided
      value; update the doc comment to describe the graded-ramp behavior (not the old knife-edge
      note) and reference this plan.
- [ ] Add the GOD-mode exemption in `NpcGarrisonCombat.ts`'s `fillGarrison()` (or the discount
      lookup call site) per Task 1's decided shape.
- [ ] Write tests: `overmindGarrisonPowerDiscount` at the new `maxDiscount` produces a graded
      (non-knife-edge) value across the `0.02-0.15` power band (extend `hostileScaling.test.ts`);
      GOD-mode fillGarrison path gets `0` discount regardless of power (extend
      `garrisonPowerScaling.test.ts`); confirm `sessionCompetence.test.ts`'s GOD-mode milestone probe
      stays green (this is the regression this exemption specifically targets).
- [ ] Run affected unit tests — must pass before Task 3.

### Task 3: Add the pirate-garrison discount

- [ ] Add `pirateGarrisonPowerDiscount` (or extend the existing function to take an `overmind: boolean`
      shape decided in Task 1) so `fillGarrison(..., overmind=false)` also receives a downward
      discount — mirror the Overmind function's exact graded-ramp shape unless Task 1 recorded a
      reason for pirates to scale differently (e.g. a different `maxDiscount` since pirate systems
      may have different baseline counts — check `fillGarrison`'s pirate branch before assuming
      identical constants).
- [ ] Update `garrisonPowerScaling.test.ts`'s pirate assertions per Task 1's recorded reversal —
      pirate garrison count now varies with power, same shape as the Overmind-side test.
- [ ] Write tests for the new/extended function's pirate-specific behavior (weak player → smaller
      pirate garrison, maxed player → today's undiscounted range, GOD-mode exemption if Task 1
      decided pirates also need it).
- [ ] Run affected unit tests, `npm run letsplay:ci`, `npm run test:playtest` — all must pass before
      Task 4.

### Task 4: First measured re-run (Gate A)

- [ ] Run `npm run letsplay:campaign` with `CAMPAIGN_SESSIONS=50`; record win-rate, median win/death
      day, `battleReadyDay` rate, death taxonomy (early vs grind-to-death, Overmind-held vs
      pirate-held now that pirates are discounted too) in this plan.
- [ ] Compare against Task 1's Gate A target (≥ 40%) and the prior plan's 4% baseline. If Gate A is
      not met, this task's own escalation applies **before** proceeding to Task 5/6: analyze
      whether the shortfall is early-death-dominant (Task 2/3's levers not enough) or a new failure
      mode (e.g. grind-to-death re-emerging now that garrisons are smaller but the player still
      dies fighting them slowly) — record findings, do not silently proceed to Task 5 without this
      analysis.
- [ ] `npm run letsplay:ci` and `npm run test:playtest` must stay green.

### Task 5: Iterate toward Gate B if Task 4 met Gate A

- [ ] Based on Task 4's death taxonomy, iterate remaining unpinned levers (record every sweep and
      result, mirroring the prior plan's sweep-log format): candidates include further
      `OVERMIND_GARRISON_POWER_MAX_DISCOUNT`/pirate-discount tuning within Task 1's structural
      ceiling, `NEUTRAL_AGGRO_POWER_THRESHOLD` (gates whether wandering neutral packs chase a weak
      ship at all — raising it extends the "not hunted while weak" window), and any newly-surfaced
      lever Task 4's analysis points to. Do not re-try `NEUTRAL_SCALING_WEAK_MULT` (already
      diagnostically ruled out) or the two categorically-pinned levers without a fresh scope
      decision.
- [ ] After each sweep, check the **pacing** side too: if median win day is trending well below
      1000 as win-rate climbs, note it now (don't wait for Task 6) — the fix is an
      `adaptivePacing.ts` lever (`ADAPTIVE_GRACE_DAYS`/spread interval), not a further difficulty
      cut, since a too-fast win is this plan's other named failure mode.
- [ ] Run 50-session measures per sweep; run `letsplay:ci`/`test:playtest` after each production
      change — must stay green throughout.

### Task 6: Measure against Gate B

- [ ] Run `npm run letsplay:campaign` with `CAMPAIGN_SESSIONS=50`; record win-rate, median win day,
      death taxonomy. Compare against Gate B (≥ 80% win-rate, median win day ≥ 1000).
- [ ] If median win day is below 1000 despite a high win-rate, apply the pacing-lever fix identified
      in Task 5 and re-measure — this is expected to be a real, needed step given every prior
      measurement in this codebase's history has the opposite problem (dying too early, never
      winning too early), so Gate B's day-1000 floor is genuinely un-tested territory once
      survivability actually improves.
- [ ] If Gate B is not met after reasonable iteration (record what was tried), apply this plan's
      escalation clause — report to the user with the honest measured numbers and a concrete
      next-step recommendation, do not silently loosen the gate.
- [ ] `npm run letsplay:ci` and `npm run test:playtest` must stay green.

### Task 7: [Final] Verify acceptance criteria and update documentation

- [ ] Verify Gate B was met (or the escalation happened and the user gave further direction — update
      this task's scope accordingly if so).
- [ ] Run full unit suite, `tsc --noEmit`, `npm run lint`, `npm run test:playtest`,
      `npm run letsplay:ci`, `npm run test:save-compat` — all must be green.
- [ ] Update `.claude/docs/systems/overmind.md`'s "Known-unmet gate" section with this plan's
      measured results — add to the existing dated history (2026-07-07 → 2026-07-13 garrison
      discount → this plan's dated entry), do not delete prior honest numbers.
- [ ] Update `CLAUDE.md`'s Overmind Arc section if the pirate-discount lever or the day-1000 pacing
      floor becomes a named invariant worth calling out.
- [ ] Record final lever values and measured results (all gates, all sweeps) in this plan's
      Technical Details section.

## Technical Details

- **Graded discount formula** (unchanged shape from the prior plan, retuned constant):
  `overmindGarrisonPowerDiscount(p, maxDiscount) = Math.floor((1 - clamp01(p)) * maxDiscount)`.
  Structural ceiling: `GARRISON_MIN=5`, `GARRISON_DISCOUNT_FLOOR=1` ⇒ `maxDiscount ≤ 4`.
- **GOD-mode exemption**: `mode === GOD ⇒ discount = 0` at the `fillGarrison` call site — GOD's hull
  floor already prevents the death this discount targets, so it has nothing to gain and (per the
  prior plan's Task 2 finding) a real combat-loot-income downside to lose.
- **Pirate-garrison discount**: new/extended function, `fillGarrison(..., overmind=false)` path,
  exact shape decided in Task 1 (record final shape here once implemented).
- **Day-1000 floor**: primarily a **measurement/tuning target** (median win day within
  `[1000, 1095]` at the final gate), not a new mechanical win-block coded into
  `overmindSpread.ts` — record here if Task 6 finds this interpretation insufficient (e.g. if
  individual sessions win dramatically early, like day 300-400, even though the *median* lands
  correctly) and a harder per-session floor becomes necessary; that would be new engine logic and
  its own scope decision, out of this plan's default assumption.
- **Final lever values and measured results**: [fill in as each task completes — win-rate/median-day
  per gate, all sweeps tried and reverted/kept, per the prior plan's own record-keeping convention].

## Post-Completion

**Full acceptance re-run** (matches both prior plans' cadence, deliberately deferred since slow):
- 300-session `letsplay:campaign` acceptance gate (≥ 297/300 wins, median win day in `[1000,1095]`,
  0 deaths) — only once the Task 6 interim gate is stably met, not before.
- 100-session neural-policy re-run if the heuristic gate improves enough to matter (the neural
  teacher clones whatever the heuristic does — a much-improved heuristic win-rate is worth
  re-checking against the net's own ceiling, previously measured far below the teacher's).

**Live-browser feel-check** (manual, informational): watch a live autopilot session engage a
now-pirate-discounted held system at low power to confirm the reduced garrison still reads as a
real fight, not a trivial mop-up — headless win-rate numbers alone can't judge whether the new
difficulty curve feels fair to a human player. (This check can use the resumed-autopilot feature
from the sibling `docs/plans/20260713-autosave-autopilot-resume.md` if that plan has landed by
then, to more easily observe a long session across multiple sittings — not a hard dependency.)
