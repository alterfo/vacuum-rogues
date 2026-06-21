import { ShipModule } from "@/domain/ShipModule";
import { ModuleCategory } from "@/types";
import type { PlayerShip } from "@/domain/PlayerShip";
import type { Player } from "@/domain/Player";
import type { ShipLoadout } from "./ShipLoadout";
import {
  GearKind,
  EquipmentClass,
  gearById,
  slotCategoryFor,
  microModuleById,
  hullMicroModuleById,
  type Gear,
  type EquipmentSpec,
  type SlotCategory,
} from "./GearCatalog";

/** Convert a catalog Gear item to the ShipModule stored in inventory. */
export function gearToModule(gear: Gear): ShipModule {
  return new ShipModule(
    gear.id,
    gear.kind as unknown as ModuleCategory,
    gear.name,
    { type: gear.kind.toLowerCase(), value: gear.techLevel * 10 },
    gear.techLevel,
  );
}

/**
 * Project a loadout slot back into a bag {@link ShipModule} when gear is
 * unfitted in the hangar. The single seam for "slot → bag" so the item's
 * attached micromodule **and** artifact-upgrade count survive the round-trip;
 * re-installing restores both. Without this the upgrades (and the artifacts
 * spent on them) were silently lost on unequip.
 */
export function slotToBagModule(
  gear: Gear,
  slot: { micromoduleId?: string; upgrades?: number },
): ShipModule {
  const mod = gearToModule(gear);
  if (slot.micromoduleId) mod.micromoduleId = slot.micromoduleId;
  if (slot.upgrades) mod.upgrades = slot.upgrades;
  return mod;
}

/**
 * Project the loadout's hull onto the live `PlayerShip` after a hull change.
 *
 * {@link ShipLoadout} is the single source of truth for the hull, but the live
 * ship still carries the in-combat HP pool (`maxHull`/`hullHP`, read by combat
 * and the daily droid repair) and a `hullClass` label (read by scaling/combat
 * code). Both hull shops call this right after `loadout.setHull(...)` so the
 * live ship reflects the new hull — sourced from the loadout's `derivedStats()`,
 * never a parallel `HULL_CLASS_SPECS` lookup, so the two can no longer drift.
 * Replaces the removed `syncShipToHullClass` bridge (dual-hull Task 5).
 */
export function applyLoadoutHullToShip(
  ship: PlayerShip,
  loadout: ShipLoadout,
): void {
  ship.hullClass = loadout.hull.hullClass;
  const maxHull = loadout.derivedStats().maxHull;
  ship.maxHull = maxHull;
  ship.hullHP = Math.min(ship.hullHP, maxHull);
}

/**
 * Authoritative cargo capacity for the player's ship.
 *
 * {@link ShipLoadout} is the single source of truth for derived stats, so the
 * hold size is the loadout hull's `cargo` (via `derivedStats().cargo`). With the
 * legacy `ship.cargoCapacity` getter removed (Task 5) there is no per-ship
 * fallback; a missing loadout means no hold (0). Both the trade UI and the NPC
 * cargo logic read through here so they never diverge from the loadout.
 */
export function cargoCapacityOf(
  loadout: ShipLoadout | null | undefined,
): number {
  return loadout ? loadout.derivedStats().cargo : 0;
}

/**
 * Owned-but-uninstalled gear ids = the inventory's `ownedGearIds` store, which is
 * the authoritative uninstalled set: a purchase/loot with no free slot is added
 * (`acquireUninstalledGear`), installing removes the id (`installOwnedGear`), and
 * unequipping adds it back (`uninstallToOwned`), so an installed copy is never in
 * the store. The single accessor both the station hangar and the equipment-shop
 * ТРЮМ view read, so the "what can I sell" list can never diverge between scenes.
 *
 * Do **not** subtract the loadout's installed ids: a player can own a *spare*
 * copy of gear that is also fitted (e.g. bought a second engine with every slot
 * full). That spare is a distinct item — subtracting it would hide a paid-for,
 * sellable copy and silently strand the credits spent on it.
 */
export function ownedUninstalledGear(
  player: Player,
  _loadout?: ShipLoadout | null,
): string[] {
  return [...(player.inventory.ownedGearIds ?? [])];
}

/**
 * Acquire gear that was not auto-installed — a purchase or loot drop with no
 * free loadout slot — into the owned-uninstalled store.
 */
export function acquireUninstalledGear(player: Player, gearId: string): void {
  player.inventory.addOwnedGear(gearId);
}

