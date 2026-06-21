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
top open surface in priority order — combat pause → contact panel → quest journal → planet info —
else cancels a planned route; Space runs the planned turn — the keyboard equivalent of the
confirming second click, suppressed while a turn/combat pause is active or a contact/planet-info
panel is open; j/i toggle journal/inventory. `SpaceFlightScene.onKeyDown` is a thin delegate that
builds `ctx` from live scene members; the extraction keeps the controller under the 1900-line
guard. Unit-tested standalone in `flightKeyHandler.test.ts`).

In-flight combat (real-time, with active pause): an aggressive NPC closing inside `WEAPON_RANGE`,
or the player clicking "Атаковать" on a contact, calls `CombatModule.addCombatant()` — no scene
transition (the hex `CombatScene` survives only for scripted text-quest encounters and the
OVERMIND-core boss fight). Each engaged NPC fires at the player every
`GAME_BALANCE.combatFireIntervalMs`, and the player's auto-selected weapon fires at the
selected target on the same cadence (`CombatModule.update` drives the timers). A lethal shot
calls `NpcShipManager`'s in-flight death path (loot drop + domain removal) via the
`onNpcDestroyed` callback; the scene also completes any bound BOUNTY.

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

Rules: a module never imports another — the scene mediates via callbacks + `*Deps` bundles;
each `destroy()` must leave `gameLayer.children.length === 0`; dispose `BlurFilter`s in
`destroy()`. **Line-count guard: `SpaceFlightScene.ts` < 1900 lines**
(`src/tests/flight/moduleContracts.test.ts`).

Historical playtest bugs and detailed conventions (re-entry spawn, NPC spawn states, route
dashing, sun clearance, pause-finishes-day, font-scale ship pos, NPC purposeful behavior)
live in `playtest-traps.md` — read it before touching those areas.
