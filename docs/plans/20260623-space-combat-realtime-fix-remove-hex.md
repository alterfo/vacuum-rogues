---
# Fix Space Combat (real-time only) + Remove the Hex CombatScene

## Overview
Space combat is effectively non-functional in the live game even though all 241
flight unit tests pass — a green-tests-but-broken-in-production gap. Three root
causes, plus a structural cleanup the user asked for:

1. **No starter weapon.** `GameEngine.starterLoadout()` fits an engine + fuel
   tank but no weapon, so the player starts with nothing to shoot. `CombatModule.
   addCombatant` then no-ops for a weaponless ship — combat never begins.
2. **Fire is gated on the route-turn.** `CombatModule.update` early-returns when
   `isTurnRunning() === false`, and the host passes `isTurnRunning = () =>
   this.isTurnRunning && !combatPause.paused`. So player **and** NPC fire only
   tick while a route-"Ход" is executing and not paused — in practice NPCs never
   shoot back, and the turn/active-pause interaction deadlocks ("ход не кончается
   после выстрела").
3. **Two combat systems.** The legacy hex `CombatScene` still exists for the
   OVERMIND-core boss and scripted encounters. The user wants **real-time only** —
   delete the hex path entirely and resolve those encounters in-flight.

Goal: real-time in-flight combat that works from a fresh game — the player has a
weapon, both sides **automatically pursue each other to stay in weapon range** and
fire in real time once engaged, the active-pause resolves cleanly without stalling
the turn, and the hex `CombatScene` is gone.

4. **No automatic pursuit.** During a fight neither side reliably closes the gap —
   the player only re-aims via a fresh route-"Ход" (`followNpcId` → `aimRoute`) and
   aggressor NPCs orbit/drift instead of chasing — so ships fall out of weapon range
   and the fight stalls. Pursuit must be automatic both ways while engaged.

## Context (from discovery)
Files/symbols involved:
- **Starter weapon:** `src/systems/GameEngine.ts` `starterLoadout()` (~L1236,
  installs `eq_engine_i`/`eq_tank`). A valid starter weapon id exists
  (`weapon_laser_1`, referenced at `GameEngine.ts:405`). Gear catalog:
  `src/systems/equipment/`.
- **Fire loop:** `src/presentation/flight/CombatModule.ts` — `update` (3×
  `if (this.deps.isTurnRunning?.() === false) return;` ~L188-205), `addCombatant`
  (weaponless no-op ~L224, `hasWeapon`), `fireNpcShot` (~L386), player auto-fire
  (`playerFireTimer`, `selectedWeapon`), `firePlayerShot`/`confirmAttack`.
- **Host wiring:** `src/presentation/SpaceFlightScene.ts` — `CombatModule` deps
  `isTurnRunning: () => this.isTurnRunning && !this.combatPause.paused` (L206,
  L240), `combatModule.update` per frame (L557), `updateShip` pause-freeze
  (`if (this.combatPause.paused) return;` L1145), `isTurnRunning`/`endTurn`.
- **Active-pause:** `src/presentation/flight/combatPause.ts` (controller:
  `requestPause`/`confirm`/`leavePause`/`notifyTargetLost`), `CombatPauseOverlay.ts`,
  `combatPauseUi.ts`.
- **Hex scene (to delete):** `src/presentation/CombatScene.ts`; `SceneType.COMBAT`
  in `src/types/index.ts`; `src/core/services/SceneFactory.ts` (L37 case);
  `GameEngine.ts` (contextDependentScenes L487/L1185, loadGame case L1683);
  `src/presentation/flight/NpcShipManager.ts:1635` (OVERMIND-core boss →
  `transitionTo(SceneType.COMBAT)`); balance multipliers `OVERMIND_COMBAT_HP_MULT`/
  `OVERMIND_COMBAT_DAMAGE_MULT`. Tests referencing the scene:
  `src/tests/renderer-scenes.test.ts`, `src/tests/core/SceneFactory.test.ts`.
- Docs: `src/presentation/flight/CLAUDE.md`, `src/systems/galaxy/CLAUDE.md`
  (both describe the CombatScene/hex split).

Related patterns:
- Real-time combat seam is `addCombatant` + per-frame `CombatModule.update`; the
  active-pause is a separate pure state machine (`combatPause.ts`).
- Decision (user): keep the active-pause (Space-Rangers/FTL style) but make
  combat tick in **real time** (decouple fire from the route-turn); freeze only on
  the active-pause. Remove the hex path entirely.

## Development Approach
- **Testing approach: Unit + manual verify** (user-chosen). Because the bugs slip
  past the current unit suite, every fix task adds a unit test that would have
  **failed before** the fix (e.g. NPC fires with no route-turn running; starter
  loadout has a weapon; pause→fire→resume ends the turn). Manual in-game
  verification is the final gate (see Post-Completion checklist) — these are
  integration bugs, so green unit tests are necessary but not sufficient.
- **Do NOT weaken existing test assertions.** The hex removal deletes the
  `SceneType.COMBAT` feature, so the scene-registration tests that assert COMBAT is
  creatable must be updated to reflect its removal — that is deleting a feature,
  not weakening a test for broken code. Flag each such test edit in the task.
- Run `gitnexus impact` on `starterLoadout`, `CombatModule.update`,
  `addCombatant`, and `SceneType.COMBAT` before editing; warn on HIGH/CRITICAL
  (GameEngine + SceneType are central).
- Complete each task (code + new tests green) before the next; full suite + lint
  at the end. `SpaceFlightScene.ts` stays < 1900 lines.

## Implementation Steps

### Task 1: Starter weapon + clear weaponless feedback
**Files:**
- Modify: `src/systems/GameEngine.ts` (`starterLoadout`)
- Modify: `src/presentation/flight/CombatModule.ts` (`addCombatant` weaponless path)
- Create/Modify tests under `src/tests/`

- [x] `gitnexus impact` on `starterLoadout`; confirm callers (new game + save fallback).
      (CRITICAL risk — GameEngine central; direct callers = 2: new-game L440 + save
      fallback L1126. Change is purely additive.)
- [x] Install a starter weapon (`wpn_pulse`, the catalog id `weapon_laser_1` maps to)
      in `starterLoadout()` so a fresh game can fight; fits `hull_corvette` (2 weapon
      slots, mass 6+3+4=13 ≤ 40 capacity).
- [x] When a genuinely weaponless player is attacked / tries to engage, replace the
      silent `addCombatant` no-op with a clear HUD message ("Нет оружия — установите
      его в ангаре") so the state is legible (still no auto-fire без оружия). Throttled
      to one toast / 3 s (the aggro path calls every frame).
- [x] write tests: `starterLoadout()` includes a weapon and derived stats expose
      weapon damage; `addCombatant` on a weaponless loadout surfaces the hint and
      does not engage. (Both would fail today.) Existing starter-gear-list assertion
      in `GameEngine.loadout-persistence.test.ts` updated to include `wpn_pulse`
      (feature change, not a weakening).
- [x] run touched tests — green (35 + 156 combat tests pass; lint clean).

### Task 2: Real-time fire — decouple from the route-turn (NPCs shoot back)
**Files:**
- Modify: `src/presentation/flight/CombatModule.ts` (`update` gating, `fireNpcShot`)
- Modify: `src/presentation/SpaceFlightScene.ts` (combat deps: pause signal)
- Create/Modify tests under `src/tests/`

- [x] `gitnexus impact` on `CombatModule.update`; confirm the host is the only caller.
      (LOW risk — 1 direct caller: `SpaceFlightScene.update` per-frame loop.)
- [x] Gate combat fire on the **active-pause only**, not the route-turn: give
      `CombatModule` an `isPaused: () => combatPause.paused` dep and freeze fire on
      `paused`, removing the `isTurnRunning() === false → return` early-returns so an
      engaged fight ticks in real time whether or not a "Ход" is running. (Ship
      movement + calendar stay turn-gated as today.) Done via a private `isFrozen()`
      that uses `isPaused` as the sole freeze signal when supplied (production), and
      falls back to the legacy `isTurnRunning` gate only when `isPaused` is absent —
      so the existing `pauseFreezesTime` tests (which fold the pause into
      `isTurnRunning`) stay green untouched. Host wiring now passes `isPaused`.
- [x] Verify NPC return fire (`fireNpcShot`) actually runs each
      `combatFireIntervalMs` once engaged, reducing player hull and raising the
      active-pause on the first hit. (Covered by the new tests below.)
- [x] write tests: with combatants engaged and **no route-turn running** (and not
      paused), `update` fires the player's weapon at the target AND each NPC fires
      back (hull deltas on both sides); while `paused`, neither fires. (Would fail
      today — fire is currently turn-gated.) New: `src/tests/combat/realtimeFire.test.ts`.
- [x] run touched tests — green (187 combat/flight tests pass; lint + tsc clean).

### Task 3: Automatic mutual pursuit during combat
**Files:**
- Modify: `src/presentation/flight/NpcShipManager.ts` (player follow + NPC aggressor maneuver)
- Modify: `src/presentation/SpaceFlightScene.ts` (real-time combat maneuver)
- Create/Modify tests under `src/tests/`

- [x] While a fight is active, make the player ship **auto-track** the selected
      target in real time — continuously close to and hold weapon range without a
      fresh "Ход" each time. Reuse `followNpcId`/`npcLeadPoint`/`solveInterceptPoint`
      but drive the aim every frame while engaged. Done: `updateCombat` early-routes
      to a new `updateCombatPursuit(physics)` while `isInCombat()`, which re-aims
      (`npcLeadPoint`→`solveInterceptPoint`) at the live combat target
      (`getCombatTargetId` dep = `combatModule.selectedTarget`) whenever it drifts
      beyond `WEAPON_RANGE`, and holds station once inside range. Frozen by the
      active-pause via a new `isPaused` dep.
- [x] Make every engaged NPC **auto-close on the player** to weapon range and hold
      it (extend the `sprite.aggressive` aggressor maneuver, ~L237-292) so enemies
      pursue instead of orbiting/drifting; ensure the pirates' captured-system gate
      doesn't suppress pursuit once they are combatants. Done: `launchCombatWithNpc`
      now flags the engaged sprite `setAggressive(true)` (player-initiated combat
      pursues like garrison/shakedown paths already do); `checkGarrisonAggro` ORs in
      a new `isCombatant(sprite)` dep so the captured-system gate never stands an
      active combatant down, and the good-rep-pirate break-off is skipped for an
      active combatant.
- [x] Scope it: combat maneuvering is real-time **only while engaged** (distinct
      from route navigation); ending/disengaging combat restores normal turn-gated
      movement. (The pursuit branch is gated on `isInCombat()`; the CombatModule
      prunes out-of-escape-range combatants, after which the resolver's normal
      chase/idle path resumes.)
- [x] write tests: an engaged player closes the gap to its target each tick; an
      aggressive NPC combatant moves toward the player and reaches weapon range.
      New: `src/tests/combat/combatPursuit.test.ts` (2 tests — both would fail
      before: player held station / engaged combatant lost aggression at the gate).
- [x] run touched tests — green (1028 combat/npc/flight/presentation tests pass;
      tsc + lint clean; `SpaceFlightScene.ts` back under 1900 lines).

### Task 4: Active-pause resolves and the turn ends cleanly
**Files:**
- Modify: `src/presentation/flight/combatPause.ts` / `CombatModule.ts` /
  `SpaceFlightScene.ts` (pause→fire→resume→end lifecycle)
- Create/Modify tests under `src/tests/`

- [ ] Trace the stall: a route-turn that enters combat and active-pauses must be
      able to **complete or stop** — confirm («Огонь!») fires one shot, resumes, and
      either the fight continues in real time or, when the last combatant dies/flees,
      `endCombat` runs and the turn ends (no permanently-stuck `isTurnRunning`).
- [ ] Ensure «Продолжить»/Esc resume and a target-lost re-pause never leave the
      turn flag stuck true with no combatants.
- [ ] write tests for the lifecycle: requestPause → confirm → resume → last
      combatant removed → combat ends and the turn-running projection clears.
- [ ] run touched tests — green.

### Task 5: Delete the hex CombatScene (real-time only)
**Files:**
- Delete: `src/presentation/CombatScene.ts`
- Modify: `src/types/index.ts` (remove `SceneType.COMBAT`), `src/core/services/
  SceneFactory.ts` (remove case), `src/systems/GameEngine.ts` (remove
  contextDependentScenes + loadGame references), `src/presentation/flight/
  NpcShipManager.ts` (OVERMIND-core boss → in-flight)
- Modify (feature-removal): `src/tests/renderer-scenes.test.ts`,
  `src/tests/core/SceneFactory.test.ts`

- [ ] `gitnexus impact` on `SceneType.COMBAT` and `CombatScene`; enumerate every
      reference. Warn — central enum/factory (likely HIGH).
- [ ] Re-point the OVERMIND-core boss encounter (`NpcShipManager.ts:1635`) to the
      in-flight `CombatModule` (spawn the core as an in-flight combatant) instead of
      `transitionTo(SceneType.COMBAT)`; do the same for any scripted text-quest
      combat that targeted the hex scene. If a faithful in-flight boss is out of
      scope, gate the prompt to resolve in-flight rather than open the hex.
- [ ] Remove `CombatScene.ts`, the `SceneType.COMBAT` enum value, the SceneFactory
      case, and the GameEngine contextDependent/loadGame references. Decide the fate
      of `OVERMIND_COMBAT_HP_MULT`/`OVERMIND_COMBAT_DAMAGE_MULT` (drop, or apply them
      in `CombatModule` for hostile systems — note in the plan if deferred).
- [ ] Update `renderer-scenes.test.ts` / `SceneFactory.test.ts` to drop the COMBAT
      scene expectations (feature removed — not a weakened assertion); add a test
      that `SceneType.COMBAT` no longer resolves / is gone.
- [ ] run touched tests + `tsc` — green (no dangling `SceneType.COMBAT`).

### Task 6: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [ ] `detect_changes({scope:"compare", base_ref:"master"})` — only combat/scene
      symbols affected.
- [ ] Full unit suite `npm test -- --run` green; `npm run lint` clean; `npm run
      build` succeeds with no reference to the removed scene.
- [ ] `SpaceFlightScene.ts` still < 1900 lines.

### Task 7: Update documentation
**Files:**
- Modify: `src/presentation/flight/CLAUDE.md`, `src/systems/galaxy/CLAUDE.md`

- [ ] Remove the "hex CombatScene survives for the boss / text quests" notes; state
      that combat is real-time-only via `CombatModule`, and document the starter
      weapon + the fire-is-real-time (pause-gated, not turn-gated) rule.

## Technical Details
- Fire gating changes from `isTurnRunning && !paused` to **`!paused`** for combat
  resolution; ship movement/calendar remain turn-gated, so real-time combat and the
  turn-based navigation coexist (Space-Rangers model).
- Starter weapon is catalog data (`weapon_laser_1`) — no schema/migration change.
- Hex removal deletes a `SceneType` value: update the two scene-registration tests
  (feature removal) and confirm no save references the dropped scene (loadGame
  already routes context-dependent scenes to SPACE_FLIGHT).

## Post-Completion
*Manual verification (the real gate — these are integration bugs):*
- New game → confirm the ship has a weapon and can auto-fire.
- Fly into a hostile NPC: both ships **auto-pursue** to stay in weapon range
  (the player auto-tracks the target, the enemy chases me) and exchange fire in
  real time; the active-pause triggers on the first incoming hit, «Огонь!» fires +
  resumes, and the turn ends cleanly (no stuck "Ход").
- Trigger an OVERMIND-core / pirate encounter: it resolves in-flight (no hex scene
  opens anywhere in the game).
- Weaponless edge: strip the weapon in the hangar and confirm the "нет оружия" hint
  instead of a silent dead fight.