/**
 * Legacy starter-module ids → the catalog gear they should become.
 *
 * The dual-hull unification left pre-loadout {@link ShipModule}s in the
 * `inventory.modules` bag whose ids are **not** catalog gear ids (the "Residual"
 * in CLAUDE.md) — e.g. the new-game starter trio "Лазер МК-1" / "Базовый щит" /
 * "Быстрый двигатель". With no `gearById` match they can't be installed (the
 * hangar gates its install button on a catalog lookup), so they sit stranded in
 * the hold. This table maps each to the nearest catalog equivalent so it becomes
 * installable owned gear.
 */
const LEGACY_MODULE_GEAR_MAP: Record<string, string> = {
  weapon_laser_1: "wpn_pulse", // «Лазер МК-1» → Импульсный лазер
  shield_basic_1: "eq_shield", // «Базовый щит» → Генератор поля
  engine_fast_1: "eq_engine_i", // «Быстрый двигатель» → Двигатель Тип-I
};

/** Fallback by {@link ModuleCategory} for any other legacy bag module. */
const LEGACY_CATEGORY_GEAR: Record<string, string> = {
  WEAPON: "wpn_pulse",
  SHIELD: "eq_shield",
  ENGINE: "eq_engine_i",
  EQUIPMENT: "eq_scanner",
};

/**
 * Map a legacy `inventory.modules` bag entry to the catalog gear id it should
 * become so it can be installed via the canonical loadout. Returns `undefined`
 * when the entry is **already** a catalog gear id (a legit spare — left in the
 * bag untouched) or has no sensible catalog equivalent. An explicit starter-trio
 * mapping takes priority; otherwise the module's `category` picks a generic
 * catalog item of that family.
 */
export function legacyModuleToGearId(module: {
  id: string;
  category?: string;
}): string | undefined {
  if (gearById(module.id)) return undefined;
  const explicit = LEGACY_MODULE_GEAR_MAP[module.id];
  if (explicit) return explicit;
  if (module.category) return LEGACY_CATEGORY_GEAR[module.category];
  return undefined;
}

/**
 * Convert legacy bag artifacts (dual-hull residual) into installable owned gear.
 *
 * Each `inventory.modules` entry that maps to a catalog gear (via
 * {@link legacyModuleToGearId}) is moved into `ownedGearIds` and dropped from the
 * bag; entries with no catalog equivalent (and legit catalog-id spares) are left
 * in place — no data loss. Returns the number converted. Idempotent: once the
 * bag is drained of mappable entries a re-run is a no-op. The migration applies
 * the same conversion to old saves at the JSON level (MigrationPipeline v24→v25).
 */
export function convertLegacyBagToOwnedGear(player: Player): number {
  const bag = player.inventory.modules;
  let converted = 0;
  for (let i = bag.length - 1; i >= 0; i--) {
    const gearId = legacyModuleToGearId(bag[i]);
    if (!gearId) continue;
    player.inventory.addOwnedGear(gearId);
    bag.splice(i, 1);
    converted++;
  }
  return converted;
}

/**
 * Install an owned-uninstalled item into a free loadout slot, moving its id out
 * of the owned store and into the loadout. Returns false and changes nothing
 * when the item isn't installable (unknown id, a hull, or no free slot).
 */
export function installOwnedGear(
  player: Player,
  loadout: ShipLoadout,
  gearId: string,
): boolean {
  // Installing an engine/radar replaces the single fitting in that slot; capture
  // the displaced id first so it returns to the owned store instead of being
  // destroyed (canon: the swapped-out part goes back to your stock).
  const displaced = loadout.displacedBy(gearId);
  if (!loadout.install(gearId)) return false;
  player.inventory.removeOwnedGear(gearId);
  if (displaced) player.inventory.addOwnedGear(displaced);
  return true;
}

/**
 * Unequip the gear at a loadout slot index back into the owned-uninstalled
 * store. Returns false (and changes nothing) for an out-of-range slot.
 */
export function uninstallToOwned(
  player: Player,
  loadout: ShipLoadout,
  slotIndex: number,
): boolean {
  const slot = loadout.installedSlots()[slotIndex];
  if (!slot) return false;
  if (!loadout.removeAt(slotIndex)) return false;
  player.inventory.addOwnedGear(slot.gearId);
  return true;
}

