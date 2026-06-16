---
# Dual-Hull Unification: One Source of Truth for Ship Fitting

## Overview
Two systems model the same concept — the legacy `PlayerShip` (`hullClass` getters
for `cargoCapacity`/`weaponSlots`/`equipmentSlots`, plus a 3-slot `modules` array)
and the canonical `GearCatalog`/`ShipLoadout` (`derivedStats`). They drift apart on
every change, which is the root of the "купил корпус, инвентарь не поменялся" class
of bugs; this session added a `syncShipToHullClass` bridge as a stopgap. This plan
makes `ShipLoadout` the single source of truth: all derived stats read from it, the
three production flows (combat loot, gear purchases, micromodule crafting) feed the
loadout, a save migration converts legacy `modules` into loadout gear, and the
legacy fields + the stopgap bridge are removed. Result: changing a hull touches one
model, not two, and the sync landmine disappears.

## Context
- **Legacy model:** `src/domain/PlayerShip.ts` — `hullClass` + getters off
  `HULL_CLASS_SPECS`; `modules: [ShipModule|null × 3]`. Rehydrated by
  `GameEngine.rehydrateModule` (prototype reattach by category).
- **Canonical model:** `src/systems/equipment/ShipLoadout.ts` (`derivedStats`:
  maxHull, cargo, slotsTotal, weaponDamage, speed, …); `GearCatalog` hulls carry
  `hullClass`, `cargo`, `slots`, `hp`.
- **Stopgap (this session):** `GearBridge.syncShipToHullClass` keeps both in step;
  both shops call it. To be removed once legacy is gone.
- **Legacy producers/consumers (blast radius):** `src/systems/EquipmentSystem.ts`,
  `src/systems/GameEngine.ts` (rehydrate), `src/presentation/InventoryScene.ts`
  (already reads loadout), `src/presentation/StationScene.ts` (hangar panel —
  player-visible legacy view), `src/presentation/CombatScene.ts` (loot → modules),
  `src/presentation/EquipmentShopScene.ts` (gear purchase). CLAUDE.md "Known Caveat:
  Legacy Equipment System" documents the three feeding flows.
- **Stat reads still on legacy:** `TradeScene`/`NpcShipManager` use
  `player.ship.cargoCapacity`; redirect to `derivedStats().cargo`.
- **Persistence:** `src/data/MigrationPipeline.ts` (add a versioned migration);
  `src/validation/schemas.ts` (drop legacy module fields after migration);
  `ShipLoadoutSnapshot` already persisted.

## Development Approach
- **Testing approach: TDD (tests first).** Higher-risk than usual (many tests touch
  `ship.modules`) — phase it so each step is independently green and reversible.
- **Backward compatibility is mandatory:** the migration must load old saves; bump
  the save version and keep the old shape readable until migrated.
- Do not modify existing test assertions; where a test asserts legacy `modules`
  behavior that is being removed, add a replacement loadout-based test and only then
  retire the legacy path (flag with ⚠️ for review — do not silently weaken).
- One concern per task; full suite green between tasks.

## Testing Strategy
- Unit: stat reads resolve from loadout; each production flow lands gear in the
  loadout; migration converts representative old saves.
- E2E/regression: buy a hull → cargo/stats/appearance update; loot a weapon → it
  appears as installable gear; `npm run test:e2e:regression` stays green.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers (esp. any test that must change). Keep in sync.

## Implementation Steps

### Task 1: Make ShipLoadout authoritative for all stat reads
**Files:**
- Modify: src/presentation/TradeScene.ts, src/presentation/flight/NpcShipManager.ts
  (read `derivedStats().cargo` instead of `player.ship.cargoCapacity`)
- Create: src/tests/equipment/statReads.test.ts

