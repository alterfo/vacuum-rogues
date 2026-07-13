# Tactical Pause-and-Plan Combat Rework

## Overview

Full replacement of the current real-time auto-pursuit combat with a pause-and-plan tactical
system: time freezes while the player plans a turn (movement destination + per-weapon target
assignment + optional afterburner/artifact/comms action), then the turn executes in real time
until the next decision point (impact, arrival, an enemy shot landing, or a round timer). This is
a fundamental paradigm change, not a tune — it replaces the entire interaction model of in-flight
combat, and is authorized (2026-07-13/14) as a **full replacement**, not an additive alternate
mode: the existing real-time auto-pursuit/orbit-strafe/single-reactive-shot system is deleted, and
the ~48 existing test files that currently pin that behavior as correct are rewritten or deleted
per this plan's own recorded disposition (Task 1) — a deliberate, user-authorized supersession of
the "never touch an existing test" rule, not a silent weakening.

**Explicitly paused for this plan**: `docs/plans/20260713-campaign-winrate-100pct.md` (garrison
difficulty tuning) was stopped mid-Task-1 (2026-07-13) specifically because it measures win/death
outcomes of the exact combat mechanics this plan replaces — resuming it before this plan lands
would tune against a system about to be deleted. **Task 16 of this plan is an explicit prerequisite
for resuming that plan** — see Task 16.

## Context (from discovery)

- **Movement**: `ShipPhysics.ts` is momentum/arc-only (no rotate-in-place), already supports a
  multi-waypoint `setPath()` — this is the primitive `computeFlightPath()`
  (`src/utils/flightGeometry.ts`) already uses for non-combat route planning. **Combat movement
  today does NOT reuse it** — `CombatPursuitController` computes a reactive live orbit-carrot every
  frame (`steerCombatOrbit`, `clampOrbitPoint`). The new planning phase reuses `setPath()` as the
  execution primitive but needs a new **planning-time** trajectory preview (point-and-click →
  colored line, length scaled by engine potency/maneuverability) that doesn't exist today.
- **Weapons**: 100% auto-target/auto-fire today. `advancePlayerWeapons` (`CombatModule.ts:618`)
  fires every fitted weapon at `pickTargetInRange`'s pick (prefers `selectedTarget`, else nearest
  in that weapon's own range) on its own `weaponFireIntervalMs`. All damage is instant hit-scan —
  the "tracer" (`CombatHud.flashShot`, fixed 130ms) is VFX only, not a travel-time projectile.
  `GearCatalog.ts`'s `WeaponClass` (ENERGY/FRAGMENT/MISSILE) and `WeaponAbility.HOMING` exist as
  **flavor-only fields — no code consumes them for behavior**. This plan is what finally consumes
  them (Task 7, Task 13).
- **Combat pause**: `combatPause.ts`'s `CombatPauseController` is reactive-only — triggers on the
  first incoming hit, lets the player pick one target+weapon, fires **exactly one shot**, resumes
  real-time auto-pursuit. It is a real foundation (freeze-gate `isFrozen()`, overlay wiring,
  target/weapon-selection primitives) but not an extension target for "plan a whole turn" — this
  plan's planning-phase state machine (Task 2) is new machinery built alongside these primitives,
  not a patch to the single-reactive-shot flow.
- **Shields**: `shieldHP`/`shieldPower` exist as **persisted domain/catalog stats**
  (`src/domain/NpcShip.ts`, `src/systems/equipment/GearCatalog.ts`, `src/validation/schemas.ts`)
  but are **never read or written by any combat damage-resolution code** (`src/systems/combat/*.ts`
  — zero hits). This plan is the first real consumer (Task 12).
- **Gravity hazards**: no black hole / gravity-well entity exists anywhere in the codebase
  (galaxy generation, `StarSystem`, or presentation) — this is 100% green-field (Task 4), unlike
  most of this plan which extends/repurposes existing primitives.
- **Artifacts**: `ResourceType.ARTIFACTS` (`types/index.ts:117`) is an existing **crafting
  currency** (Overmind loot → gear tech-level upgrades via `GearCatalog.ts`'s
  `ARTIFACT_UPGRADE_COSTS`). This plan's "artifact" (instant-use combat consumable: shield
  restore/AoE damage/weapon jam) is a **different concept with a name collision** — Task 1 records
  the disambiguating name.
- **In-combat comms**: `NpcInteractionController.ts`'s pirate shakedown flow (hail → pay tribute /
  flee / attack) is pre-combat/negotiation-gated, not reachable mid-fight — the closest existing
  pattern to extend for Task 10, not a ready-made feature.
