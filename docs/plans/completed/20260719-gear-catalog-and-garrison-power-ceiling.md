# Gear Catalog Expansion & Overmind Garrison Power Ceiling

## Overview

A live playtest session (2026-07-19) found that by the end of in-game year 2 (~day 730) the Overmind
has typically finished spreading across the galaxy, while the player's ship still lacks the raw
combat power to push back and liberate systems solo. The user's ask: expand the equipment/hull
catalog assortment so a solo player can genuinely liberate Overmind-held systems by that point.

Research done before drafting this plan (see Context) found the problem is **two-layered**, not one:

1. **The hull catalog is sparse and gapped.** Only 6 hulls span techLevel 2–7 (no tech-1 starter, no
   tech-6, no tech-8) — `hull_freighter` (tech-4, 180 HP, 4500cr) is "the best hull a campaign
   realistically reaches" per this repo's own docs; the tech-5 Warden and tech-7 Bastion (rare) sit
   effectively out of reach. Weapons, by contrast, already cover every tech level 1–8 cleanly — this
   is a **hull-side** gap, not a general equipment shortage.
2. **Even the existing "battle-ready" bar is not enough to solo a garrison, and adding raw stats alone
   won't fix that.** `POWER_INDEX_BATTLE_READY_THRESHOLD` (0.13) is already calibrated to roughly
   freighter-hull + ~30 weapon damage — but `.claude/docs/systems/overmind.md`'s own "Known-unmet
   gate" section states plainly: *"a battle-ready 180/49 ship still can't solo the fixed
   `GARRISON_MIN=5` standing garrison."* A held system defends with **5–10 simultaneous ships**, not
   one, and the garrison-size formula (`overmindGarrisonPowerBonus`/`_Discount`,
   `src/systems/campaign/hostileScaling.ts`) actually **grows** the garrison as the player's own
   ratcheted power (`campaignPeakPower`) rises — a stronger solo ship alone doesn't shrink the fight
   it must win; the enemy count scales up to match. Pure catalog expansion, without addressing this,
   risks landing real content work that doesn't move the actual outcome.

This plan therefore does **both**, in sequence: fill the hull-tier gap with a smoother, more
affordable progression ladder, **and** retune the garrison power-bonus/discount math so a genuinely
well-armed solo ship faces a winnable fight instead of a scaling target. Each change is measured
against real campaign sessions (`npm run letsplay:campaign`), not assumed.

**Relationship to existing open work** (read before starting, do not duplicate):
- `docs/plans/20260713-campaign-winrate-100pct.md` — open, diagnosed a **day 250–300 affordability
  wall** (credits plateau at 1000–2000cr, never again reaching ~5500cr for even the freighter). That
  plan owns the *economy/pricing* side of getting a player to the existing battle-ready bar at all.
  This plan does not re-litigate that diagnosis; it assumes a player who DOES reach battle-ready gear
  and asks whether that gear is enough to actually win.
- `docs/plans/20260719-autopilot-combat-coverage-and-campaign-pacing.md`'s **Task 9b** (open) — tracks
  a *different*, already-landed regression (quest-cargo routing costing arm-up pace). Also
  balance/pacing-adjacent, also not to be duplicated here.
- This plan is the one that owns: hull catalog gaps, and whether garrison combat math structurally
  allows a solo win at any gear tier.

## Context (from discovery)

- **Hulls** (`src/systems/equipment/GearCatalog.ts:142-260`, `HULLS` array, 6 entries): `hull_scout`
  (T2, 55hp, 1200cr), `hull_corvette` (T3, 140hp, 3000cr), `hull_courier` (T3, 120hp, 3000cr,
  cargo-focused), `hull_warden` (T5, 220hp, 7000cr), `hull_freighter` (T4, 180hp, 4500cr),
  `hull_bastion` (T7, 360hp, 12000cr, `rare: true`). Gaps: no T1, no T6, no T8. `BATTLE_READY_MAX_HULL
  = 180` (freighter) is documented as the realistic campaign ceiling.
- **Weapons** (`GearCatalog.ts:262-433`, 12 entries) already span T1–T8 with roughly 4 tiers each of
  ENERGY/FRAGMENT/MISSILE (per `.claude/docs/systems/equipment.md`) — not the bottleneck.
