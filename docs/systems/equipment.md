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

Canonical home: `Inventory.ownedGearIds`, read **only** through `ownedUninstalledGear(player, loadout)` in `GearBridge`. Transitions: `acquireUninstalledGear` (purchase/loot), `installOwnedGear` (owned → loadout), `uninstallToOwned` (loadout → owned), `jettisonOwnedGear` (owned → discarded, no refund — `InventoryScene`'s jettison action; contrast with `sellUninstalledGear`'s paid path). Both hangar ТРЮМ strips consume this one accessor. Selling: `sellUninstalledGear` (refund `basePrice × SELL_RATE (0.4)`). `sellLegacyModule` sells directly out of the legacy `inventory.modules` bag by index (covers starter gear and any other item stuck there pre-`ownedGearIds`) — both share `creditSale` so refund math never drifts. `HangarPanel`'s ТРЮМ rows expose a sell action for **any** installed or owned gear, not just loot. Persisted via `InventorySchema.ownedGearIds` (defaults `[]` — no save-version bump).

## Shop/trade-in seams

- `micromoduleShop.ts` (`micromoduleShopCatalog`/`micromodulePrice`/`buyMicromodule`) — only purchase path for CRAFT_CENTER micromodules.
- `sellHull.ts` (`hullTradeInPrice` = `floor(basePrice × HULL_TRADE_IN_RATE (0.4) × conditionFactor)`, `buyHullWithTradeIn`) — EquipmentShop hull trade-in path (charge new hull + credit old; never hull-less). `conditionFactor = clamp(hullHP/maxHull, HULL_TRADE_IN_CONDITION_FLOOR (0.2), 1)` — a worn-out hull trades in for as little as 20% of the flat rate; a full-health hull still gets the old flat 40%. Both rate and condition floor are read through `getEconomyOverrides()` first (see "Dev economy admin panel" below).
- Drag-drop fitting decided purely in `GearBridge` (`evaluateMicromoduleDrop`/`applyMicromoduleDrop`/`micromoduleDropHint` + `micromoduleTargetCategory`).
- **Hide already-installed gear**: `EquipmentShopScene`'s stock filter drops any listing whose `gear.id` is currently fitted (`installedGearIds()`), on top of the existing hull exclusion — a shop never re-offers what the player already has mounted.
- **Rare-gear uniqueness (mid-game wealth sink)**: gear with `isRareGear(gear)` true (explicit `rare: true`, or any `techLevel ≥ RARE_TECH_THRESHOLD`) marks itself sold-out at the purchasing planet/station for the rest of that shop-refresh bucket after a buy — `Galaxy.soldOutGear: Record<string, number>` (key `soldOutKey(planetId, gearId)`, value = `shopBucket(day)`) is set by both `EquipmentShopScene` and `StationScene`'s buy handlers and read by `generateShop` to skip re-rolling that item until the next bucket. Persisted as `GalaxySchema.soldOutGear` (optional, no migration). Two apex-tier items exist specifically to drain mid/late-game credit surplus: `hull_marauder` (T7, 40 000cr, `minDay: 270`) and `eq_engine_surge` (T7, 38 000cr, `minDay: 270`) — both `rare: true`, so each is a one-shot buy per location per refresh window.

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
resolve to the wrong hull. **A new `HullClass` value must also be added to `PlayerShipSchema.hullClass`'s
hardcoded `z.enum([...])` in `src/validation/schemas.ts`** — `applyLoadoutHullToShip` writes
`ship.hullClass` into the save, and `SaveManager.loadGame` runs `validateSaveState` **before**
migration, so an unlisted value hard-rejects the save (a `.default(...)` only fills `undefined`, not an
invalid string). This widening needs no version bump (existing saves never carry the new value).
`hull_cruiser` has no dedicated ship art yet; `PlayerShipRenderer`'s
`HULL_ART_ALIAS` maps it to reuse `hull_bastion`'s "destroyer" art key (mirrors `NpcShipSprite`'s
OVERMIND→"patrol" reuse-until-drawn pattern) until real art is generated. `hull_freighter`
(Грузовоз) is under the same alias mechanism, mapped to `transport`'s art — **interim only**,
both shipped `heavy_freighter_*.webp` variants are defective AI generations (kaleidoscope /
garbled-fog); revert the alias once proper art is regenerated.

