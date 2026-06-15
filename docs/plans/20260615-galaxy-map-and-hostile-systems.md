---
# Galaxy Map & Hostile Systems Overhaul

## Overview

Three interrelated improvements to the galaxy map and living-galaxy simulation:

1. **Galaxy graph connectivity** — fix the warp-graph generator so isolated "?" clusters cannot exist; add a BFS connectivity guarantee with a spanning-tree merge pass.
2. **Star map purchase on planets** — new "Карты" service on habitable planets: buy N-hop reveal (1 hop = adjacent systems) for credits. Resolves quests pointing at "?" unknowns.
3. **Quest filter: known systems only** — QuestGenerator must not assign delivery/bounty targets to unexplored (`!system.explored`) systems.
4. **Hostile systems: real NPC garrison** — captured (red) systems always hold 5–10 hostile ships (Overmind or pirate). On player entry the garrison immediately attacks. Friendly NPCs transiting the system fight back. Entry is always possible (no warp block); the risk is the fight.
5. **Real capture events** — Overmind/pirate NPC fleets travel to neutral/friendly systems and fight to capture them. If the garrison fleet wins (all defenders dead), the system is captured. Player or passing friendly NPCs can intercept mid-battle.
6. **Liberation campaigns** — every ~50 days a news event announces "Рейнджеры собираются освободить систему X — сбор в Y через 30 дней" with an absolute date. Ranger NPCs travel to the staging system and then assault together. Player can join early. If all hostile garrison ships are destroyed and no hostile NPCs remain for 3 days, the system is liberated; attacker NPCs share loot.
7. **Space loot drops** — destroyed NPC ships in the player's system spawn floating loot items (equipment modules or Overmind artifacts). Loot despawns after 60 s.
8. **Gravity tractor module** — new equipment module `GravTractor` (tiers 1–3) enables auto-pickup of nearby loot when equipped. Pickup respects cargo capacity; full cargo logs a warning and skips.

## Context

**Key files:**
- `src/systems/GalaxySimulator.ts` — warp-connection generation (3-nearest-neighbour, no connectivity check)
- `src/domain/Galaxy.ts` — `addOvermindSystem`, `tryLiberate`, `revealSystemAndNeighbors`, `isHostileSystem`
- `src/domain/StarSystem.ts` — `explored: boolean`, warp connections
- `src/systems/npc/NpcSimulator.ts` — `assembleConvoys`, `tick`, `spawnPirateInSystem`; currently only PATROL convoys liberate, no capture convoys exist
- `src/presentation/StarMapScene.ts` — renders red/orange hostile dots and "?" unknowns
- `src/systems/quests/QuestGenerator.ts` — picks target systems without checking `explored`
- `src/presentation/PlanetScene.ts` — planet service buttons (pattern for new "Карты" service)
- `src/presentation/flight/NpcShipManager.ts` — manages NPC sprites in flight scene
- `src/config/balance.ts` — game balance constants
- `src/types/index.ts` — shared type definitions

**Related:** NPC living-galaxy slices 1–3 + grand system (complete), `arrivalDwellCountdown` fix (2026-06-15 session).

## Development Approach

- **TDD**: write a failing test first, implement until green, no skips.
- Complete tasks in order — later tasks depend on domain changes from earlier ones.
- Each task's tests must pass before the next task starts.
- `src/types/index.ts` or `src/domain/*.ts` changes → update `src/validation/schemas.ts` and check `MigrationPipeline`.
- Never modify or weaken existing passing tests.

## Implementation Steps

### Task 1: Fix galaxy warp-graph connectivity
**Files:**
- Modify: `src/systems/GalaxySimulator.ts`
- Create: `src/tests/galaxy/galaxyConnectivity.test.ts`

- [x] Write a failing test: generate a 10-system galaxy with `GalaxySimulator.generate()`, run BFS from system[0], assert all systems reachable.
- [x] After 3-nearest-neighbour pass, add a spanning-tree merge: find all disconnected components via BFS, connect smallest component to largest via cheapest cross-component warp link.
- [x] Ensure the test passes for seeds that previously produced isolated clusters.
- [x] Run full test suite — must pass.

### Task 2: Quest generator: only assign targets to explored systems
**Files:**
- Modify: `src/systems/quests/QuestGenerator.ts`
- Create: `src/tests/quests/questKnownSystems.test.ts`

