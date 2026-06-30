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
combatPause (pure active-pause state machine — PixiJS-free, unit-tested standalone),
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
`isBlockingModalOpen` guard); j/i toggle journal/inventory. `SpaceFlightScene.onKeyDown` is a thin delegate that
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

**Exploration encounters are two pure functions + a thin flight bridge**
(`src/systems/encounters/`, `docs/plans/20260625-exploration-encounters.md`). On system entry
`NpcShipManager.maybeShowEntryEncounter` rolls one (skipped while a fight is already active) —
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

In-flight combat is **real-time only** — there is no hex combat scene. The legacy `CombatScene`
(and `SceneType.COMBAT`) was deleted; **every** fight resolves in-flight, including the
OVERMIND-core boss and former scripted text-quest encounters. An aggressive NPC closing inside
`WEAPON_RANGE`, or the player clicking "Атаковать" on a contact, calls `CombatModule.addCombatant()`
— no scene transition. A fresh game starts armed: `GameEngine.starterLoadout()` fits a weapon
(`wpn_pulse`) so the player can fight immediately; `addCombatant` on a genuinely weaponless ship
surfaces a throttled HUD hint ("Нет оружия — установите его в ангаре") instead of silently
no-opping. Once engaged, both sides **auto-pursue** to hold `WEAPON_RANGE`: the player ship
auto-tracks the selected target and each aggressive NPC closes on the player (`NpcShipManager`
pursuit, gated on `isInCombat()`, frozen by the active pause). **The in-range hold is a
controlled orbit/strafe, not a stop** — `steerCombatOrbit` circle-strafes the target at
`COMBAT_ORBIT_RANGE` (0.6 × weapon range), arc-movement-compatible, so the target stays inside
`WEAPON_RANGE` continuously and auto-fire always has a hit (a dead-heading "no steer" hold let
the always-cruising ship coast straight through and orbit unboundedly). A player who plots a
manual route (to a planet or to flee) **overrides** the auto-pursuit via
`breakOffCombatPursuit()` — `updateCombatPursuit` yields navigation while the route flies and
re-engages only once it completes with a hostile still in range. Detail in `playtest-traps.md`.
**Fire is per-weapon, not a flat
cadence:** the player fires **every** fitted weapon (`advancePlayerWeapons`), each on its own
`weaponFireIntervalMs(weapon)` = `max(1, cooldownTurns) × GAME_BALANCE.combatFireIntervalMs` timer
— so a slow `cooldownTurns:3` beam fires ~⅓ as often as a `cooldownTurns:1` pulse, making cadence a
real tradeoff against damage (DPS = `damage ÷ interval`). Each engaged NPC fires from within **its
own role-scaled reach** `npcWeaponRange(npc)` (`systems/combat/npcWeapon.ts`: TRADER 200 / PIRATE
260 / RANGER 300 / PATROL 340, role-derived → **no schema/migration**), not the legacy flat
`GAME_BALANCE.weaponRange` 240 — so a long-range player weapon (railgun 360) can no longer trivially
out-range *every* foe (a PATROL's 340 keeps the edge bounded). `CombatModule.update` drives all
these timers. A lethal shot calls
`NpcShipManager`'s in-flight death path (loot drop + domain removal) via the `onNpcDestroyed`
callback; the scene also completes any bound BOUNTY. Killing the OVERMIND core in flight wins the
game (`handleInFlightDeath` → `showGameOutcomeScreen(true)`).

**Fire is gated on both the active pause AND the running turn.** `CombatModule.update` ticks its
fire timers whenever it is **not frozen** (`isFrozen()` = `isPaused()` = `combatPause.paused ||
!isTurnRunning`). Both player weapons and NPC return fire halt when the overlay is up **or** when
the player ends the turn via Space — pressing Space is a true combat pause: no shots land on either
side until the player starts the next turn. Ship movement and the calendar are also turn-gated (the
full Space-Rangers model). When the module's
`endCombat` fires (last combatant gone), `onCombatEnded` calls `SpaceFlightScene.endTurn()` so a
resolved fight never leaves `isTurnRunning` stuck true.

**Active pause (Space-Rangers/FTL style):** the fight is real-time *until* a shot lands on the
player. `CombatModule.fireNpcShot` raises `onPlayerUnderAttack`; the `CombatPauseController`
debounces it to the first hit per engagement and *freezes the turn* — `SpaceFlightScene.updateShip`
early-returns and `isTurnRunning` is gated on `!combatPause.paused`, so movement, the calendar,
NPC AI and fire timers all halt. **The freeze gate (`CombatModule.isFrozen()` =
`isPaused()` = `combatPause.paused || !isTurnRunning`) halts the *whole* fight, not just new NPC shots:** the
**player multi-weapon loop** (`advancePlayerWeapons`) and the **NPC loop** (`advanceNpcTimers`)
both sit behind `update`'s `if (this.isFrozen()) return;` early-return **and** re-check
`if (this.isFrozen()) break;` per iteration (so a shot that raises the pause mid-frame can't let a
later weapon/NPC volley through on the pausing frame), and **in-flight projectiles/tracers freeze**
too — `update` advances the HUD tracers (`this.hud?.update(dt)`) only when `!this.isFrozen()`, so a
shot launched the instant before the pause stops mid-flight (no travel, no impact) and resumes only
on unpause. Do **not** add a second pause concept — every fire + projectile path honours this one
gate (regression: `combatPauseFreeze.test.ts`). **To add a new freeze condition, fold it into
the `isPaused` dep closure in `SpaceFlightScene` (line ~205), never into `isFrozen()` itself** —
`isFrozen()` short-circuits: when `isPaused` is wired it is the ONLY thing checked; `isTurnRunning`
dep is ignored. The `combatModule.isActive` guard is redundant in `isPaused` because `update()`
early-returns on `!isActive` before any fire code runs anyway. The `CombatPauseOverlay` lets the player pick a target + weapon;
**Огонь!** fires one shot (`CombatModule.confirmAttack`) and resumes, **Продолжить** (or `Escape`)
resumes without firing. The controller also **re-pauses when the selected auto-fire target is
lost** — killed or out of range *while a survivor remains*: `CombatModule.removeCombatant` raises
`onTargetLost`, wired to `CombatPauseController.loseTarget` (which adopts the lost ship as the
current selection, then re-pauses via `notifyTargetLost`). Losing the *last* combatant ends
the fight (`endCombat` → `onCombatEnded` → `controller.reset` re-arms the debounce) instead of
pausing onto an empty overlay. While paused, `onKeyDown` suppresses flight shortcuts so the player
can't escape the deliberate choice.

**Single sub-day clock:** the fractional `SpaceFlightScene.currentDay` getter
(`gameDays + distanceTraveled/DISTANCE_PER_DAY + waitDayAccum`) is the **one** source for
sub-day time — it feeds both planet orbits (the `getOrbitalDay` dep) **and** the HUD date
read-out, pushed in via `FlightHud.setDayProvider(() => this.currentDay)`.
`FlightHud.updateDayCounter` renders it with `formatGameTimestamp` (date + HH:MM clock); with no
provider wired it falls back to whole-day `galaxy.gameDays`. Do **not** re-derive the fractional
day at a call site or render the HUD date straight from `gameDays` (that was the frozen-date bug).
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
the stationary and moving combat day-sources never double-count. The **active pause**
(`combatPause.paused`) holds it at 0, freezing
the orbits along with movement, NPC AI and fire. Position stays a pure function of `orbitalDay` (no
per-planet motion state); only the day source gains a combat path — no data/schema/save impact.

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

Rules: a module never imports another — the scene mediates via callbacks + `*Deps` bundles;
each `destroy()` must leave `gameLayer.children.length === 0`; dispose `BlurFilter`s in
`destroy()`. **Line-count guard: `SpaceFlightScene.ts` < 1900 lines**
(`src/tests/flight/moduleContracts.test.ts`).

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

Historical playtest bugs and detailed conventions (re-entry spawn, NPC spawn states, route
dashing, sun clearance, pause-finishes-day, font-scale ship pos, NPC purposeful behavior,
ship movement model, NPC clickability invariant, smoothed auto-follow/chase steering, combat
range-keeping orbit / break-off / live-position autosave) live in
`playtest-traps.md` — read it before touching those areas.
