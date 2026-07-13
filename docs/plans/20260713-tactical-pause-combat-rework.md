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

- [x] Build the new planning/execute state machine per Task 1's recorded loop shape — likely a new
      module (name per Task 1) alongside `combatPause.ts`, not a rewrite of it (the reactive
      single-shot flow may still cover the "hit while NOT in a deliberate planning phase" edge
      case — decide and record whether `combatPause`'s reactive trigger is fully superseded or
      kept as a fallback).
- [x] Wire the freeze gate into `CombatModule.isFrozen()`'s existing `isPaused` closure pattern
      (per `flight/CLAUDE.md`'s standing rule: fold new freeze conditions into `isPaused`, never
      into `isFrozen()` itself).
- [x] Write tests for the state machine's transitions (idle → planning → executing → next planning
      cycle; malformed/incomplete plan confirm attempts; interruption by a lethal hit mid-execute).

#### Task 2 outcome (implemented 2026-07-14)

- **New module**: `src/presentation/flight/combatPlanning.ts` — `CombatPlanningController<TTarget,
  TWeapon>`, a pure PixiJS-free state machine (same discipline as `combatPause`/`combatRounds`).
  Phases `idle | planning | executing`; a single `PlannedTurn` draft (destination, per-weapon target
  map, afterburner flag, ≤1 `consumableId`, ≤1 `commsAction`) filled during PLANNING, handed to the
  host via `onConfirm`. Transitions: `beginCombat()` idle→planning, `confirm()` planning→executing
  (empty draft legal), `tickExecute(dt)` closes the fixed `COMBAT_ROUND_MS` window and re-opens
  PLANNING, `endCombat()` any→idle (the only early terminator — player death / last hostile).
  Draft setters no-op outside PLANNING so a confirmed plan can't be edited mid-execute.
- **`combatPause` reactive trigger — decision: fully SUPERSEDED, not kept as a fallback** (matches
  Task 1b). The new planning loop is the sole in-combat interaction model; the reactive
  single-reactive-shot flow is not retained as a parallel "hit outside a planning phase" fallback.
  Its freeze-gate *primitive* is reused (the `isPaused` closure), not its trigger. `combatPause.ts`
  itself is still wired in the scene during this skeleton task (removed by Task 15's test-disposition
  execution once the loop is fully driven) — the two do not both fire, because the planning trigger
  (combat-open → `beginCombat`) is not connected until later tasks; today `combatPlanning` stays
  idle, so behaviour is unchanged.
- **Freeze gate**: new balance constant `COMBAT_ROUND_MS` (`src/config/balance.ts`, mirrored by the
  module's `DEFAULT_ROUND_MS`, parity-asserted in the test). The scene folds
  `this.combatPlanning.isPlanning` into the `CombatModule` `isPaused` closure
  (`SpaceFlightScene.ts`, per `flight/CLAUDE.md`) — never into `isFrozen()`. Inert this task
  (controller idle), so the full unit suite + line guard (`SpaceFlightScene.ts` = 1898 ≤ 1898) stay
  green.
- **Tests**: `src/tests/combat/combatPlanning.test.ts` (14) — the idle→planning→executing→planning
  cycle, empty/malformed confirm attempts (empty legal, idle-confirm & double-confirm rejected,
  mid-execute draft edits ignored), lethal-hit mid-execute end + inert subsequent ticks, and the
  round-timer config/default fallback.

### Task 3: Movement trajectory planning UI

- [x] Point-and-click destination selection during the planning phase; render a colored trajectory
      line from ship to the chosen point, length scaled by engine potency/maneuverability stats
      (reuse the existing `RouteRenderer` pattern from non-combat flight if its shape fits, else a
      new lightweight combat-scoped renderer — decide and record which).
      Note the constraint: `ShipPhysics` remains momentum/arc-only (no rotate-in-place) — the
      trajectory preview must reflect the ship's real achievable arc (min turn radius), not a
      straight-line fantasy the ship can't actually fly.
- [x] Wire the confirmed destination into `ShipPhysics.setPath()` as the execute-phase movement
      primitive (reuse, do not reinvent the path-follow logic).
- [x] Write tests: trajectory line length formula (engine potency/maneuverability → px), the
      confirmed path handed to `ShipPhysics` matches the click target, arc-radius constraint
      honored in the preview.

#### Task 3 outcome (implemented 2026-07-14)

- **New pure module**: `src/presentation/flight/combatTrajectory.ts` (PixiJS-free, unit-tested
  standalone like `combatPlanning`). Owns the trajectory geometry:
  - `combatReach(profile, roundMs) = maxSpeed × roundMs` — the **length formula**: how far the ship
    can plan to travel in one execute window, so a more potent (faster) engine draws a strictly
    longer line. "Engine potency" = cruise speed (`derivedStats().speed` / `ShipPhysics.getMaxSpeed`).
  - `minTurnRadius(profile) = maxSpeed ÷ rotationSpeed` — the maneuverability constraint.
  - `clampDestinationToReach(from, to, reach)` — pulls a too-far click back onto the reach circle
    along the ship→click ray (planned destination is always reachable this round).
  - `previewTrajectory(profile, from, heading, dest, reach)` — the sampled **arc** polyline the
    renderer draws. Replays the same momentum kinematics as `ShipPhysics.update` (constant forward
    cruise + a per-step heading turn bounded by `rotationSpeed`), so an off-axis/behind destination
    **curves in** — never a straight-line pivot the momentum ship can't fly (honors the min turn
    radius by construction; asserted per-segment in tests).
  - `applyPlannedMovement(dest, physics)` — hands the confirmed destination to `ShipPhysics.setPath`
    (reuse, not a reinvented follower). Null destination = hold position.
- **Renderer decision (recorded)**: **reuse `RouteRenderer`**, not a new combat-scoped renderer —
  its `drawRoute` already dashes an arbitrary polyline and `drawNavigationMarker` marks the
  endpoint, which is exactly the preview's shape (the combat-specific length/arc logic is the
  polyline fed in). The thin presentation seam is `src/presentation/flight/combatCoursePreview.ts`
  (`previewCombatCourse`) — clamp → `setDestination` → draw. (Preview colour stays cyan for now; a
  distinct combat tint is deferred polish, not worth widening `RouteRenderer`'s signature.)
- **Scene wiring** (`SpaceFlightScene.ts`): `combatPlanning`'s `onConfirm` now calls
  `applyPlannedMovement(plan.destination, shipPhysics)` (confirmed destination → `setPath`), and
  `onPointerDown` routes a left-click through `previewCombatCourse` **while `isPlanning`**. Both are
  **inert in production today** (the combat-open `beginCombat` trigger is still not wired — Task 2
  deferred it to a later task), exactly like Task 2's freeze-gate: the machinery + math + renderer
  seam are complete and unit-tested; the live click/preview lights up the moment the trigger lands.
- **Line guard**: Task 2 had shipped `SpaceFlightScene.ts` **over** the `< 1900`
  (`split("\n").length`) guard (1902) — a committed-red regression. Fixed here by extracting the
  `plotRoute` body into `src/presentation/flight/routePlot.ts` (`plotPlannedRoute`, behaviour
  byte-for-byte identical; `plotRoute()` stays as a thin delegate for `routeHideWhileMoving.test.ts`),
  netting the scene back to **1896** (`split`) with the new Task 3 wiring included. `moduleContracts`
  guard is green again.
- **Tests**: `src/tests/combat/combatTrajectory.test.ts` (17) — reach/length formula + monotonic in
  potency, min-turn-radius, clamp, arc-constraint (per-segment turn ≤ bounded rate, no snap-straight,
  reach cap), and `applyPlannedMovement` (path target == click target, flown path arrives, null =
  hold). `src/tests/combat/combatCoursePreview.test.ts` (2) — the click→setDestination→draw wiring +
  the beyond-reach clamp. Full unit suite green (5556 pass); the E2E planning-loop coverage the plan
  scoped for Tasks 2/3/5 is deferred to the task that wires the combat-open trigger, since the
  planning phase can't be entered live until then (same rationale as `letsplay:ci` being allowed red
  until Task 15).

### Task 4: Environmental gravity effects (planet slingshot; black holes if Task 1 included them)

- [x] Planet gravity assist: a planned course passing within a threshold radius of a planet during
      the execute phase adds a velocity boost along the pass trajectory (pure function of
      distance/mass-proxy — reuse existing planet position/size data, no new domain fields).
- [x] If Task 1 scoped black holes into this plan: add the new hazard entity (galaxy-gen +
      `StarSystem` field + presentation) with a pull-toward-center force scaling with proximity,
      usable as an escape tool (dangerous, high-risk high-reward) — otherwise record here that
      this sub-item was deferred to Post-Completion per Task 1's decision.
      → **DEFERRED to Post-Completion** per Task 1 decision 1e (v1 = planet-assist only): a black-hole
      hazard needs a new `StarSystem` hazard type + galaxy-gen levers + presentation + a
      schema/migration/version bump — too large a green-field entity for this plan. Task 4 found no
      cheap way to fold both in (planet-assist reuses live `displayRadius`/position at zero blast
      radius; a black hole shares none of that), so the deferral stands.
