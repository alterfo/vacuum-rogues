import type { IEquipmentService } from "@/core/ports/IEquipmentService";
import type { Player } from "@/domain/Player";
import { EquipmentSystem } from "@/systems/EquipmentSystem";

/**
 * Adapter: makes EquipmentSystem compatible with IEquipmentService port.
 */
export class EquipmentSystemAdapter implements IEquipmentService {
  private readonly delegate = new EquipmentSystem();

  equipModule(player: Player, moduleId: string, slot: number): void {
    this.delegate.equipModule(player, moduleId, slot);
  }

  unequipModule(player: Player, slot: number): void {
    this.delegate.unequipModule(player, slot);
  }

  getTotalWeaponDamage(player: Player): number {
    return this.delegate.getTotalWeaponDamage(player);
  }

  getTotalWeaponEnergyCost(player: Player): number {
    return this.delegate.getTotalWeaponEnergyCost(player);
  }
}