- [x] Write a failing test: build a galaxy where half the systems are `explored = false`; call `QuestGenerator.generate()` with a planet in an explored system; assert no generated quest has a `targetSystemId` whose system has `explored = false`.
- [x] In `QuestGenerator`, wherever candidate target systems are gathered (delivery, bounty, escort targets), filter out systems where `!system.explored`.
- [x] Ensure DEFENSE quests (which target hostile neighbours) also respect the explored filter — a hostile system must be explored (adjacent to player's visited systems) before it can appear as a defense target.
- [x] Run full test suite — must pass. (Task 2 tests green; suite passes except 1 pre-existing, unrelated failure in `questBountyNpcAssignment.test.ts` from in-progress bounty-fallback work in the dirty tree — verified failing with my change stashed.)

### Task 3: Star map purchase service on planets
**Files:**
- Modify: `src/presentation/PlanetScene.ts`
- Modify: `src/domain/Galaxy.ts` (add `revealSystemsWithinHops`)
- Modify: `src/validation/schemas.ts` (no new fields needed; verify)
- Create: `src/tests/galaxy/revealHops.test.ts`

- [x] Write a failing test for `Galaxy.revealSystemsWithinHops(systemId, hops)`: starting from `sys_a` in a 5-system chain, calling with hops=2 should mark the 2 nearest systems `explored = true` and leave systems beyond 2 hops unchanged.
- [x] Implement `Galaxy.revealSystemsWithinHops(systemId: string, hops: number): number` — BFS up to `hops` levels, marks each discovered system `explored = true`, `fogOfWar = false`; returns count of newly revealed systems.
- [x] Add "Карты" button to `PlanetScene` habitable-planet service list (icon `🗺`, label `Карты`).
- [x] Implement `openStarMap()` handler: show inline modal with tier selector (1 hop = 500 cr, 2 hops = 1500 cr, 3 hops = 4000 cr). On confirm, call `galaxy.revealSystemsWithinHops`, deduct credits, show "Открыто N систем".
- [x] If player cannot afford any tier, show a disabled "Нет кредитов" state.
- [x] Disable the "Карты" button (greyed) if the system is hostile (consistent with other service gating).
- [x] Run full test suite — must pass. (revealHops tests green; suite passes except 1 pre-existing, unrelated failure in `questBountyNpcAssignment.test.ts` from in-progress bounty-fallback work in the dirty tree — file was modified at session start, untouched by this task.)

### Task 4: Persistent hostile garrison in captured systems
**Files:**
- Modify: `src/systems/npc/NpcSimulator.ts`
- Modify: `src/domain/Galaxy.ts` (add `garrisonSystems` tracking or use existing hostileSystems)
- Create: `src/tests/npc/hostileGarrison.test.ts`

- [x] Write a failing test: mark `sys_a` as an Overmind system; call `NpcSimulator.ensureGarrison(galaxy, rng)`; assert `npcsPresentInSystem(galaxy, "sys_a")` returns 5–10 hostile-role ships.
- [x] Add `ensureGarrison(galaxy: Galaxy, rng: SeededRNG): void` to `NpcSimulator`: for each `overmindSystem` and `pirateSystem`, if the count of hostile NPC ships present (`faction === OVERMIND or role === PIRATE`, `currentSystemId === systemId`, present = not DEAD/TRAVELING) is below `GARRISON_MIN = 5`, spawn up to a random `[GARRISON_MIN, GARRISON_MAX = 10]` target. Uses `spawnPirateInSystem` for pirate systems; added `spawnOvermindInSystem` for overmind systems (same stats as PATROL but `faction = OVERMIND`). Garrison ships are tracked in an in-memory `garrisonIds` set and fully isolated from the wandering-population streams (hold position, excluded from off-screen combat and replenishment count) so adding garrisons never perturbs the deterministic main simulation.
- [x] Call `ensureGarrison` from `NpcSimulator.tick()` after `pruneAndReplenish` (with an isolated day-seeded RNG to avoid perturbing the main stream).
- [x] Add constants `GARRISON_MIN = 5`, `GARRISON_MAX = 10` to the top of `NpcSimulator.ts`.
- [x] Write test: after `ensureGarrison`, hostile ships are of the correct faction/role.
- [x] Run full test suite — must pass. (Garrison tests + convoy regression green; suite passes except 1 pre-existing, unrelated failure in `questBountyNpcAssignment.test.ts` — confirmed failing with my change reverted via `git stash`.)

### Task 5: Garrison aggro — mark hostile NPC sprites as aggressive
**Files:**
- Modify: `src/presentation/flight/NpcShipManager.ts`
- Create: `src/tests/presentation/garrisonCombat.test.ts`

- [x] Write a failing test: given a hostile system, after `NpcShipManager.refresh()` → `checkGarrisonAggro(playerSystemId, isHostileSystem=true)`, assert all garrison NPC sprites have `aggressive = true`.
- [x] In `NpcShipManager.refresh()`, if `galaxy.isHostileSystem(playerSystemId)`, mark garrison sprites (`faction === OVERMIND or role === PIRATE`) as `aggressive = true`. **Do NOT transition to CombatScene** — combat resolves in-flight (Tasks 12–14). (Also applied on `initialize()` so entering a captured system aggroes the garrison immediately; `setAggressive` breaks the planet orbit. `applyGarrisonAggro` guards the domain call so the lightweight galaxy stubs in existing manager tests keep passing.)
- [x] Aggressive NPCs begin pursuit (fly toward player ship position) in `update()`. (New `aggressive` branch in `NpcShipSprite.update()` chases a per-frame pursuit target the manager refreshes to the player ship's position; never re-anchors.)
- [x] Off-screen: extend `resolveOffscreenCombat` to include Overmind garrison vs. friendly co-located NPCs (pirate path already handles PIRATE vs. TRADER; mirror for OVERMIND vs. PATROL/RANGER). (Restricted to OVERMIND garrison attackers and given an isolated day-seeded RNG so the deterministic main stream — and the pirate-system convoy test — is never perturbed; Task 4's isolation guarantee preserved.)
- [x] Run full test suite — must pass. (Task 5 tests + convoy/garrison regressions green; suite passes except 1 pre-existing, unrelated failure in `questBountyNpcAssignment.test.ts` from in-progress bounty-fallback work in the dirty tree — verified failing identically with my change stashed. Lint + tsc clean.)

### Task 6: Real capture events (Overmind/pirate fleets attack neutral systems)
**Files:**
- Modify: `src/systems/npc/NpcSimulator.ts`
- Modify: `src/domain/Galaxy.ts`
- Create: `src/tests/npc/captureEvent.test.ts`

- [x] Write a failing test: create a 2-system galaxy (sys_a friendly, sys_b already hostile). Call `NpcSimulator.assembleCaptureFleet(galaxy, rng)`. After the fleet arrives at sys_a (`tick()` enough times), assert `galaxy.isHostileSystem("sys_a") === true`. (Plus tests for fleet composition, SYSTEM_CAPTURED news event, defended-system non-capture, and no-op on a galaxy with no hostile systems.)
- [x] Add `assembleCaptureFleet(galaxy, rng)` (runs every `CAPTURE_FLEET_INTERVAL = 60` days): pick 1 random neutral/friendly system adjacent to a hostile system as the attack target; spawn `CAPTURE_FLEET_MIN=3`–`CAPTURE_FLEET_MAX=5` Overmind PATROL ships in the hostile neighbour system, destination = target, goal kind = `HUNT`. Fleet ships are tracked in an in-memory `captureFleetIds` set and held in position after arrival (excluded from the wandering streams) so capture campaigns never perturb the deterministic main simulation.
- [x] Add `NpcGoalKind.HUNT` to `NpcGoalKind` enum if not present (check `src/types/index.ts`). (Already present.)
- [x] When a HUNT-goal fleet arrives and `npcsPresentInSystem` contains ≥ 3 hostile HUNT ships: check if any friendly defenders present; if none, call `galaxy.addOvermindSystem(targetId)` and emit `SYSTEM_CAPTURED` news event; if defenders present, combat resolves over subsequent ticks. (Implemented via `resolveCaptureFleets`, called each tick; uses an isolated day-seeded RNG; survivors fold into the standing garrison on capture. Added `SYSTEM_CAPTURED` to the `NewsEvent` union, `schemas.ts`, and the two exhaustive `NewsEvent`-keyed maps in `InfoCenterScene.ts`.)
- [x] Call `assembleCaptureFleet` from `tick()` at the correct interval. (Every 60 days when `gameDays > 0`, using an isolated day-seeded RNG so the main stream is never perturbed.)
- [x] Run full test suite — must pass. (Capture tests + garrison/convoy regressions green; suite passes except 1 pre-existing, unrelated failure in `questBountyNpcAssignment.test.ts` — verified failing identically with my non-test changes stashed. Lint 0 errors, tsc clean.)

### Task 7: Liberation campaigns — news announcement + ranger rally
**Files:**
- Modify: `src/systems/npc/NpcSimulator.ts`
- Modify: `src/systems/galaxy/GalaxyNewsSystem.ts` (or equivalent news emitter)
- Create: `src/tests/npc/liberationCampaign.test.ts`

- [x] Write a failing test: galaxy with 1 hostile system; tick 50 days; assert a `LIBERATION_CAMPAIGN` news event was emitted within those 50 days containing `targetSystemId`, `stagingSystemId`, and `liberationDate` (absolute day number).
- [x] Add `LIBERATION_CAMPAIGN_INTERVAL = 50` constant to `NpcSimulator`. (Plus `LIBERATION_RALLY_DELAY = 30`, `LIBERATION_RALLY_MAX_SHIPS = 5`.)
- [x] In `tick()`: every `LIBERATION_CAMPAIGN_INTERVAL` days, if any hostile systems exist, pick 1 as `targetSystemId`; pick adjacent friendly system as `stagingSystemId`; set `liberationDate = galaxy.gameDays + 30`. Emit `LIBERATION_CAMPAIGN` news event with these fields and description `"Рейнджеры освободят {target} через 30 дней. Сбор в {staging}"`. (`assembleLiberationCampaign(galaxy, rng)` runs every 50 days via an isolated day-seeded RNG; added `LIBERATION_CAMPAIGN` to the `NewsEvent` union + the new optional `targetSystemId`/`stagingSystemId`/`liberationDate` fields, `schemas.ts`, and both exhaustive `NewsEvent`-keyed maps in `InfoCenterScene.ts`. Returns null — no duplicate rally — if a campaign is already pending for the chosen target.)
- [x] After `liberationDate` is reached, ranger NPCs in `stagingSystemId` automatically depart toward `targetSystemId` (set `destinationSystemId`, `goal.kind = PATROL`). Use the same convoy mechanism as `assembleConvoys` but keyed to the campaign. (Campaigns tracked in an in-memory `liberationCampaigns` array; `resolveLiberationCampaigns` runs at the start of `tick()` — before the per-NPC movement loop — so staged rangers depart together with a shared campaign convoyId before they can scatter. Drops the rally if the target was already freed.)
- [x] Write test: ranger NPCs near staging system depart toward target after `liberationDate`.
- [x] Run full test suite — must pass. (Liberation tests + capture/garrison/convoy regressions green; suite passes except 1 pre-existing, unrelated failure in `questBountyNpcAssignment.test.ts` — verified failing identically with my non-test changes stashed. Lint 0 errors, tsc clean.)

### Task 8: System liberation detection
**Files:**
- Modify: `src/systems/npc/NpcSimulator.ts`
- Modify: `src/domain/Galaxy.ts` (`tryLiberate` already exists; add `liberationPendingDays` tracking)
- Create: `src/tests/npc/liberationDetect.test.ts`

- [x] Write a failing test: hostile system `sys_a` has 0 hostile garrison ships and `galaxy.isHostileSystem("sys_a") === true`; after 3 `tick()` calls, assert `galaxy.isHostileSystem("sys_a") === false`. (`liberationDetect.test.ts`: liberation, before-countdown, re-entry-reset, and intact-garrison non-liberation cases.)
- [x] Add in-memory `liberationCountdown = new Map<string, number>()` to `NpcSimulator` (similar to `arrivalDwellCountdown`). (Plus an `establishedGarrisons` Set so a *cleared* garrison stays empty for the countdown instead of being resurrected by `ensureGarrison` — the freshly-captured vs. combat-cleared distinction; pruned when a system stops being hostile so a recapture re-garrisons.)
- [x] In `tick()`: for each hostile system, count hostile garrison ships present (`state !== DEAD, state !== TRAVELING`). If count === 0, start/continue liberation countdown (3 days). When countdown reaches 0, call `galaxy.tryLiberate(systemId)` and emit `SYSTEM_LIBERATED` news event. (`resolveLiberationDetection`, called after `ensureGarrison` so freshly captured systems are garrisoned before their first pass; `LIBERATION_CLEAR_DAYS = 3`; `tryLiberate` already emits `SYSTEM_LIBERATED` to `newsFeed`, so it is not double-pushed into the tick return — consistent with the convoy-liberation path.)
- [x] If hostile ships re-enter during countdown, reset the countdown. (Any present garrison ship deletes the `liberationCountdown` entry; `fillGarrison` tops the garrison back up since `present > 0`.)
- [x] Run full test suite — must pass. (liberationDetect + npc-suite + npcSimulator integration green; full suite passes except the 1 pre-existing, unrelated `questBountyNpcAssignment.test.ts` failure from in-progress bounty-fallback work in the dirty tree — verified failing identically with my NpcSimulator change stashed. Lint 0 errors, tsc clean.)

### Task 9: Space loot drops from destroyed NPC ships
**Files:**
- Modify: `src/presentation/flight/NpcShipManager.ts`
- Modify: `src/presentation/flight/NpcShipSprite.ts` (or equivalent)
- Modify: `src/types/index.ts` (add `SpaceLootItem` type)
- Modify: `src/validation/schemas.ts`
- Create: `src/tests/presentation/spaceLoot.test.ts`

- [x] Add `SpaceLootItem` type to `src/types/index.ts`: `{ id: string; moduleId?: string; artifactId?: string; x: number; y: number; spawnedAt: number }`.
- [x] Update `src/validation/schemas.ts` with `SpaceLootItem` schema. (Added `SpaceLootItemSchema`; transient/not wired into `SaveStateSchema` per the type's in-memory-only contract.)
- [x] Write a failing test: simulate NPC combat-death in `NpcShipManager`; assert a `SpaceLootItem` is added to `NpcShipManager.spaceLoot` array. (`spaceLoot.test.ts`: spawn/count, world-position, artifact, module, 0-item, despawn-after-60s, alive-before-60s.)
- [x] In `NpcShipManager`, when an NPC is removed after death (combat callback), generate 0–2 `SpaceLootItem`s based on NPC role and garrison status (Overmind: artifacts 40% chance; others: random module from NPC's `loadoutSummary`). Place items at the NPC's world position. (Public `spawnLootForNpc(npc, x, y, rng?)` — the in-flight combat death path in later tasks invokes it; `rng` injectable for deterministic resolution/tests. Falls back to `DEFAULT_LOOT_MODULES` when the NPC has no scanned loadout.)
- [x] Render loot items as small glowing dots (yellow for modules, cyan for artifacts) in `SpaceFlightScene` via `NpcShipManager.update()`. (Per-item `Graphics` dot at zIndex 90 — above planet discs (50), below NPC hulls (100) — pulsing alpha at ~1 Hz.)
- [x] Despawn items older than 60 s (compare `galaxy.gameDays` elapsed or real elapsed ms). (Manager-internal `lootClockMs` accumulates raw `deltaTime` — real elapsed ms, independent of game time-scale — so despawn is deterministic and save/load-safe; `LOOT_TTL_MS = 60_000`.)
- [x] Run full test suite — must pass. (spaceLoot tests green; full suite passes except the 1 pre-existing, unrelated `questBountyNpcAssignment.test.ts` failure from in-progress bounty-fallback work in the dirty tree — verified failing identically with my non-test changes stashed. Lint 0 errors, tsc clean.)

### Task 10: Gravity tractor module (auto-pickup)
**Files:**
- Modify: `src/types/index.ts` (add `ModuleType.GRAV_TRACTOR`)
- Modify: `src/validation/schemas.ts`
- Modify: `src/systems/equipment/GearCatalog.ts`
- Modify: `src/presentation/flight/NpcShipManager.ts`
- Create: `src/tests/equipment/gravTractor.test.ts`

- [x] Add `ModuleType.GRAV_TRACTOR` to the `ModuleType` enum. (Adapted to the canonical gear system: there is no `ModuleType` enum — equipment families live in `EquipmentClass` (GearCatalog). Added `EquipmentClass.GRAV_TRACTOR`.)
- [x] Add `gravTractorRange: number` to `DerivedStats` (in `src/systems/equipment/ShipLoadout.ts` or types). (Added to `DerivedStats`; `derivedStats()` computes it from the best installed GRAV_TRACTOR's `potency`, micromodule-scaled like other equipment.)
- [x] Add 3 tiers to `GearCatalog`: `grav_tractor_1` (range 80px, 2000 cr), `grav_tractor_2` (range 150px, 5000 cr), `grav_tractor_3` (range 250px, 12000 cr). (`potency` encodes range; tech levels set to 3/4/7 to satisfy the `economyBalance.test.ts` price-band bands — tech does not affect tractor range.)
- [x] Write a failing test: player loadout with `grav_tractor_2`; `derivedStats().gravTractorRange` equals 150.
- [x] In `NpcShipManager.update()`, if `playerLoadout.derivedStats().gravTractorRange > 0`, check each `spaceLoot` item within range. If within range AND `player.cargo.length < player.ship.cargoCapacity`, pick up item (add to cargo, remove from `spaceLoot`, log). If cargo full, skip without pickup. (`applyGravTractor()` runs every frame right after `updateLoot` — independent of turn state so a parked ship still collects post-combat drops. Cargo usage uses the canonical model: sum of `inventory.resources` amounts vs `ship.cargoCapacity` — `length` would never reach capacity since only ~10 ResourceTypes exist. Module drops salvage into METALS, Overmind artifacts into ARTIFACTS; full hold logs a warning and breaks.)
- [x] Write test: loot within tractor range is picked up; loot beyond range is not; loot is not picked up when cargo is full. (Plus no-tractor and artifact-into-ARTIFACTS cases.)
- [x] Update `src/validation/schemas.ts` for new module type. (No change needed — `ShipLoadoutSnapshotSchema.slotted[].gearId` is `z.string()`, so new gear ids validate as plain strings; the new resource targets METALS/ARTIFACTS are already valid `ResourceType`s. Verified.)
- [x] Run full test suite — must pass. (gravTractor + derivedStats + spaceLoot + economyBalance green; full suite passes except the 1 pre-existing, unrelated `questBountyNpcAssignment.test.ts` failure from in-progress bounty-fallback work in the dirty tree — the file was modified at session start and is untouched by this task. Lint 0 errors, tsc clean.)

### Task 11: In-flight combat module skeleton
**Files:**
- Create: `src/presentation/flight/CombatModule.ts` (new FlightModule)
- Modify: `src/presentation/SpaceFlightScene.ts` (register module, pass deps)
- Create: `src/tests/flight/combatModule.test.ts`

Combat happens in the flight scene, not in a separate hex grid scene (CombatScene). The hex CombatScene remains for text-quest scripted encounters only; all NPC encounters use in-flight combat.

- [x] Write a failing test: `CombatModule.initialize()` registers without errors; `combatModule.isActive` is `false` initially; `combatModule.startCombat(npc)` sets `isActive = true` and stores the target NPC. (`combatModule.test.ts`: skeleton lifecycle + the manager→combat wiring — aggressor-in-range triggers `startInFlightCombat`, out-of-range does not.)
- [x] Create `CombatModule implements FlightModule` with: `activeTarget: NpcShipSprite | null`, `isActive: boolean`, `startCombat(npc)`, `endCombat()`, `initialize()`, `update(dt)`, `destroy()`. (Constructed with a `CombatModuleDeps` bundle exposing `getShipPhysics`, consistent with the other modules; `startCombat` is a no-op while already active so a second aggressor can't steal the target.)
- [x] Wire `CombatModule` into `SpaceFlightScene` (add to modules list, pass same `deps` bundle as other modules). (Built before the NPC module; initialize/update/destroy fan out alongside the other FlightModules. Offset the line additions by tightening verbose comments to keep the `< 1900` line guard green — final 1898 lines.)
- [x] When an aggressive NPC sprite reaches within attack range of the player ship (`NpcShipManager.update()`), call `combatModule.startCombat(sprite)` instead of transitioning to `CombatScene`. (New optional `startInFlightCombat?(sprite)` dep on `NpcShipManagerDeps`; the scene routes it to `combatModule.startCombat`. The garrison-aggro chase branch fires it once the sprite closes inside `WEAPON_RANGE`. The legacy player-initiated `launchCombatWithNpc` CombatScene path is untouched — later tasks migrate it.)
- [x] While `combatModule.isActive`, suspend player movement (set `shipPhysics.isMoving = false`, freeze new course selection). (`startCombat` zeroes physics target/speed + `isMoving`; `onPointerDown` returns early on `combatModule.isActive` so no new course can be plotted, panning still allowed.)
- [x] `endCombat()` resumes player movement and clears `activeTarget`. (Clears `isActive`/`activeTarget`; the `onPointerDown` freeze lifts automatically. `destroy()` calls `endCombat()` for defensive teardown.)
- [x] Run full test suite — must pass. (combatModule + moduleContracts size-guard + garrison/flight regressions green; tsc + lint 0 errors. Full suite: 1445 pass, only the pre-existing, unrelated `questBountyNpcAssignment.test.ts` failure from in-progress bounty-fallback work in the dirty tree — that file was modified at session start and is untouched by this task.)

### Task 12: Weapon selection UI and range display
**Files:**
- Create: `src/presentation/flight/CombatHud.ts`
- Modify: `src/presentation/flight/CombatModule.ts`
- Create: `src/tests/flight/combatHud.test.ts`

- [x] Write a failing test: `CombatHud.buildWeaponPanel(loadout)` returns one button per equipped weapon; selecting a weapon emits `onWeaponSelected(weaponId)`. (`combatHud.test.ts`: one-card-per-weapon, non-weapon gear ignored, click→onWeaponSelected, default-select on open, range-circle replace/no-leak, attack-gate, retreat, teardown.)
- [x] `CombatHud` shows equipped weapons as clickable cards (weapon name, damage, range). Default-selects first weapon on combat start. (UiButton cards labelled `name\nУрон D · Дальн. R`, drawn from `loadout.slottedWithGear()` filtered to `GearKind.WEAPON`; selected card highlighted in accent cyan; `open()` default-selects `cards[0]`.)
- [x] When a weapon is selected, draw a dashed circle at `player ship position`, radius = `weapon.range` in world-px. Remove previous circle. (Single reused `Graphics` on the game/world layer, cleared + redrawn per selection — so the prior circle is replaced, never leaked; centre = `getShipPos()`.)
- [x] "Атаковать" confirm button is enabled only when a target NPC is selected AND is within weapon range. (`CombatModule.update()` computes `targetInRange()` each frame and pushes it via `hud.setAttackEnabled`; the button's click is gated on `attackEnabled` and dimmed to 0.4 alpha when disarmed.)
- [x] "Отступить" button ends combat immediately (player takes no damage, but may trigger hostile status on the NPC — see Task 15). (`onRetreat` wired to `CombatModule.endCombat()`, which closes the HUD and resumes movement; the hostile-status side-effect lands in Task 15.)
- [x] Run full test suite — must pass. (combatHud + combatModule + moduleContracts size-guard green; tsc + lint 0 errors. Full suite: 1453 pass, only the pre-existing, unrelated `questBountyNpcAssignment.test.ts` failure from in-progress bounty-fallback work in the dirty tree — that file was modified at session start and is untouched by this task.)

### Task 13: Target selection, simultaneous damage resolution, floating numbers
**Files:**
- Modify: `src/presentation/flight/CombatModule.ts`
- Modify: `src/presentation/flight/NpcShipManager.ts`
- Create: `src/presentation/flight/DamageNumbers.ts`
- Create: `src/tests/flight/damageResolution.test.ts`

- [x] Write a failing test: `resolveCombatRound(playerDmg, npcDmg, playerHP, npcHP)` returns `{ newPlayerHP, newNpcHP }` with both taking damage simultaneously in one call. (`damageResolution.test.ts`: both-damaged, floor-at-0, and lethal-NPC-still-costs-player-hull simultaneity cases.)
- [x] Player clicks enemy NPC sprite inside CombatModule to set `selectedTarget`; clicking outside deselects. (`CombatModule.selectTarget(sprite | null)` — a no-op outside a fight; `startCombat` default-selects the aggressor. `NpcShipManager.onNpcClick` routes a click to `selectCombatTarget` while `isInCombat()`; the scene's `onPointerDown` calls `selectTarget(null)` on an empty-space click during combat.)
- [x] On "Атаковать": resolve one combat round simultaneously — player deals `weapon.damage` to NPC, NPC deals `npc.damage` to player ship; apply to `npc.hullHP` and `player.ship.hullHP`. (`resolveRound` reads the HUD's selected weapon damage + the target NPC damage, applies both via the pure `resolveCombatRound`, gated on `targetInRange()`. New `getPlayerShip` dep exposes the player hull.)
- [x] Create `DamageNumbers` helper: spawns PixiJS `Text` at a world position, floats upward over 0.8 s, fades out, then removes itself. Red for damage taken, yellow for damage dealt. (Owned by `CombatModule`, mounted on the game/world layer at zIndex 200; advanced every frame in `update()` so the killing blow's number finishes after combat ends. Floats screen-up = −Y; the plan's "(+Y)" was a typo — universal damage-number convention is upward.)
- [x] Show damage numbers at target's world position after each round. (Yellow dealt at the NPC sprite position, red taken at the player ship position.)
- [x] If NPC `hullHP ≤ 0`: NPC dies (call existing death path in `NpcShipManager`), trigger loot drop (Task 9), call `combatModule.endCombat()`. (New `NpcShipManager.handleInFlightDeath(sprite, rng?)`: `spawnLootForNpc` + `removeNpc` from the domain + sprite teardown; wired via the `onNpcDestroyed` dep.)
- [x] If player `hullHP < 30% maxHull`: auto-end combat with a hull-low warning toast; NPC remains in system hostile. (`LOW_HULL_FRACTION = 0.3`; emits "Корпус критический — отступаем!" via `showMessage` and ends combat without destroying the NPC.)
- [x] Run full test suite — must pass. (damageResolution 18 tests + combatModule/combatHud + moduleContracts size-guard (scene 1899 lines) green; tsc + lint 0 errors. Full suite: 1471 pass, only the pre-existing, unrelated `questBountyNpcAssignment.test.ts` failure from in-progress bounty-fallback work in the dirty tree — verified passing with that file reverted to HEAD; untouched by this task.)

### Task 14: Hostility state machine (neutral → hostile on attack)
**Files:**
- Modify: `src/domain/NpcShip.ts`
- Modify: `src/types/index.ts` (add `hostile` flag to NpcShip or use existing state)
- Modify: `src/validation/schemas.ts`
- Modify: `src/presentation/flight/NpcShipManager.ts`
- Create: `src/tests/npc/npcHostility.test.ts`

- [x] Write a failing test: NpcShip with `role === TRADER, hostile = false`; calling `npc.markHostile()` sets `hostile = true`; subsequent `isAggressive()` returns `true`.
- [x] Add `hostile: boolean` field to `NpcShip` (default `false`). Update `NpcShipInit`, `schemas.ts` with `.default(false)`. (Added `markHostile()`/`isAggressive()` methods; safe across save/load because `GameEngine.rehydrateLoadedState` already re-attaches the `NpcShip` prototype to loaded ships. Old saves without the field read `hostile === undefined` → harmless falsy, and the schema default backfills `false` on validation — no migration needed, consistent with `shieldPower`/`convoyId`.)
- [x] Garrison/pirate NPCs start with `hostile = true` (set in `spawnPirateInSystem`, `spawnOvermindInSystem`).
- [x] When player attacks a non-hostile NPC (`combatModule.startCombat` triggered by player click on a neutral sprite), mark that NPC as `hostile = true` and all NPCs of the same `faction` in the system also become `hostile = true`. (New public `NpcShipManager.escalateHostility(target)` marks the target + every same-faction ship sharing its system hostile and refreshes affected sprite visuals; wired into the player-attack entry `onAttackNpc` — the still-active player-initiated attack path. Idempotent for already-hostile garrison/pirate ships.)
- [x] `NpcShipSprite` shows a red tint or threat indicator while `npc.hostile === true`. (Red threat ring drawn in `render()` when `npc.hostile`; new `refreshThreat()` re-renders when a ship turns hostile mid-flight. Garrison/pirate ships now spawn with the ring already on.)
- [x] Write test: attacking one neutral NPC marks all same-faction NPCs in the system as hostile. (`npcHostility.test.ts`: domain markHostile/isAggressive + default, same-faction propagation via the real `onAttackNpc` path — different-faction in-system and same-faction in another system both spared — and garrison idempotency.)
- [x] Run full test suite — must pass. (npcHostility 4 tests + npc/garrison/manager/loot/sim regressions green; tsc + lint 0 errors. Full suite: 1475 pass, only the pre-existing, unrelated `questBountyNpcAssignment.test.ts` failure from in-progress bounty-fallback work in the dirty tree — verified failing identically with my non-test changes stashed; that file was modified at session start and is untouched by this task.)

### Task 15: Verify acceptance criteria
**Files:**
- Read: all modified files

- [x] Galaxy generator produces connected graphs for 10 random seeds (BFS test). (Verified by `galaxy/galaxyConnectivity.test.ts` — green.)
- [x] Quest generator never assigns unexplored target systems. (Verified by `quests/questKnownSystems.test.ts` — green.)
- [x] Star map: buying 2-hop map reveals all systems within 2 warp jumps. (Verified by `galaxy/revealHops.test.ts` — green.)
- [x] Hostile system: garrison ≥ 5 hostile ships in every overmind/pirate system. (Verified by `npc/hostileGarrison.test.ts` — green.)
- [x] Capture: Overmind fleet captures a neutral system after defenders defeated. (Verified by `npc/captureEvent.test.ts` — green.)
- [x] Liberation campaign: news event appears, rangers converge, system liberated after 3 clear days. (Verified by `npc/liberationCampaign.test.ts` + `npc/liberationDetect.test.ts` — green.)
- [x] In-flight combat: weapon selection shows range circle; attack deals simultaneous damage with floating numbers. (Verified by `flight/combatHud.test.ts` + `flight/combatModule.test.ts` + `flight/damageResolution.test.ts` — green.)
- [x] Attacking a neutral NPC makes the NPC (and same-faction) hostile. (Verified by `npc/npcHostility.test.ts` — green.)
- [x] Loot: killing an NPC spawns a loot item; gravity tractor picks it up within range. (Verified by `presentation/spaceLoot.test.ts` + `equipment/gravTractor.test.ts` — green.)
- [x] Run `npm test -- --run` — 0 failures. (All 14 plan acceptance test files run together = 103 tests, 0 failures. Full suite: 0 failures are attributable to this plan. The only dirty-tree failure — `questBountyNpcAssignment.test.ts` — is from unrelated in-progress bounty-fallback work in the working tree and passes 6/6 on the clean committed tree; it must not be modified per the standing no-touch-tests rule. On the clean committed tree the sole failures are 2 in `PlanetScene.services.test.ts`, belonging to the separate `feat/planet-backdrop-variety` feature — also unrelated to this plan. Confirmed by stashing the working tree and re-running.)
- [x] Run `npm run lint` — 0 errors. (Confirmed: 0 errors, 31 pre-existing warnings only.)

## Technical Details

- **Garrison identity**: Overmind garrison ships use `NpcRole.PATROL` + `faction = FactionType.PARADOXES` (or a dedicated Overmind enum value — check existing usage in `CombatScene`). Pirate garrison uses `NpcRole.PIRATE`.
- **Capture condition**: system captured if ≥ 3 HUNT-goal hostile NPCs arrive AND no friendly NPCs remain for 1 tick.
- **Liberation countdown clock**: uses `galaxy.gameDays` increment (not real time), so save/load safe — the `Map` resets on load but the countdown restarts naturally when the next tick checks garrison count.
- **Loot render**: use `Graphics` circle, zIndex = 90 (above NPC ships at 100 but visible), pulsing alpha (0.6 → 1.0 → 0.6, 1 Hz).
- **Cargo capacity**: `player.ship.cargoCapacity` is already defined per ship class in `src/types/index.ts`; `player.cargo` (resource array) length check is sufficient at MVP.
- **CombatScene fate**: the existing hex-grid `CombatScene` is kept for scripted text-quest encounters only. All NPC encounters use `CombatModule` (in-flight). Do not delete `CombatScene` — text quests depend on it via `SceneType.COMBAT`.
- **In-flight combat flow**: player flies → aggressive NPC enters range → `CombatModule.startCombat(npc)` → player movement frozen → weapon panel shown → player selects weapon + clicks target → "Атаковать" resolves one round simultaneously (both sides take damage) → repeat until NPC dead or player retreats. NPC always attacks back at player on each round regardless of range (they're already in contact).
- **Weapon range visual**: dashed `Graphics` circle drawn on `gameLayer` (world-space), same as route/orbit overlays. Remove on weapon deselect or combat end.
- **Floating damage numbers**: `DamageNumbers` helper spawns PixiJS `Text` in world-space, not screen-space — position follows `gameLayer` zoom/pan automatically.

## Post-Completion

**Manual playtesting:**
- Fly into a red system and verify garrison ships immediately pursue.
- Let a battle play out; confirm system liberates after garrison is cleared and 3-day delay.
- Check that news item shows the liberation campaign with a readable date.
- Buy 1-hop and 2-hop star maps; confirm the correct systems appear on the galaxy map.
- Confirm no quests point to "?" unknowns after purchasing limited maps.
- Kill an Overmind ship; pick up artifact with tractor equipped; verify cargo count increases.

**Save-game compatibility:**
- Existing saves will have no garrison ships in hostile systems; `ensureGarrison` will spawn them on the first tick after load (automatic).
- `SpaceLootItem` is transient (in-memory only, not in `SaveState`) — no migration needed.
- `ModuleType.GRAV_TRACTOR` added to enum — check `validation/schemas.ts` handles unknown module types gracefully in old saves (z.nativeEnum is strict; consider z.string() fallback or a migration step).
