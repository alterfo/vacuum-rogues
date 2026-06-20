---
# In-Flight Active-Pause Combat (Target & Weapon Selection)

## Overview
When the player is attacked in flight, combat resolves in real time (`CombatModule`) with no chance
to deliberately choose a target or weapon. Add **active-pause** combat: an incoming attack
auto-pauses the flight turn and surfaces an overlay where the player picks a **target** and a
**weapon**; confirming an action (or explicitly resuming) lets time continue. The game **also pauses
when the current target is lost** — destroyed or out of range — so the player picks a new target
instead of drifting in real time. This keeps the existing in-flight combat model (combat resolves in
the flight scene, "not the hex CombatScene") while giving the player Space-Rangers/FTL-style control
over each engagement.

## Context
- **In-flight combat:** `src/presentation/flight/CombatModule.ts` — real-time fire timers, target
  selection by clicking a sprite (L167), enemies "fire at the player"; `SpaceFlightScene` comment
  (L199): "encounters resolve here, not the hex CombatScene".
- **Turn control:** `src/presentation/SpaceFlightScene.ts` — a turn "runs" (ship/NPCs/combat advance)
  while a flag is true (L87); `pauseAtDayBoundary` (L93) shows pause plumbing already exists.
- **Weapon UI precedent:** `src/presentation/CombatScene.ts` already renders a weapon panel
  (`renderWeaponPanel`, `onPlayerAttackWithWeapon(weaponId)`, ~L604–708) and reads weapon modules
  from the loadout — reuse the pattern/labels, but render it as a flight overlay.
- **HUD:** `src/presentation/flight/FlightHud.ts` / `CombatHud.ts` for overlay anchoring.
- **Weapons source:** the canonical `ShipLoadout` weapon banks (per CLAUDE.md, loadout is the single
  source of truth) — list the player's fitted weapons for selection.
- **Decision (confirmed):** **active-pause in flight** (auto-pause on attack, pick target+weapon,
  resume), not a transition into the turn-based CombatScene.

## Development Approach
- **TDD for the pause/selection state machine** (auto-pause on incoming attack, selected
  target/weapon, resume) — model it as a pure controller so it unit-tests without PixiJS; then wire
  the overlay. **Visual-verify** the overlay via screenshot.
- **Reuse, don't fork:** drive the weapon list from `ShipLoadout` and reuse the CombatScene weapon
  action shape; do not duplicate weapon-stat logic.
- Run `impact` on `CombatModule` and any `SpaceFlightScene` turn-control method before editing; warn
  on HIGH/CRITICAL. **Do not modify existing tests**; add new ones.
- One concern per task; full suite green between tasks.

## Testing Strategy
- Unit: a pure pause-controller — an incoming attack sets `paused = true`; selecting a target +
  weapon then confirming issues exactly one attack and resumes; explicit resume without acting does
  not fire; no weapons fitted → graceful (no crash, message).
- Integration: while paused, simulation time does not advance (NPCs/fire timers frozen); after a
  confirmed action time resumes.
- E2E/regression: a hostile opens fire → the game pauses and the target/weapon overlay appears;
  choosing a weapon fires and unfreezes.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers. Keep in sync.

## Implementation Steps

### Task 1: Active-pause controller (auto-pause on incoming attack)
**Files:**
- Create: src/presentation/flight/combatPause.ts (pure controller: paused state, selected
  target/weapon, transitions)
- Modify: src/presentation/flight/CombatModule.ts (raise "player under attack" → request pause)
- Create: src/tests/combat/combatPause.test.ts

- [x] pure controller: incoming attack → paused; select target; select weapon; confirm → emit one
      attack + resume; explicit resume → no fire
- [x] target lost while engaged (selected target destroyed or out of range) → re-pause so the player
      can pick a new target (rather than continuing in real time)
- [x] write unit tests for every transition (auto-pause, select, confirm, resume-without-acting,
      target-lost → re-pause)
- [x] run affected tests — must pass before next task

### Task 2: Freeze simulation time while paused
**Files:**
- Modify: src/presentation/SpaceFlightScene.ts (gate the turn-running flag on the pause controller so
  ship/NPC/fire-timer updates halt while paused)
- Create/Modify: src/tests/combat/pauseFreezesTime.test.ts

- [x] while paused, per-frame simulation (movement, fire timers) does not advance; resumes on action
- [x] write tests: paused → update is a no-op for sim state; resumed → advances
- [x] run affected tests — must pass before next task

### Task 3: Target + weapon selection overlay
**Files:**
- Modify: src/presentation/flight/CombatModule.ts (target pick) + a flight weapon overlay (reuse the
  CombatScene weapon-panel shape), src/presentation/flight/CombatHud.ts / FlightHud.ts (anchor)
- Create/Modify: e2e regression spec for the pause overlay

- [x] overlay lists fitted weapons (from `ShipLoadout`) and lets the player pick a target + weapon;
      confirming routes through the controller (Task 1)
- [x] no-weapons / no-target cases handled gracefully with a message
- [x] visually verify the overlay via screenshot
- [x] add e2e: an attack pauses the game and shows the overlay; picking a weapon fires + resumes
- [x] run affected tests + regression — must pass before next task

### Task 4: Resume / disengage + preserve combat hooks
**Files:**
- Modify: src/presentation/flight/CombatModule.ts / SpaceFlightScene.ts (resume after action;
  disengage path; keep NPC-death → BOUNTY/quest hooks firing)

- [x] after a confirmed action time resumes; disengage/flee still works; `onNpcDestroyed` /
      bounty/quest completion still fire as before
- [x] write tests: a kill during active-pause still triggers the bounty hook
- [x] run affected tests — must pass before next task

### Task 5: Verify acceptance criteria
- [ ] verify Overview: attack auto-pauses, target+weapon selectable, action resumes time, hooks intact
- [ ] run full unit suite — all green; `npm run test:e2e:regression`; `npm run lint` clean
- [ ] confirm no existing combat test assertions changed

## Technical Details
- **Active-pause vs turn-based:** time is frozen only while the overlay is open; once the player acts
  (or resumes) the existing real-time `CombatModule` loop continues — no new turn engine.
- **Single weapon source:** the selectable weapon list is the loadout's weapon bank; firing reuses the
  existing attack resolution (no parallel damage path).
- **Trigger:** auto-pause fires on the first incoming shot at the player per engagement (debounced so
  it doesn't re-pause every frame).

## Post-Completion
**Manual verification:** fly into a hostile; confirm the game pauses when they open fire, the overlay
lets you pick a target and weapon, firing resumes time, and fleeing/disengaging still works.
