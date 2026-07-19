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

## Catalog scope (post `20260707-gear-variety-and-hangar`)

45 catalog items: 7 hulls, 12 weapons (4 each of ENERGY/FRAGMENT/MISSILE, T1–T8 ladder), 26 equipment (5 engine, 3 fuel tank, 3 radar, 3 scanner, 3 repair droid, 3 shield, 3 grapple, 3 grav-tractor). Every non-hull/weapon family has ≥3 items spanning the tech ladder — see `src/tests/equipment/catalogInvariants.test.ts` / `weaponCatalogInvariants.test.ts` for the enforced invariants (unique ids, price/mass growth per family, `rare` gating T5+). GRAPPLE went from enum-only to a real 3-item family (`eq_grapple_i/ii/iii`) with a live `derivedStats().grappleStrength` (best-grapple-wins, micromodule-scaled) consumed by `LootDropHandler`. `radarRange` now reads the item's `potency` directly (fixed the old latent tech-formula mismatch) with upgrade scaling preserved via a tech-ratio multiplier.

**Hull lineup** (gear-catalog & garrison-power-ceiling plan, 2026-07-19): `hull_scout` (T2, 55hp) →
`hull_corvette`/`hull_courier` (T3, 140/120hp) → `hull_freighter` (T4, 180hp — the realistic
"battle-ready" ceiling most campaigns reach) → `hull_warden` (T5, 220hp) → `hull_cruiser` (T6, 280hp,
`HullClass.CRUISER`) → `hull_bastion` (T7, 360hp, `rare: true`, apex). `hull_cruiser` fills what was a
single big jump between the common T5 Warden and the rare T7 Bastion; any `techLevel ≥ 6` hull is
automatically `isRareGear()`-gated (`RARE_TECH_THRESHOLD`) regardless of an explicit `rare` flag.
`HullClass` values map 1:1 to catalog hull ids (`MigrationPipeline.hullIdForHullClass` resolves a
legacy save's `hullClass` string via `GEAR_CATALOG.find()`, which returns the **first** match) — a
new hull must get its own `HullClass` value, never reuse an existing one, or old saves silently
resolve to the wrong hull. `hull_cruiser` has no dedicated ship art yet; `PlayerShipRenderer`'s
`HULL_ART_ALIAS` maps it to reuse `hull_bastion`'s "destroyer" art key (mirrors `NpcShipSprite`'s
OVERMIND→"patrol" reuse-until-drawn pattern) until real art is generated.

Weapon dimensions (`range`, `cooldownTurns`) have real consumers in real-time flight combat, not turn combat: `CombatModule.weaponFireIntervalMs()` derives per-weapon fire cadence from `cooldownTurns`; `pickTargetInRange()`/`advancePlayerWeapons()` bind engagement to each fitted weapon's own `range` (NPC side: `npcWeaponRange()`). No new stat gets added without a consumer landing in the same change.

## Hangar ring UI

`HangarPanel` renders a **presentation-only** ring over the same 4-bank `SlotCategory` domain model (weapon/engine/radar/equipment — unchanged): `renderFittingRing` lays out a central hull-view box (`renderHullArtBox`) flanked by four visual zones via `renderRingZone` — ВООРУЖЕНИЕ (top, weapon bank), СИСТЕМА ДВИЖЕНИЯ (left, engine bank + fitted fuel-tank items), СИСТЕМА ОТСЛЕЖИВАНИЯ (right, radar bank + fitted scanner items), ДОПОЛНИТЕЛЬНОЕ ОБОРУДОВАНИЕ (bottom, remaining equipment-bank items). Each zone still carries the original `${CATEGORY_LABEL[cat]} used/total` header; grouping is visual only. МАССА/СВОБОДНО/СКОРОСТЬ/ЗАЩИТА render as bordered stat chips (`renderHangarStats`) over the same `derivedStats()` data. Below the ring: СКЛАД (owned-uninstalled gear) + ТРЮМ (cargo) in a shared scrollable column (`renderWarehouseAndCargo`), a ВЫБРОСИТЬ/ШЛЮЗ jettison action per row (two-step arm/confirm, no refund — reuses `jettisonOwnedGear`/`Inventory.removeResource`), and a СЕРВИСНЫЙ ЦЕНТР block (`renderServiceCenter`) showing hull repair status via `hullStatus` with a `[Полный ремонт]` button.

**Repair cost seam**: `repairCost(status, ratePerHp = 2)` in `src/systems/equipment/hullStatus.ts` — the hangar's own repair pricing. `StationScene.doRepair`/`PlanetScene.openGarage` still price independently (different rates); unifying them is a separate balance-anchor concern, not folded into this seam.

## Gear icons

`src/presentation/ui/gearIcon.ts` — `gearIconKey(gear)` resolves a per-item `wpn_<class>_<tier>`/`eq_<family>_<tier>` key (tier bucketed low/mid/high from `techLevel`), falling back to the flat family icon (6 shipped WebPs: engine/fuel_tank/laser/radar/repair_droid/shield), then to `undefined` (text-only — always the case in unit/Node test environments, which never preload textures). `mountGearIcon(container, gear, x, y, size)` mounts it via cached `tex()` (eager `icons/` category, outside `LAZY_PREFIXES`). Both `HangarPanel` (fitted slots + СКЛАД rows) and `EquipmentShopScene.renderRows` (shop listings) call the same shared module — never fork icon resolution into a scene. New per-item icon prompts live in `tools/comfyui/asset_prompts.json`'s `icons` category (27 new id-keyed prompts); art generation is a separate GPU-side step, and the no-art state stays fully functional by design (fallback chain above).

## Loadout presets (КОМПЛЕКТАЦИЯ 1/2/3)

`LoadoutPreset` (`src/types/index.ts`) stores gear-id layouts, not copies — presets never bypass slot/mass rules. Pure helpers in `GearBridge.ts`: `captureLoadoutPreset` (snapshot current fit), `upsertLoadoutPreset`/`removeLoadoutPreset` (tab-order-preserving array ops, capped at 3), `applyLoadoutPreset` (unfits everything back to the bag via the normal `[снять]` path, then re-installs each preset slot's gearId from owned stores through the normal `ShipLoadout.install` — missing/sold items skip with a toast, mass/slot caps enforced as always). Hull micromodules are never touched by apply (a fitted one can't be removed by canon; a preset can only add one to a free slot). Persisted as `loadoutPresets?: LoadoutPreset[]` — **optional additive** field (`LoadoutPresetSchema` in `src/validation/schemas.ts`), no migration, no version bump. `HangarPanel.renderPresetTabs` renders `К{n}:` + `[Сохр]`/`[Прим]`/`[X]` in the header; `[Прим]`/`[X]` are dim/unwired when that slot is empty.