- **Power index**: `playerPowerIndex()` (`src/systems/campaign/playerPower.ts:52`) = weighted linear
  norms, `hull:0.35, weapon:0.35, credits:0.15, rank:0.15` (`balance.ts:1118-1137`), hull norm anchored
  `[130,360]`, weapon `[14,110]`. `POWER_INDEX_BATTLE_READY_THRESHOLD = 0.13` (`balance.ts:1196`)
  crosses at roughly freighter (180hp) + ~30 combined weapon damage.
- **Garrison combat** (`src/systems/npc/NpcGarrisonCombat.ts`, `npcRoleCatalog.ts:86-92`): base Overmind
  ship 160hp/28dmg; size tiers small/medium/large (0.8×/1.0×/1.3× hull only, damage flat); boss tier
  450hp/45dmg. `GARRISON_MIN=5`/`GARRISON_MAX=10` standing ships per held system
  (`NpcGarrisonCombat.ts:56-58`). `hostileScaling(peakPower, mode)`
  (`src/systems/campaign/hostileScaling.ts:91-104`) linearly interpolates hull/damage multipliers
  0.5×–1.5× on `clamp01(campaignPeakPower)` (NOT day — power-keyed). `overmindGarrisonPowerBonus`/
  `_Discount` (`hostileScaling.ts:166-195`, consumed by `NpcGarrisonCombat.fillGarrison`):
  `bonus = floor(clamp01(p)×2)`, `discount = floor((1-clamp01(p))×4)` (floored at
  `GARRISON_DISCOUNT_FLOOR=1`, GOD-exempt) — net effect: **higher player power → bigger bonus, smaller
  discount → net garrison count trends UP, not down**, as the player arms up.
- **`.claude/docs/systems/overmind.md`**'s "Known-unmet gate" section states this outright: even after
  the garrison-count-discount work, win-rate plateaued at 2–24% across measured runs, root-caused to
  "a battle-ready 180/49 ship still can't solo the fixed 5-ship garrison."
- **GOD mode caveat**: the tracked win-rate/loss/died numbers in `letsplay:campaign` (e.g. 6 win/31
  loss/11 died/2 timeout) run on **NORMAL** mode by default (`campaign.run.ts` — GOD is used only for
  a separate capacity/perf session). `died` (hull hit 0, impossible on GOD) is a large share of
  outcomes in those measurements — so combat lethality against garrisons is a real, already-measured
  bottleneck, not merely the Overmind's spread outrunning the player.
- **Catalog conventions** (`.claude/docs/systems/equipment.md`, `src/tests/equipment/
  catalogInvariants.test.ts` / `weaponCatalogInvariants.test.ts`): unique ids across `GEAR_CATALOG`;
  within a family the top tier must cost strictly more and weigh ≥ the entry tier; no near-duplicate
  price/mass/potency within a family; `isRareGear()` = explicit `rare: true` OR `techLevel ≥ 6`. Hull/
  weapon stats are pure catalog data — `ShipLoadout` persists gear by **id**, not copied stats, so
  **adding new catalog entries needs no save migration** (existing saves are untouched; only a
  catalog *removal/shrink* needs `revalidateToCurrentHull()`, per root CLAUDE.md).
- **No existing test/diagnostic** computes "what hull+weapon combo actually wins a day-730 solo
  liberation" — this plan's Task 3 introduces the first one.

## Development Approach

- **Testing approach**: regression-first / TDD, per this repo's standing convention (root
  `CLAUDE.md`'s "Bug Fixing Process") — red test pinning the target behavior/number before each
  change, green after.
- Complete each task fully (tests green, affected suites re-run) before moving to the next.
- **Every balance/config change gets a pinned unit test** — no silent threshold loosening (mirrors
  this repo's explicit "known, measured, open gap — not silently loosened" convention for the
  win-rate gate). If a measurement doesn't meet a stated target, document it as an open gap with the
  measured number, don't quietly adjust the target to match.