Engine/shield tier-ladder gaps (2026-08-12): `eq_engine_ii`/`eq_engine_iib` (T3/T4) close what was
a `potency` dead-zone between 0.9 and 1.4 on the engine family; `eq_shield_ii`/`eq_shield_iii`/
`eq_shield_v` smooth the T4/T5/T7 shield gaps. `eq_engine_surge` (T7, `minDay: 270`, see uniqueness
above) is the reachable top-tier engine that actually matches `hull_marauder`/`hull_bastion`'s mass
budget — added so the apex hull isn't stuck under-powered. Progression pacing: `GALAXY_MAX_TECH_FLOOR`
6 (was 5, `src/systems/galaxy/systemTechDistribution.ts`) plus a tech-6 weight in
`SYSTEM_TECH_WEIGHTS` let systems naturally roll tech 6 at generation, and `TECH_UPLIFT_DAYS` 180
(was 270, `src/config/balance.ts`) — together these make tech-6 gear (`hull_cruiser`,
`eq_engine_iv`) reachable well before day 270 instead of gated behind it.

Weapon dimensions (`range`, `cooldownTurns`) have real consumers in real-time flight combat, not turn combat: `CombatModule.weaponFireIntervalMs()` derives per-weapon fire cadence from `cooldownTurns`; `pickTargetInRange()`/`advancePlayerWeapons()` bind engagement to each fitted weapon's own `range` (NPC side: `npcWeaponRange()`). No new stat gets added without a consumer landing in the same change.

## Hangar ring UI

`HangarPanel` renders a **presentation-only** ring over the same 4-bank `SlotCategory` domain model (weapon/engine/radar/equipment — unchanged): `renderFittingRing` lays out a central hull-view box (`renderHullArtBox`) flanked by four visual zones via `renderRingZone` — ВООРУЖЕНИЕ (top, weapon bank), СИСТЕМА ДВИЖЕНИЯ (left, engine bank + fitted fuel-tank items), СИСТЕМА ОТСЛЕЖИВАНИЯ (right, radar bank + fitted scanner items), ДОПОЛНИТЕЛЬНОЕ ОБОРУДОВАНИЕ (bottom, remaining equipment-bank items). Each zone still carries the original `${CATEGORY_LABEL[cat]} used/total` header; grouping is visual only. МАССА/СВОБОДНО/СКОРОСТЬ/ЗАЩИТА render as bordered stat chips (`renderHangarStats`) over the same `derivedStats()` data. Below the ring: СКЛАД (owned-uninstalled gear) + ТРЮМ (cargo) in a shared scrollable column (`renderWarehouseAndCargo`), a ВЫБРОСИТЬ/ШЛЮЗ jettison action per row (two-step arm/confirm, no refund — reuses `jettisonOwnedGear`/`Inventory.removeResource`), and a СЕРВИСНЫЙ ЦЕНТР block (`renderServiceCenter`) showing hull repair status via `hullStatus` with a `[Полный ремонт]` button.

**Repair cost seam**: `repairCost(status, ratePerHp = 2)` in `src/systems/equipment/hullStatus.ts` — the hangar's own repair pricing. `StationScene.doRepair`/`PlanetScene.openGarage` still price independently (different rates); unifying them is a separate balance-anchor concern, not folded into this seam.

## Gear icons

`src/presentation/ui/gearIcon.ts` — `gearIconKey(gear)` resolves a per-item `wpn_<class>_<tier>`/`eq_<family>_<tier>` key (tier bucketed low/mid/high from `techLevel`), falling back to the flat family icon (6 shipped WebPs: engine/fuel_tank/laser/radar/repair_droid/shield), then to `undefined` (text-only — always the case in unit/Node test environments, which never preload textures). `mountGearIcon(container, gear, x, y, size)` mounts it via cached `tex()` (eager `icons/` category, outside `LAZY_PREFIXES`). Both `HangarPanel` (fitted slots + СКЛАД rows) and `EquipmentShopScene.renderRows` (shop listings) call the same shared module — never fork icon resolution into a scene. New per-item icon prompts live in `tools/comfyui/asset_prompts.json`'s `icons` category (27 new id-keyed prompts); art generation is a separate GPU-side step, and the no-art state stays fully functional by design (fallback chain above). Below the family-icon fallback: a per-category-glyph fallback for families with no shipped WebP at all, so `mountGearIcon` **always** returns a visible glyph plus a positive x-offset for the label — never a bare icon-less row.

**Icon-forward row layout** (shop + hangar, 2026-08-11/12): both `EquipmentShopScene.renderRows` and `HangarPanel` lay out rows icon-first with **hard width-clamped labels** (truncate + ellipsis at a fixed character budget) instead of the old fixed-fraction columns — this is what fixed the "мешанина" (long names running under the type/price/button columns). Never revert to fraction-of-width columns for gear rows.

