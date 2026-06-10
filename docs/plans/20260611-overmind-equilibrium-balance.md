---
# Overmind / Galaxy Equilibrium Balance (Regression-First)

## Overview
Replace the broken overmind loss mechanic (instant loss in small galaxies,
toothless at 30 systems, zero counterplay) with a **self-balancing galaxy**: on
its own the galaxy reaches a stable equilibrium with a slight pirate/overmind
bias and persists indefinitely; only the player disturbs it. The player gets
time to develop (credits → best hull/weapons) and can then **liberate
overmind/pirate systems solo** in combat. Loss (overmind majority) becomes
reachable only through prolonged player neglect, behind a grace period. The
linchpin is a **simulation acceptance test** proving the galaxy never falls on
its own over thousands of days.

## Context
- Findings + ground-truth simulation: `docs/playtests/20260611-overmind-balance-findings.md`
- Loss check: `GameEngine.simulateDay` → `Galaxy.isOvermindMajority()` (`overmindSystems.length > systems.length/2`), every day, no grace/counterplay (`GameEngine.ts:461-468`)
- Expansion: every 5 days `+1` adjacent system via `Galaxy.getOvermindAdjacentSystems` + `addOvermindSystem` (`GameEngine.ts:441-459`) — the ONLY `addOvermindSystem` caller; expansion alone caps ~9/30 (never majority) but ≤6-system saves lose in days
- Fresh game = 30 systems (`main.ts:121`, `generateDefaultGameState:1131`); old saves with ~10 systems auto-load on boot (`GameEngine.ts:191-195`) and are the user's instant-loss case
- Domain: `Galaxy` (`overmindSystems: string[]`, `systems`, `gameDays`, `addOvermindSystem`/`removeOvermindSystem`/`isOvermindMajority`/`getOvermindAdjacentSystems`); pirate control lives in NPC/quests today — confirm where "pirate-held" is represented before wiring pirate flips
- Combat: `CombatScene`/`CombatSystem` resolve fights; liberation hook attaches on a player combat win in an overmind/pirate system
- Balance constants live in `src/config/balance.ts` (`GAME_BALANCE`); add overmind tuning there
- **Domain field changes require `src/validation/schemas.ts` + a `MigrationPipeline` step** (CLAUDE.md) — relevant if new per-system ownership fields are added

## Development Approach
- Regression-first; the headline gate is a **deterministic multi-thousand-day simulation** asserting the equilibrium holds with no player input.
- Pure equilibrium logic goes in a tested module/helper (e.g. `src/systems/galaxy/OvermindBalance.ts`), not inline in GameEngine.
- Tune via simulation in the test loop, not by eyeballing; record the chosen constants and the observed band.
- Each task: lint + `npm test -- --run` + `NO_PROXY=localhost,127.0.0.1 npm run test:e2e:regression` green before the next.

## Implementation Steps

### Task 1: Immediate playability stopgap (grace + small-galaxy guard)
**Files:**
- Modify: `src/config/balance.ts`, `src/systems/GameEngine.ts`
- Modify/Create: `src/domain/Galaxy.ts` (add `isOvermindVictory(graceDays, minSystems, gameDays)` pure method) + test

- [x] Write the RED test: overmind at majority but `gameDays < OVERMIND_LOSS_GRACE_DAYS` → no loss; in a galaxy below `OVERMIND_LOSS_MIN_SYSTEMS` → no loss; only past grace AND full-size AND majority → loss. Confirm it FAILS against the current bare `isOvermindMajority()` gate
- [x] Add `OVERMIND_LOSS_GRACE_DAYS` (~40) and `OVERMIND_LOSS_MIN_SYSTEMS` (~12) to balance; gate the GameEngine loss trigger through the new pure check
- [x] Confirm a fresh game (30 systems) and a small stale save are both non-instant-loss
- [x] Run lint + unit + regression — green

