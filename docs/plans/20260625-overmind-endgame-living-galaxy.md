---
# Overmind Endgame Arc + Living Galaxy

## Overview
The game is a strong sandbox but lacks a **point** — an arc with stakes and a climax.
Make the **OVERMIND ("Neural Onslaught")** an escalating, **spreading** threat: it
captures systems over time, the galaxy reacts (faction pressure, refugees, garrisons),
and if the player dawdles it advances — culminating in a **win** (break the Overmind
core) or **loss** (it consumes the galaxy), plus **new-game+**. This gives the
neural-Overmind work a narrative home and gives players a reason to push.

## Context (from discovery)
- **Overmind exists** as a faction (`OVERMIND_FACTION_ID`), with hostile seeding +
  difficulty scaling (`GameEngine.applyDifficultyHostileScaling`, `NpcSimulator` garrisons)
  and captured-system landing gating (`landingAccess`, `docs/plans/.../captured-system-landing-gating`).
- **Daily sim hook:** `GameEngine.advanceGalaxyDay()` already runs an EOD batch — the
  natural tick for Overmind spread + galaxy reactions.
- **Win/lose already partly wired:** killing the Overmind core in flight wins
  (`handleInFlightDeath` → `showGameOutcomeScreen(true)`); GAME_OVER on death.
- **Terminal-scene rules** (autosave exclusion / `contextDependentScenes`) per
  `adding-features.md` must be honoured for any new end screens.

## Development Approach
- **Testing approach: TDD.** The **spread state machine** (which systems the Overmind
  captures each day, advance/contest/win/loss thresholds) is pure and unit-tested; the
  galaxy-reaction + end-condition checks are pure. Persisted Overmind-arc state needs the
  schema + migration lockstep (per CLAUDE.md). Scene wiring verified in the real-engine
  playtest.
- Tunable in `balance.ts`; Fallback/heuristic Overmind behaviour stays the floor.

## Implementation Steps

### Task 1: Overmind spread state machine (pure)
**Files:**
- Create: `src/systems/overmind/overmindSpread.ts` (+ test)

- [x] Pure `advanceOvermind(state, galaxy, day)` → captures/contests systems on a cadence
      with thresholds for "advancing/contained/won/lost"; deterministic by seed/day.
- [x] write tests: spread advances over days, the player retaking systems contains it,
      win/loss thresholds fire.
- [x] run tests — green.

### Task 2: Persisted arc state (schema + migration)
**Files:**
- Modify: `src/types/index.ts`/`src/domain/**`, `src/validation/schemas.ts`, `src/data/MigrationPipeline.ts`

- [x] Add persisted Overmind-arc fields (captured set, threat level, day-zero) with a
      schema entry + a migration defaulting old saves (version bump per CLAUDE.md).
- [x] write tests: round-trips through save/load; old saves default safely.
- [x] run tests — green.

### Task 3: Daily spread + galaxy reactions in EOD
**Files:**
- Modify: `src/systems/GameEngine.ts` (`advanceGalaxyDay`), `NpcSimulator`

- [x] Drive `advanceOvermind` in the EOD batch; reflect captures in landing gating +
      garrisons + a visible threat indicator; idempotent per business date.
- [x] write tests (real-engine playtest): days advance the front; retaking contains it;
      zero logged errors.
- [x] run tests — green.

### Task 4: Win / loss / new-game+ arc
**Files:**
- Modify: end-of-game flow (`showGameOutcomeScreen`), new-game (`RaceSelectionScene`/GameEngine)

- [x] Wire the won/lost thresholds to the outcome screens (honour terminal-scene
      autosave rules); add new-game+ carrying a chosen subset of progress.
- [x] write tests: thresholds route to the right screen; NG+ seeds correctly.
- [x] run tests — green.

### Task 5: Verify + balance + docs
- [ ] full suite + `test:playtest` green; lint/build ok; tune spread pacing in
      `balance.ts`; document the arc + the spread machine.

## Post-Completion
**Manual:** a full run where ignoring the Overmind visibly loses ground and acting
pushes it back to a real win/loss; NG+ starts a tougher cycle.
