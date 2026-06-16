import type { Player } from "@/domain/Player";
import type { ShipModule } from "@/domain/ShipModule";
import { WeaponModule, ShieldModule, EngineModule } from "@/domain/ShipModule";
import { GameBusinessException } from "@/exceptions/GameBusinessException";
import { logger } from "@/utils/logger";
import type { ShipLoadout } from "./equipment/ShipLoadout";
import { gearById, GearKind } from "./equipment/GearCatalog";

/**
 * Total fractional speed bonus from every installed EngineModule (its
 * `speedBoost` / `{ type: "speed", value }` stat). A ship fitted with a single
 * `value: 0.2` fast engine returns 0.2, so cruise speed should scale ×1.2.
 *
 * Pure and dependency-free so {@link ShipPhysics}' cruise-speed derivation in
 * the flight scene can read the equipped engine without pulling in the whole
 * EquipmentSystem (Task 10: fast engine had no effect on movement).
 */
export function engineSpeedBonus(ship: {
  modules: readonly (ShipModule | null)[];
}): number {
  return ship.modules
    .filter((m): m is EngineModule => m instanceof EngineModule)
    .reduce((sum, m) => sum + m.speedBoost, 0);
}

/**
 * Equipment System - manages ship module installation, removal, and stat updates
 */
export class EquipmentSystem {
  /**
   * Equip a module from inventory to ship slot
   * @param player Player instance
   * @param moduleId Module ID from inventory
   * @param slot Target slot (0-2)
   */
  equipModule(player: Player, moduleId: string, slot: number): void {
    // Validate slot number
    if (slot < 0 || slot > 2) {
      throw new GameBusinessException(
        "INVALID_SLOT",
        `Invalid equipment slot: ${slot}. Valid slots are 0-2.`,
        { slot },
      );
    }

    // Find module in inventory
    const module = player.inventory.modules.find((m) => m.id === moduleId);
    if (!module) {
      throw new GameBusinessException(
        "MODULE_NOT_FOUND",
        `Module ${moduleId} not found in inventory.`,
        { moduleId },
      );
    }

    // Check if slot is occupied
    const currentModule = player.ship.modules[slot];
    if (currentModule) {
      // Unequip current module first (returns it to inventory)
      this.unequipModule(player, slot);
    }

    // Remove module from inventory
    player.inventory.removeItem(moduleId);

    // Equip module to ship
    player.ship.equipModule(slot, module);

    // Apply module bonuses
    this.applyModuleBonuses(player.ship, module);

    logger.info(`Equipped ${module.name} to slot ${slot}`);
  }

  /**
   * Unequip module from ship slot and return to inventory
   * @param player Player instance
   * @param slot Slot to unequip (0-2)
   */
  unequipModule(player: Player, slot: number): void {
    // Validate slot
    if (slot < 0 || slot > 2) {
      throw new GameBusinessException(
        "INVALID_SLOT",
        `Invalid equipment slot: ${slot}. Valid slots are 0-2.`,
        { slot },
      );
    }

    // Get module from slot
    const module = player.ship.modules[slot];
    if (!module) {
      throw new GameBusinessException(
        "EMPTY_SLOT",
        `Slot ${slot} is already empty.`,
        { slot },
      );
    }

    // Remove module bonuses
    this.removeModuleBonuses(player.ship, module);

    // Unequip from ship
    player.ship.unequipModule(slot);

    // Return to inventory
    player.inventory.addItem(module);

    logger.info(`Unequipped ${module.name} from slot ${slot}`);
  }

  /**
   * Apply module stat bonuses to ship
   */
  private applyModuleBonuses(ship: any, module: ShipModule): void {
    if (module instanceof WeaponModule) {
      // Weapon modules don't directly modify ship stats (used in combat)
      logger.debug(
        `Weapon module ${module.name} equipped: +${module.damage} damage`,
      );
    } else if (module instanceof ShieldModule) {
      ship.maxShields += module.shieldBoost;
      ship.shields = Math.min(
        ship.shields + module.shieldBoost,
        ship.maxShields,
      );
      logger.debug(
        `Shield module ${module.name} equipped: +${module.shieldBoost} shields`,
      );
    } else if (module instanceof EngineModule) {
      ship.speed += module.speedBoost;
      ship.evasion += module.evasionBoost;
      logger.debug(
        `Engine module ${module.name} equipped: +${module.speedBoost} speed, +${module.evasionBoost} evasion`,
      );
    }
  }

  /**
   * Remove module stat bonuses from ship
   */
  private removeModuleBonuses(ship: any, module: ShipModule): void {
    if (module instanceof WeaponModule) {
      // Weapon modules don't modify ship stats
    } else if (module instanceof ShieldModule) {
      ship.maxShields -= module.shieldBoost;
      ship.shields = Math.min(ship.shields, ship.maxShields);
      logger.debug(
        `Shield module ${module.name} removed: -${module.shieldBoost} shields`,
      );
    } else if (module instanceof EngineModule) {
      ship.speed -= module.speedBoost;
      ship.evasion -= module.evasionBoost;
      logger.debug(
        `Engine module ${module.name} removed: -${module.speedBoost} speed, -${module.evasionBoost} evasion`,
      );
    }
  }

  /**
   * Get total weapon damage from all equipped weapons
   */
  getTotalWeaponDamage(player: Player): number {
    let totalDamage = 0;
    for (const module of player.ship.modules) {
      if (module instanceof WeaponModule) {
        totalDamage += module.damage;
      }
    }
    return totalDamage;
  }

  /**
   * Calculate total energy cost for all weapons
   */
  getTotalWeaponEnergyCost(player: Player): number {
    let totalCost = 0;
    for (const module of player.ship.modules) {
      if (module instanceof WeaponModule) {
        totalCost += module.energyCost;
      }
    }
    return totalCost;
  }

  /**
   * Feed a combat-loot drop into the canonical loadout (dual-hull Task 2).
   *
   * Combat loot is rolled straight from `GEAR_CATALOG`, so a drop is identified
   * by its catalog gear id. We install it into a free loadout slot — never
   * replacing fitted gear — and return whether it landed. `false` means the id
   * isn't installable gear (unknown id, or a hull) or the loadout is full, so
   * the caller can fall back to the legacy inventory bag until that bag is
   * retired in Task 5.
   */
  installLoot(loadout: ShipLoadout, gearId: string): boolean {
    const gear = gearById(gearId);
    if (!gear || gear.kind === GearKind.HULL) return false;
    const installed = loadout.install(gearId);
    if (installed) {
      logger.info(`Loot ${gear.name} installed into loadout`);
    }
    return installed;
  }
}