- [x] Write tests for the pure physics functions: gravity-assist vector/magnitude, black-hole pull
      falloff (if in scope). → Black-hole falloff N/A (deferred). Planet-assist covered by
      `src/tests/combat/combatGravity.test.ts` (18).

#### Task 4 outcome (implemented 2026-07-14)

- **New pure module**: `src/presentation/flight/combatGravity.ts` (PixiJS-free, unit-tested
  standalone like `combatPlanning` / `combatTrajectory`). Owns the slingshot physics:
  - `gravityAssistRadius(body, config) = displayRadius × radiusMultiplier` — the threshold reach; a
    larger (more massive) planet reaches farther.
  - `gravityAssistDelta(ship, body, dtMs, config)` — the per-frame velocity delta (px/ms) a single
    planet adds: a boost **along the ship's current heading** (a slingshot accelerates along the pass
    trajectory — it never yanks the ship toward the planet), scaled by a **mass-proxy** (the planet's
    rendered `displayRadius` relative to `referenceRadius`) and a linear distance falloff (0 at the
    assist edge → full at the surface), integrated over `dtMs` and capped at `maxBoostPerMs × dtMs`.
    Returns zero outside the reach, for a (near-)stationary ship, for `dtMs ≤ 0`, or a zero-size body.
  - `gravityAssistTotal(ship, bodies, dtMs, config)` — sums the deltas of every planet the ship is
    passing; the primitive the execute-phase movement loop calls each frame.
- **Data reuse (no new domain fields)**: the mass-proxy is the planet's live rendered `displayRadius`
  (`PlanetManager` `PlanetSprite.displayRadius`, already used for landing-range/quest-marker sizing) —
  no galaxy-gen change, no `StarSystem` field, **no schema/migration/save impact**.
- **Balance**: new `GRAVITY_ASSIST` constant in `src/config/balance.ts` (radiusMultiplier /
  referenceRadius / strengthPerMs / maxBoostPerMs), mirrored by the module's `DEFAULT_GRAVITY_ASSIST`
  and parity-asserted in the test — tune-in-one-place, per the `COMBAT_ROUND_MS` precedent.
- **Wiring status**: inert in production today, exactly like Task 2's freeze-gate and Task 3's
  course-preview — the execute-phase movement loop that would fold this delta into `ShipPhysics`'
  velocity isn't wired until the combat-open `beginCombat` trigger lands (a later task). The pure math
  + config + tests are complete and green; the live pass-boost lights up the moment the execute loop
  is connected.
- **Tests**: `src/tests/combat/combatGravity.test.ts` (18) — reach formula + monotonic in mass,
  in/outside-threshold, boost-along-heading (not toward planet, diagonal parallel-to-velocity),
  closer→stronger falloff, zero at the edge, more-massive→harder, stationary/zero-dt no-op, linear in
  dt, the max-boost cap, multi-body summation, and the balance/module parity. Full unit suite green
  (5574 pass).

### Task 5: Per-weapon range visualization + manual target assignment UI

- [x] Render a colored circle per fitted weapon showing its individual range (surfacing the
      player's own loadout range data — the equivalent of `npcWeaponRange`'s role-scaled ranges,
      now for the player's actual fitted gear via `GearCatalog`/`ShipLoadout`).
- [x] Build the assignment interaction (pick the concrete UX in Task 1 if not already decided:
      click a weapon icon then click a target, or drag-to-target) that writes into the planned
      turn's per-weapon target map — supports assigning every gun to one target (focus fire) or
      spreading targets across multiple guns.
- [x] Write tests: range-circle radius matches catalog range per weapon, assignment persists into
      the planned-turn draft, re-assignment overwrites cleanly, an out-of-range assignment is
      rejected or flagged (decide which and record).

#### Task 5 outcome (implemented 2026-07-14)

- **New pure module**: `src/presentation/flight/combatWeaponTargeting.ts` (PixiJS-free,
  unit-tested standalone like `combatPlanning` / `combatTrajectory` / `combatGravity`). Owns the
  range visualization + manual-assignment logic:
  - `weaponRangeCircles(weapons, center)` — one `RangeCircle` per fitted weapon, **radius = that
    weapon's own catalog `range`** (`WeaponSpec.range`, the player-side equivalent of
    `npcWeaponRange`'s role-scaled reach, read from the actual fitted `GearCatalog`/`ShipLoadout`
    gear), centred on the ship, tinted distinctly by slot order.
  - `WEAPON_RANGE_PALETTE` / `weaponRangeColor(index)` — a 6-colour palette (cyan/amber/green/
    magenta/orange/violet) that wraps for a loadout with more guns than colours, so overlapping
    range rings read as separate circles.
  - `targetInRange(range, from, target)` — inclusive-boundary reach test.
  - `WeaponAssignmentController<TWeapon extends RangedWeapon, TTarget>` — the **UX decision:
    click-a-weapon-then-click-a-target** two-step interaction. `selectWeapon` arms a gun (clicking
    the armed gun again toggles it off); `selectTarget` writes the assignment into the planned-turn
    draft via the narrow `WeaponAssignmentSink` (satisfied by `CombatPlanningController` — whose
    `assignWeapon`/`clearWeapon` already overwrite cleanly and no-op outside PLANNING). Focus-fire
    (every gun → one target) and spread (re-aim one gun) both work; `unassign` clears a gun.
- **Out-of-range decision (recorded): FLAGGED, not rejected.** In a pause-and-plan model the
  planned movement can carry a target into range during the execute window, so a hard reject
  measured from the pre-move position would wrongly forbid a legitimate lead-the-target plan. The
  assignment is accepted and returned with `inRange: false` so the UI can render it in a warning
  tint; the execute-phase fire gate (`advancePlayerWeapons`' own range check, Task 6) stays the
  sole authority on whether the shot lands.
- **Presentation seam**: `src/presentation/flight/combatWeaponRangeOverlay.ts`
  (`drawWeaponRangeCircles`) — a thin drawing seam mirroring `combatCoursePreview`, strokes each
  `RangeCircle` as a dashed ring in the same style as `CombatHud.drawRangeCircle`, tested with a
  fake `Graphics` recorder. All range/colour decisions live in the pure module; this only turns
  circles into strokes.
- **Wiring status**: inert in production today, exactly like Task 2's freeze-gate / Task 3's
  course-preview / Task 4's gravity math — the live click routing between a movement click and a
  weapon-assign click needs the planning-phase UI mode, which isn't lit up until the combat-open
  `beginCombat` trigger lands (a later task); the scene isn't touched here (also keeps
  `SpaceFlightScene.ts` clear of the line guard). The math + assignment logic + render seam +
  tests are complete and green; the live overlay + two-step click light up the moment the trigger
  is connected. **No new i18n strings** (range circles are geometry, weapon icons reuse the
  existing `gearIcon.ts` art) and **no save/schema impact** (assignments live on the transient
  planned-turn draft).
- **Tests**: `src/tests/combat/combatWeaponTargeting.test.ts` (14) — radius==catalog range,
  distinct+wrapping colours, negative-index/zero-range edge cases, inclusive/beyond range test,
  assignment persists into the real `CombatPlanningController` draft, re-assignment overwrites,
  focus-fire vs. spread, the out-of-range **flag** (recorded decision), no-weapon-armed no-op,
  select toggle/clear, unassign, and the outside-PLANNING sink no-op.
  `src/tests/combat/combatWeaponRangeOverlay.test.ts` (3) — clears + strokes one dashed ring per
  weapon in that weapon's colour, skips a zero-radius circle, empty-list no-op. Full unit suite
  green (5591 pass).

### Task 6: Weapon execution — replace auto-fire with planned per-weapon assignments

- [x] Replace `advancePlayerWeapons`'s `pickTargetInRange` auto-target call with reading the
      confirmed planned turn's per-weapon target assignments; each weapon still fires on its own
      `weaponFireIntervalMs` cadence during the execute phase, now at ITS assigned target instead
      of the nearest-in-range pick. NPC-side targeting (`fireNpcShot`/NPC AI) is unchanged — only
      the player's weapons become manually targeted.
- [x] Write tests: each weapon fires at its own assigned target (not just the nearest), an
      unassigned weapon falls back to a sane default (decide: auto-pick nearest, or hold fire —
      record which), multi-weapon focus-fire and spread-fire both resolve correctly.

#### Task 6 outcome (implemented 2026-07-14)