- [x] route every cargo/maxHull/slot/weapon read through `playerLoadout.derivedStats()`
      (new `cargoCapacityOf` helper reads `derivedStats().cargo`; TradeScene + NpcShipManager use it.
      TradeSystem.executeTrade's cargo guard stays on the bridge-synced getter until Task 5 — its
      signature is locked by ~20 existing tests, so it's resolved when the getter is dropped.)
- [x] keep `PlayerShip.hullClass` only as a label derived from `loadout.hull.hullClass`
      (stat reads no longer route through the hull-class getters; `hullClass` set by the bridge from
      the installed hull, kept as a display/scaling label per Technical Details.)
- [x] write tests: stat reads match loadout, not stale legacy values (src/tests/equipment/statReads.test.ts)
- [x] run affected tests — must pass before next task (48 passed: statReads, hullSync, hull, trade, tradeSystem)

### Task 2: Redirect combat loot into the loadout/gear inventory
**Files:**
- Modify: src/presentation/CombatScene.ts (+ loot source), src/systems/EquipmentSystem.ts
- Create/Modify: src/tests/combat/lootToLoadout.test.ts

- [x] dropped weapons/equipment become installable `Gear`, not `ship.modules` entries
      (loot is rolled from `GEAR_CATALOG`; `EquipmentSystem.installLoot(loadout, gearId)` installs the
      drop into a free loadout slot; `CombatScene.applyRewardsToPlayer` feeds every drop through it,
      falling back to the legacy inventory bag only when the loadout is full — Task 5 retires that bag.)
- [x] write tests: a loot drop is installable via `ShipLoadout`
      (src/tests/combat/lootToLoadout.test.ts: installLoot installs weapon/equipment, rejects hull/unknown
      id, never replaces fitted gear when full; every `resolveVictory` drop resolves to installable Gear.)
- [x] run affected tests — must pass before next task (31 passed: lootToLoadout, combat, combatSystem,
      combatScene. Pre-existing unrelated gravTractor.test.ts failure confirmed present without these
      changes — left untouched per the don't-touch-tests rule.)

### Task 3: Redirect gear purchase + micromodule crafting to the loadout
**Files:**
- Modify: src/presentation/StationScene.ts (hangar panel → loadout view),
  src/presentation/EquipmentShopScene.ts
- Create/Modify: src/tests/equipment/purchaseCraftToLoadout.test.ts

- [ ] hangar panel renders the loadout (read/write), not `ship.modules`
- [ ] purchases and crafted micromodules land in the loadout
- [ ] write tests: buy/craft paths mutate the loadout only
- [ ] run affected tests — must pass before next task

### Task 4: Save migration legacy modules → loadout
**Files:**
- Modify: src/data/MigrationPipeline.ts (versioned migration), src/validation/schemas.ts
- Create: src/tests/data/hullUnificationMigration.test.ts

- [ ] convert `ship.modules` + `inventory.modules` into a `ShipLoadoutSnapshot`;
      bump save version; old saves load without data loss
- [ ] write tests: representative old save migrates to an equivalent loadout
- [ ] run affected tests — must pass before next task

### Task 5: Remove legacy fields and the stopgap bridge
**Files:**
- Modify: src/domain/PlayerShip.ts (drop `modules` + spec getters), src/systems/GameEngine.ts
  (drop `rehydrateModule`), src/systems/equipment/GearBridge.ts (drop `syncShipToHullClass`),
  both shops (drop the sync calls)
- Modify: any remaining `ship.modules` references

- [ ] delete legacy `modules`/getters + `syncShipToHullClass`; compile clean
- [ ] ⚠️ for each existing test asserting legacy behavior: add a loadout replacement
      test first, flag for review, then retire the legacy assertion
- [ ] run affected tests — must pass before next task

### Task 6: Verify acceptance criteria
- [ ] verify Overview: one source of truth; buy-hull updates cargo/stats/appearance;
      loot/purchase/craft all feed the loadout; old saves migrate
- [ ] run full unit suite — all green
- [ ] run `npm run test:e2e:regression`
- [ ] run `npm run lint` — clean

## Technical Details
- Migration is one-way and idempotent (guard on save version). Unknown gear ids are
  skipped item-by-item (mirrors `ShipLoadout.fromJSON`), never voiding the whole loadout.
- `hullClass` stays as a derived label so combat/scaling code reading it keeps working.

## Post-Completion
**Manual verification:** load a pre-migration save; confirm fitted modules reappear
as installed gear and stats match. Buy each hull class; confirm hold/stats/sprite all
update (ship art from the playtest batch is keyed by hull class).
