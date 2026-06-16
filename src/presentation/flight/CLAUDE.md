# Flight Module Conventions

`SpaceFlightScene` is a thin Controller; flight logic lives in `src/presentation/flight/`
modules implementing `FlightModule` (`initialize()` / `update(dt, bgElapsed)` / `destroy()`).

Modules: SpaceBackgroundLayer, StarRenderer, AsteroidBelt, OrbitRenderer, PlayerShipRenderer,
NpcShipManager, PlanetManager, CombatModule, FlightHud. Helpers (not FlightModules):
RouteRenderer, WarpEffectRenderer, CameraController, QuestCompletion, CombatHud, DamageNumbers.

In-flight combat (real-time): an aggressive NPC closing inside `WEAPON_RANGE`, or the player
clicking "Атаковать" on a contact, calls `CombatModule.addCombatant()` — the ship keeps moving
(no freeze, no scene transition). Each engaged NPC fires at the player every
`GAME_BALANCE.combatFireIntervalMs`, and the player's auto-selected weapon fires at the
selected target on the same cadence (`CombatModule.update` drives the timers). A lethal shot
calls `NpcShipManager`'s in-flight death path (loot drop + domain removal) via the
`onNpcDestroyed` callback; the scene also completes any bound BOUNTY. The hex `CombatScene`
survives only for scripted text-quest encounters and the OVERMIND-core boss fight.

Rules: a module never imports another — the scene mediates via callbacks + `*Deps` bundles;
each `destroy()` must leave `gameLayer.children.length === 0`; dispose `BlurFilter`s in
`destroy()`. **Line-count guard: `SpaceFlightScene.ts` < 1900 lines**
(`src/tests/flight/moduleContracts.test.ts`).

Historical playtest bugs and detailed conventions (re-entry spawn, NPC spawn states, route
dashing, sun clearance, pause-finishes-day, font-scale ship pos, NPC purposeful behavior)
live in `playtest-traps.md` — read it before touching those areas.
