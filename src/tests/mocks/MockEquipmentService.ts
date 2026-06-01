import type { IEquipmentService } from "@/core/ports/IEquipmentService";
import type { Player } from "@/domain/Player";

/**
 * Mock implementation of IEquipmentService for testing.
 */
export class MockEquipmentService implements IEquipmentService {
  public equipCalls: Array<{ moduleId: string; slot: number }> = [];
  public unequipCalls: number[] = [];

  equipModule(_player: Player, moduleId: string, slot: number): void {
    this.equipCalls.push({ moduleId, slot });
  }

  unequipModule(_player: Player, slot: number): void {
    this.unequipCalls.push(slot);
  }

  getTotalWeaponDamage(_player: Player): number {
    return 42;
  }

  getTotalWeaponEnergyCost(_player: Player): number {
    return 10;
  }
}