- **Campaign-level changes are verified with real `npm run letsplay:campaign -- --pool=forks` runs**
  (50 sessions, matching this session's established measurement discipline), not just unit tests —
  balance changes at this scale have shown surprising second-order effects this session (Task 9's
  quest-routing fix cost campaign win-rate 12%→6% even though it fixed a real bug).
- **If a change measurably regresses an existing gate** (win-rate, battle-ready rate, an existing
  pinned test), stop and report the tradeoff for a decision — do not land it silently, do not spend a
  third tuning round without checking in first (mirrors this session's Task 2b constraint).
- Any new persisted field would need a migration (root CLAUDE.md) — this plan's changes are pure
  catalog/config data (no new persisted fields expected); flag immediately if a task's design needs one.

## Testing Strategy

- **Unit tests**: catalog invariant tests (existing suite must stay green + new entries covered),
  balance/hostileScaling formula tests, garrison-fill tests.
- **Campaign/integration tests**: `letsplay:campaign` 50-session measurement for win-rate AND a new
  solo-liberation-by-day-730 metric (Task 3 adds the metric; Tasks 4-5 measure against it).
- **E2E**: none expected (no UI change — new catalog entries render through existing hangar/shop UI
  paths automatically, per `HangarPanel`/`EquipmentShopScene`'s catalog-driven rendering).

## Progress Tracking

- Mark completed items with `[x]` immediately when done.
- Add newly discovered tasks with a `➕` prefix; document blockers with `⚠️`.
- Update this plan if scope changes during implementation.

## Implementation Steps

### Task 1: Fill the hull-tier gap with a smoother progression ladder
- [x] Design 2-3 new `HullSpec` entries for `GearCatalog.ts`'s `HULLS` array to close the tech-1/6/8
      gaps and reduce the price jump between tiers (currently corvette/courier 3000cr → freighter
      4500cr → warden 7000cr → bastion 12000cr, with the biggest single-ship-tier jump between warden
      and the rare bastion). Follow existing catalog conventions exactly (unique id, strictly
      increasing cost/mass within the progression, `isRareGear()` semantics for any tech ≥ 6 entry).
- [x] Decide (design note in this task, not a separate question) whether the new entries also need
      matching `HullClass` roles or reuse existing ones.
- [x] Update/extend `src/tests/equipment/catalogInvariants.test.ts` with cases for the new entries.
- [x] Verify `HangarPanel`/`EquipmentShopScene`/`ResearchUpgradePanel` render the new hulls with no
      code change needed (catalog-driven) — write a quick presentation-level test if any assumption
      about hull count/order is hardcoded anywhere (grep first).
- [x] Run `src/tests/equipment/**`, `src/tests/presentation/**` (hangar/shop) — must pass before Task 2.

**Outcome (2026-07-19):** Added ONE new hull, `hull_cruiser` («Каркас «Крейсер»», T6, 280hp, 8800cr,
slots 8/weap3/equip5/cargo45/massCap85), sitting between «Страж» (T5, 220hp, 7000cr) and the apex
«Бастион» (T7, 360hp, 12000cr). Scoped down from the original "2-3 entries, T1/6/8" idea after
research: T1 doesn't help the late-game ceiling this plan targets (Scout already serves as the cheap
early pick); a T8 hull would push the ceiling even further out of reach, working against the plan's
actual goal. The T6 gap was the one that mattered — `RARE_TECH_THRESHOLD=6` means T6+ is already
`isRareGear()`-gated regardless of an explicit flag, so this gives the rare band a stepping stone
instead of an all-or-nothing jump from common-T5 straight to the apex.

Reused `HullClass.DESTROYER` at first (same role as Bastion) — this broke a real, pre-existing test
(`hullUnificationMigration.test.ts`: legacy-save `hullClass` string → catalog hull id resolution
assumed exactly one hull per `HullClass`, and `GEAR_CATALOG.find()` returning the first DESTROYER
match now silently redirected legacy DESTROYER saves onto the new hull instead of Bastion). Fixed by
giving the new hull its own `HullClass.CRUISER` value instead (added to the enum + `HULL_CLASS_SPECS`
+ `hull.test.ts`'s class-count assertion, all legitimate content-driven updates, not weakened
assertions) — the migration's one-hull-per-class assumption now holds again.

That in turn exposed a missing ship-art asset (`player_ships/cruiser` has no sprite yet — generating
one needs the ComfyUI pipeline, out of scope for a coding session). Per user decision, followed this
codebase's own established precedent (`NpcRole.OVERMIND` reusing `patrol` ship art until dedicated art
lands) rather than leaving the asset-coverage gate red: `PlayerShipRenderer.HULL_ART_ALIAS` maps
`cruiser` → `destroyer`'s art key, mirrored in `assetCoverage.test.ts`'s `HULL_SHIP_PREFIX` map —
reversible the moment real art is generated.

Also surfaced (and fixed, not loosened) two more real gates: `economyBalance.test.ts`'s tech-5/6 price
band (5500-9000) — the initial 9200cr price was over budget, retuned to 8800cr; and
`noHardcodedCyrillic.test.ts`'s ratchet — the new hull's display name is a legitimate catalog literal,
baseline regenerated via the test's own documented `UPDATE_CYRILLIC_BASELINE=1` process.

Full project suite (5923 tests) green, `npx tsc --noEmit` clean, `eslint src --ext .ts` clean (0
errors). Committed as (see commit below).

### Task 2: Verify/extend weapon coverage against the new hulls' weapon-slot counts
- [x] Confirm the existing 12-weapon catalog gives every new hull a sensible loadout at its tech
      level (weapon slots × techLevel-appropriate weapon options) — this is a verification task, add
      new weapons ONLY if a genuine gap is found (per Context, weapons are not currently sparse).
- [x] If a gap is found, add the minimum new `WeaponSpec` entries needed, following the same
      catalog-invariant conventions as Task 1.
- [x] Write/update `weaponCatalogInvariants.test.ts` for any new entries.
- [x] Run `src/tests/equipment/**` — must pass before Task 3.

**Outcome (2026-07-19): no gap found, no code change needed.** `hull_cruiser` (T6, 3 weapon slots)
has 10 weapons available at techLevel ≤ 6 (`wpn_mining_laser` T1, `wpn_pulse`/`wpn_swarm_racks` T2,
`wpn_scatter`/`wpn_rocket` T3, `wpn_railgun`/`wpn_flak_burst` T4, `wpn_beam`/`wpn_long_lance` T5,
`wpn_torpedo` T6) spanning all 3 `WeaponClass` families — including `wpn_torpedo` (T6, 55dmg,
HOMING, rare), a genuine tier-matched pairing for the new T6 hull. A full 3-slot loadout (e.g.
beam 9 + torpedo 12 + railgun 8 = 29 mass) fits well within the hull's 85 `massCapacity` alongside
an engine/tank — confirmed by the existing `catalogInvariants.test.ts` "every hull admits a basic
same-tech engine+tank+weapon kit" check, already green from Task 1's run (no new test needed since
nothing changed). This matches the plan's own Context research: weapons already cover techLevel
1-8 cleanly, so this verification pass confirms rather than fixes anything.

