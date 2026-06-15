# Flight Module Conventions

`SpaceFlightScene` is a thin Controller; flight logic lives in `src/presentation/flight/`
modules implementing `FlightModule` (`initialize()` / `update(dt, bgElapsed)` / `destroy()`).

Modules: SpaceBackgroundLayer, StarRenderer, AsteroidBelt, OrbitRenderer, PlayerShipRenderer,
NpcShipManager, PlanetManager, CombatModule, FlightHud. Helpers (not FlightModules):
RouteRenderer, WarpEffectRenderer, CameraController, QuestCompletion, CombatHud, DamageNumbers.

In-flight combat: an aggressive NPC closing inside `WEAPON_RANGE` triggers
`CombatModule.startCombat()`, which freezes player movement and opens the weapon HUD; a round
deals simultaneous damage with floating numbers. A lethal round calls `NpcShipManager`'s
in-flight death path (loot drop + domain removal); the scene also completes any bound BOUNTY.
The hex `CombatScene` survives only for scripted text-quest encounters and player-initiated
attacks via "Атаковать".

Rules: a module never imports another — the scene mediates via callbacks + `*Deps` bundles;
each `destroy()` must leave `gameLayer.children.length === 0`; dispose `BlurFilter`s in
`destroy()`. **Line-count guard: `SpaceFlightScene.ts` < 1900 lines**
(`src/tests/flight/moduleContracts.test.ts`).

Historical playtest bugs and detailed conventions (re-entry spawn, NPC spawn states, route
dashing, sun clearance, pause-finishes-day, font-scale ship pos, NPC purposeful behavior)
live in `playtest-traps.md` — read it before touching those areas.
