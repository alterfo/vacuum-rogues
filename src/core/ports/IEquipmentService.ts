import type { Player } from "@/domain/Player";

/**
 * Port for ship equipment management.
 * Follows SRP: equipment logic separate from GameEngine.
 */
export interface IEquipmentService {
  equipModule(player: Player, moduleId: string, slot: number): void;
  unequipModule(player: Player, slot: number): void;
  getTotalWeaponDamage(player: Player): number;
  getTotalWeaponEnergyCost(player: Player): number;
}
