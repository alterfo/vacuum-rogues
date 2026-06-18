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
 * Install an owned-uninstalled item into a free loadout slot, moving its id out
 * of the owned store and into the loadout. Returns false and changes nothing
 * when the item isn't installable (unknown id, a hull, or no free slot).
 */
export function installOwnedGear(
  player: Player,
  loadout: ShipLoadout,
  gearId: string,
): boolean {
  if (!loadout.install(gearId)) return false;
  player.inventory.removeOwnedGear(gearId);
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
 *   `massCapacity`; carries the gear `mass` and current `massFree` for the readout.
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
  return { status: "over-mass", mass: gear.mass, massFree: stats.massFree };
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
 * other equipment the generic EQUIPMENT module. Hulls have no micromodule
 * category here (the hull micromodule is applied by hull, not in this seam).
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

/** Badge colour per gear kind. */
export const KIND_COLOR: Record<GearKind, number> = {
  [GearKind.HULL]: 0x88ccff,
  [GearKind.WEAPON]: 0xff8888,
  [GearKind.EQUIPMENT]: 0x88ffcc,
};