### Task 2: Galaxy ownership model + self-balancing tick
**Files:**
- Create: `src/systems/galaxy/OvermindBalance.ts` (pure step function) + `src/tests/galaxy/overmindBalance.test.ts`
- Modify: `src/domain/Galaxy.ts` (ownership accessors / pirate set if needed), `src/validation/schemas.ts`, `src/data/MigrationPipeline.ts` if a field is added

- [ ] Define the per-tick step: border faction systems may be captured (`pCapture`); border overmind/pirate systems may be recaptured by factions (`pRecapture`), with the **negative-feedback stabilizer** (`pRecapture` rises / `pCapture` falls as overmind+pirate share grows)
- [ ] Implement it as a pure function over `{systems, overmindSystems, pirateSystems, rng}` → next ownership sets (no GameEngine coupling)
- [ ] Write unit tests for the step: a border capture and a recapture each occur under forced RNG; share moves toward the equilibrium from both a low and a high start
- [ ] If new ownership state is persisted, update Zod schema + add a migration; otherwise reuse `overmindSystems`
- [ ] Run lint + unit + regression — green

### Task 3: Tune the equilibrium — the "lives forever" simulation gate
**Files:**
- Modify: `src/config/balance.ts` (final tuned constants)
- Create: `src/tests/galaxy/overmindEquilibrium.test.ts`

- [ ] Write the simulation test: a real generated 30-system galaxy, run the balance tick for 2000+ days with NO player input; assert overmind(+pirate) share stays within a target band (e.g. 8–25%) and `isOvermindMajority()` is NEVER true; assert the share is stationary (no upward trend across the run)
- [ ] Tune `pCapture`/`pRecapture`/feedback constants in the loop until the band holds for multiple seeds; record the chosen values + observed band in the findings doc
- [ ] Wire the tuned tick into `GameEngine.simulateDay` (replacing the old +1/5-day expansion), behind the same day cadence
- [ ] Run lint + unit + regression — green

### Task 4: Player counterplay — liberate systems in combat
**Files:**
- Modify: `src/presentation/CombatScene.ts` / `src/systems/CombatSystem.ts`, `src/domain/Galaxy.ts`, `src/systems/GameEngine.ts`
- Modify: `src/tests/` (liberation tests)

- [ ] Write the RED test: a player combat win in an overmind/pirate system liberates it (removed from the overmind/pirate set, flips to faction); a win elsewhere does not
- [ ] Wire the liberation hook on a player combat victory in a contested system; surface a news/toast event
- [ ] Scale combat difficulty in overmind systems so an early, ungeared player cannot solo them but a well-geared (best hull/weapons) player can — verify with a stats-based unit test (early loadout loses, top loadout wins on average)
- [ ] Run lint + unit + regression — green

### Task 5: Surface the galaxy state (warning + readability)
**Files:**
- Modify: `src/presentation/StarMapScene.ts` (and/or InfoCenter)
- Modify: `src/tests/` matching test

- [ ] Show overmind/pirate-held systems and the current share on the star map; a warning indicator when the share approaches the loss threshold (so the loss is never a surprise)
- [ ] Unit test the indicator state at representative shares
- [ ] Run lint + unit + regression — green

### Task 6: Verify acceptance criteria
**Files:** none

- [ ] `npm run lint` 0 errors; `npm test -- --run` all pass
- [ ] `NO_PROXY=localhost,127.0.0.1 npm run test:e2e:regression` green, < 60 s
- [ ] The 2000-day equilibrium simulation passes for multiple seeds (no self-fall, share in band)
- [ ] `NO_PROXY=localhost,127.0.0.1 npx playwright test e2e/letsplay-discovery.spec.ts --project=letsplay` — all steps ok, 0 JS errors
- [ ] Update `docs/playtests/20260611-overmind-balance-findings.md` with final constants, observed equilibrium band, and the liberation/progression behaviour

## Post-Completion
**Manual verification:**
- New game: play many days without touching contested systems → galaxy persists, no loss. Gear up, then liberate an overmind system in combat → its share drops. Confirm an early ungeared attempt fails.
- Clear the old auto-save (or start a new game) to drop the stale small-galaxy save that triggered the instant loss.