- **VFX inventory already built** (extend, don't rebuild): weapon tracer+impact bloom
  (`CombatHud.ts:315-419`), floating damage numbers (`DamageNumbers.ts`), death spark burst
  (`shipDeathFx.ts`/`shipDeathFxRenderer.ts`), floating loot pickup dots (`LootDropHandler.ts`).
  **Not built**: per-ship floating hull/shield bars (only a HUD side-panel exists today), any
  shield-hit flash, actual wreck sprites (loot is dots only, no wreck).
- **Headless letsplay driving**: `PlayerAgent.driveAttack`, `LiveApplier`'s attack/flee heads, and
  `MemoryHeuristicPolicy`'s combat decision branches all assume today's real-time
  auto-pursuit/single-reactive-pause model. They will not function against the new planning-phase
  loop without their own update — this is a large, easy-to-miss downstream consumer, given its own
  Task 15 rather than folded into Task 1's cleanup.
- **Minimum touch surface** (from blast-radius research): ~23 production files
  (`ShipPhysics.ts`, `CombatModule.ts`, `CombatPursuitController.ts`, `combatPause.ts`,
  `combatPauseUi.ts`, `CombatPauseOverlay.ts`, `CombatHud.ts`, `combatRounds.ts`, `npcWeapon.ts`,
  `combatManeuver.ts`, `CombatAI.ts`, `SpaceFlightScene.ts`, `flightKeyHandler.ts`,
  `NpcInteractionController.ts`, `EncounterController.ts`, `OvermindBossController.ts`,
  `combatOrbitClock.ts`, plus the letsplay driving files above) and ~48 existing test files.

## Development Approach

- **Testing approach**: Regular (implement, then write/update tests) — matches how the rest of this
  codebase's `presentation`/`flight` layer has been built. Pure-logic pieces (trajectory math,
  missile evasion, afterburner degradation curve, gravity-assist vectors) will naturally read as
  TDD-shaped within their own task even under this ordering.
- Complete each task fully before moving to the next.
- **CRITICAL: every task that touches production code MUST include new/updated tests.**
- **CRITICAL: all tests must pass before starting the next task** — no exceptions.
- **CRITICAL: update this plan file when scope changes during implementation** — near-certain
  given the size; if a task turns out substantially bigger than scoped, split it and renumber
  rather than silently cramming scope into one checkbox.
- **Test-replacement authorization (supersedes the "never touch existing tests" rule, deliberately,
  for this plan only)**: Task 1 records an exact file-by-file disposition (delete / rewrite / keep)
  for every one of the ~48 existing tests that pins now-obsolete real-time combat behavior. Any
  test **outside** that recorded list must still never be modified/weakened without stopping and
  asking, exactly as usual.
- Per root `CLAUDE.md`'s blast-radius rule: run `gitnexus impact` on each major symbol
  (`CombatModule`, `CombatPursuitController`, `combatPause`, `ShipPhysics`, `combatRounds`) before
  its task edits it; report risk.
- **Iteration budget note**: this plan has ~16 tasks at realistic per-task granularity for a
  paradigm-level rewrite — larger than a typical ralphex run. Launch with a higher
  `-m`/`--max-iterations` than the 50 default, and expect this may need a `resume` pass; `ralphex`
  resumes from the plan's own unchecked boxes, so a mid-run stop is not lost work.

## Testing Strategy

- **Unit tests**: pure-logic modules (trajectory/gravity/evasion/afterburner math, damage-order,
  VFX-variant selection) get direct unit coverage.
- **Real-engine playtest**: the planning→execute loop itself, weapon target-assignment persistence,
  and the letsplay driving update (Task 15) need `src/tests/playtest/**` coverage — this is wiring
  between real components, not pure logic, per this project's three-tier testing convention.
- **`npm run letsplay:ci`** must stay green from Task 15 onward (it will legitimately fail/need
  updating between Task 2 and Task 15, since the headless driver won't understand the new loop
  until Task 15 lands — this is expected, not a regression, but must not be left broken past that
  task).
- **E2E**: this is a UI-surfaced interaction change (planning-phase clicks, weapon-assignment UI,
  comms panel) — add/update `e2e/playtest-regression.spec.ts` coverage per the project's "UI
  changes → e2e in the same task" rule, at minimum for the core planning-phase loop (Task 2/3/5).
- No new save/schema impact expected unless Task 9's artifact inventory needs persistence — confirm
  in Task 9 and follow the additive-optional-field pattern if so (`campaignPeakPower` precedent).

## Progress Tracking

- Mark completed items with `[x]` immediately when done.
- Add newly discovered tasks with ➕ prefix.
- Document issues/blockers with ⚠️ prefix.
- Update this plan if implementation deviates from original scope.

## What Goes Where

- **Implementation Steps** (`[ ]` checkboxes): every mechanic and VFX item from the user's spec,
  the old-system removal, the test-disposition migration, and the letsplay driving update.
