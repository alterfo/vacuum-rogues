# Flight Module Conventions

`SpaceFlightScene` is a thin Controller; flight logic lives in `src/presentation/flight/`
modules implementing `FlightModule` (`initialize()` / `update(dt, bgElapsed)` / `destroy()`).

Modules: SpaceBackgroundLayer, StarRenderer, AsteroidBelt, OrbitRenderer, PlayerShipRenderer,
NpcShipManager, PlanetManager, CombatModule, FlightHud. Helpers (not FlightModules):
RouteRenderer, WarpEffectRenderer, CameraController, QuestCompletion, CombatHud, DamageNumbers,
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

In-flight combat is **real-time only** — there is no hex combat scene. The legacy `CombatScene`
(and `SceneType.COMBAT`) was deleted; **every** fight resolves in-flight, including the
OVERMIND-core boss and former scripted text-quest encounters. An aggressive NPC closing inside
`WEAPON_RANGE`, or the player clicking "Атаковать" on a contact, calls `CombatModule.addCombatant()`
— no scene transition. A fresh game starts armed: `GameEngine.starterLoadout()` fits a weapon
(`wpn_pulse`) so the player can fight immediately; `addCombatant` on a genuinely weaponless ship
surfaces a throttled HUD hint ("Нет оружия — установите его в ангаре") instead of silently
no-opping. Once engaged, both sides **auto-pursue** to hold `WEAPON_RANGE`: the player ship
auto-tracks the selected target and each aggressive NPC closes on the player (`NpcShipManager`
pursuit, gated on `isInCombat()`, frozen by the active pause). Each engaged NPC fires at the player
every `GAME_BALANCE.combatFireIntervalMs`, and the player's auto-selected weapon fires at the
selected target on the same cadence (`CombatModule.update` drives the timers). A lethal shot calls
`NpcShipManager`'s in-flight death path (loot drop + domain removal) via the `onNpcDestroyed`
callback; the scene also completes any bound BOUNTY. Killing the OVERMIND core in flight wins the
game (`handleInFlightDeath` → `showGameOutcomeScreen(true)`).

**Fire is real-time, gated on the active pause — not the route-turn.** `CombatModule.update` ticks
its fire timers whenever it is **not paused** (its `isPaused` dep = `combatPause.paused`), so once
combat is engaged both the player's weapon and NPC return fire keep firing whether or not a
route-"Ход" is running — that decoupling is what makes NPCs shoot back. Ship movement and the
calendar stay turn-gated (the navigation half of the Space-Rangers model). When the module's
`endCombat` fires (last combatant gone), `onCombatEnded` calls `SpaceFlightScene.endTurn()` so a
resolved fight never leaves `isTurnRunning` stuck true.

**Active pause (Space-Rangers/FTL style):** the fight is real-time *until* a shot lands on the
player. `CombatModule.fireNpcShot` raises `onPlayerUnderAttack`; the `CombatPauseController`
debounces it to the first hit per engagement and *freezes the turn* — `SpaceFlightScene.updateShip`
early-returns and `isTurnRunning` is gated on `!combatPause.paused`, so movement, the calendar,
NPC AI and fire timers all halt. The `CombatPauseOverlay` lets the player pick a target + weapon;
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

Historical playtest bugs and detailed conventions (re-entry spawn, NPC spawn states, route
dashing, sun clearance, pause-finishes-day, font-scale ship pos, NPC purposeful behavior,
ship movement model, NPC clickability invariant) live in `playtest-traps.md` — read it before
touching those areas.
