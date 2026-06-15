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

- [ ] Write a failing test: build a galaxy where half the systems are `explored = false`; call `QuestGenerator.generate()` with a planet in an explored system; assert no generated quest has a `targetSystemId` whose system has `explored = false`.
- [ ] In `QuestGenerator`, wherever candidate target systems are gathered (delivery, bounty, escort targets), filter out systems where `!system.explored`.
- [ ] Ensure DEFENSE quests (which target hostile neighbours) also respect the explored filter — a hostile system must be explored (adjacent to player's visited systems) before it can appear as a defense target.
- [ ] Run full test suite — must pass.

### Task 3: Star map purchase service on planets
**Files:**
- Modify: `src/presentation/PlanetScene.ts`
- Modify: `src/domain/Galaxy.ts` (add `revealSystemsWithinHops`)
- Modify: `src/validation/schemas.ts` (no new fields needed; verify)
- Create: `src/tests/galaxy/revealHops.test.ts`

- [ ] Write a failing test for `Galaxy.revealSystemsWithinHops(systemId, hops)`: starting from `sys_a` in a 5-system chain, calling with hops=2 should mark the 2 nearest systems `explored = true` and leave systems beyond 2 hops unchanged.
- [ ] Implement `Galaxy.revealSystemsWithinHops(systemId: string, hops: number): number` — BFS up to `hops` levels, marks each discovered system `explored = true`, `fogOfWar = false`; returns count of newly revealed systems.
- [ ] Add "Карты" button to `PlanetScene` habitable-planet service list (icon `🗺`, label `Карты`).
- [ ] Implement `openStarMap()` handler: show inline modal with tier selector (1 hop = 500 cr, 2 hops = 1500 cr, 3 hops = 4000 cr). On confirm, call `galaxy.revealSystemsWithinHops`, deduct credits, show "Открыто N систем".
- [ ] If player cannot afford any tier, show a disabled "Нет кредитов" state.
- [ ] Disable the "Карты" button (greyed) if the system is hostile (consistent with other service gating).
- [ ] Run full test suite — must pass.

### Task 4: Persistent hostile garrison in captured systems
**Files:**
- Modify: `src/systems/npc/NpcSimulator.ts`
- Modify: `src/domain/Galaxy.ts` (add `garrisonSystems` tracking or use existing hostileSystems)
- Create: `src/tests/npc/hostileGarrison.test.ts`

- [ ] Write a failing test: mark `sys_a` as an Overmind system; call `NpcSimulator.ensureGarrison(galaxy, rng)`; assert `npcsPresentInSystem(galaxy, "sys_a")` returns 5–10 hostile-role ships.
- [ ] Add `ensureGarrison(galaxy: Galaxy, rng: SeededRNG): void` to `NpcSimulator`: for each `overmindSystem` and `pirateSystem`, if the count of hostile NPC ships present (`role === PATROL or PIRATE`, `currentSystemId === systemId`, `state !== DEAD`) is below `GARRISON_MIN = 5`, spawn up to `GARRISON_MAX = 10` until the minimum is met. Use `spawnPirateInSystem` for pirate systems; introduce `spawnOvermindInSystem` for overmind systems (same stats as PATROL but `faction = OVERMIND`).
- [ ] Call `ensureGarrison` from `NpcSimulator.tick()` after `pruneAndReplenish`.
- [ ] Add constants `GARRISON_MIN = 5`, `GARRISON_MAX = 10` to the top of `NpcSimulator.ts`.
- [ ] Write test: after `ensureGarrison`, hostile ships are of the correct faction/role.
- [ ] Run full test suite — must pass.

### Task 5: Garrison attacks all entrants (player + friendly NPCs)
**Files:**
- Modify: `src/presentation/flight/NpcShipManager.ts`
- Modify: `src/presentation/SpaceFlightScene.ts` (or the NPC contact/combat trigger path)
- Create: `src/tests/presentation/garrisonCombat.test.ts` (unit test for trigger logic)

- [ ] Write a failing test: given a hostile system with garrison ships, simulate `NpcShipManager.refresh()` followed by `NpcShipManager.checkGarrisonAggro(playerSystemId, isHostileSystem)`; assert that at least one garrison NPC is flagged as `aggressive`.
- [ ] In `NpcShipManager`, after `refresh()`, if `galaxy.isHostileSystem(playerSystemId)`, mark all NPC sprites with `faction === OVERMIND or role === PIRATE` as `aggressive = true` (auto-attack stance).
- [ ] Aggressive NPCs automatically begin pursuit (use existing follow/combat path triggered in `update()`).
- [ ] Off-screen: garrison ships also fight friendly (PATROL, RANGER, TRADER) NPCs co-located — extend `resolveOffscreenCombat` to include garrison vs. friendly encounters in hostile systems (already handled by pirate logic; confirm Overmind is included).
- [ ] Run full test suite — must pass.

### Task 6: Real capture events (Overmind/pirate fleets attack neutral systems)
**Files:**
- Modify: `src/systems/npc/NpcSimulator.ts`
- Modify: `src/domain/Galaxy.ts`
- Create: `src/tests/npc/captureEvent.test.ts`

- [ ] Write a failing test: create a 2-system galaxy (sys_a friendly, sys_b already hostile). Call `NpcSimulator.assembleCaptureFleet(galaxy, rng)`. After the fleet arrives at sys_a (`tick()` enough times), assert `galaxy.isHostileSystem("sys_a") === true`.
- [ ] Add `assembleCaptureFleet(galaxy, rng)` (runs every `CAPTURE_FLEET_INTERVAL = 60` days): pick 1 random neutral/friendly system adjacent to a hostile system as the attack target; spawn 3–5 Overmind PATROL ships in the hostile neighbour system, destination = target, goal kind = `HUNT`.
- [ ] Add `NpcGoalKind.HUNT` to `NpcGoalKind` enum if not present (check `src/types/index.ts`).
- [ ] When a HUNT-goal fleet arrives and `npcsPresentInSystem` contains ≥ 3 hostile HUNT ships: check if any friendly defenders present; if none, call `galaxy.addOvermindSystem(targetId)` and emit `SYSTEM_CAPTURED` news event; if defenders present, combat resolves over subsequent ticks.
- [ ] Call `assembleCaptureFleet` from `tick()` at the correct interval.
- [ ] Run full test suite — must pass.

### Task 7: Liberation campaigns — news announcement + ranger rally
**Files:**
- Modify: `src/systems/npc/NpcSimulator.ts`
- Modify: `src/systems/galaxy/GalaxyNewsSystem.ts` (or equivalent news emitter)
- Create: `src/tests/npc/liberationCampaign.test.ts`

- [ ] Write a failing test: galaxy with 1 hostile system; tick 50 days; assert a `LIBERATION_CAMPAIGN` news event was emitted within those 50 days containing `targetSystemId`, `stagingSystemId`, and `liberationDate` (absolute day number).
- [ ] Add `LIBERATION_CAMPAIGN_INTERVAL = 50` constant to `NpcSimulator`.
- [ ] In `tick()`: every `LIBERATION_CAMPAIGN_INTERVAL` days, if any hostile systems exist, pick 1 as `targetSystemId`; pick adjacent friendly system as `stagingSystemId`; set `liberationDate = galaxy.gameDays + 30`. Emit `LIBERATION_CAMPAIGN` news event with these fields and description `"Рейнджеры освободят {target} через 30 дней. Сбор в {staging}"`.
- [ ] After `liberationDate` is reached, ranger NPCs in `stagingSystemId` automatically depart toward `targetSystemId` (set `destinationSystemId`, `goal.kind = PATROL`). Use the same convoy mechanism as `assembleConvoys` but keyed to the campaign.
- [ ] Write test: ranger NPCs near staging system depart toward target after `liberationDate`.
- [ ] Run full test suite — must pass.

### Task 8: System liberation detection
**Files:**
- Modify: `src/systems/npc/NpcSimulator.ts`
- Modify: `src/domain/Galaxy.ts` (`tryLiberate` already exists; add `liberationPendingDays` tracking)
- Create: `src/tests/npc/liberationDetect.test.ts`

- [ ] Write a failing test: hostile system `sys_a` has 0 hostile garrison ships and `galaxy.isHostileSystem("sys_a") === true`; after 3 `tick()` calls, assert `galaxy.isHostileSystem("sys_a") === false`.
- [ ] Add in-memory `liberationCountdown = new Map<string, number>()` to `NpcSimulator` (similar to `arrivalDwellCountdown`).
- [ ] In `tick()`: for each hostile system, count hostile garrison ships present (`state !== DEAD, state !== TRAVELING`). If count === 0, start/continue liberation countdown (3 days). When countdown reaches 0, call `galaxy.tryLiberate(systemId)` and emit `SYSTEM_LIBERATED` news event.
- [ ] If hostile ships re-enter during countdown, reset the countdown.
- [ ] Run full test suite — must pass.

### Task 9: Space loot drops from destroyed NPC ships
**Files:**
- Modify: `src/presentation/flight/NpcShipManager.ts`
- Modify: `src/presentation/flight/NpcShipSprite.ts` (or equivalent)
- Modify: `src/types/index.ts` (add `SpaceLootItem` type)
- Modify: `src/validation/schemas.ts`
- Create: `src/tests/presentation/spaceLoot.test.ts`

- [ ] Add `SpaceLootItem` type to `src/types/index.ts`: `{ id: string; moduleId?: string; artifactId?: string; x: number; y: number; spawnedAt: number }`.
- [ ] Update `src/validation/schemas.ts` with `SpaceLootItem` schema.
- [ ] Write a failing test: simulate NPC combat-death in `NpcShipManager`; assert a `SpaceLootItem` is added to `NpcShipManager.spaceLoot` array.
- [ ] In `NpcShipManager`, when an NPC is removed after death (combat callback), generate 0–2 `SpaceLootItem`s based on NPC role and garrison status (Overmind: artifacts 40% chance; others: random module from NPC's `loadoutSummary`). Place items at the NPC's world position.
- [ ] Render loot items as small glowing dots (yellow for modules, cyan for artifacts) in `SpaceFlightScene` via `NpcShipManager.update()`.
- [ ] Despawn items older than 60 s (compare `galaxy.gameDays` elapsed or real elapsed ms).
- [ ] Run full test suite — must pass.

### Task 10: Gravity tractor module (auto-pickup)
**Files:**
- Modify: `src/types/index.ts` (add `ModuleType.GRAV_TRACTOR`)
- Modify: `src/validation/schemas.ts`
- Modify: `src/systems/equipment/GearCatalog.ts`
- Modify: `src/presentation/flight/NpcShipManager.ts`
- Create: `src/tests/equipment/gravTractor.test.ts`

- [ ] Add `ModuleType.GRAV_TRACTOR` to the `ModuleType` enum.
- [ ] Add `gravTractorRange: number` to `DerivedStats` (in `src/systems/equipment/ShipLoadout.ts` or types).
- [ ] Add 3 tiers to `GearCatalog`: `grav_tractor_1` (range 80px, 2000 cr), `grav_tractor_2` (range 150px, 5000 cr), `grav_tractor_3` (range 250px, 12000 cr).
- [ ] Write a failing test: player loadout with `grav_tractor_2`; `derivedStats().gravTractorRange` equals 150.
- [ ] In `NpcShipManager.update()`, if `playerLoadout.derivedStats().gravTractorRange > 0`, check each `spaceLoot` item within range. If within range AND `player.cargo.length < player.ship.cargoCapacity`, pick up item (add to cargo, remove from `spaceLoot`, log). If cargo full, skip without pickup.
- [ ] Write test: loot within tractor range is picked up; loot beyond range is not; loot is not picked up when cargo is full.
- [ ] Update `src/validation/schemas.ts` for new module type.
- [ ] Run full test suite — must pass.

### Task 11: Verify acceptance criteria
**Files:**
- Read: all modified files

- [ ] Galaxy generator produces connected graphs for 10 random seeds (BFS test).
- [ ] Quest generator never assigns unexplored target systems (test with half-explored galaxy).
- [ ] Star map purchase: buying 2-hop map in `sys_a` reveals all systems within 2 warp jumps.
- [ ] Hostile system: `npcsPresentInSystem` returns ≥ 5 hostile ships for every overmind/pirate system.
- [ ] Capture: a 3-ship Overmind fleet successfully captures a neutral system after defenders defeated.
- [ ] Liberation campaign: news event appears, rangers converge, system liberated after 3 clear days.
- [ ] Loot: killing an NPC in the player system spawns a loot item visible on screen.
- [ ] Tractor: `grav_tractor_1` picks up loot within 80px.
- [ ] Run `npm test -- --run` — 0 failures.
- [ ] Run `npm run lint` — 0 errors.

## Technical Details

- **Garrison identity**: Overmind garrison ships use `NpcRole.PATROL` + `faction = FactionType.PARADOXES` (or a dedicated Overmind enum value — check existing usage in `CombatScene`). Pirate garrison uses `NpcRole.PIRATE`.
- **Capture condition**: system captured if ≥ 3 HUNT-goal hostile NPCs arrive AND no friendly NPCs remain for 1 tick.
- **Liberation countdown clock**: uses `galaxy.gameDays` increment (not real time), so save/load safe — the `Map` resets on load but the countdown restarts naturally when the next tick checks garrison count.
- **Loot render**: use `Graphics` circle, zIndex = 90 (above NPC ships at 100 but visible), pulsing alpha (0.6 → 1.0 → 0.6, 1 Hz).
- **Cargo capacity**: `player.ship.cargoCapacity` is already defined per ship class in `src/types/index.ts`; `player.cargo` (resource array) length check is sufficient at MVP.

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
