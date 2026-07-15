# Flight Module Conventions

`SpaceFlightScene` is a thin Controller; flight logic lives in `src/presentation/flight/`
modules implementing `FlightModule` (`initialize()` / `update(dt, bgElapsed)` / `destroy()`).

Modules: SpaceBackgroundLayer, StarRenderer, AsteroidBelt, OrbitRenderer, PlayerShipRenderer,
NpcShipManager, PlanetManager, CombatModule, FlightHud. Helpers (not FlightModules):
RouteRenderer, WarpEffectRenderer, CameraController, QuestCompletion, CombatHud, DamageNumbers,
ContactPanelManager (owns the NPC contact-panel lifecycle: one open panel at a time, deferred
teardown so PixiJS event dispatch is never interrupted mid-frame — extracted from NpcShipManager),
LootDropHandler (owns floating space loot: spawn, TTL despawn, pulse animation, proximity
pickup into gear inventory or resource hold — extracted from NpcShipManager),
NpcInteractionController (contact-panel action cluster: hail/trade/attack/approach/shakedown —
extracted from NpcShipManager), CombatPursuitController (chase-steering/orbit/breakoff state —
extracted from NpcShipManager; survives as the execute-window movement primitive of the
pause-and-plan loop), EncounterController (exploration-encounter rolls + overlay —
extracted from NpcShipManager), OvermindBossController (OVERMIND-core prompt + combatant spawn —
extracted from NpcShipManager),
combatPlanning (pure pause-and-plan state machine — PixiJS-free, unit-tested standalone; see the
"In-flight combat" section), combatPlanningUi (planning-phase weapon bar + range rings +
assignment/action routing), combatExecution (execute-window mechanics/VFX orchestrator),
combatPause (the SUPERSEDED reactive single-shot active-pause — reactive triggers unwired, only
its freeze/Esc primitives still mounted; see "In-flight combat"),
cometDustTail (pure dust-tail particle emitter for flyby comets — PixiJS-free, owns a fixed-size
mote pool with a hard live-count bound; `AsteroidBelt` mirrors each pool slot 1:1 onto a pooled
PixiJS `Particle`. Same pure-logic-tested-standalone pattern as `combatPause`),
CombatPauseOverlay (the target/weapon modal), combatPauseUi (`createCombatPauseUi` cross-links
controller ↔ overlay ↔ `CombatModule`; called with no args it returns a bare overlay-less
controller for field-init / unit tests, rebuilt wired in `initialize()`),
flightKeyHandler (`handleFlightKey(event, ctx)` — pure flight-scene keydown router: Esc closes the
top open surface in priority order — combat pause → contact panel → quest journal → planet info →
settings panel — else cancels a planned route; Space runs the planned turn — the keyboard
equivalent of the confirming second click, suppressed while a turn/combat pause is active or a
contact/quest-journal/planet-info/settings panel is open (mirrors the mouse-click
`isBlockingModalOpen` guard) — EXCEPT during combat PLANNING, where Space confirms the planned
combat turn (the `combatPlanning.confirm()` branch, checked before the `isTurnRunning` guard but
STILL behind the modal guard — Space must never confirm a combat turn behind an open journal/
contact/settings panel, review 2026-07-15);
j/i toggle journal/inventory. `SpaceFlightScene.onKeyDown` is a thin delegate that
builds `ctx` from live scene members; the extraction keeps the controller under the 1900-line
guard. Unit-tested standalone in `flightKeyHandler.test.ts`).

**Touch flight controls are additive and gated — the mouse path is byte-for-byte unchanged**
(`docs/plans/20260625-mobile-adaptation.md` Phase 2). The pure `touchGestures.ts`
(`TouchGestureInterpreter`, the touch sibling of the mouse-only `PanZoomController`, sharing its
`DRAG_THRESHOLD`) folds a pointer stream into pan/pinch/tap intents; `flightTouchControls.ts`
(`FlightTouchController`) is the narrow scene seam that forwards only **touch** pointers and only on
a real touch layout (`isTouchLayoutActive()` from `ui/responsiveLayout.ts`). One-finger taps stay on
the **existing** route/target path (a touch already fires a `button:0` pointerdown/up — tap-to-route
and tap-to-target need no new code); the *second* finger flips into pinch mode (the scene drops the
planned route) and pinch moves drive `CameraController.zoomByFactor(scale, anchorX, anchorY)` about
the finger midpoint. The keyboard-only **Esc/cancel** gets a touch-only «✕» `UiButton` in
`FlightHud` (built only when `isTouchLayoutActive()`) that runs the *exact* Esc action
(`SpaceFlightScene.onKeyDown({key:"Escape"})`). Mouse events and non-touch layouts early-return in
every controller method (`pointerType !== "touch"` ⇒ no-op), so the desktop path is untouched. Do
**not** re-implement the route guards in the touch controller — it only ever adds pinch-zoom.