/**
 * Whether a piece of gear would fit the current loadout if it were installed,
 * and — when it wouldn't — why. A pure projection of {@link ShipLoadout.canInstall}
 * into a structured result so the equipment shop can show a per-listing "fits /
 * no free <category> slot / over mass" indicator **before** purchase, and the
 * hangar can phrase its install-block toast, both from the one source of truth.
 *
 * - `fits` — the gear's category bank has room and it stays within the mass budget.
 * - `no-slot` — the weapon/equipment bank is full (engine/radar always have room:
 *   a new one replaces the current single fitting, so they never report `no-slot`).
 * - `over-mass` — a slot is free but installing would push Σ mass over the hull's
 *   `massCapacity`; carries the gear `mass` and the *effective* `massFree` for the
 *   readout (for an engine/radar swap the displaced fitting's mass is credited
 *   back first, so the deficit shown matches the real overflow after the swap).
 * - `n/a` — the id is unknown or names a hull (the ship itself, not a slotted item).
 */
export type GearFit =
  | { status: "fits" }
  | { status: "no-slot"; category: SlotCategory; used: number; total: number }
  | { status: "over-mass"; mass: number; massFree: number }
  | { status: "n/a" };

export function gearFit(loadout: ShipLoadout, gearId: string): GearFit {
  const gear = gearById(gearId);
  if (!gear || gear.kind === GearKind.HULL) return { status: "n/a" };
  if (loadout.canInstall(gearId)) return { status: "fits" };
  const cat = slotCategoryFor(gear);
  const stats = loadout.derivedStats();
  if (cat && cat !== "engine" && cat !== "radar") {
    const c = stats.categories[cat];
    if (c.used >= c.total) {
      return { status: "no-slot", category: cat, used: c.used, total: c.total };
    }
  }
  // An engine/radar swap frees the displaced fitting's mass first, so the free
  // budget the player effectively has is `massFree + that displaced mass`.
  const displaced = loadout.displacedBy(gearId);
  const replacedMass = displaced ? (gearById(displaced)?.mass ?? 0) : 0;
  return {
    status: "over-mass",
    mass: gear.mass,
    massFree: stats.massFree + replacedMass,
  };
}

/** Russian display label per gear kind. */
export const KIND_LABEL: Record<GearKind, string> = {
  [GearKind.HULL]: "Корпус",
  [GearKind.WEAPON]: "Оружие",
  [GearKind.EQUIPMENT]: "Снаряжение",
};

/**
 * Which micromodule `targetCategory` matches a piece of installed gear.
 *
 * Micromodules are bucketed by {@link ModuleCategory}; loadout gear is bucketed
 * by {@link GearKind}/{@link EquipmentClass}. The hangar uses this to offer only
 * compatible micromodules for a fitted item (dual-hull Task 3): a weapon takes a
 * WEAPON module, an engine an ENGINE module, a shield a SHIELD module, and every
 * other equipment the generic EQUIPMENT module. Hulls have no *fitted-gear*
 * micromodule category here — hull micromodules target the hull directly
 * (ModuleCategory.HULL) and are matched by {@link micromoduleTargetCategory},
 * not this seam.
 */
export function gearMicromoduleCategory(gear: Gear): ModuleCategory | null {
  if (gear.kind === GearKind.WEAPON) return ModuleCategory.WEAPON;
  if (gear.kind === GearKind.EQUIPMENT) {
    const cls = (gear as EquipmentSpec).equipmentClass;
    if (cls === EquipmentClass.ENGINE) return ModuleCategory.ENGINE;
    if (cls === EquipmentClass.SHIELD) return ModuleCategory.SHIELD;
    return ModuleCategory.EQUIPMENT;
  }
  return null;
}

/**
 * The {@link ModuleCategory} a micromodule *targets*, resolved across both
 * catalogs — the 4-category gear modules ({@link microModuleById}) and the hull
 * family ({@link hullMicroModuleById}, `ModuleCategory.HULL`). The inverse of
 * {@link gearMicromoduleCategory}: given a micromodule it tells you what kind of
 * slot accepts it, so the drag-drop fitting (Task 6) can reject an
 * energy-redirect hull module dropped on a weapon, or a weapon module dropped on
 * the hull. Returns `undefined` for an unknown id.
 */
export function micromoduleTargetCategory(
  id: string,
): ModuleCategory | undefined {
  return (microModuleById(id) ?? hullMicroModuleById(id))?.targetCategory;
}

// ── Drag-and-drop micromodule fitting (overhaul Task 6) ──────────────────────