### Task 3: Add a "solo liberation" measurement to the campaign harness
- [x] Add a new tracked milestone to `campaignMetrics.ts` (mirroring `firstLiberationDay`/
      `playerLiberations`): the day of the player's FIRST successful solo liberation of an
      Overmind-held system (a garrison assault the player's own ship — not an NPC ranger — wins),
      and whether one occurred by day ~730.
- [x] Write unit tests pinning the new metric's computation (success case, never-liberated case).
- [x] Run `src/tests/campaign/**` — must pass before Task 4.

**Outcome (2026-07-19):** Found real ground truth to build on instead of re-deriving a proxy:
`Galaxy.tryLiberate(id, "player")` already increments a persisted `overmindArc.playerLiberations`
counter specifically for a genuine player-driven liberation (a real combat clear or a completed
DEFENSE quest) — never an NPC ranger convoy — because the arc's own `won` derivation already gates
on it (root CLAUDE.md's "player participation" invariant). Added `firstPlayerLiberationDay` to
`CampaignMilestones` (latches the first day `playerLiberations > 0`, mirroring `firstLiberationDay`'s
latch pattern but keyed on this ground truth instead of the generic system-count-decrease proxy,
which fires on ANY liberation), threaded `playerLiberations` through `CampaignDaySignal` →
`campaign.run.ts`'s checkpoint (`engine.galaxy?.overmindArc.playerLiberations`) → the session
report's `milestones` → `aggregateCampaign`'s new `playerLiberationRate`/
`avgFirstPlayerLiberationDay` → `formatCampaignReport`'s per-session (`firstSoloLib=`) and aggregate
(`solo-liberation N%`) lines.

Verified end-to-end with a real 4-session `letsplay:campaign` run, not just unit tests: the metric
correctly distinguished a session where the Overmind's system count dropped (an NPC liberation,
`firstLib=d98`) but the player never personally liberated anything (`firstSoloLib=-`) from one where
the player genuinely did (`firstLib=d101`, `firstSoloLib=d150` — later, since the generic proxy also
catches earlier NPC liberations first). This is exactly the signal Task 4/5 need — it would have been
invisible using only the existing `firstLiberationDay` proxy.

New tests in `campaignMetrics.test.ts`: latching on `playerLiberations > 0` distinct from the generic
proxy, and the never-liberated-stays-null case. Updated the file's shared `mkSignal`/`mkReport` test
factories (not per-call-site duplication) plus two other fixture literals the new required field
broke. Full `src/tests/playtest/letsplay/` + `src/tests/campaign/` + `src/tests/oddities/` (911
tests) green, `tsc`/`eslint` clean.

### Task 4: Retune the garrison power-bonus/discount formula — investigated, NOT changed (scope revised)
- [x] Using the new Task 3 metric as ground truth, investigate whether `overmindGarrisonPowerBonus`/
      `_Discount` (`hostileScaling.ts`) need retuning so a genuinely battle-ready-or-better solo ship
      faces a garrison it can plausibly win.
- [x] Measured a 50-session NORMAL-mode baseline with the new metric (see Task 3's commit) before
      touching anything, per this session's established "measure, don't guess" discipline.
- ⚠️ **No formula change made — the diagnosis this plan opened with was wrong, corrected here, and
      the corrected picture points the real fix elsewhere.**

**Outcome (2026-07-19):** First caught and fixed a real bug in my own reasoning before writing any
balance code: `hostileScaling.ts`'s docstring on `overmindGarrisonPowerDiscount` described the
*old*, already-superseded `OVERMIND_GARRISON_POWER_MAX_DISCOUNT=1` "knife-edge" (fixed by
`docs/plans/20260713-campaign-winrate-100pct.md`'s Task 2, which raised it to `4`) as if it were
still current — a stale comment, not stale code. Cross-checking the actual constant
(`balance.ts:1239`) and the existing `hostileScaling.test.ts` pinned tests confirmed the discount
**already** grades smoothly (4→3→2→1→0) across the realistic power band real campaigns reach
(~0.02–0.33 measured this session) — the premise behind this task's planned "rescale against a
realistic ceiling" fix was false, so implementing it would have changed nothing real. Fixed the
stale comment itself (a genuine, small, uncontroversial doc fix, landed regardless).

With that premise gone, traced the ACTUAL bottleneck using the baseline data: solo-liberation (24%
of 50 sessions, avg day 340) mostly happens **without** the ship ever reaching `isBattleReady()`
(180hp/30dmg) — it's gradual, incidental attrition of an already-discounted small garrison through
ordinary combat encounters (median 2 simultaneous combatants per death) over months, not the
deliberate `MemoryHeuristicPolicy` "Overmind-slayer" assault tier (which requires battle-ready and
only fires in the 10% of sessions that ever reach it). Worse: of the sampled battle-ready sessions,
most **died** shortly after reaching it rather than liberating — the slayer tier's stand-and-fight
behavior correlates with dying, not winning, in this sample. So the garrison bonus/discount formula
was never the active constraint; the real blockers are (a) battle-ready rate itself (10%) — the
arm-up/affordability wall already tracked as `docs/plans/20260719-autopilot-combat-coverage-and-
campaign-pacing.md`'s Task 2b, and (b) a newly-observed risk in the slayer tier's engage decision
that this plan did not open with and is out of scope to fix here.

Per user decision: close this task as investigated-not-fixed rather than force a formula change the
data says won't help (a further garrison-formula attempt would likely repeat the 2026-07-13 attempt's
own measured "still plateaued" result). Task 5's "re-measure and iterate" is accordingly **not run
separately** — nothing changed to re-measure; the Task 3 baseline stands as this plan's final
measurement. Tracked as a new backlog item for a future session:

- ➕ **Task 4b (new, open, not started): investigate why battle-ready ships die instead of winning.**
  `OVERMIND_SLAYER_RETREAT_HULL_FRACTION`'s retreat gate apparently isn't preventing these deaths in
  practice — needs its own reproduction (trace a battle-ready session through to its death) before
  any fix, per this session's reproduction-first discipline. Distinct from, and likely more
  actionable than, the garrison-formula angle this task ruled out.

Full `src/tests/campaign/hostileScaling.test.ts` (comment-only change) still green (34 tests).

### Task 6: [Final] Verify acceptance criteria and update documentation
- [x] Verify every checkbox above is resolved or explicitly flagged `⚠️` with a reason.
- [x] Run the full unit suite, `npm run letsplay:ci`, `npm run test:playtest`, `npx tsc --noEmit`,
      `npm run lint`.
- [x] Update `.claude/docs/systems/equipment.md` with the new hull tier(s) (mirrors its existing hull
      lineup description) and `.claude/docs/systems/overmind.md` with the final garrison-formula state
      and measured solo-liberation numbers.
- [x] Update root `CLAUDE.md` if the hull count/tiers are referenced there.

**Outcome (2026-07-19):** Root `CLAUDE.md` has no hull-count reference (only the generic
`GearCatalog`-is-source-of-truth rule) — nothing to update there. Updated
`.claude/docs/systems/equipment.md`'s catalog-scope line (44→45 items, 6→7 hulls) with a new "Hull
lineup" paragraph documenting the full tier list, the `HullClass`-must-be-1:1-with-hull-id migration
gotcha this plan's Task 1 discovered, and the art-alias reuse pattern. Updated
`.claude/docs/systems/overmind.md`'s "Known-unmet gate" section with a dated addendum covering: the
stale-comment correction, the corrected garrison-discount understanding, and the new battle-ready-
ships-die-instead-of-winning finding (Task 4b).

Plan status: Tasks 1-3 landed real, tested changes (new hull, weapon-coverage verification, campaign
metric). Task 4 landed a real doc fix (stale comment) but made no balance change — the data said a
formula retune wasn't the right lever, and forcing one anyway would have repeated a prior session's
already-measured "still plateaued" result. This plan's stated goal ("by end of year 2 the player can
solo-liberate systems") is **not fully met** — solo-liberation happens in 24% of sessions, late (avg
d340), gated upstream by battle-ready rate (10%, a pre-existing, separately-tracked affordability
problem) and a newly-found slayer-tier death correlation (Task 4b, untouched). Documented as an open
gap, not silently closed, per this session's standing discipline.

## Technical Details

- All new data is additive to `GearCatalog.ts`'s `HULLS`/`WEAPONS` arrays — no schema/migration impact
  (gear persists by id; see Context).
- Garrison formula changes are pure `balance.ts` constant/function tuning, config-only per this
  repo's convention (root CLAUDE.md: "HARD scaling: config-only... tune there, never at call sites").
- The new campaign metric (Task 3) is additive to `campaignMetrics.ts`'s existing session-result
  shape — no save/schema impact (it's a `letsplay`-only dev-tool measurement, not persisted game state).

## Post-Completion

**Manual verification** (if applicable):
- A live dev-autopilot session (backtick key) watching a run reach day ~730 with the new gear/garrison
  balance, to visually confirm a liberation attempt actually looks winnable, not just numerically so.

**Follow-up threads** (not this plan's scope, cross-reference only):
- `docs/plans/20260713-campaign-winrate-100pct.md`'s affordability-wall work (getting a player to
  battle-ready gear reliably at all) stays open and separate.
- `docs/plans/20260719-autopilot-combat-coverage-and-campaign-pacing.md`'s Task 9b (quest-detour
  pacing tradeoff) stays open and separate.