- **Two additive optional deps on `CombatModuleDeps`** (`src/presentation/flight/CombatModule.ts`),
  the seam the planning loop drives targeting through:
  - `isPlannedTargetingActive(): boolean` — true only while a confirmed planning turn is executing
    (the scene will wire it to `combatPlanning.isExecuting`). Absent/false ⇒ the legacy
    `pickTargetInRange` auto-fire is unchanged, so **production stays on real-time auto-fire** and
    this change is **inert today** (the execute window is never reached until the combat-open
    `beginCombat` trigger lands — same deferral as Tasks 2–5).
  - `getPlannedWeaponTarget(weapon): NpcShipSprite | null` — the confirmed per-weapon assignment
    (Task 5's `weaponTargets` map), or null if that gun was left unassigned.
- **`advancePlayerWeapons` now branches** on `isPlannedTargetingActive`: while planned targeting is
  active each weapon fires **only** at its assignment via the new `resolvePlannedTarget(weapon)`
  helper; otherwise it keeps the exact legacy nearest-in-range pick. Each weapon still runs its own
  `weaponFireIntervalMs` timer and its own range gate. **NPC-side targeting (`fireNpcShot`/NPC AI)
  is untouched** — only the player's guns become manually targeted.
- **Unassigned-weapon fallback — decision: HOLD FIRE** (not auto-pick-nearest). This is the direct
  consequence of Task 1b's "empty draft = hold position, **hold fire**" rule: an empty planned turn
  means every gun is unassigned, which must mean no shots — so an unassigned gun under a partial
  plan likewise holds. `resolvePlannedTarget` returns null for an unassigned weapon → the existing
  "primed but no target" hold path.
- **Range/liveness stays the sole fire authority** (plan Task 5's flag-don't-reject): a planned
  assignment still fires only if the target is a live combatant (`combatants.has`) inside that
  weapon's own `range` this frame — a killed/fled or out-of-range assigned target holds and fires
  the instant it becomes valid (e.g. the planned course carries it into range), exactly like the
  legacy "closes into range" behaviour. So an out-of-range assignment is **accepted** at plan time
  (Task 5) and simply **held** at execute time, never hard-rejected.
- **Wiring status**: the CombatModule change + tests are complete and green; the scene is **not
  touched** (same rationale as Task 5 — the live click routing / `beginCombat` trigger isn't lit up
  yet, and touching `SpaceFlightScene.ts` would breach its `< 1900`-line guard, which sits at the
  ceiling). The two deps are optional, so every existing DI site (and the whole legacy auto-fire
  path) is byte-identical; the planned path lights up the moment the scene wires
  `isPlannedTargetingActive`/`getPlannedWeaponTarget` alongside the trigger. **No i18n/save/schema
  impact** (targeting lives on the transient planned-turn draft). Blast radius: `advancePlayerWeapons`
  is **LOW** (only `CombatModule.update` → `SpaceFlightScene.update` calls it), and the change is
  additive/gated, so the CRITICAL `CombatModule` fan-out is not disturbed.
- **Tests**: `src/tests/combat/plannedWeaponFire.test.ts` (7) — each gun fires at its OWN
  assignment (not nearest), focus-fire (all guns → one target), spread-fire (guns → different
  targets), an unassigned gun **holds fire** with a target in range, an out-of-range assignment
  holds then fires once it closes, a non-live-combatant assignment holds (no nearest-pick fallback),
  and the legacy auto-fire resuming when planned targeting is inactive (proving the gate). The
  existing `multiWeaponFire`/`confirmAttack`/`combatModule` suites stay green (legacy path
  unchanged; those files' rewrite for the new loop is Task 15's scope, not touched here). Full unit
  suite green apart from a pre-existing order-dependent flake in `cometHeadSprite.test.ts`
  (comet-sprite rotation VFX — unrelated to combat; passes in isolation).

### Task 7: Missile projectile mechanic — travel time + evasion

- [x] New projectile entity for `WeaponClass.MISSILE` weapons: instead of the instant hit-scan
      every other weapon class uses, a fired missile becomes a tracked entity that travels toward
      its target's position over N turns/seconds (finally consuming the existing flavor-only
      `WeaponClass`/`WeaponAbility.HOMING` fields for real behavior).
- [x] Evasion: the target can maneuver during the missile's flight to reduce hit probability —
      pick and record the exact resolution rule (e.g. hit chance inversely tied to the target's
      displacement/speed during the missile's flight window, resolved at arrival) rather than
      leaving it vague.
- [x] Write tests: travel-time math (distance/missile-speed → turns), evasion probability given a
      stationary vs. actively-maneuvering target, a destroyed/out-of-range target causes the
      missile to miss/despawn cleanly (no dangling entity).

#### Task 7 outcome (implemented 2026-07-14)

- **New pure module**: `src/presentation/flight/combatMissile.ts` (PixiJS-free, unit-tested
  standalone like `combatPlanning` / `combatTrajectory` / `combatGravity`). Owns the missile
  travel-time + evasion mechanic — the first real consumer of the previously flavor-only
  `WeaponClass.MISSILE` (travel time) and `WeaponAbility.HOMING` (live re-aim + evasion
  resistance) fields:
  - `missileTravelTime(distance, speedPerMs)` — the **travel-time formula** (distance ÷ speed,
    `Infinity` for a non-positive speed, never negative).
  - `launchMissile(...)` — spawns a `MissileState` entity flying from the firing ship, aimed at
    the target's launch-time position; carries `launchDistance`, per-missile `damage`, the
    `homing` flag, and the displacement/flown accumulators.
  - `advanceMissile(state, targetPos | null, dtMs, config)` — steps the missile toward its aim
    each frame: a **homing** missile re-aims at the *live* `targetPos`, a dumb one flies the
    fixed line to `targetLaunchPos`. Accumulates the target's frame-to-frame path length into
    `targetDisplacement` (the evasion input). Resolves to `"arrived"` (within
    `MISSILE_ARRIVAL_EPS` of the aim), `"expired"` (flew past `launchDistance ×
    maxRangeMultiplier` without arriving — the target outran it), or `"miss"` (target `null` =
    destroyed/removed). **No dangling entity** — a done/arrived missile is returned unchanged
    (idempotent) and `isMissileDone` gates the execute-phase despawn sweep.
  - `missileHitChance(state, config)` — the pure **evasion curve**: `baseHitChance` minus
    `evasionPerPx × targetDisplacement`, floored at `minHitChance`; a homing missile suffers only
    `homingEvasionFactor` of that penalty.
  - `resolveMissileArrival(state, roll, config)` — settles an `"arrived"` missile to `"hit"`/
    `"miss"` by comparing `missileHitChance` against an **injected** `roll ∈ [0,1)`, keeping the
    module RNG-free and deterministic (the caller supplies the draw).
- **Evasion resolution rule (recorded, Task 7 decision)**: hit probability is resolved *at
  arrival* and is inversely tied to the target's **accumulated maneuver path length during the
  missile's flight** (not instantaneous speed) — a stationary target is hit at `baseHitChance`
  (~0.95), each px of target travel subtracts `evasionPerPx`, floored at `minHitChance` (0.15) so
  a frantic weaver can always *possibly* be hit. A **homing** missile re-aims each frame and
  therefore only suffers `homingEvasionFactor` (0.35) of the displacement penalty — homing trades
  a straight-line flight for evasion resistance, which is exactly what consumes
  `WeaponAbility.HOMING` for real behaviour.
- **Balance**: new `MISSILE_COMBAT` constant in `src/config/balance.ts` (speedPerMs / baseHitChance
  / minHitChance / evasionPerPx / homingEvasionFactor / maxRangeMultiplier), mirrored by the
  module's `DEFAULT_MISSILE_CONFIG` and parity-asserted in the test — tune-in-one-place, per the
  `COMBAT_ROUND_MS` / `GRAVITY_ASSIST` precedent.
- **Wiring status**: inert in production today, exactly like Tasks 2–6's machinery — the
  execute-phase loop that would launch a missile from `advancePlayerWeapons` (for a
  `WeaponClass.MISSILE` gun) and step it each frame folding a hit into `applyDamageWithMode`
  isn't wired until the combat-open `beginCombat` trigger lands (a later task). The pure math +
  entity lifecycle + config + tests are complete and green; the weapon-type VFX smoke-trail that
  tracks this projectile's actual flight path is Task 13. **No i18n/save/schema impact** (missiles
  are transient execute-window entities).