**HUD bottom-left corner lane** (`FlightHud`, ae8b082 + `layoutTurnControls`): [МЕНЮ] is the true
bottom-left corner element (`h-40`), ♿ stacks tight above it (`h-80`), the mini-log sits above both
(`h-180`) — nothing may render below [МЕНЮ] (an empty mini-log gap under it read as dead space).
The bottom-centre ✕/ХОД cluster (`layoutTurnControls`) must clamp right of that lane on narrow
touch screens: the ✕ is `addChild`'d to `uiContainer` **after** [МЕНЮ], so an overlap renders
*above* the text and steals its taps (the ~430px-width regression). The lane is the constant
`BOTTOM_LEFT_LANE_W` (104px — [МЕНЮ]'s x=20 + ~65px of bold text at the largest font scale), NOT a
live `menuButtonText.width` read: PixiJS Text measurement throws in the jsdom unit harness, so a
measured lane would be permanently untested — re-derive the constant if the label or font scaling
changes. Desktop (no ✕) keeps exact centring. Below ~316px viewport width the lane clamp and the
right screen edge conflict — the lane deliberately wins (tap-stealing [МЕНЮ] is worse than ХОД
touching the edge). Guarded by `flightHudTouchControls.test.ts` (lane clamp on narrow touch
screens) and `flightHudCornerLayout.test.ts` (corner-stack order — mini-log above ♿ above
[МЕНЮ] — on both the create and reposition paths).

**Exploration encounters are two pure functions + a thin flight bridge**
(`src/systems/encounters/`, `docs/plans/20260625-exploration-encounters.md`). On system entry
`EncounterController.maybeShowEntryEncounter` rolls one (skipped while a fight is already active) —
`rollEncounter(system, seed, playerState, ENCOUNTER_CONFIG)` (`encounterGenerator.ts`) is **pure**
and **deterministic by `(systemId, seed)`**: a weighted, danger/level-scaled
derelict/anomaly/distress `Encounter` (else `null`). The roll fires **once per system entry**, so
its per-entry occurrence probability (`baseChance`..`maxChance`) is the "spice, not a flood"
flood-control; `minGap`/`stepsSinceLastEncounter` is an optional extra gap guard the entry-based
caller leaves inert (it's for a finer per-tick cadence). The system `danger` 0..1 comes from
`encounterSystemView` (`encounterFlight.ts`: Overmind-held = 1, pirate-held = 0.6, else 0); the
player projection from `encounterPlayerStateFor` (level + pirate rep). The scene then shows a
two-choice prompt; the player's pick runs `resolveEncounter(encounter, choice, rng?,
ENCOUNTER_OUTCOME_CONFIG)` (`encounterOutcome.ts`, pure, `rng` defaults to a deterministic PRNG
seeded off `encounter.id`) → `{credits?, cargo?, reputationDelta?, startCombat?, message}`. The
**non-combat** payoff is applied by `applyEncounterOutcome` through the **existing** seams only —
banking `adjustPlayerCredits`, `Inventory.addResource`, `Player.adjustReputation` (**no new economy
plumbing**); a `startCombat` trap/ambush spawns a hostile into the in-flight `CombatModule`
(`spawnEncounterAmbush`). The overlay is **transient/ephemeral — no save state**. **Tune live
rates/payoffs in `balance.ts` (`ENCOUNTER_CONFIG` / `ENCOUNTER_OUTCOME_CONFIG`)**, the single source
of truth `NpcShipManager` passes in; each mirrors the module's standalone `DEFAULT_*` default, kept
in lockstep by `encounterBalanceParity.test.ts`. Don't re-derive rates at the call site.

In-flight combat is a **tactical pause-and-plan loop**
(`docs/plans/20260713-tactical-pause-combat-rework.md` — a full supersession of the old real-time
auto-pursuit interaction model). There is still no hex combat scene: the legacy `CombatScene` (and
`SceneType.COMBAT`) stays deleted and **every** fight resolves in-flight, including the
OVERMIND-core boss and former scripted text-quest encounters. Every engagement path (aggressive NPC
closing to range, "Атаковать" on a contact, encounter ambush) funnels through the scene's
`startInFlightCombat`, which calls `CombatModule.addCombatant()` **and**
`combatPlanning.beginCombat()` — no scene transition. A fresh game starts armed:
`GameEngine.starterLoadout()` fits a weapon (`wpn_pulse`) so the player can fight immediately;
`addCombatant` on a genuinely weaponless ship surfaces a throttled HUD hint ("Нет оружия —
установите его в ангаре") instead of silently no-opping. `startInFlightCombat` opens planning
**only when `addCombatant` actually engaged** (`isCombatActive()` gate, `npcManagerDeps.ts`): a
refused engagement (weaponless / GOD-mode downed ship) must never open the planning freeze —
no fight ever becomes active to end it, so the freeze would soft-lock the sim
(review 2026-07-15, `combatPlanningLoopGuards.test.ts`).

**The loop** (`flight/combatPlanning.ts`, `CombatPlanningController` — a pure PixiJS-free state
machine over opaque target/weapon handles): combat opens → **PLANNING** freezes the whole sim —
movement, camera-follow ship sync, NPC AI, all fire timers, orbits and the calendar. The freeze
signal is `combatPlanning.isPlanning`, folded into the scene's `frozen` local, the `updateShip`
early-return, `CombatModule`'s `isPaused` dep closure (`combatModuleDeps.ts`:
`isPlanning() || isCombatPauseActive() || (!isTurnRunning() && !isExecutingPlan())` — per the
standing rule below: fold new freeze conditions into `isPaused`, never into `isFrozen()`; the
`isExecutingPlan` carve-out makes the round timer the sole owner of a confirmed window — an
`endTurn()` landing mid-window from any path (HUD abort, low-hull auto-stop) must not freeze
fire/pruning into an unendable planning/executing cycle, review 2026-07-15), **and**
`NpcShipManagerDeps.isPaused` (`npcManagerDeps.ts`: `isCombatPauseActive() || isPlanning()`) so
hostile ships hold still while the player plans. During planning the player fills
one `PlannedTurn` draft — **all fields optional; an empty draft is legal** ("hold position, hold
fire") and never blocks confirm:
- **Movement destination** — an empty-space click routes to `previewCombatCourse`
  (`combatCoursePreview.ts`), drawing the engine-scaled reachable course (`combatTrajectory.ts`);
  applied on confirm via `applyPlannedMovement` → `ShipPhysics.setPath()`. The planning click
  branch runs **before** the turn-running guard in `onPointerDown` (`routePlanningClick`) — the
  guard sits later and would otherwise swallow every planning click (real 14.5b bug).
- **Per-weapon target assignment** — `CombatPlanningUi` (`combatPlanningUi.ts`) mounts a
  bottom-centre weapon bar (one `UiButton` per fitted gun, accent-matched to its world-space range
  ring, `combatWeaponRangeOverlay.ts`) on `onEnterPlanning`, torn down on confirm and rebuilt from
  the live loadout each round. Two-step assignment (`WeaponAssignmentController`,
  `combatWeaponTargeting.ts`): arm a gun (`armWeapon`) → click an enemy sprite
  (`handleTargetClick` via the `selectCombatTarget` seam; combatants only; out-of-range is
  **flagged, not rejected**). A weapon left unassigned **holds fire** for the whole window.
- **Afterburner toggle, ≤1 consumable, ≤1 comms action** — the action row above the weapon bar
  (`toggleAction(key)`; afterburner ⛔-labelled once the engine is spent).

**Confirm is «Ход»** — Space (`flightKeyHandler`'s `combatPlanning.confirm()` branch, checked
before the `isTurnRunning` guard) or the HUD «Ход»/«Пауза» button (`onPlayPause` during PLANNING
confirms — it must never `endTurn()` mid-plan; that desync is the bug its guard exists for).
During EXECUTING the button is a **no-op** (`PlayPauseHost.isExecutingPlan` guard,
`flightTurnEnd.ts`): its legacy combat-abort `endTurn()` used to freeze `CombatModule` while
`tickExecute` kept cycling — a permanent zero-fire planning loop (review 2026-07-15,
`combatPlanningLoopGuards.test.ts`).
Confirm → **EXECUTING**: one fixed real-time window of `COMBAT_ROUND_MS` (`balance.ts`), ticked by
`combatPlanning.tickExecute(dt)` in `SpaceFlightScene.update`. **The round timer is the single
deterministic terminator** — impacts, arrivals and incoming hits resolve in real time but never
end a window early. The only early exits are terminal: player death or last hostile destroyed →
`endCombat()`; `onCombatEnded` still calls `SpaceFlightScene.endTurn()` so a resolved fight never
leaves `isTurnRunning` stuck true. When the timer elapses, PLANNING re-opens with a fresh empty
draft while ≥1 hostile remains.

**During an execute window — fire.** Planned per-weapon targeting is wired through
`combatModuleDeps.ts`: `isPlannedTargetingActive → combatPlanning.isExecuting` and
`getPlannedWeaponTarget → plan.weaponTargets.get(w)` (identity-keyed on the stable `GearCatalog`
`WeaponSpec` objects `fittedWeapons()` returns). Each gun keeps its own
`weaponFireIntervalMs(weapon)` = `max(1, cooldownTurns) × GAME_BALANCE.combatFireIntervalMs`
cadence (DPS = `damage ÷ interval`; fresh engagements still pre-charge `cooldownTurns > 1` timers
via `primeWeaponFireTimers`, `weaponCadence.test.ts`), but fires **only at its assignment** —
unassigned holds fire. A fight staged *without* `beginCombat` (bare `addCombatant`, e2e helpers)
keeps legacy auto-fire. NPC return fire stays real-time within each NPC's role-scaled reach
`npcWeaponRange(npc)` (`systems/combat/npcWeapon.ts`: TRADER 200 / PIRATE 260 / RANGER 300 /
PATROL 340, role-derived → no schema/migration).

**During an execute window — movement.** A confirmed destination flies its `setPath` course —
the confirm calls `breakOffCombatPursuit()` (the same seam `executeRouteTo` uses, wired through
`CombatPlanningHost.breakOffPursuit`) so the orbit yields while the planned course flies (without
it the pursuit re-`setPath`s its carrot every frame and the plan is cosmetic — review 2026-07-15);
the override self-clears when the course completes. With none planned,
`CombatPursuitController`'s orbit-strafe **survives as the execute-window movement
primitive** (`npcManager.updateCombat` → `updateCombatPursuit`/`steerCombatOrbit`, gated
`!frozen`) — it was deliberately NOT deleted (gitnexus 2026-07-15: CRITICAL, 19 live refs), and
all the boundary-clamp lore below still applies inside windows. **The in-range hold is a
controlled orbit/strafe, not a stop** — `steerCombatOrbit` circle-strafes the target at
`COMBAT_ORBIT_RANGE` (0.6 × weapon range), arc-movement-compatible, so the target stays inside
`WEAPON_RANGE` continuously and auto-fire always has a hit (a dead-heading "no steer" hold let
the always-cruising ship coast straight through and orbit unboundedly). The orbit carrot and its
×2 far point are capped at `SYSTEM_GEOMETRY.boundaryRadius` from the star center via a
**heading-preserving ray/circle shrink** (`clampOrbitPoint`) — deliberately NOT a radial
reprojection à la `NpcShipSprite.beginDeparture`: a radial snap swaps the carrot onto
an unrelated bearing near the edge and reds `combatOrbit.test.ts`'s orbit-hold assertions
(trap hit during `20260709-combat-feel-fixes` Task 1). The truncation keeps the exact steer
heading, so carrot and far both land on the ray's boundary-exit point — an accepted final-leg
deceleration near the wall — EXCEPT in the edge-parking window: when the clamped leg `tExit`
is ≤ `ORBIT_PARK_EPS` (= the imported `SHIP_STOP_THRESHOLD`, 8px), the coincident
`setPath([P, P])` sits inside ShipPhysics' arrival window and the strafe **parks dead at the
edge** (2nd-review sim: 0px travelled for 38s against an edge target), so only then is the
leftover distance **slid along the boundary arc** in the heading's tangential sense, turning
the freeze into an edge-following strafe. A ship at/past the boundary (entry spawn at exactly
`boundaryRadius`, momentum overshoot — `ShipPhysics` never clamps position) deliberately keeps
the **raw unclamped** point: the orbit legitimately swings past the boundary by up to
`COMBAT_ORBIT_RANGE` + momentum and self-corrects on the next pass, and the exemption also
covers an unconfigured/test star center; caging an outside ship at its current radius was tried
in review and reds `combatOrbit.test.ts`'s range-hold on a moving edge target. All locked by
`combatPursuitController.test.ts` edge3–edge5 (edge5 pins the ship-outside exemption). A player who plots a
manual route (to a planet or to flee) **overrides** the auto-pursuit via
`breakOffCombatPursuit()` — `updateCombatPursuit` yields navigation while the route flies and
re-engages only once it completes with a hostile still in range. Detail in `playtest-traps.md`.
A lethal shot calls `NpcShipManager`'s in-flight death path (domain removal via the
`onNpcDestroyed` callback); the scene also completes any bound BOUNTY. A **player** kill first
spawns a drifting wreck and defers the loot dump to the drift (see the execute-window mechanics
below); crossfire NPC-vs-NPC deaths keep the instant loot dump. Killing the OVERMIND core in
flight wins the game (`handleInFlightDeath` → `showGameOutcomeScreen(true)`).

**During an execute window — folded mechanics** (`flight/combatExecution.ts`,
`CombatExecutionController`, built via `combatExecutionDeps.ts` in the `combatModuleDeps` host
pattern; the scene ticks it only on unfrozen frames, so every entity here freezes with the fight;
all state is transient — no save/schema impact). Each consumes its pure, unit-tested module:
- **Gravity assist** (`combatGravity.ts`): per-frame `gravityAssistTotal` over the live planet
  discs adds to `ShipPhysics.currentSpeed` — a slingshot genuinely exceeds cruise `maxSpeed` and
  decays on the final leg. Planet-only by design; black holes were deferred (plan Task 1e).
- **Afterburner** (`combatAfterburner.ts`): `plan.afterburner` → `engageAfterburner` at confirm;
  extra forward displacement for exactly one window; engine wear persists per fight and resets on
  the next engagement (`pristineEngine()` on `endFight()`).
- **Missiles** (`combatMissile.ts`): a `WeaponClass.MISSILE` planned shot is intercepted
  (`CombatModuleDeps.interceptPlannedShot`, cadence still spent) → a tracked travel-time
  `MissileState` (homing = `WeaponAbility.HOMING`), advanced per frame, settled by
  `resolveMissileArrival` with an injected evasion roll; a hit lands through
  `CombatModule.landExternalShot` (the canonical scaled/shield/kill path). The smoke trail draws
  the actual flown points (`missileTrailPoints`).
- **Consumables** (`combatConsumable.ts`, persisted inventory `Inventory.removeConsumable`):
  shield restore (`applyShieldRestore` on the player pool), AoE blast (`aoeDamageTargets`, each
  hit through `landExternalShot`), weapon jam (a `WeaponJam` enforced by
  `CombatModuleDeps.isNpcFireSuppressed` in `advanceNpcTimers`). Player-facing name is
  «Тактическое устройство» — deliberately distinct from `ResourceType.ARTIFACTS` (crafting
  currency); the two never share a type or i18n key. **Known gap:** no production acquisition
  path exists yet — `Inventory.addConsumable` has zero production callers (no loot/shop/quest
  grant), so the device buttons never appear in real play; see the plan's Post-Completion.
- **Comms** (`combatComms.ts`): **bribe** pays `resolveBribe`'s tribute through the bank bus
  (`payTribute`) and every combatant departs + `CombatModule.disengage()`s; **demand-surrender**
  gates on `resolveSurrenderDemand(role, hullFraction)` — a yielder drops loot and flees, a
  refusal fights on; **call-for-help** recruits `findCallForHelpAlly` (non-hostile, non-engaged,
  within `allyProximityRadius`) who fires at the hostiles on the shared cadence.
- **VFX** (Tasks 11–14): banking roll (`combatBanking.ts` — transverse `scale.y = cos(roll)`
  squash during EXECUTING, leveled on fight end); NPC-side **shield-then-hull** damage ordering
  (`resolveShieldedDamage`, shield-less ships byte-identical) with the shield-hit flash
  (`combatShieldFlash.ts`) and per-ship floating hull/shield bars (`combatStatusBars.ts`, player
  included); weapon-type tracers (`combatWeaponVfx.ts` beam/burst/distortion via
  `onPlayerShotVfx`, replacing the flat `flashShot` for player fire); drifting wreck + staggered
  loot emissions at the wreck's live drifted position (`combatWreck.ts`,
  `NpcShipManagerDeps.deferDeathLoot`). Floating damage numbers (`DamageNumbers.ts`) predate the
  rework and stay live.

**Known deliberate deferral**: player-side **incoming** shield absorption is NOT folded — NPC fire
still lands on the player's hull directly (pinned by `combatPlanningLiveWiring.test.ts`); the
shield-restore consumable and the player's floating shield bar do read/write the pool live. NPC
shields, by contrast, drain before hull. Flip only alongside that suite's authorized evolution.

**The freeze gate halts the *whole* fight, not just new shots:** the player weapon loop
(`advancePlayerWeapons`) and the NPC loop (`advanceNpcTimers`) both sit behind `update`'s
`if (this.isFrozen()) return;` early-return **and** re-check `if (this.isFrozen()) break;` per
iteration, and in-flight projectiles/tracers freeze too (`this.hud?.update(dt)` only when
`!this.isFrozen()`). Do **not** add a second pause concept — every fire + projectile path honours
this one gate (regression: `combatPauseFreeze.test.ts`, rewired to the planning freeze). **To add
a new freeze condition, fold it into the `isPaused` dep closure (`combatModuleDeps.ts`), never
into `isFrozen()` itself** — `isFrozen()` short-circuits: when `isPaused` is wired it is the ONLY
thing checked; the `isTurnRunning` dep is ignored.

**The old reactive single-shot active-pause is superseded, not yet deleted.** `combatPause.ts`'s
reactive triggers (`onPlayerUnderAttack`/`onTargetLost`/`onRoundComplete`) are **no longer wired**
from `combatModuleDeps.ts`; its freeze-gate/overlay/Esc-routing wiring (`createCombatPauseUi`,
`flightKeyHandler`) is still mounted with 3 live refs. Removing it fully is a Post-Completion
scene-wiring cleanup — do **not** re-wire the reactive freeze-on-first-hit → one-shot flow.

**Headless letsplay drives the same loop** — `src/tests/playtest/letsplay/planningDriver.ts`
(`confirmPlanningIfOpen`: pick target → assign every fitted gun → optional steer → confirm; no-op
outside PLANNING), wired into `PlayerAgent` heads and the live autopilot. `onAttackNpc`/
`e2eEngageCombat` remain combat-*entry* seams. Key wiring tests:
`combatPlanningLiveWiring.test.ts` (planned fire flip, click order),
`combatExecutionLive.test.ts` (each folded mechanic live), `combatPauseFreezesLiveFight.test.ts`
(freeze + round cycling), plus the E2E planning click loop in `playtest-regression.spec.ts`.

**Single sub-day clock:** the fractional `SpaceFlightScene.currentDay` getter
(`gameDays + distanceTraveled/DISTANCE_PER_DAY + waitDayAccum`) is the **one** source for
sub-day time — it feeds both planet orbits (the `getOrbitalDay` dep) **and** the HUD date
read-out, pushed in via `FlightHud.setDayProvider(() => this.currentDay)`.
`FlightHud.updateDayCounter` renders it with `formatGameDate` (clock-free calendar date only — the
HH:MM read-out was removed as HUD clutter, playtest bug 2026-07-06/07 #3); with no provider wired
it falls back to whole-day `galaxy.gameDays`. The provider seam stays wired so a whole-day boundary
crossed mid-turn via distance/wait accrual still shows up immediately. Do **not** re-derive the
fractional day at a call site or render the HUD date straight from `gameDays` (that was the
frozen-date bug).
The day has **three** sub-day sources, all summed into `currentDay`: move-distance, the wait-turn
accumulator, **and a real-time-combat path** so planets keep orbiting during a stationary fight.
A fight freezes the calendar (and the move/wait paths are gated off while it runs), so a still
fight would otherwise stall the orbits even though bullets fly in real time. The pure
`combatOrbitalDayIncrement({inCombat, paused, dt, timeScale})` (`flight/combatOrbitClock.ts`,
sharing `MS_PER_ORBITAL_DAY` with `MS_PER_WAIT_DAY`) advances the orbital day **only** during the
real-time portion of the fight (`inCombat && !paused`) and returns 0 otherwise; it accrues into the
existing `waitDayAccum` (free during combat — the wait path is gated off there) from the
*stationary* combat branch only. A **moving** combat orbit (`steerCombatOrbit` keeps the ship
cruising) instead crosses the move-distance day boundary: while `combatModule.isActive` that loop
routes each day into `waitDayAccum` too — **never** `advanceGalaxyDay` — so the real calendar / NPC
sim stays frozen during the whole fight (else it would tick ~1 day/s and `refresh()` could despawn
the live target) while planets keep orbiting. The combatOrbitClock path is gated to `!isMoving`, so
the stationary and moving combat day-sources never double-count. A combat freeze — PLANNING
(`combatPlanning.isPlanning`, via the `updateShip` early-return) or the legacy
`combatPause.paused` — holds it at 0, freezing
the orbits along with movement, NPC AI and fire. Position stays a pure function of `orbitalDay` (no
per-planet motion state); only the day source gains a combat path — no data/schema/save impact.

**Orbit-visual floor: planets must visibly orbit while flying, not just while waiting**
(playtest bug 2026-07-09, fixed directly without a plan file — "planets don't orbit while moving, only
stationary + «Ход»"). Root cause: a moving turn's day-rate is `distanceTraveled / DISTANCE_PER_DAY`
at the ship's actual cruise speed (0.08 px/ms starter engine .. 0.29 px/ms top-tier) — 5-10x slower
than the wait-turn's fixed `MS_PER_WAIT_DAY` (1 day/1000ms, "день = секунда"), so planets crept
almost imperceptibly during flight next to a visibly-fast spin while waiting. `visualOrbitBoost`
tops up **only** the value `getOrbitalDay()` hands to `PlanetManager` (`currentDay +
visualOrbitBoost`) whenever `shipPhysics.isMoving`, via `orbitBump` (the thin
`combatOrbitalDayIncrement` wrapper in `combatOrbitClock.ts` both the moving top-up and the
stationary-combat path share — kept there for the SpaceFlightScene line guard). The top-up is
**additive** at the full 1-day/1000ms wait rate — deliberately NOT a shortfall-only floor: a
floor (`max(0, waitRate·dt − distanceDayDelta)`) was tried in review and reds the deterministic
letsplay campaign gate (`longGameCompetence` (c)), because the boosted day moves the planets'
**live geometry** (`screenX/screenY`) that landing/lead/click reads consume, and slowing it
reroutes a whole 200-day agent trajectory. Known accepted consequences: a fast engine's visual
orbit rate slightly exceeds the wait rate (up to ~1.6×), a moving combat orbit stacks with the
whole-day `waitDayAccum` routing, and the boost accrues ~1 day per real second of flight, so the
`endTurn()` settle to 0 (same as `waitDayAccum`/`distanceTraveled`, "orbits settle to gameDays")
is a **visible backward snap after a long flight**. Changing any of this is a game-feel/design
decision — re-run the letsplay campaign gates, don't just eyeball it. The boost never feeds
`gameDays`, the HUD date, or any economy/quest/NPC-sim pacing (those still use the untouched
`currentDay`), so a trip still takes exactly as many in-game days as its distance/speed
dictates. Do **not** fold this into `currentDay` itself — that would speed up the real calendar
during travel and ripple into day-calibrated systems (quest deadlines, the Overmind arc's
`campaignPeakPower` pacing). The mid-flight `reaim` loop (`updateRouteToTarget`, 30px drift) is
what keeps a route to an orbiting planet converging under the faster visual motion.

**Live in-flight position persists across a reload.** Free flight otherwise only autosaves at
discrete turn-ends (and a combat orbit moves the ship with **no** turn-end), so a reload used to
edge-spawn at the system entry. The scene calls `recordAndMaybeAutosaveFlight` (`flight/flightTurnEnd.ts`)
every frame: it pushes the live ship position into `GameEngine.recordLiveFlightPos(x,y)` (which
`saveGame` folds into the system-tagged `flightShipPos` **only** while SPACE_FLIGHT is active) and
throttles a periodic `flushFlightAutosave` (~5 s, only when the ship actually moved). A page-hide
flush (`beforeunload` + `visibilitychange`→hidden, registered once at engine init) saves on
tab-close/backgrounding. `flushFlightAutosave` **no-ops outside SPACE_FLIGHT**, so terminal/menu
scenes are never clobbered with a stale flight capture; `performWarp` clears `liveFlightShipPos`
when the ship leaves the system so a capture can't leak into a cross-system spawn. No schema change
(`flightShipPos` already persists). Detail in `playtest-traps.md`.

**Twinkle stars, nebula clouds, the `AsteroidBelt` flyby-comet coma, and asteroid rocks are baked
Canvas2D sprites, not runtime `Graphics` shapes or per-frame `BlurFilter`s** (`gradientTexture.ts`,
`docs/plans/20260708-space-visual-cleanup.md`). `SpaceBackgroundLayer` and `AsteroidBelt` mount cheap
tinted `Sprite`s of textures baked once and cached in `gradientTexture.ts`: `starPointTexture(hero)`
for background twinkle stars (replaced a stroked 4-point diffraction-spike `Graphics` cross that read
as a flat vector plus-sign), `nebulaCloudTexture(seed)` for nebula clouds (replaced 4 perfectly
concentric `softGlowTexture` rings that stacked into one muddy undifferentiated blob — now a single
wispy, internally-structured cloud per seed), and `cometHeadTexture()` for the `AsteroidBelt` flyby
comet's coma (replaced reusing the generic `softGlowTexture` blob with a sharp bright nucleus +
asymmetric coma so the head reads as a coherent object). `rockTexture(seed)` (pre-existing) was also
redesigned for more silhouette/crater variety plus a rim-light pass. Every factory follows the same
contract: bake once via `document.createElement("canvas")` + `getContext("2d")`, cache by
variant/seed, return `null` with no 2D context (jsdom/unit tests) so callers fall back to a
`Graphics` approximation instead of crashing. Do **not** reintroduce a stroked cross-spike star, a
stacked-concentric-ring nebula/comet, or a per-frame `BlurFilter` for any of these — bake a new
variant into `gradientTexture.ts` instead. **Known gap:** `SpaceBackgroundLayer`'s separate ambient
"shooting star" streak (`CometStreak`/`spawnComet()` — ~15-40s cadence, ephemeral, ranging across the
screen) is a *different* comet visual from `AsteroidBelt`'s in-system flyby comet and was **not**
in this plan's scope; it still draws its tail/nucleus as raw `Graphics.poly()`/`circle()` fills. If
it turns out to be what a future "muddy comet" complaint is about, it needs its own
`gradientTexture.ts` bake — don't assume `cometHeadTexture()` already covers it.

Rules: a module never imports another — the scene mediates via callbacks + `*Deps` bundles;
each `destroy()` must leave `gameLayer.children.length === 0`; dispose `BlurFilter`s in
`destroy()`. **Line-count guard: `SpaceFlightScene.ts` < 1900 lines**
(`src/tests/flight/moduleContracts.test.ts`).

**One flight-path derivation for plotting AND execution:** both `planRouteTo` and
`executeRouteTo` derive their polyline from the single `computeFlightPath()` in
`src/utils/flightGeometry.ts` (star-avoidance bow + landing spiral-in; extracted from the scene
for the line-count guard). Never re-derive a route path inside `SpaceFlightScene` — a second
derivation forks the drawn route from the flown path (the "drawn == flown" contract,
`routeMatchesPath.test.ts`).

**Ship movement is momentum / arc-only (no rotate-in-place).** `ShipPhysics.update`
(`src/systems/ShipPhysics.ts`) always cruises forward along `shipAngle` and steers toward
the target by turning at a bounded `rotationSpeed` **only while moving** — it never slows or
pivots because the target is off-axis (a target behind is reached by arcing around). This
gives a minimum turn radius of `currentSpeed / rotationSpeed` (≈19px at cruise); only the
final leg decelerates to a stop. Do NOT re-add alignment-gated speed (the old stop-and-pivot
model). Detail + the no-regression contract in `playtest-traps.md`.

**NPC clickability invariant: `NpcShipSprite.assertClickable()`.** A live (non-departing/gone)
ship is always `eventMode="static"` with a finite hit-circle ≥ 28 world px;
`setClickHandler`/`updateHitArea`/`restoreInteractivity` all route through it (never set
`eventMode`/`hitArea` inline), and a NaN/0 camera zoom is ignored so a transient bad transform
can't collapse the circle and leave a ship mouse-dead in combat. Detail in `playtest-traps.md`.

**The planet hover tooltip surfaces the landing-denial reason** (so an un-landable planet reads
as occupied **before** a wasted trip). `PlanetManager` computes `landingDenial(planet)` in the
hover handler (the same verdict the land-attempt uses) and threads the reason through
`PlanetManagerDeps` → `FlightHud` → `buildPlanetTooltipLines` (`src/utils/planetTooltip.ts`),
which appends a red line. The wording comes from the **shared** `landingDenialMessage(reason)`
(`systems/galaxy/landingAccess.ts`) — single source, so the hover and land-attempt show the
*same* text (Overmind / pirate-rep). The line is additive and absent when landing is allowed;
presentation-only, no domain/schema/save change. **When a denial is present the builder also
names the live occupier (Овермайнд / Пираты) on the controlling-faction + relation lines** —
capture is tracked **per-system on the galaxy**, not on `planet.capturedBy` (never written in
production), so without this the controller line would name the stale benign system owner and
contradict the red denial line.

**A fleeing (`BREAK_OFF`) NPC is bounded at the system edge via the departure path, never left to
run unbounded** (`20260708-font-scale-and-faction-bugs`, Bug 3). `NpcShipSprite.maneuverToward`
used to add `cos/sin(heading) * speed * deltaTime` straight to `this.x/this.y` with no radius check
at all whenever `decideManeuver` returned `BREAK_OFF` — a ship fleeing a low-hull or out-matched
fight could run to any distance and stay in the live ship list forever, unreachable (the player is
only *soft*-bounded by `CameraController.clampPan()`, which clamps the camera focus, not any ship's
real position). The fix: when `BREAK_OFF` fires, `maneuverToward` checks whether this frame's step
would carry the ship's distance from `bounds.cx/cy` past `bounds.boundary` and, if so, calls the
existing `beginDeparture()` (the same scripted cross-system departure path, reusing its outward-radial
target math) instead of applying the raw unbounded move. Once `departing = true`, the aggressive-pursuit
branch's `!this.departing` guard falls through to the general waypoint-following code, which carries
the ship the rest of the way to the boundary and sets `gone = true` on arrival — `NpcShipManager`'s
`isGone()` cleanup and `CombatModule`'s `destroyed` sweep handle it generically, with no new despawn
path needed. Do **not** reintroduce a second boundary concept for flee movement — route any future
flee/maneuver change through `beginDeparture()`'s existing boundary, not a fresh radius check.

Historical playtest bugs and detailed conventions (re-entry spawn, NPC spawn states, route
dashing, sun clearance, pause-finishes-day, font-scale ship pos, NPC purposeful behavior,
ship movement model, NPC clickability invariant, smoothed auto-follow/chase steering, combat
range-keeping orbit / break-off / live-position autosave) live in
`playtest-traps.md` — read it before touching those areas.
