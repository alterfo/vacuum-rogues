# Equipment System

`GearCatalog`/`ShipLoadout` is the single source of truth for the hull and every derived stat (cargo, slots, weapon damage, speed, HP).

## Slot categories

`ShipLoadout.canInstall`/`install` resolve each gear to one of four banks via `slotCategoryFor(gear)`: weapon (`hull.weaponSlots`), equipment (`hull.equipmentSlots`, shared by fuel tank/shield/droid/scanner/grav-tractor/grapple), engine (1), radar (1). Engine and radar are single dedicated slots — installing a new one **replaces** the fitted part (drops it) rather than stacking; the displaced id is surfaced by `loadout.displacedBy(gearId)` so install callers re-home it (warehouse/bag). `derivedStats().categories` reports `{used,total}` per bank. The flat `slotsTotal`/`slotsUsed` are legacy — prefer `categories`.

## Mass budget

Each gear carries `mass` (catalog data on `GearBase`); installed mass sums against `HullSpec.massCapacity`, and `canInstall` rejects an over-mass install even if a category slot is free (an engine/radar swap credits the displaced part's mass first). `derivedStats()` exposes `massUsed`/`massCapacity`/`massFree`. Mass is catalog-derived — no save migration.

## Hull micromodule slots (third capacity gate)

Each hull exposes `HullSpec.micromoduleSlots` (1–4; `DEFAULT_HULL_MICROMODULE_SLOTS` fallback) bounding `ShipLoadout.hullMicromoduleIds: string[]`. Hull micromodules are a separate catalog family `HULL_MICRO_MODULES` (`ModuleCategory.HULL`). `hullMicromoduleEffectKind` classifies each: defense→maxHull, cargo→hold, energyWeapon→weapon damage, energyEngine→engine speed — applied as a global multiplier in `derivedStats()`. `MicroModuleSchema.targetCategory` **must** include `"HULL"`.

## Gear fit / hull status

- **`gearFit(loadout, gearId)`** in `GearBridge` is the canonical projection of `canInstall` (`fits` / `no-slot` / `over-mass` / `n/a`). Do not re-derive fit logic.
- **`hullStatus(hullHP, shipMaxHull, loadoutMaxHull?)`** (`src/systems/equipment/hullStatus.ts`) is the canonical max-hull read. Never compute `hullHP / ship.maxHull` directly at a call site — `ship.maxHull` can lag the loadout.

## Live ship sync

The live `PlayerShip` carries only in-combat HP/shield/energy pools + `hullClass`; these are projected from the loadout via `applyLoadoutHullToShip(ship, loadout)` at hull-change time. Cargo capacity: `cargoCapacityOf(loadout)`. Repair paths first `applyLoadoutHullToShip` to sync the live ship, then read `hullStatus`.

## Hull swaps

`ShipLoadout.setHull` **returns the gear ids it dropped** (gear that no longer fits a smaller hull); callers return those to the inventory bag. Hangar slot edits use slot-indexed `removeAt`/`applyMicromoduleAt` so the exact clicked copy is targeted.

## Owned-but-uninstalled gear

Canonical home: `Inventory.ownedGearIds`, read **only** through `ownedUninstalledGear(player, loadout)` in `GearBridge`. Transitions: `acquireUninstalledGear` (purchase/loot), `installOwnedGear` (owned → loadout), `uninstallToOwned` (loadout → owned), `jettisonOwnedGear` (owned → discarded, no refund — `InventoryScene`'s jettison action; contrast with `sellUninstalledGear`'s paid path). Both hangar ТРЮМ strips consume this one accessor. Selling: `sellUninstalledGear` (refund `basePrice × 0.4`). Persisted via `InventorySchema.ownedGearIds` (defaults `[]` — no save-version bump).

## Shop/trade-in seams

- `micromoduleShop.ts` (`micromoduleShopCatalog`/`micromodulePrice`/`buyMicromodule`) — only purchase path for CRAFT_CENTER micromodules.
- `sellHull.ts` (`hullTradeInPrice` = `floor(basePrice × 0.4)`, `buyHullWithTradeIn`) — EquipmentShop hull trade-in path (charge new hull + credit old; never hull-less).
- Drag-drop fitting decided purely in `GearBridge` (`evaluateMicromoduleDrop`/`applyMicromoduleDrop`/`micromoduleDropHint` + `micromoduleTargetCategory`).

## Shared hangar component

`src/presentation/ui/HangarPanel.ts` — four category banks + install/unfit + ТРЮМ owned-gear strip, mounted by **both** `StationScene` and `EquipmentShopScene` АНГАР tab. Per-slot micromodule-apply modal: shared `MicromoduleApplyPanel`. Do not fork fit logic into a scene.

## Starter loadout

`GameEngine.starterLoadout()` ships a fresh corvette fully fitted: `eq_engine_i` + `eq_tank` + `wpn_pulse` + `grav_tractor_1`; fitted mass 16 ≤ 40; empty `inventory.modules`/`ownedGearIds`.

## Multi-weapon fire

`CombatModule` fires **every** fitted weapon (`fittedWeapons()`), each on its own `weaponFireTimers` cadence — `weaponFireIntervalMs(weapon)` = `max(1, cooldownTurns) × GAME_BALANCE.combatFireIntervalMs`. Each engaged NPC fires from its own role-scaled reach (`npcWeaponRange`, `src/systems/combat/npcWeapon.ts`: TRADER 200 / PIRATE 260 / RANGER 300 / PATROL 340).

## Residual bag path

The `inventory.modules` bag is still the hangar-unequip target (via `slotToBagModule`, preserves micromodule + upgrade counts) and a purchase fallback. Combat loot lands in `ownedGearIds`. `PlayerShipSchema.modules` stays `.optional()` so pre-v23 saves validate.