**Hover tooltips**: `src/presentation/ui/gearTooltip.ts` (`gearTooltipLines`, mounted by both scenes) renders per-item characteristics — stat line from `gearStatLine` (`src/systems/equipment/gearDisplay.ts`), plus a same-class comparison suffix (`gearComparisonSuffix`/`installedSameClass`) against whatever is currently fitted in that slot, e.g. `(+2 vs Двигатель Тип-I)`. Positioning is numeric-only (row x/y read directly) — PixiJS `Text.width`/`.height` throw under jsdom, so tooltip layout must never depend on measuring rendered text at test time.

## Infocenter ↔ shop stock parity

`InfoService.buildRegistry` must only advertise gear a player can actually walk up and buy. Single lever: it calls the same `generateGalaxyGear`/`generateShop` (`src/systems/equipment/ShopGenerator.ts`) with the same `maxTechLevel`/`priceFactor` derivation (`techLevelWithUplift(sys.techLevel, day)`) that `EquipmentShopScene`/`StationScene` use to build their own live inventory — never hand-roll a second tech-level or price formula for the infocenter view.

- **Inhabited/station gate**: uninhabited planets (`planet.isHabitable === false`) are skipped entirely; only stations that actually sell gear (`stationSellsGear(station.type)`) are included, alongside inhabited planets. `RESEARCH_LAB` stations get a `+1` tech-level bump (capped at 8) and a 1.1× price factor over their system's base — matching the shop-side research-lab uplift.
- Station listings are filtered to `gear.kind !== GearKind.HULL` (stations don't sell hulls; planets do).
- Any future infocenter-visible gear source must be wired through this same `buildRegistry` path — a second ad-hoc listing builder is exactly the bug this task fixed (infocenter previously advertised hulls/gear the real shop's tech-level filter excluded).

## Loadout presets (КОМПЛЕКТАЦИЯ 1/2/3)

`LoadoutPreset` (`src/types/index.ts`) stores gear-id layouts, not copies — presets never bypass slot/mass rules. Pure helpers in `GearBridge.ts`: `captureLoadoutPreset` (snapshot current fit), `upsertLoadoutPreset`/`removeLoadoutPreset` (tab-order-preserving array ops, capped at 3), `applyLoadoutPreset` (unfits everything back to the bag via the normal `[снять]` path, then re-installs each preset slot's gearId from owned stores through the normal `ShipLoadout.install` — missing/sold items skip with a toast, mass/slot caps enforced as always). Hull micromodules are never touched by apply (a fitted one can't be removed by canon; a preset can only add one to a free slot). Persisted as `loadoutPresets?: LoadoutPreset[]` — **optional additive** field (`LoadoutPresetSchema` in `src/validation/schemas.ts`), no migration, no version bump. `HangarPanel.renderPresetTabs` renders `К{n}:` + `[Сохр]`/`[Прим]`/`[X]` in the header; `[Прим]`/`[X]` are dim/unwired when that slot is empty.

## Boarding grapple → enemy disengage/flee

`derivedStats().grappleStrength` (best-fitted-grapple-wins, micromodule-scaled — see "Catalog scope" above) now has a live combat consumer: `NpcBrain`'s flee/disengage decision and `combatManeuver.ts` read the player's grapple strength against `GRAPPLE_HOLD.hullToThreshold` (`src/config/balance.ts`, `0.5`) — a sufficiently strong grapple raises the hull-fraction threshold at which a fleeing NPC can actually break off, and increases the shakedown (board-and-loot) success odds via `NpcShipManager`/`NpcInteractionController`. Before this task, `grappleStrength` was computed but had no gameplay effect past loot-drop odds; a purchased grapple upgrade now visibly changes flee outcomes.

## Dev economy admin panel (dev-only)

`src/dev/EconomyAdminPanel.ts` (`installEconomyAdminPanel`) — an F9-toggled overlay, dynamic-imported from `main.ts` only behind `import.meta.env.DEV` (same pattern as `attachDevAutopilot`), tree-shaken from production builds. Guaranteed production-exclusion is enforced by `src/tests/architecture/economyAdminPanelDevOnly.test.ts` (only `main.ts` may reference the panel, and only via a DEV-gated dynamic import) — never add a second import site.

Reads/writes go through `src/config/economyOverrides.ts` (`EconomyOverrides`/`getEconomyOverrides`/`setEconomyOverride`/`resetEconomyOverrides`/`bumpShopRerollNonce`) — a pure additive override seam consumed via `?? BASE_CONSTANT` fallback by `techLevelWithUplift`, `sellHull.hullTradeInPrice`, and `ShopGenerator.stockCount`/`shopBucket`/`generateShop`. Absent an override, every one of those functions behaves exactly as before — the seam is a no-op in production and in any test that doesn't call `setEconomyOverride`. Panel actions: adjust credits (routed through `adjustPlayerCredits`, never a direct `player.credits` write), advance the day, bump a system's tech level, force a shop re-roll (`bumpShopRerollNonce`), and reset all overrides.