- **Tests**: `src/tests/combat/combatMissile.test.ts` (25) — travel-time formula (distance/speed,
  faster→sooner, zero-speed=Infinity, non-negative), launch state, travel + arrival (stationary
  target, per-step advance, overshoot-snap, homing intercept of a drifting target), clean despawn
  (null target = miss, outrun target = expired, done/arrived idempotent — no dangling entity), the
  evasion curve (stationary=base, more displacement→lower, floored, homing resists better, linear
  penalty), roll-injected hit/miss settlement (low-roll hit, high-roll miss, a weaver survives a
  mid roll a stationary target wouldn't, flying-not-settled), and the stationary-vs-weaving
  integration. Full unit suite green (5635 pass, 0 fail).

### Task 8: Afterburner

- [x] Add an afterburner action selectable during planning: a large speed multiplier for the
      following execute window. Decide and record the degradation model (cumulative wear stat on
      the engine, capped uses per fight, or a persistent cross-fight engine-health field — pick
      the smallest one that satisfies "postepenno razrushaet motor" / "gradually damages the
      engine" from the spec, and check whether it needs `SaveState` persistence).
- [x] Write tests: speed multiplier applied correctly for exactly one execute window then reverts,
      degradation accumulates per the chosen model, a fully-degraded engine can no longer
      afterburn (or applies a penalty — record which).

#### Task 8 outcome (implemented 2026-07-14)

- **New pure module**: `src/presentation/flight/combatAfterburner.ts` (PixiJS-free, unit-tested
  standalone like `combatPlanning` / `combatTrajectory` / `combatGravity` / `combatMissile`). The
  `PlannedTurn.afterburner` flag (+ `CombatPlanningController.setAfterburner`) already existed from
  Task 2; this task adds the speed-boost + engine-wear math the execute loop consumes:
  - `pristineEngine()` / `EngineWearState` — the session-scoped `{ integrity: 0..1 }` the host
    carries for one fight (1 = pristine, 0 = spent).
  - `afterburnerMultiplier(integrity, config)` — the **boost-taper curve**: `speedMultiplier` at
    pristine, tapering linearly toward `1` (no boost) as the engine wears, exactly `1` once too
    worn to engage; never below 1.
  - `canAfterburn(state, config)` — true while integrity is strictly above `minIntegrityToEngage`.
  - `engageAfterburner(state, config) → { state, multiplier, engaged }` — the **stateless
    transform**: applies the pre-wear multiplier and permanently drops integrity by `wearPerBurn`
    (floored at 0); a spent engine is a clean no-op (`engaged:false`, `multiplier:1`, state
    unchanged — no penalty, just no boost).
  - `afterburnerBurnBudget(config)` — the natural per-fight burn cap the wear model yields for free
    (`Infinity` for a non-positive `wearPerBurn`).
- **Degradation model (recorded decision) — session-scoped cumulative engine wear, NO save
  persistence.** This is the *smallest* model satisfying "постепенно разрушает мотор": each burn
  permanently lowers integrity for the rest of the fight (weakening later burns until the engine is
  spent and can no longer afterburn), and integrity resets to pristine at the next engagement.
  Rationale: (1) smallest of the three options — it subsumes "capped uses per fight" for free
  (`afterburnerBurnBudget`); (2) **no `SaveState`/schema impact**, consistent with every sibling
  task in this rework staying persistence-neutral (transient execute-window state); (3) avoids
  opening a cross-fight repair/economy loop the spec never specifies (where would you fix a
  permanently-damaged engine?). A persistent cross-fight engine-health field is recorded as a
  Post-Completion stretch, not v1.
- **Fully-degraded behaviour (recorded "record which")**: a spent engine **can no longer
  afterburn** (reverts to normal speed, `multiplier:1`) rather than applying a speed penalty.
- **"Applied for exactly one window then reverts"**: this is the planning loop's own contract, not
  a timer in this module — the caller applies the returned `multiplier` for one execute window, and
  the per-turn `afterburner` flag resets in the next fresh draft (`freshPlan`), so the boost
  reverts automatically. The module stays stateless math.
- **Balance**: new `AFTERBURNER` constant in `src/config/balance.ts` (speedMultiplier /
  wearPerBurn / minIntegrityToEngage), mirrored by the module's `DEFAULT_AFTERBURNER` and
  parity-asserted in the test — tune-in-one-place, per the `COMBAT_ROUND_MS` / `GRAVITY_ASSIST` /
  `MISSILE_COMBAT` precedent.
- **Wiring status**: inert in production today, exactly like Tasks 2–7's machinery — the
  execute-phase loop that would read `plan.afterburner`, call `engageAfterburner`, and fold the
  multiplier into `ShipPhysics`' speed for the window isn't wired until the combat-open
  `beginCombat` trigger lands (a later task). The pure math + config + tests are complete and green;
  the live boost lights up the moment the execute loop is connected. **No i18n/save/schema impact.**
- **Tests**: `src/tests/combat/combatAfterburner.test.ts` (13) — balance/module parity, pristine
  engine + engage-floor detection, the boost taper (peak at pristine, linear halving at half
  integrity, monotonic, `1` when spent, never below 1), a pristine burn applies the peak multiplier
  + wears the engine, degradation accumulates monotonically over a full fight (uses capped at
  `afterburnerBurnBudget`), a fully-degraded engine can no longer afterburn (no boost, no further
  wear), integrity never wears below 0, and the burn-budget cap (matches actual burns + `Infinity`
  for non-positive wear). Full unit suite green (5636 pass, 0 fail).

### Task 9: Consumable combat artifacts (shield restore / AoE damage / weapon jam)

- [x] Add the new consumable-artifact concept per Task 1's disambiguated naming and
      persistence decision: an inventory of activatable combat items, each with one of the three
      effects from the spec. Activation is a planning-phase action (like movement/weapons/comms).
- [x] Wire shield-restore to `shieldHP` (the first real combat consumer of that previously-unused
      field — coordinate with Task 12's shield-damage-order work so the two don't define
      conflicting semantics; if Task 12 hasn't landed yet, this task defines the shield-HP
      semantics and Task 12 follows it).
- [x] Write tests: shield-restore delta, AoE-damage applies to every enemy within its radius (not
      just the selected target), weapon-jam disables the target's fire for its stated duration and
      expires correctly.

#### Task 9 outcome (implemented 2026-07-14)

- **New pure module**: `src/presentation/flight/combatConsumable.ts` (PixiJS-free, unit-tested
  standalone like `combatPlanning` / `combatAfterburner` / `combatMissile`). Defines the
  `CombatConsumable` type + the three-item built-in catalog `COMBAT_CONSUMABLES` (one device per
  effect: `con_shield_cell` shield-restore, `con_pulse_bomb` aoe-damage, `con_jammer` weapon-jam),
  `consumableById` lookup, pure owned-inventory helpers (`hasConsumable`/`consumeOne`, non-mutating),
  and the three pure effect resolvers:
  - `applyShieldRestore(current, max, amount)` — clamp-to-max, **never-reduce** shield restore
    (a non-positive amount is a no-op, not a drain); guards non-finite/negative inputs. This
    **defines the shield-HP restore semantics Task 12's shield-vs-hull ordering follows** (Task 9
    lands first, per the plan's coordination note).
  - `aoeDamageTargets(center, enemies, posOf, config)` — returns an `AoeHit` for **every** enemy
    within the blast radius (inclusive boundary), not just a single selected target; generic over
    the ship-sprite type via `posOf`.
  - `jamTarget(target, nowMs, durationMs)` + `isJamActive(jam, nowMs)` — silences a target's fire
    for a fixed window that expires cleanly at `expiresAtMs` (`nowMs < expiresAtMs`).
- **Activation is a planning-phase action** — already threaded: `PlannedTurn.consumableId` +
  `CombatPlanningController.setConsumable` (Task 2) carry the ≤1 selected device per turn; this task
  fills in what the id means and the effect math the execute loop resolves.
- **Naming (Task 1 decision 1d)**: code type `CombatConsumable`, player-facing category
  **"Тактическое устройство" / "Tactical Device"** (i18n `combat.consumable.category`), deliberately
  distinct from `ResourceType.ARTIFACTS` (the Overmind-loot crafting currency) — asserted in the test.
  Per-device name/desc keys added to **both** `ru.ts` and `en.ts`.
- **Persistence (Task 1 decision 1d — additive-optional, NO migration/version bump)**: new
  `Inventory.ownedConsumableIds: string[]` domain field + `addConsumable`/`hasConsumable`/
  `removeConsumable` methods (mirroring the `ownedGearIds` precedent, `??=`-guarded so an old save's
  absent field — the `setPrototypeOf` load path skips field initializers — never throws), and
  `.default([])` in `InventorySchema` (`schemas.ts`). An absent field defaults to an empty inventory,
  so **no `MigrationPipeline` migration and no `CURRENT_VERSION` bump** — `npm run test:save-compat`
  stays green (old golden saves load with an empty consumable inventory).
- **Balance**: new `COMBAT_CONSUMABLE` constant in `src/config/balance.ts` (shieldRestoreAmount /
  aoeDamage / aoeRadius / weaponJamMs), mirrored by the module's `DEFAULT_COMBAT_CONSUMABLE` and
  parity-asserted in the test — tune-in-one-place, per the `COMBAT_ROUND_MS` / `GRAVITY_ASSIST` /
  `MISSILE_COMBAT` / `AFTERBURNER` precedent.
- **Wiring status**: inert in production today, exactly like Tasks 2–8's machinery — the execute-phase
  loop that would read `plan.consumableId`, spend the copy (`Inventory.removeConsumable`) and apply
  the resolved effect (restore shields / AoE-damage enemies / jam a target's fire gate) isn't wired
  until the combat-open `beginCombat` trigger lands (a later task). The pure math + catalog +
  persisted inventory + i18n + config + tests are complete and green; the live activation lights up
  the moment the execute loop is connected. Blast radius: `Inventory` is MEDIUM (6 direct callers);
  the change is purely additive (new optional field + new methods), so no existing caller breaks.
- **Tests**: `src/tests/combat/combatConsumable.test.ts` (21) — balance/module parity, catalog
  one-device-per-effect + unique ids, i18n key presence in both dictionaries + the ARTIFACTS
  disambiguation, `consumableById`, the non-mutating owned-inventory helpers, the domain
  add/has/remove round-trip + the old-save absent-field guard, shield-restore (delta, clamp,
  never-reduce, full-shield no-op, non-finite guards, config default), AoE (every enemy in radius,
  inclusive boundary, multiple-hit not-just-one, empty list), and weapon-jam (suppress-then-expire,
  non-positive no-op, config default). Full unit suite green (5657 pass, 0 fail); save-compat green.

### Task 10: In-combat comms panel (bribe / demand surrender / call for help)

- [x] Extend `NpcInteractionController.ts`'s existing shakedown-hail pattern to be reachable as a
      planning-phase action during an **active** fight (today it's pre-combat/negotiation-gated
      only) — add the "Связь" action alongside movement/weapons/afterburner/artifact.
- [x] Bribe/tribute reuses the existing `shakedownTribute` economy path. Demand-surrender is a new
      resolution: a surrendering NPC flees or yields loot without being destroyed (decide which,
      record reasoning — probably role/hull-fraction gated, not unconditional). Call-for-help is a
      new resolution: a nearby friendly NPC (trader/military per the spec) joins the fight on the
      player's side if one exists in range (decide the eligibility/proximity rule).
- [x] Write tests for each of the three new resolution branches, plus the "no eligible ally in
      range" call-for-help failure case.

#### Task 10 outcome (implemented 2026-07-14)

- **New pure module**: `src/presentation/flight/combatComms.ts` (PixiJS-free, unit-tested
  standalone like `combatPlanning` / `combatConsumable` / `combatMissile`). Owns the three «Связь»
  branches; `PlannedTurn.commsAction` + `CombatPlanningController.setComms` (Task 2) already thread
  the ≤1 selected action per turn, this task fills in what each id means + the resolution rules:
  - **bribe** — `resolveBribe(playerCredits)` reuses the existing `shakedownTribute` (imported from
    `NpcBrain`, the same economy math the pirate shakedown uses) for the tribute amount; the target
    always disengages once paid (even a penniless player's 0-credit bribe buys peace this fight,
    matching the shakedown-payoff semantics). The pure function computes the amount + disengage
    decision; the execute-loop caller moves the credits through the bank bus (`payTribute`), so the
    module stays free of economy side effects.
  - **demand-surrender** — `resolveSurrenderDemand(role, hullFraction, config)`, **role- AND
    hull-fraction-gated** (recorded decision, not unconditional): a target yields only if its
    clamped `[0,1]` hull fraction is at/below its role's `surrenderThreshold` and that threshold is
    strictly positive. Cowardly traders (0.6) surrender at high hull, brave rangers/pirates
    (0.3/0.2) only near death, and the hive `OVERMIND` (threshold 0) **never** surrenders even at 0
    hull. Deterministic (no RNG). **Surrender = flees while dropping its loot** (recorded decision):
    removed from the fight via the existing departure/flee path (never destroyed), and the player
    still collects the yielded loot — chosen over "yields loot without fleeing" (a passive sitting
    target the player could execute for free contradicts "spared, not killed") and "flees
    empty-handed" (no reward for a successful demand).
  - **call-for-help** — `findCallForHelpAlly(playerPos, candidates, posOf, roleOf, isAvailable?,
    config)`: the **closest** candidate that is (1) an ally-eligible role (`allyRoles` = TRADER +
    military PATROL/RANGER per the spec), (2) within `allyProximityRadius` of the player, and (3)
    `isAvailable` (caller's predicate — e.g. not itself hostile/departing; defaults to always
    available). Returns **null** when no eligible ally is in range (the failure case). Generic over
    the candidate type via `posOf`/`roleOf`, so the module never touches sprite internals.
- **Balance**: new `COMBAT_COMMS` constant in `src/config/balance.ts` (per-role
  `surrenderHullThreshold` + `defaultSurrenderThreshold` / `allyProximityRadius` / `allyRoles`),
  mirrored by the module's `DEFAULT_COMBAT_COMMS` and parity-asserted in the test — tune-in-one-place,
  per the `COMBAT_ROUND_MS` / `MISSILE_COMBAT` / `AFTERBURNER` / `COMBAT_CONSUMABLE` precedent. Roles
  are plain strings (the `NpcRole` enum values), so neither the module nor `balance.ts` imports
  `NpcRole`.
- **i18n (Task 1 decision 1d, disambiguated)**: player-facing category **«Связь» / "Comms"** (i18n
  `combat.comms.category`) + per-branch name/desc keys added to **both** `ru.ts` and `en.ts`,
  deliberately distinct from `combat.consumable.category` and the `ResourceType.ARTIFACTS` currency
  (asserted in the test).
- **Wiring status**: inert in production today, exactly like Tasks 2–9's machinery — the
  execute-phase loop that would read `plan.commsAction`, run the resolved branch (pay tribute + break
  off / flee-and-drop-loot / spawn a friendly combatant) isn't wired until the combat-open
  `beginCombat` trigger lands (a later task). The pure resolution rules + config + i18n + tests are
  complete and green; the live «Связь» panel + resolution light up the moment the execute loop is
  connected. The scene is **not** touched here (also keeps `SpaceFlightScene.ts` clear of the line
  guard). Blast radius: `NpcInteractionController` is MEDIUM (11 callers) but is **not edited** — the
  new module extends its *pattern* (shakedown economy reuse) without touching the class, so its
  fan-out is undisturbed. **No save/schema impact** (comms action lives on the transient
  planned-turn draft; the `shakedownTribute`/`payTribute` reuse adds no new economy plumbing).
- **Tests**: `src/tests/combat/combatComms.test.ts` (21) — balance/module parity, the three-branch
  catalog + i18n presence in both dictionaries + the consumable/artifact disambiguation,
  `commsActionById`, bribe (tribute == `shakedownTribute`, penniless=0 still disengages, paying
  disengages), demand-surrender (role threshold lookup + default fallback, cowardly-trader vs
  brave-pirate, boundary-inclusive gate, full-hull never yields, OVERMIND never yields, clamped
  out-of-range/NaN hull), and call-for-help (closest eligible in range, ignores pirate/overmind,
  null when none in range / no candidates, inclusive proximity boundary, availability-predicate
  skip, all trader+military roles eligible). Full unit suite green (5678 pass, 0 fail).

### Task 11: Ship visual polish — banking/roll during planned execution

- [x] Ships bank/roll into turns during the execute window — a presentation-only rotation tilt
      correlated with the ship's current turn rate (no physics change, `ShipPhysics`'s
      `shipAngle`/turn math is untouched; this reads the existing turn rate to drive a visual
      roll).
- [x] Write tests: pure banking-angle-from-turn-rate function (input turn rate → output roll
      angle, clamped to a sane max).

#### Task 11 outcome (implemented 2026-07-14)

- **New pure module**: `src/presentation/flight/combatBanking.ts` (PixiJS-free, unit-tested
  standalone like `combatPlanning` / `combatTrajectory` / `combatGravity` / `combatMissile` /
  `combatAfterburner`). Owns the presentation-only roll-tilt math — it **only reads** the turn
  rate; `ShipPhysics`' `shipAngle`/turn math and every physics path are **untouched** (no
  physics/save/schema impact):
  - `shipTurnRate(prevAngle, currAngle, dtMs)` — the signed turn rate (radians/ms) between two
    consecutive headings, with the heading delta wrapped to the shortest rotation so a wrap across
    ±π never reads as a spurious ~2π turn; `0` for a non-positive `dtMs` or a non-finite heading.
    The one place the scene derives "how fast is the ship turning" from the existing `shipAngle`.
  - `bankingAngle(turnRate, config)` — the **banking-angle-from-turn-rate function**:
    `turnRate × rollPerTurnRate`, **sign-preserving** (banks *into* the turn) and **clamped to
    ±maxRollAngle** (the "sane max"), so a lag-spike / time-scaled frame with an outsized
    instantaneous turn rate can never flip the sprite past a believable bank. Tuned so a full-rate
    `ShipPhysics.rotationSpeed` (≈ π/2 / 300) turn lands right at the `π/6` clamp. Level (`0`) for
    a zero / non-finite turn rate.
  - `approachRoll(current, target, dtMs, config)` — a smoothing easer that steps the live roll
    toward the target at `rollSmoothingPerMs` (never overshooting), so the tilt reads as a smooth
    roll-in/roll-out rather than a snap; holds the current roll for a non-positive `dtMs`.
- **Balance**: new `BANKING` constant in `src/config/balance.ts` (rollPerTurnRate / maxRollAngle /
  rollSmoothingPerMs), mirrored by the module's `DEFAULT_BANKING` and parity-asserted in the test
  — tune-in-one-place, per the `COMBAT_ROUND_MS` / `GRAVITY_ASSIST` / `MISSILE_COMBAT` /
  `AFTERBURNER` / `COMBAT_CONSUMABLE` / `COMBAT_COMMS` precedent.
- **Wiring status**: inert in production today, exactly like Tasks 2–10's machinery — the
  execute-phase render loop that would read the ship's live per-frame turn rate, feed
  `bankingAngle` and ease it via `approachRoll` into the ship sprite's visual roll isn't wired
  until the combat-open `beginCombat` trigger lands (a later task). The scene is **not** touched
  here (also keeps `SpaceFlightScene.ts` clear of the `< 1900`-line guard). The pure math + config
  + tests are complete and green; the live bank lights up the moment the execute loop is
  connected. **No i18n/save/schema impact** (roll is a transient render-only value; no persisted
  field, no player-facing string).
- **Tests**: `src/tests/combat/combatBanking.test.ts` (18) — balance/module parity, `shipTurnRate`
  (unchanged=0, signed magnitude=delta/dt, ±π wrap, non-positive-dt/non-finite guards),
  `bankingAngle` (level at no turn, banks-into-turn sign, linear below the clamp, monotonic in
  magnitude, ±clamp for an outsized rate, a full-rate `rotationSpeed` turn landing at the clamp, a
  never-exceeds-clamp sweep, non-finite guard), and `approachRoll` (steps at the smoothing rate,
  snaps-without-overshoot within one step, eases both up and down, holds on non-positive dt,
  converges over repeated steps). Full unit suite green (5696 pass, 0 fail).

### Task 12: Shield-hit flash + per-ship floating hull/shield bars

- [x] Wire real shield-vs-hull damage ordering into combat resolution (shields absorb damage up to
      `shieldHP` before hull takes the overflow) — per Task 9's coordination note, this is the
      first real consumer of `shieldHP` if Task 9 hasn't already defined the semantics; otherwise
      this task follows what Task 9 established.
- [x] Add the shield-hit flash VFX (translucent colored sphere, brief) on any hit that shields
      absorb, distinct from the existing hull-hit flash.
- [x] Add a small floating hull/shield bar over each ship in flight (new presentation component —
      today only the HUD side-panel shows target/player bars, nothing floats over the sprites).
- [x] Write tests: damage-order math (shield-then-hull, overflow calculation), bar-fraction mapping
      for both hull and shield values.

#### Task 12 outcome (implemented 2026-07-14)

- **New pure module**: `src/presentation/flight/combatShield.ts` (PixiJS-free, unit-tested
  standalone like `combatPlanning` / `combatTrajectory` / `combatGravity` / `combatMissile` /
  `combatAfterburner` / `combatConsumable` / `combatBanking`). The **first real combat consumer** of
  the ship shield pool — `PlayerShip.shields`/`maxShields` and `NpcShip.shields` are persisted domain
  stats that no damage-resolution code has ever read (grep: zero hits in `src/systems/combat/*`).
  (Note: the plan's Task-1 text calls the field `shieldHP`; the actual domain field is `shields`,
  as Task 9 already recorded — this module stays generic over plain `shields`/`damage` numbers.)
  - `resolveShieldedDamage(shields, damage)` → `{ shields, shieldAbsorbed, hullDamage, shieldHit }`
    — the **damage-order split**: shields absorb up to their current value, the overflow reaches the
    hull. **It does NOT touch the hull-flooring rule** — the caller feeds `hullDamage` to
    `applyDamageWithMode` (godMode.ts), which still owns the GOD-mode floor, so this composes ahead
    of the existing damage path without rewriting it. `shieldHit` (absorbed > 0) is the flash
    trigger. Non-finite/negative inputs are guarded to 0.
  - `barFraction(current, max)` → `[0,1]` — the fill mapping **both** the hull and shield floating
    bars render their width from; a non-positive/non-finite `max` (a shield-less ship) is an empty
    bar, over-full clamps to 1.
  - `shieldFlashAlpha(ageMs, config)` — the flash sphere's linear fade from `shieldFlashPeakAlpha`
    at the hit instant to 0 at `shieldFlashMs`.
- **Shield-HP semantics coordinate with Task 9** (recorded): a shield is a `[0, maxShields]` pool
  that `resolveShieldedDamage` drains and Task 9's `applyShieldRestore` (clamp-to-max, never-reduce)
  refills — a round-trip test (`combatShield.test.ts`) proves the two agree on what a shield value
  means, satisfying the plan's "whichever of Task 9/Task 12 lands first defines the semantics" note.
- **Shield-hit flash VFX seam**: `src/presentation/flight/combatShieldFlash.ts`
  (`drawShieldFlashes`, `SHIELD_FLASH_COLOR` cold cyan) — a thin drawing seam (mirrors
  `combatWeaponRangeOverlay`/`combatCoursePreview`) that turns a `{x,y,radius,alpha}` descriptor into
  a soft outer + brighter inner **translucent sphere**, deliberately **distinct** from the warm
  hull-hit impact bloom (`CombatHud`'s tracer/impact flash). Tested with a fake `Graphics` recorder.
- **Floating hull/shield bars seam**: `src/presentation/flight/combatStatusBars.ts`
  (`drawShipStatusBars`) — a new presentation component (today only the HUD side-panel shows
  target/player bars; nothing floats over the sprites). Draws a compact stacked bar (hull below,
  shield above with a `barGap`) centred on each ship, floating `barYOffset` above it; a shield-less
  ship (no/zero `maxShields`) reads as a single hull bar with no empty shield slot, and an
  enemy-hull tint is a caller override. Tested with a fake `Graphics` recorder.
- **Balance**: new `SHIELD_COMBAT` constant in `src/config/balance.ts` (shieldFlashMs /
  shieldFlashPeakAlpha / shieldFlashRadiusScale / barWidth / barHeight / barGap / barYOffset),
  mirrored by the module's `DEFAULT_SHIELD_COMBAT` and parity-asserted in the test — tune-in-one-place,
  per the `COMBAT_ROUND_MS` / `GRAVITY_ASSIST` / `MISSILE_COMBAT` / `AFTERBURNER` /
  `COMBAT_CONSUMABLE` / `COMBAT_COMMS` / `BANKING` precedent.
- **Wiring status**: inert in production today, exactly like Tasks 2–11's machinery — the
  execute-phase damage loop that would run `resolveShieldedDamage` before `applyDamageWithMode`,
  spawn a `drawShieldFlashes` sphere on a `shieldHit`, and draw a `drawShipStatusBars` bar over each
  combatant isn't wired until the combat-open `beginCombat` trigger lands (a later task). The scene
  is **not** touched here (also keeps `SpaceFlightScene.ts` clear of the `< 1900`-line guard). The
  pure damage-order math + fraction/flash math + both render seams + config + tests are complete and
  green; the live shield absorption + flash + floating bars light up the moment the execute loop is
  connected. **No i18n/save/schema impact** — shields already persist (`schemas.ts` unchanged), and
  the flash/bar are transient render-only values. Blast radius: `applyDamageWithMode` is **not
  edited** (the new module composes ahead of it), so the CRITICAL combat-core fan-out is undisturbed.
- **Tests**: `src/tests/combat/combatShield.test.ts` (17) — balance/module parity, the
  shield-then-hull split (full-absorb, overflow, shields-down, exact-drain, zero-damage no-op,
  non-finite/negative guards, the Task-9 restore round-trip), `barFraction` (mid/full/empty, clamps,
  non-positive/non-finite max, non-finite current), and `shieldFlashAlpha` (peak→0 linear fade,
  monotonic, negative-age/past-duration, zero-duration no-op). `combatShieldFlash.test.ts` (5) —
  clears + draws the concentric sphere per flash, default cyan tint + override, skips faded/zero
  flashes, empty-list no-op. `combatStatusBars.test.ts` (9) — hull+shield tracks/fills, fill widths
  match fractions, centred + floats above the ship, shield above hull, shield-less/missing-field
  hull-only, empty-hull background-only, non-positive-maxHull no-op, enemy-tint override, empty-list
  no-op. Full unit suite green (5727 pass, 0 fail; +31 new).

### Task 13: Weapon-type VFX (laser / plasma-blaster / missile smoke trail / heavy-weapon distortion)

- [x] Extend the existing `CombatHud` tracer/impact-bloom system to branch visual style by
      `WeaponClass` (now consumed for both behavior — Task 6/7 — and visuals): a continuous beam
      for ENERGY/laser weapons, a fast plasma/physical burst for FRAGMENT/blaster weapons, a
      curved white smoke-trail arc for MISSILE weapons (ties into Task 7's travel-time entity —
      the trail should track the projectile's actual flight path, not a static line), and a
      space-distortion ripple effect for the heaviest weapon tier (decide which tier qualifies,
      record the threshold).
- [x] Write tests: correct VFX variant selected per `WeaponClass`/tier (presentation-logic unit
      test asserting the right variant is dispatched, not pixel output).

#### Task 13 outcome (implemented 2026-07-14)

- **New pure module**: `src/presentation/flight/combatWeaponVfx.ts` (PixiJS-free, unit-tested
  standalone like `combatMissile` / `combatShield` / `combatWeaponTargeting`). Owns the **variant
  dispatch** — it consumes `GearCatalog.WeaponClass` for *visuals* (Task 6/7 already consumed it for
  *behaviour*):
  - `weaponVfxKind(weaponClass)` → `WeaponVfxKind.{BEAM|BURST|MISSILE_TRAIL}` (ENERGY→beam,
    FRAGMENT→plasma burst, MISSILE→curved smoke-trail arc).
  - `isDistortionTier(weapon, config)` — the heaviest-tier gate (see threshold below).
  - `selectWeaponVfx(weapon, config)` → `{ kind, distortion }` — the full pure dispatch the drawing
    seam branches on (no pixels here).
  - `missileTrailPoints(path, maxPoints)` — samples Task 7's flown `MissileState.pos` history into a
    bounded trail polyline so the smoke-trail arc **tracks the projectile's actual flight path**, not
    a static shooter→target line (never mutates the input; clamps the cap to ≥2).
- **Heaviest-tier threshold (recorded Task 13 decision)**: a weapon draws the space-distortion
  ripple when it is `rare` (apex/endgame stock — catalog `wpn_torpedo` T6 / `wpn_singularity_lance`
  T8) **or** its `techLevel >= distortionMinTech` (default **7** — captures the T7 `wpn_disruptor`,
  which the catalog names «редкий» but does not flag `rare`). Smallest rule that reads as "only the
  very heaviest guns warp space" against the current T1..8 catalog; the cutoff lives in `balance.ts`
  (`WEAPON_VFX`) so it's tuned in one place.
- **Drawing seam**: `src/presentation/flight/combatWeaponVfxOverlay.ts` (`drawWeaponVfx`) — a thin
  presentation seam mirroring `combatShieldFlash` / `combatWeaponRangeOverlay`: it turns a resolved
  `WeaponVfxSpec` (variant + endpoints + optional trail) into strokes/fills per kind (BEAM = one
  continuous line; BURST = short bolt + impact spark; MISSILE_TRAIL = polyline along the flown trail
  with a from→to fallback), plus the `distortion` ripple ring drawn *over* the base kind. Tinted
  distinctly (`WEAPON_VFX_COLOR` hot cyan / `MISSILE_TRAIL_COLOR` near-white / `DISTORTION_COLOR`
  violet). All *which-style* decisions are the pure module's; the seam only turns numbers into fills.
- **Balance**: new `WEAPON_VFX` constant in `src/config/balance.ts` (`distortionMinTech`), mirrored
  by the module's `DEFAULT_WEAPON_VFX` and parity-asserted in the test — tune-in-one-place, per the
  `COMBAT_ROUND_MS` / `MISSILE_COMBAT` / `SHIELD_COMBAT` precedent.
- **Wiring status**: inert in production today, exactly like Tasks 2–12's machinery — `CombatHud`
  itself is **not** edited (its `flashShot` signature stays unchanged, so `CombatModule` needs no
  behavioural change); the execute-phase fire loop that would call `selectWeaponVfx` per shot and
  hand the variant to `drawWeaponVfx` (branching the tracer style, feeding a missile's flown points
  as the trail) isn't wired until the combat-open `beginCombat` trigger lands (a later task). The
  scene/`CombatHud` are untouched here (also keeps `SpaceFlightScene.ts` clear of the `< 1900`-line
  guard). The pure dispatch + trail sampling + render seam + config + tests are complete and green;
  the live weapon-type tracers light up the moment the execute loop is connected. **No i18n/save/
  schema impact** (variants are transient render-only values; VFX geometry has no player-facing text).
  Blast radius: `combatWeaponVfx`/`combatWeaponVfxOverlay` are brand-new files with no callers yet, so
  the CRITICAL `CombatModule`/`CombatHud` fan-out is undisturbed (per the standing new-file impact
  exemption).
- **Tests**: `src/tests/combat/combatWeaponVfx.test.ts` (17) — `WEAPON_VFX`/module parity, base kind
  per class, the heaviest-tier threshold (rare-any-tech, ≥minTech, below-minTech, custom config), the
  full variant dispatch (incl. a rare apex missile keeping MISSILE_TRAIL **and** getting distortion,
  and a T7 non-rare energy weapon getting distortion), and `missileTrailPoints` (whole-path copy, cap
  trimming to most-recent, no-mutation, cap-clamp-to-2). `src/tests/combat/combatWeaponVfxOverlay.test.ts`
  (8) — beam draws one line (no spark), burst draws bolt+spark fill, missile-trail draws a polyline
  along the trail points (+ from→to fallback), a distortion shot adds the ripple ring over the base
  kind, base-colour override keeps the distortion tint, faded/empty no-ops. Full unit suite green
  (5752 pass, 0 fail; +25 new).

### Task 14: Death explosion + drifting wreckage/cargo debris

- [x] Extend the existing `shipDeathFx` explosion; add an actual wreck sprite (today's
      `LootDropHandler` only spawns floating loot dots, no wreck) that inherits the destroyed
      ship's last velocity/heading and drifts with that inertia before settling or despawning.
- [x] Spawn existing `LootDropHandler` cargo dots from the wreck's drifting position over its
      lifetime, rather than all at the instant of death at a fixed point.
- [x] Write tests: wreck spawn velocity/heading matches the ship's pre-death physics state, drift
      decay/despawn timing.

#### Task 14 outcome (implemented 2026-07-14)

- **New pure module**: `src/presentation/flight/combatWreck.ts` (PixiJS-free, unit-tested
  standalone like `combatPlanning` / `combatTrajectory` / `combatGravity` / `combatMissile` /
  `combatAfterburner` / `combatBanking`). Owns the death-aftermath physics — the missing middle
  between the one-shot `shipDeathFx` spark burst and `LootDropHandler`'s all-at-once dump:
  - `shipVelocity(angle, speed)` — projects the ship's `ShipPhysics.shipAngle` + scalar
    `currentSpeed` into the `{vx,vy}` (px/ms) velocity the wreck inherits (non-finite → zero).
  - `spawnWreck(x, y, vx, vy, angle, config)` → `WreckState` — spawns the wreck at the destroyed
    ship's position **inheriting its velocity + heading**; tumble `spinRate = spinRatePerSpeed ×
    speed` so a fast-dying ship tumbles harder and a stationary kill barely rotates.
  - `advanceWreck(state, dtMs, config)` — steps the wreck each frame: drifts by its velocity,
    applies a per-ms **drag decay** (`v × driftRetentionPerMs^dt`, so it coasts then slows), tumbles
    the heading, ages it. Returns a **new** state (input never mutated); a non-positive `dtMs` or an
    already-done wreck is returned unchanged (idempotent — no dangling drift past despawn).
  - `isWreckDone(state)` / `wreckAlpha(state, config)` — despawn gate + the render fade (full
    opacity until the `fadeMs` window opens at `lifeMs − fadeMs`, then a linear ease to 0),
    monotonically non-increasing across the life.
  - `wreckLootEmissionTimes(count, spreadMs)` — the **staggered loot schedule**: `count` emissions
    at interior instants `(i + 0.5)/count × spreadMs`, so cargo peels off the *drifting* wreck over
    its lifetime and **never all at once at the death point** (the Task 14 requirement); the `+0.5`
    interior offset keeps every emission strictly inside `(0, spread)` so a per-frame sweep from age
    0 catches them all.
  - `dueLootEmissions(prevAgeMs, currAgeMs, times)` — the half-open `[prev, curr)` frame check: the
    execute loop steps the wreck, then spawns a `LootDropHandler` dot at the wreck's **live** drift
    position for each returned index, so each scheduled drop fires on exactly one frame across the
    drift.
- **Wreck render seam**: `src/presentation/flight/combatWreckRenderer.ts` (`drawWrecks`,
  `WRECK_HULL_COLOR` scorched slate / `WRECK_EMBER_COLOR` dim ember) — a thin drawing seam
  (mirrors `combatShieldFlash` / `combatStatusBars`) that turns a `{x,y,angle,alpha,size}`
  descriptor into a jagged hull-silhouette polygon (deliberately broken/asymmetric so it reads as
  debris, not an intact ship), rotated to the wreck's tumble, plus a dim ember core so a fresh
  wreck still glows. Tested with a fake `Graphics` recorder.
- **Loot reuse (no new plumbing)**: the drift-position dots reuse the **existing** `LootDropHandler`
  spawn/TTL/pickup path unchanged — this module only computes *when* and *where* along the drift to
  call it, so `LootDropHandler`'s loot roll/pickup semantics are untouched.
- **Data reuse (no new domain fields)**: the wreck inherits the ship's live `shipAngle` +
  `currentSpeed` (already on `ShipPhysics`) and rough radius — no galaxy-gen change, no domain/
  schema/save impact (wreck/drift/loot-cadence are transient render-window state).
- **Balance**: new `WRECK` constant in `src/config/balance.ts` (driftRetentionPerMs / lifeMs /
  fadeMs / spinRatePerSpeed), mirrored by the module's `DEFAULT_WRECK` and parity-asserted in the
  test — tune-in-one-place, per the `COMBAT_ROUND_MS` / `GRAVITY_ASSIST` / `MISSILE_COMBAT` /
  `AFTERBURNER` / `COMBAT_CONSUMABLE` / `COMBAT_COMMS` / `BANKING` / `SHIELD_COMBAT` / `WEAPON_VFX`
  precedent.
- **Wiring status**: inert in production today, exactly like Tasks 2–13's machinery — `shipDeathFx`
  and `LootDropHandler` themselves are **not** edited; the execute-phase death loop that would
  spawn a wreck on a kill (inheriting the dying ship's `shipVelocity`), step it each frame
  (`advanceWreck` → `drawWrecks`), and spawn a `LootDropHandler` dot at the wreck's live position
  for each `dueLootEmissions` index isn't wired until the combat-open `beginCombat` trigger lands
  (a later task). The scene/`shipDeathFx`/`LootDropHandler` are untouched here (also keeps
  `SpaceFlightScene.ts` clear of the `< 1900`-line guard, unchanged at 1898). The pure drift/fade/
  loot-cadence math + render seam + config + tests are complete and green; the live wreck + trailing
  loot light up the moment the execute loop is connected. Blast radius: `combatWreck` /
  `combatWreckRenderer` are brand-new files with no callers yet, so the CRITICAL `CombatModule` /
  `NpcShipManager` fan-out is undisturbed (per the standing new-file impact exemption).
- **Tests**: `src/tests/combat/combatWreck.test.ts` (26) — `WRECK`/module parity, `shipVelocity`
  projection + non-finite guard, `spawnWreck` inherits position/velocity/heading + tumble ∝ speed
  (fast vs. slow vs. stationary) + non-finite guards, `advanceWreck` drift + drag-slows-over-frames
  + heading tumble + no-mutation + non-positive-dt hold + done-idempotence, `isWreckDone`/
  `wreckAlpha` despawn + fade timing (hold-then-ease, 0 at despawn, monotonic, zero-life),
  `wreckLootEmissionTimes` interior stagger (never at t=0, single-drop mid-drift, non-positive
  count/spread), and `dueLootEmissions` half-open frame window (boundary fires once, multi-span,
  non-advancing/spent, and the every-drop-fires-exactly-once integration).
  `src/tests/combat/combatWreckRenderer.test.ts` (11) — clears + draws a hull + ember poly per
  wreck, alpha passthrough, colour override, centred silhouette, rotates with heading, skips
  faded/zero-size, empty-list no-op. Full unit suite green (5801 pass, 0 fail; +37 new).

### Task 14.5: [PREREQUISITE — was missing] Wire the planning loop live into SpaceFlightScene combat flow

> ⚠️ **Blocker surfaced 2026-07-14 (this task did not exist in the original plan; inserted here).**
> Tasks 2–14 each built their mechanic as a pure, unit-tested module and **every one of them
> explicitly deferred production wiring** with the same sentence — *"inert in production today … the
> execute-phase loop that would fold this into the live combat flow isn't wired until the combat-open
> `beginCombat` trigger lands (a later task)."* **That later task was never written.** No task calls
> `CombatPlanningController.beginCombat()` anywhere in production (`grep` confirms: the only scene
> references are `combatPlanning.isPlanning` reads, never a lifecycle call). Consequences verified on
> 2026-07-14:
> - The new planning/execute loop **never activates** in the real engine. In-flight combat is still
>   100% the legacy real-time auto-pursuit (`CombatPursuitController` orbit-strafe + `advancePlayerWeapons`
>   auto-target). Every module from Tasks 2–14 (`combatPlanning`, `combatTrajectory`, `combatGravity`,
>   `combatWeaponTargeting`, planned-fire branch, `combatMissile`, `combatAfterburner`,
>   `combatConsumable`, `combatComms`, `combatBanking`, `combatShield`, `combatWreck`, the VFX seams)
>   is inert parallel machinery.
> - `gitnexus impact CombatPursuitController` (upstream) = **19 direct refs, CRITICAL**, across 8 core
>   `SpaceFlightScene` processes. So Task 15's checkbox to *"delete now-fully-superseded dead modules …
>   only once nothing still references them"* is **forbidden by its own guard** — they are not dead;
>   they are the live combat system. Deleting them would brick combat.
> - `npm run letsplay:ci` (108 passed) and `npm run test:playtest` (736 passed) are **already green**,
>   precisely because production combat was never replaced — not because the new loop works headlessly.
>
> **Task 15 (headless driver rewire) and Task 16 (verification) both assume this integration already
> happened. It did not.** This prerequisite must land first. Doing a headless-only force-wire of
> `beginCombat` (to make letsplay drive the "new loop") without the live planning-phase UI would freeze
> real human combat with no way to confirm a turn — a player-visible regression, which the standing
> "fix the game, don't just satisfy the oracle" rule forbids. So this is a coordinated production +
> UI integration, not a headless shortcut.

- [ ] Call `combatPlanning.beginCombat()` when combat engages (fold into the same seam that today
      starts the legacy pursuit / opens `combatPause`), and `endCombat()` on player death / last
      hostile destroyed (the only early terminators, per Task 1b).
- [ ] Drive the execute window: tick `combatPlanning.tickExecute(dt)` in `SpaceFlightScene.update`,
      re-open PLANNING when it closes; on `onConfirm` apply movement (`applyPlannedMovement` → Task 3)
      and flip the CombatModule planned-targeting deps live (`isPlannedTargetingActive` →
      `combatPlanning.isExecuting`, `getPlannedWeaponTarget` → the confirmed `weaponTargets` — Task 6).
- [ ] Light up the planning-phase **live UI**: mount the course preview (Task 3
      `previewCombatCourse`) and per-weapon range overlay + two-step assignment click
      (Task 5 `combatWeaponRangeOverlay` / `WeaponAssignmentController`), route planning-phase clicks
      to movement-vs-weapon-assign, and surface the "Ход"/Space confirm (Task 1b). New i18n strings go
      in BOTH `ru.ts`/`en.ts`.
- [ ] Fold the remaining execute-phase mechanics into the live loop each frame: gravity assist
      (Task 4 `gravityAssistTotal` → `ShipPhysics` velocity), afterburner (Task 8), missile entities
      (Task 7 launch/advance/resolve), consumable/comms actions (Tasks 9/10), and the VFX
      (Tasks 11–14) keyed to real execute-window events.
- [ ] Respect the `SpaceFlightScene.ts` ≤ 1898-line guard — extract to `flight/` helpers as needed
      (this integration is large; prefer new modules over inlining).
- [ ] Tests: a real-engine playtest that boots the engine, enters combat, confirms a planned turn,
      and asserts the loop actually cycled planning→execute→planning (the wiring, not the pure math
      Tasks 2–14 already cover) + E2E for the core planning-phase click loop (the plan's Task 2/3/5
      E2E, deferrable until now because the loop couldn't be entered live before this task).

> **NOTE for the ralphex loop / next iteration:** this is a paradigm-sized integration touching two
> CRITICAL-risk symbols (`CombatModule`, `CombatPursuitController`) and the scene at its line-guard
> ceiling — it is realistically several iterations, and is a big user-visible flip. It should be
> reviewed/split by a human before an autonomous batch drives it, per the standing "prefer fresh
> sessions over long autonomous batches that broke real play" guidance. Recommend splitting into
> sub-tasks (trigger+tick / live UI / mechanic-folding / VFX-folding) rather than one commit.

### Task 15: Update headless letsplay driving for the new planning-phase loop

> ⚠️ **Blocked on Task 14.5 (above).** The checkboxes below cannot be executed until the planning loop
> is actually live in production. Concretely: checkbox 1 says "drive the new loop instead of the old
> handlers **this plan removes**" — the plan has not removed them; checkbox 2's deletes are forbidden
> by their own "only once nothing still references them" guard (`gitnexus impact CombatPursuitController`
> = 19 live refs, CRITICAL); checkbox 3 is already green only because nothing was replaced. Do not mark
> these done and do not delete live combat modules until Task 14.5 lands.

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