/**
 * Where a dragged micromodule was dropped: onto a fitted gear slot (by flat slot
 * index, so the exact clicked copy is targeted with duplicate gear) or onto the
 * hull's own micromodule bank.
 */
export type MicromoduleDropTarget =
  | { readonly kind: "gear"; readonly slotIndex: number }
  | { readonly kind: "hull" };

/**
 * The outcome of dropping a micromodule on a target — `"ok"` means it fits and
 * (for {@link applyMicromoduleDrop}) was applied; every other value is a reject
 * reason the UI turns into a clear hint via {@link micromoduleDropHint}.
 */
export type MicromoduleDropOutcome =
  | "ok"
  | "unknown" // not a real micromodule id
  | "no-target" // dropped on an empty/invalid gear slot
  | "wrong-category" // module category ≠ what the target accepts
  | "occupied" // gear slot already holds a micromodule (one per item)
  | "hull-full" // no free hull micromodule slot
  | "incompatible"; // rejected by the ship's faction

/**
 * Pure decision for a drag-drop: does `micromoduleId` fit `target` on `loadout`?
 * Reuses the canonical accessors — `micromoduleTargetCategory` /
 * `gearMicromoduleCategory` for the slot-vs-category match, the loadout's hull
 * bank counts for slot limits, and `loadout.isMicromoduleCompatible` for the
 * faction gate — so there is no new fit logic, only routing the existing rules
 * to a structured reason. The apply methods (`applyMicromoduleAt` /
 * `applyMicromodule`) do NOT themselves check the module *category*, so this
 * gate is load-bearing: it stops a weapon module landing on the hull, or a hull
 * module on a weapon.
 */
export function evaluateMicromoduleDrop(
  loadout: ShipLoadout,
  target: MicromoduleDropTarget,
  micromoduleId: string,
): MicromoduleDropOutcome {
  const category = micromoduleTargetCategory(micromoduleId);
  if (category === undefined) return "unknown";
  if (!loadout.isMicromoduleCompatible(micromoduleId)) return "incompatible";

  if (target.kind === "hull") {
    if (category !== ModuleCategory.HULL) return "wrong-category";
    if (loadout.hullMicromodules().length >= loadout.hullMicromoduleSlots()) {
      return "hull-full";
    }
    return "ok";
  }

  // Gear slot.
  const slot = loadout.installedSlots()[target.slotIndex];
  if (!slot) return "no-target";
  const gear = gearById(slot.gearId);
  if (!gear) return "no-target";
  if (slot.micromoduleId) return "occupied";
  if (gearMicromoduleCategory(gear) !== category) return "wrong-category";
  return "ok";
}

/**
 * Evaluate then apply a drag-dropped micromodule. On `"ok"` it mutates the
 * loadout via the canonical apply method for the target kind; otherwise it
 * leaves the loadout untouched and returns the reject reason. The caller
 * consumes the micromodule from inventory only when this returns `"ok"`.
 */
export function applyMicromoduleDrop(
  loadout: ShipLoadout,
  target: MicromoduleDropTarget,
  micromoduleId: string,
): MicromoduleDropOutcome {
  const outcome = evaluateMicromoduleDrop(loadout, target, micromoduleId);
  if (outcome !== "ok") return outcome;
  const applied =
    target.kind === "hull"
      ? loadout.applyMicromodule(loadout.hull.id, micromoduleId)
      : loadout.applyMicromoduleAt(target.slotIndex, micromoduleId);
  // evaluate already proved the slot/faction/category — a false here would be a
  // logic drift between the two, so surface it rather than silently swallow it.
  return applied ? "ok" : "no-target";
}

/** Player-facing Russian hint for a rejected micromodule drop. */
export function micromoduleDropHint(outcome: MicromoduleDropOutcome): string {
  switch (outcome) {
    case "ok":
      return "Микромодуль установлен";
    case "unknown":
      return "Неизвестный микромодуль";
    case "no-target":
      return "Перетащите на установленный модуль или корпус";
    case "wrong-category":
      return "Микромодуль не подходит к этому слоту";
    case "occupied":
      return "В этом модуле уже есть микромодуль";
    case "hull-full":
      return "Нет свободных слотов корпуса";
    case "incompatible":
      return "Фракция корабля отвергает этот микромодуль";
  }
}

/** Badge colour per gear kind. */
export const KIND_COLOR: Record<GearKind, number> = {
  [GearKind.HULL]: 0x88ccff,
  [GearKind.WEAPON]: 0xff8888,
  [GearKind.EQUIPMENT]: 0x88ffcc,
};
