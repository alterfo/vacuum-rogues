import { logger } from "@/utils/logger";
import type { ShipLoadout } from "./equipment/ShipLoadout";
import { gearById, GearKind } from "./equipment/GearCatalog";

/**
 * Equipment System — installs catalog gear into the canonical {@link ShipLoadout}.
 *
 * The legacy `ship.modules` fitting (equip/unequip/weapon-totals + the
 * `engineSpeedBonus` helper) was removed in the dual-hull unification (Task 5);
 * the loadout is the single source of truth for fitting and derived stats. What
 * remains is the single seam through which every "acquire gear" flow lands gear
 * in the loadout.
 */
export class EquipmentSystem {
  /**
   * Install a catalog gear item into a free loadout slot (dual-hull Task 2/3).
   *
   * Gear is identified by its `GEAR_CATALOG` id; it installs into a free slot,
   * never replacing fitted gear. Returns `false` when the id isn't installable
   * (unknown, or a hull — hulls are swapped via `setHull`) or the loadout is
   * full, letting the caller fall back to the legacy inventory bag.
   */
  installGear(loadout: ShipLoadout, gearId: string): boolean {
    const gear = gearById(gearId);
    if (!gear || gear.kind === GearKind.HULL) return false;
    const installed = loadout.install(gearId);
    if (installed) {
      logger.info(`${gear.name} installed into loadout`);
    }
    return installed;
  }

  /**
   * Feed a combat-loot drop into the canonical loadout (dual-hull Task 2).
   * Semantic alias for {@link installGear} kept for the combat call site.
   */
  installLoot(loadout: ShipLoadout, gearId: string): boolean {
    return this.installGear(loadout, gearId);
  }
}
