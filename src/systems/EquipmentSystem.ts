import type { Player } from '@/domain/Player';
import type { ShipModule } from '@/domain/ShipModule';
import { WeaponModule, ShieldModule, EngineModule } from '@/domain/ShipModule';
import { GameBusinessException } from '@/exceptions/GameBusinessException';
import { logger } from '@/utils/logger';

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
        'INVALID_SLOT',
        `Invalid equipment slot: ${slot}. Valid slots are 0-2.`,
        { slot },
      );
    }

    // Find module in inventory
    const module = player.inventory.modules.find((m) => m.id === moduleId);
    if (!module) {
      throw new GameBusinessException(
        'MODULE_NOT_FOUND',
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
        'INVALID_SLOT',
        `Invalid equipment slot: ${slot}. Valid slots are 0-2.`,
        { slot },
      );
    }

    // Get module from slot
    const module = player.ship.modules[slot];
    if (!module) {
      throw new GameBusinessException(
        'EMPTY_SLOT',
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
      logger.debug(`Weapon module ${module.name} equipped: +${module.damage} damage`);
    } else if (module instanceof ShieldModule) {
      ship.maxShields += module.shieldBoost;
      ship.shields = Math.min(ship.shields + module.shieldBoost, ship.maxShields);
      logger.debug(`Shield module ${module.name} equipped: +${module.shieldBoost} shields`);
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
      logger.debug(`Shield module ${module.name} removed: -${module.shieldBoost} shields`);
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
}
