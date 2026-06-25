---
# Freeze All Combat Fire During the Active Pause

## Overview
The player reports that **ships keep firing during the active (combat) pause** —
the FTL-style freeze is supposed to halt the fight while the player picks a
target/weapon, but shots still go off. The NPC fire loop already breaks on the
freeze gate; the gap is most likely the **player's multi-weapon fire loop** (added
by the combat-multiweapon plan) and/or **shots already in flight** continuing to
animate/damage during the pause. Make **every** fire path — player weapons + NPC +
in-flight projectiles — honor the single `isPaused`/`isFrozen` gate.

## Context (from discovery)
- **The freeze gate is canonical** (`src/presentation/flight/CombatModule.ts`):
  `isFrozen()`/`effectivelyPaused` (~L602) returns `deps.isPaused()` —
  `combatPause.paused`; "the sole freeze signal", fire decoupled from the route-turn.
- **NPC loop already gated:** `advanceNpcTimers` (~L375) re-checks
  `if (this.isFrozen()) break;` per iteration before `fireNpcShot` — correct.
- **Suspect path — player weapons:** the fitted-weapon fire loop (~L399,
  "Advance every fitted weapon's fire timer and fire it at the nearest combatant")
  added for multi-weapon fire. Confirm it is gated the same way (top-of-update +
  per-iteration `isFrozen()`), and that the **active-pause start** doesn't let a
  same-frame player volley through.
- **Suspect path — projectiles in flight:** any tracer/shot already launched should
  **freeze** (no travel, no damage application) while paused, not just stop new
  shots (`CombatModule` projectile/tracer update + `update`'s freeze early-return).
- The pause wiring: `SpaceFlightScene` `isPaused: () => this.combatPause.paused`;
  `combatPause` raised by the first incoming hit.

## Development Approach
- **Testing approach: TDD.** `CombatModule.update`/fire loops are unit-testable with
  a fake `isPaused`. Assert: with `isPaused()===true`, **no** player weapon shot and
  **no** NPC shot is emitted and **no** projectile advances/deals damage across
  several ticks; with `isPaused()===false` they fire on cadence. Reproduce the bug
  red first.
- Single freeze gate — do not add a second pause concept. `impact` on the fire
  loops before editing. Presentation-only; no domain/schema/save change.

## Testing Strategy
- **Unit:** drive `CombatModule.update(dt)` with `isPaused → true`; assert zero
  player + zero NPC shots over N ticks and that projectile positions/health are
  unchanged; flip to false and assert firing resumes on the interval.
- **Real-engine playtest:** engaging a fight and being hit (raises the pause) leaves
  the world — incl. all weapons — frozen until «Огонь!»/«Продолжить».

## Implementation Steps

### Task 1: Reproduce — a shot escapes the pause (red)
**Files:**
- Create: `src/tests/flight/combatPauseFreeze.test.ts`

- [x] With a fitted player weapon + an NPC combatant and `isPaused()===true`, tick
      `update` several times; assert the test currently FAILS because a player
      weapon (and/or an in-flight projectile) still fires/advances while paused.
- [x] run — confirm RED (the escaping fire path is identified).
      Escaping path = **in-flight tracers**: `CombatModule.update` advances the HUD
      tracers (`this.hud?.update(dt)`) at the *top* of the frame, before the
      `isFrozen()` early-return, so a projectile launched the instant before the
      pause keeps traveling (age 0 → 48 over three frozen frames). The player + NPC
      fire loops are already gated. Captured RED with a plain `it`
      ("expected 48 to be +0"), then wrapped the repro in `it.fails` so the
      committed test honestly documents the bug while keeping the commit gate green
      (Task 2 freezes the tracers and flips it back to a plain `it`).

### Task 2: Gate every fire + projectile path on `isFrozen()`
**Files:**
- Modify: `src/presentation/flight/CombatModule.ts`

- [x] Gate the **player multi-weapon** fire loop on `isFrozen()` (top-of-loop +
      per-iteration break, mirroring `advanceNpcTimers`), so no weapon fires while
      paused — including the frame the pause is raised. Already gated: `update`
      early-returns at `if (this.isFrozen()) return;` before `advancePlayerWeapons`,
      and the loop re-checks `if (this.isFrozen()) break;` per iteration (~L417).
- [x] Freeze **projectiles/tracers in flight** while paused (no movement, no damage
      application) — only resume on unpause. `CombatModule.update` now advances the
      HUD tracers only when `!this.isFrozen()` (was unconditional at the top of the
      frame), so a shot launched the instant before the pause freezes mid-flight.
- [x] write tests: paused ⇒ zero player + zero NPC shots + frozen projectiles over
      N ticks; unpaused ⇒ fire resumes on cadence; the Task 1 repro now passes.
      `combatPauseFreeze.test.ts`: frozen-tracer regression (flipped `it.fails`→`it`),
      "no player or NPC shot while paused", "resumes fire on cadence once unpaused".
- [x] run tests — green (the locked combat-pause tests stay green). All 33 flight
      test files (261 tests) pass; lint clean (0 errors).

### Task 3: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [x] `detect_changes({scope:"compare", base_ref:"master"})` — the two combat-pause
      commits (4767fab, 7048f04) touch only `CombatModule.ts` + the new
      `combatPauseFreeze.test.ts` (+ this plan doc); no other production symbol moves.
      (The raw compare-vs-master flags critical risk only because the whole feature
      branch has diverged far from master — unrelated to this change.)
- [x] full unit suite green (2793 passed, 1 skipped); `npm run test:playtest` green
      (63 passed, 1 skipped); lint clean (0 errors); build ok (`✓ built in 3.86s`).

### Task 4: Update documentation
**Files:**
- Modify: `src/presentation/flight/CLAUDE.md` (combat-pause section)

- [ ] Note that ALL fire + in-flight projectiles freeze on the single
      `isPaused`/`isFrozen` gate (player weapons + NPC + projectiles), not just new
      NPC shots.

## Post-Completion
**Manual verification:** get into a fight, take a hit (raises the pause) → nothing
fires and no shot moves until you resume; on «Продолжить»/«Огонь!» the fight
continues normally.