- **Post-Completion** (no checkboxes): live-browser feel verification (this is a game-feel-heavy
  rewrite — headless tests can't judge whether pacing/telegraphing reads well to a human), and
  resuming the paused campaign win-rate plan.

## Implementation Steps

### Task 1: Confirm scope — architecture decisions and test-migration policy

- [x] Run `gitnexus impact` on `CombatModule`, `CombatPursuitController`, `combatPause`,
      `ShipPhysics`, `combatRounds`, `NpcInteractionController`; report risk.
- [x] Decide and record the exact planning→execute loop shape: what starts a planning phase
      (combat begins / each new round / a fixed real-time interval), what the player can set
      during it (movement destination, per-weapon targets, afterburner flag, one artifact use, one
      comms action), what ends it (an explicit confirm action — name it, e.g. reusing the
      existing "Ход" turn-confirm pattern already used for non-combat flight turns, per
      `flightKeyHandler.ts`'s Space-to-run-turn convention, if that turns out to be the right
      precedent to extend), and what ends the subsequent execute phase (impact / arrival / next
      incoming hit / a round timer — pick one deterministic rule, not "whichever happens first"
      left informally).
- [x] Decide and record the exact file-by-file disposition of the ~48 existing tests referencing
      the modules being replaced (list every file from the Context section's blast-radius research
      here, marked delete/rewrite/keep-as-is) — this is the concrete authorization record Task 15
      executes against.
- [x] Decide and record the artifact-consumable naming (disambiguated from the existing
      `ResourceType.ARTIFACTS` crafting currency) and whether it needs new `SaveState`/schema
      persistence (inventory of unused consumables) or is scoped to combat-session-only (simpler,
      no save impact — record which and why).
- [x] Decide and record the gravity-hazard scope for this plan: full black-hole galaxy-gen entity
      (larger — new `StarSystem` hazard type, generation levers, presentation) vs. planet-only
      gravity-assist for v1 with black holes deferred to Post-Completion as a stretch item. Record
      the reasoning (size vs. spec completeness) — default recommendation: land planet-assist in
      Task 4, defer black holes to Post-Completion unless Task 4 finds it cheap to include both.
- [x] No code changes in this task — confirmation and decision-recording only.

#### Task 1 Decisions (recorded 2026-07-14)

##### 1a. Blast-radius / risk (gitnexus impact, upstream)

| Symbol | Risk | Direct callers | Notes |
|--------|------|----------------|-------|
| `CombatModule` (`src/presentation/flight/CombatModule.ts`) | **CRITICAL** | 13 | 6 processes (`onPlayPause`/`initialize`/`updateShip`/`update`/`destroy`/`onPointerDown` in `SpaceFlightScene`); modules Presentation/Flight/Combat. Central combat class — every edit is high-blast. |
| `CombatPursuitController` (`src/presentation/flight/CombatPursuitController.ts`) | **CRITICAL** | 19 | 8 processes incl. `NpcShipManager.constructor`; Flight/Presentation. The orbit-strafe engine being deleted — highest fan-out. |
| `combatPause` | LOW (ambiguous) | 0 | No production `combatPause` *symbol* — the primitive lives in `combatPause.ts`'s `CombatPauseController`; the three matches are a `SpaceFlightScene.combatPause` property + two test consts. Extend via the class, not this name. |
| `ShipPhysics` (`src/systems/ShipPhysics.ts`) | **CRITICAL** | 18 | 5 processes; Flight/Presentation/Systems. Momentum/arc primitive reused by the new movement — touch additively (Task 3 reuses `setPath()`), do not rewrite. |
| `combatRounds` | n/a (file, not symbol) | — | Lives at `src/systems/combat/combatRounds.ts` (`roundDamageBudget` etc.); no class symbol so impact resolves by function. Repurposed as the execute-phase round timer (Task 2), not deleted wholesale. |
| `NpcInteractionController` (`src/presentation/flight/NpcInteractionController.ts`) | **MEDIUM** | 11 | Flight/Npc; the shakedown-hail pattern Task 10 extends. Lower blast than the combat core. |

**⚠️ Two CRITICAL-risk core symbols (`CombatModule`, `CombatPursuitController`, `ShipPhysics`).** Every task
touching them must re-run `gitnexus impact` at edit time and prefer additive seams over in-place rewrites;
the six `SpaceFlightScene` processes above are the recurring break surface.

##### 1b. Planning→execute loop shape (deterministic)

- **What starts a planning phase**: (i) the frame combat begins (first mutually-hostile engaged
  combatant) freezes the sim and opens **planning**; (ii) planning re-opens automatically at the end
  of **every execute window** while ≥1 hostile combatant remains. Round-based, not a free-running
  real-time interval.
- **What the player sets during planning** (all optional, all into a single planned-turn draft):
  movement destination (one `setPath()` waypoint course), per-weapon target assignments, an
  afterburner flag, **≤1** artifact/consumable use, **≤1** comms action.
- **What ends planning**: an explicit **confirm** action — reuse the existing **"Ход"** turn-confirm
  (the `flightKeyHandler.ts` Space-to-run-turn convention already used for non-combat flight turns).
  Confirming with an empty draft is legal and means "hold position, hold fire" — an incomplete draft
  never blocks confirm (per Task 2's malformed-plan test).
- **What ends the execute phase**: **one deterministic terminator — a fixed round timer.** The execute
  window runs for a fixed duration (`COMBAT_ROUND_MS`, a new `balance.ts` constant reusing the
  `combatRounds` budget machinery), then auto-returns to planning. Impacts / arrivals / incoming hits
  during the window are resolved in real time but do **NOT** end the window early (explicitly rejecting
  the "whichever happens first" option the plan warned against). The only two events that end the
  window *early* are terminal, not round-level: **player death** (ends the whole fight → death flow)
  and **all hostiles destroyed** (ends the whole fight → turn resolves, per `turnEndsAfterCombat`).
- **`combatPause` reactive single-shot flow**: **superseded**, not kept as a parallel mode. The
  reactive "freeze on first incoming hit → pick one target+weapon → fire exactly one shot → resume
  auto-pursuit" flow is removed. Its **freeze-gate primitive** (`isFrozen()`/`isPaused` closure wiring,
  overlay mount, target/weapon-selection helpers) is **reused** by the new planning state machine
  (Task 2 builds the state machine alongside `combatPause.ts`, folding the new freeze condition into
  the `isPaused` closure per `flight/CLAUDE.md`, never into `isFrozen()` itself).

##### 1c. Test-disposition list (executed by Task 15; authorization record)

Legend: **DELETE** = pins deleted orbit-strafe/auto-pursuit/real-time-auto-fire behavior with no
surviving invariant; **REWRITE** = subject module survives but its behavior changes under the new loop
(freeze-trigger rewiring, player targeting, round timer, letsplay driving); **KEEP** = paradigm-neutral
(NPC-side AI, hostility, god-mode damage routing, death detection, save/reload, cadence math, settings,
encounters, balance). All DELETEs are conditional on Task 15 re-confirming zero live references via
`gitnexus impact` before removal.

DELETE (4):
- `src/tests/combat/combatPursuit.test.ts` — real-time mutual auto-pursuit / auto-track (deleted paradigm).
- `src/tests/flight/combatOrbit.test.ts` — orbit holds target in weapon range (orbit-strafe deleted).
- `src/tests/flight/combatOrbitAntiSpin.test.ts` — orbit degenerate-spin guard (orbit deleted).
- `src/tests/combat/combatManeuver.test.ts` — `decideManeuver` CLOSE/ORBIT/BREAK_OFF orbit-strafe AI
  for the player ship (superseded by planning). *(If Task 15 impact shows NPC AI still consumes
  `decideManeuver`, downgrade to REWRITE keeping only the NPC-path assertions.)*

REWRITE (20):
- `src/tests/combat/combatEscape.test.ts` — keep `ShipPhysics.canOutrun` physics; the CombatModule
  disengage-at-escape-range semantics change to the deterministic round terminator.
- `src/tests/combat/combatPause.test.ts` — single-reactive-shot `CombatPauseController` → planning phase.
- `src/tests/combat/combatRounds.test.ts` — `roundDamageBudget`/round machinery repurposed as the
  execute-window timer; re-anchor assertions to `COMBAT_ROUND_MS`.
- `src/tests/combat/confirmAttack.test.ts` — keep `fittedWeapons`; `confirmAttack` single-shot →
  planned-turn confirm.
- `src/tests/combat/multiWeaponFire.test.ts` — auto-fire per-weapon → planned per-weapon assignment (Task 6).
- `src/tests/combat/npcMovementFreezesOnPause.test.ts` — freeze-NPC-movement invariant kept, rewired to
  the planning freeze trigger.
- `src/tests/combat/pauseFreezesTime.test.ts` — freeze-sim-time invariant kept; reactive-trigger wording changes.
- `src/tests/combat/pauseHooks.test.ts` — kill-hook-during-freeze kept; disengage-re-arm changes to round loop.
- `src/tests/combat/realtimeFire.test.ts` — real-time fire now scoped to the execute window, not a
  route-turn/pause-down gate.
- `src/tests/combat/targetLostRepause.test.ts` — target-lost handling becomes re-planning on the next round.
- `src/tests/combat/turnEndsAfterCombat.test.ts` — turn-resolves-on-last-kill kept; auto-fire path changes.
- `src/tests/flight/combatEngagement.test.ts` — in-flight engagement entry under the new loop.
- `src/tests/flight/combatModule.test.ts` — fire-timer/engagement assertions change for planned targeting
  (death-detection assertions stay valid).
- `src/tests/flight/combatOrbitClock.test.ts` — in-fight day-advance re-anchored to the execute window.
- `src/tests/flight/combatPauseFreeze.test.ts` — full-freeze invariant kept, rewired to planning.
- `src/tests/flight/orbitsDuringCombat.test.ts` — "planets keep orbiting during a real-time fight"
  invariant survives as "during the execute window".
- `src/tests/playtest/combatEscape.test.ts` — real-engine escape under the new loop.
- `src/tests/playtest/combatPauseFreezesLiveFight.test.ts` — real-engine freeze, rewired to planning.
- `src/tests/playtest/combatRoundReaction.test.ts` — round reaction window → planning phase.
- `src/tests/presentation/overmindCombat.test.ts` — Overmind two-way in-flight combat under the new model.

REWRITE — letsplay/driving (Task 15's own scope; 6):
- `src/tests/playtest/fleeAfterCombatPauseProgress.test.ts`
- `src/tests/playtest/letsplay/combat.test.ts`
- `src/tests/playtest/letsplay/longGameCompetence.test.ts`
- `src/tests/playtest/letsplay/slayerCampaign.test.ts`
- `src/tests/presentation/combatPursuitController.test.ts` — DELETE the orbit-strafe/`updateCombat`
  assertions; keep/repurpose any pre-combat approach-launch coverage that survives as the execute-phase
  approach primitive.
- `src/tests/presentation/npcInteractionController.test.ts` — `onAttackNpc` path changes (Task 10/15);
  `onNpcClick`/panel-action assertions stay.

KEEP (paradigm-neutral — do NOT modify; new planning-phase coverage is additive):
- `src/tests/combat/godModeIntegration.test.ts`, `src/tests/combat/hostileScalingCombat.test.ts`
  *(revisit only if Task 12's shield-order restructures incoming-damage math)*,
  `src/tests/combat/phantomStanceCleanup.test.ts`, `src/tests/combat/playerDeath.test.ts`,
  `src/tests/flight/flightKeyHandler.test.ts`, `src/tests/flight/npcWeapons.test.ts`,
  `src/tests/flight/orbitVisualFloorDuringFlight.test.ts`, `src/tests/flight/spaceRunsTurn.test.ts`,
  `src/tests/flight/warpCaptureGuard.test.ts`, `src/tests/flight/weaponCadence.test.ts`,
  `src/tests/playtest/reloadDuringCombat.test.ts`,
  `src/tests/playtest/shipDeathExplosion.test.ts` *(Task 14 is additive; re-diagnose if drift-loot
  timing reds an assertion)*, `src/tests/presentation/encounterController.test.ts`,
  `src/tests/presentation/overmindBossController.test.ts`,
  `src/tests/presentation/npcShipManager.test.ts`, `src/tests/npc/crossFactionCombat.test.ts`,
  `src/tests/npc/npcHostility.test.ts`, `src/tests/oddities/balanceInvariants.test.ts`,
  `src/tests/presentation/settingsPanel.test.ts`,
  `src/tests/core/GameEngine.loadout-persistence.test.ts`, `src/tests/playtest/encounters.test.ts`,
  `src/tests/playtest/journeys.test.ts`, `src/tests/playtest/letsplay/installAutopilotHook.test.ts`.

Totals: **4 DELETE, 26 REWRITE (20 core + 6 letsplay/driving), 23 KEEP** ≈ the ~48 the plan scoped.
Any test file **not** in this list stays under the standing "never touch existing tests" rule.

##### 1d. Artifact-consumable naming + persistence

- **Name (disambiguated)**: code type **`CombatConsumable`** (an activatable tactical item), i18n
  player-facing **"Тактическое устройство" / "Tactical Device"**. This is deliberately distinct from
  `ResourceType.ARTIFACTS` (the existing Overmind-loot **crafting currency** consumed by
  `ARTIFACT_UPGRADE_COSTS`) — the two never share a type or i18n key.
- **Persistence**: **YES — a small persisted inventory** (the player carries acquired consumables
  between fights, so combat-session-only would lose loot). Implemented via the **additive-optional-field
  pattern** (`campaignPeakPower` precedent): an optional field on the persisted inventory, `.optional()`
  in `schemas.ts`, defaulting to empty. **No `MigrationPipeline` migration and no `CURRENT_VERSION`
  bump** — an absent field correctly defaults to "empty inventory", which is exactly the additive-field
  exception in root `CLAUDE.md`. Task 9 confirms the concrete field placement and follows this decision.

##### 1e. Gravity-hazard scope

- **v1 = planet gravity-assist ONLY.** A planned course passing within a threshold radius of a planet
  during the execute window adds a velocity boost (pure function of distance + a mass-proxy from
  existing planet size data — no new domain fields, no galaxy-gen change, no save impact). Landed in Task 4.
- **Black holes = DEFERRED to Post-Completion.** A full black-hole hazard needs a new `StarSystem`
  hazard type + galaxy-generation levers + presentation + almost certainly a schema/migration/version
  bump — too large a green-field entity to bolt onto this already-paradigm-sized plan. Deferred as the
  gated stretch follow-up already noted in Post-Completion.
- **Rationale (size vs. completeness)**: planet-assist delivers the core "gravity bends your planned
  course" tactical feel at near-zero blast radius (reuses existing planet data, pure math, zero
  persistence), while black holes carry disproportionate green-field cost. Revisit only if Task 4
  discovers both are cheap together.

### Task 2: Planning-phase state machine skeleton

- [ ] Build the new planning/execute state machine per Task 1's recorded loop shape — likely a new
      module (name per Task 1) alongside `combatPause.ts`, not a rewrite of it (the reactive
      single-shot flow may still cover the "hit while NOT in a deliberate planning phase" edge
      case — decide and record whether `combatPause`'s reactive trigger is fully superseded or
      kept as a fallback).
- [ ] Wire the freeze gate into `CombatModule.isFrozen()`'s existing `isPaused` closure pattern
      (per `flight/CLAUDE.md`'s standing rule: fold new freeze conditions into `isPaused`, never
      into `isFrozen()` itself).
- [ ] Write tests for the state machine's transitions (idle → planning → executing → next planning
      cycle; malformed/incomplete plan confirm attempts; interruption by a lethal hit mid-execute).

### Task 3: Movement trajectory planning UI

- [ ] Point-and-click destination selection during the planning phase; render a colored trajectory
      line from ship to the chosen point, length scaled by engine potency/maneuverability stats
      (reuse the existing `RouteRenderer` pattern from non-combat flight if its shape fits, else a
      new lightweight combat-scoped renderer — decide and record which).
      Note the constraint: `ShipPhysics` remains momentum/arc-only (no rotate-in-place) — the
      trajectory preview must reflect the ship's real achievable arc (min turn radius), not a
      straight-line fantasy the ship can't actually fly.
- [ ] Wire the confirmed destination into `ShipPhysics.setPath()` as the execute-phase movement
      primitive (reuse, do not reinvent the path-follow logic).
- [ ] Write tests: trajectory line length formula (engine potency/maneuverability → px), the
      confirmed path handed to `ShipPhysics` matches the click target, arc-radius constraint
      honored in the preview.

### Task 4: Environmental gravity effects (planet slingshot; black holes if Task 1 included them)

- [ ] Planet gravity assist: a planned course passing within a threshold radius of a planet during
      the execute phase adds a velocity boost along the pass trajectory (pure function of
      distance/mass-proxy — reuse existing planet position/size data, no new domain fields).
- [ ] If Task 1 scoped black holes into this plan: add the new hazard entity (galaxy-gen +
      `StarSystem` field + presentation) with a pull-toward-center force scaling with proximity,
      usable as an escape tool (dangerous, high-risk high-reward) — otherwise record here that
      this sub-item was deferred to Post-Completion per Task 1's decision.
- [ ] Write tests for the pure physics functions: gravity-assist vector/magnitude, black-hole pull
      falloff (if in scope).

### Task 5: Per-weapon range visualization + manual target assignment UI

- [ ] Render a colored circle per fitted weapon showing its individual range (surfacing the
      player's own loadout range data — the equivalent of `npcWeaponRange`'s role-scaled ranges,
      now for the player's actual fitted gear via `GearCatalog`/`ShipLoadout`).
- [ ] Build the assignment interaction (pick the concrete UX in Task 1 if not already decided:
      click a weapon icon then click a target, or drag-to-target) that writes into the planned
      turn's per-weapon target map — supports assigning every gun to one target (focus fire) or
      spreading targets across multiple guns.
- [ ] Write tests: range-circle radius matches catalog range per weapon, assignment persists into
      the planned-turn draft, re-assignment overwrites cleanly, an out-of-range assignment is
      rejected or flagged (decide which and record).

### Task 6: Weapon execution — replace auto-fire with planned per-weapon assignments

- [ ] Replace `advancePlayerWeapons`'s `pickTargetInRange` auto-target call with reading the
      confirmed planned turn's per-weapon target assignments; each weapon still fires on its own
      `weaponFireIntervalMs` cadence during the execute phase, now at ITS assigned target instead
      of the nearest-in-range pick. NPC-side targeting (`fireNpcShot`/NPC AI) is unchanged — only
      the player's weapons become manually targeted.
- [ ] Write tests: each weapon fires at its own assigned target (not just the nearest), an
      unassigned weapon falls back to a sane default (decide: auto-pick nearest, or hold fire —
      record which), multi-weapon focus-fire and spread-fire both resolve correctly.

### Task 7: Missile projectile mechanic — travel time + evasion

- [ ] New projectile entity for `WeaponClass.MISSILE` weapons: instead of the instant hit-scan
      every other weapon class uses, a fired missile becomes a tracked entity that travels toward
      its target's position over N turns/seconds (finally consuming the existing flavor-only
      `WeaponClass`/`WeaponAbility.HOMING` fields for real behavior).
- [ ] Evasion: the target can maneuver during the missile's flight to reduce hit probability —
      pick and record the exact resolution rule (e.g. hit chance inversely tied to the target's
      displacement/speed during the missile's flight window, resolved at arrival) rather than
      leaving it vague.
- [ ] Write tests: travel-time math (distance/missile-speed → turns), evasion probability given a
      stationary vs. actively-maneuvering target, a destroyed/out-of-range target causes the
      missile to miss/despawn cleanly (no dangling entity).

### Task 8: Afterburner

- [ ] Add an afterburner action selectable during planning: a large speed multiplier for the
      following execute window. Decide and record the degradation model (cumulative wear stat on
      the engine, capped uses per fight, or a persistent cross-fight engine-health field — pick
      the smallest one that satisfies "postepenno razrushaet motor" / "gradually damages the
      engine" from the spec, and check whether it needs `SaveState` persistence).
- [ ] Write tests: speed multiplier applied correctly for exactly one execute window then reverts,
      degradation accumulates per the chosen model, a fully-degraded engine can no longer
      afterburn (or applies a penalty — record which).

### Task 9: Consumable combat artifacts (shield restore / AoE damage / weapon jam)

- [ ] Add the new consumable-artifact concept per Task 1's disambiguated naming and
      persistence decision: an inventory of activatable combat items, each with one of the three
      effects from the spec. Activation is a planning-phase action (like movement/weapons/comms).
- [ ] Wire shield-restore to `shieldHP` (the first real combat consumer of that previously-unused
      field — coordinate with Task 12's shield-damage-order work so the two don't define
      conflicting semantics; if Task 12 hasn't landed yet, this task defines the shield-HP
      semantics and Task 12 follows it).
- [ ] Write tests: shield-restore delta, AoE-damage applies to every enemy within its radius (not
      just the selected target), weapon-jam disables the target's fire for its stated duration and
      expires correctly.

### Task 10: In-combat comms panel (bribe / demand surrender / call for help)

- [ ] Extend `NpcInteractionController.ts`'s existing shakedown-hail pattern to be reachable as a
      planning-phase action during an **active** fight (today it's pre-combat/negotiation-gated
      only) — add the "Связь" action alongside movement/weapons/afterburner/artifact.
- [ ] Bribe/tribute reuses the existing `shakedownTribute` economy path. Demand-surrender is a new
      resolution: a surrendering NPC flees or yields loot without being destroyed (decide which,
      record reasoning — probably role/hull-fraction gated, not unconditional). Call-for-help is a
      new resolution: a nearby friendly NPC (trader/military per the spec) joins the fight on the
      player's side if one exists in range (decide the eligibility/proximity rule).
- [ ] Write tests for each of the three new resolution branches, plus the "no eligible ally in
      range" call-for-help failure case.

### Task 11: Ship visual polish — banking/roll during planned execution

- [ ] Ships bank/roll into turns during the execute window — a presentation-only rotation tilt
      correlated with the ship's current turn rate (no physics change, `ShipPhysics`'s
      `shipAngle`/turn math is untouched; this reads the existing turn rate to drive a visual
      roll).
- [ ] Write tests: pure banking-angle-from-turn-rate function (input turn rate → output roll
      angle, clamped to a sane max).

### Task 12: Shield-hit flash + per-ship floating hull/shield bars

- [ ] Wire real shield-vs-hull damage ordering into combat resolution (shields absorb damage up to
      `shieldHP` before hull takes the overflow) — per Task 9's coordination note, this is the
      first real consumer of `shieldHP` if Task 9 hasn't already defined the semantics; otherwise
      this task follows what Task 9 established.
- [ ] Add the shield-hit flash VFX (translucent colored sphere, brief) on any hit that shields
      absorb, distinct from the existing hull-hit flash.
- [ ] Add a small floating hull/shield bar over each ship in flight (new presentation component —
      today only the HUD side-panel shows target/player bars, nothing floats over the sprites).
- [ ] Write tests: damage-order math (shield-then-hull, overflow calculation), bar-fraction mapping
      for both hull and shield values.

### Task 13: Weapon-type VFX (laser / plasma-blaster / missile smoke trail / heavy-weapon distortion)

- [ ] Extend the existing `CombatHud` tracer/impact-bloom system to branch visual style by
      `WeaponClass` (now consumed for both behavior — Task 6/7 — and visuals): a continuous beam
      for ENERGY/laser weapons, a fast plasma/physical burst for FRAGMENT/blaster weapons, a
      curved white smoke-trail arc for MISSILE weapons (ties into Task 7's travel-time entity —
      the trail should track the projectile's actual flight path, not a static line), and a
      space-distortion ripple effect for the heaviest weapon tier (decide which tier qualifies,
      record the threshold).
- [ ] Write tests: correct VFX variant selected per `WeaponClass`/tier (presentation-logic unit
      test asserting the right variant is dispatched, not pixel output).

### Task 14: Death explosion + drifting wreckage/cargo debris

- [ ] Extend the existing `shipDeathFx` explosion; add an actual wreck sprite (today's
      `LootDropHandler` only spawns floating loot dots, no wreck) that inherits the destroyed
      ship's last velocity/heading and drifts with that inertia before settling or despawning.
- [ ] Spawn existing `LootDropHandler` cargo dots from the wreck's drifting position over its
      lifetime, rather than all at the instant of death at a fixed point.
- [ ] Write tests: wreck spawn velocity/heading matches the ship's pre-death physics state, drift
      decay/despawn timing.

### Task 15: Update headless letsplay driving for the new planning-phase loop

- [ ] Update `PlayerAgent.driveAttack`, `LiveApplier`'s attack/flee heads, and
      `MemoryHeuristicPolicy`'s combat decision branches to drive the new loop: pick a movement
      destination + assign weapon target(s) + confirm, instead of invoking the old real-time
      auto-pursuit `onAttackNpc`/`e2eEngageCombat` handlers this plan removes.
      **This task is a hard prerequisite for resuming `docs/plans/20260713-campaign-winrate-100pct.md`**
      (that plan's entire measurement mechanism is headless combat outcomes) — do not consider this
      plan done for that purpose until `npm run letsplay:ci` is green against the new combat loop.
- [ ] Execute Task 1's recorded test-disposition list: delete/rewrite every named file among the
      ~48 affected existing tests. Delete now-fully-superseded dead modules (old
      `CombatPursuitController` orbit-strafe logic, old `combatRounds` disengage-window logic) only
      once nothing still references them (confirm via `gitnexus impact` before deleting).
- [ ] Run `npm run letsplay:ci`, `npm run test:playtest` — must be green (this is the task where
      they're allowed to have been red since Task 2, and must not stay red past this task).

### Task 16: [Final] Verify acceptance criteria, update documentation, full regression

- [ ] Verify every mechanic from the user's original spec (movement trajectory + gravity effects,
      multi-weapon manual targeting, missile travel-time/evasion, afterburner, artifacts, comms
      panel; banking/roll, shield flash, weapon-type VFX, damage numbers, hull/shield bars, death
      explosion + drifting wreckage) is implemented — check off against the spec text directly, not
      just against this plan's own task list, in case something was lost in translation.
- [ ] Run full unit suite, `tsc --noEmit`, `npm run lint`, `npm run test:playtest`,
      `npm run letsplay:ci`, `npm run test:save-compat`, `npm run test:e2e:regression` — all green.
- [ ] Rewrite `src/presentation/flight/CLAUDE.md`'s entire "In-flight combat" section to describe
      the new pause-and-plan system (the current section describes real-time auto-pursuit
      mechanics this plan deletes — this needs a near-total rewrite, not a patch) and update root
      `CLAUDE.md`'s pointers if the combat description there is now stale.
- [ ] Record in this plan: confirmation that `docs/plans/20260713-campaign-winrate-100pct.md` is
      now unblocked and safe to resume against the new combat model (or, if this plan's own scope
      shrank during implementation such that real-time combat wasn't fully replaced, record that
      explicitly rather than silently leaving a stale prerequisite note).

## Technical Details

- **Planning/execute loop shape**: recorded by Task 1.
- **Test-disposition list** (the ~48 files, delete/rewrite/keep): recorded by Task 1, executed by
  Task 15.
- **Artifact-consumable naming + persistence decision**: recorded by Task 1.
- **Gravity-hazard scope (planet-only vs. + black holes)**: recorded by Task 1.
- **Shield damage-order semantics**: recorded by Task 9 or Task 12, whichever lands first.
- **Afterburner degradation model**: recorded by Task 8.

## Post-Completion

**Live-browser feel verification** (manual, informational — headless tests can't judge game feel):
play several live fights covering every new mechanic (planned movement around a planet for
gravity-assist, multi-weapon focus-fire vs. spread-fire, a missile exchange with active evasion,
an afterburner escape, each artifact type, a bribe/surrender/call-for-help negotiation) and confirm
the pacing/telegraphing reads as a real tactical decision, not just correct math.

**Black holes** (if Task 1 deferred them out of this plan's scope): a follow-up plan for the galaxy
hazard entity, gated on this plan's core loop already being live and stable.

**Resume the paused win-rate plan**: `docs/plans/20260713-campaign-winrate-100pct.md`, once Task 16
confirms the headless driving update (Task 15) is solid — that plan's Task 1 investigation work is
preserved and resumable, not lost.
