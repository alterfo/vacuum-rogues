import { ShipModule } from "@/domain/ShipModule";
import { ModuleCategory } from "@/types";
import type { PlayerShip } from "@/domain/PlayerShip";
import type { ShipLoadout } from "./ShipLoadout";
import {
  GearKind,
  EquipmentClass,
  type Gear,
  type EquipmentSpec,
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
