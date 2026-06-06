import { type FactionType, HullClass, HULL_CLASS_SPECS } from "@/types";
import type { ShipModule } from "./ShipModule";
import { GameBusinessException } from "@/exceptions/GameBusinessException";

export class PlayerShip {
  modules: [ShipModule | null, ShipModule | null, ShipModule | null] = [
    null,
    null,
    null,
  ];

  constructor(
    public readonly id: string,
    public name: string,
    public hullHP: number,
    public maxHull: number,
    public shields: number,
    public maxShields: number,
    public energy: number,
    public maxEnergy: number,
    public speed: number,
    public evasion: number,
    public readonly factionBaseline: FactionType,
    public hullClass: HullClass = HullClass.CORVETTE,
  ) {}

  get weaponSlots(): number {
    return HULL_CLASS_SPECS[this.hullClass].weaponSlots;
  }

  get equipmentSlots(): number {
    return HULL_CLASS_SPECS[this.hullClass].equipmentSlots;
  }

  get cargoCapacity(): number {
    return HULL_CLASS_SPECS[this.hullClass].cargoCapacity;
  }

  equipModule(slot: number, module: ShipModule): void {
    if (slot < 0 || slot > 2) {
      throw new GameBusinessException(
        "INVALID_MODULE_SLOT",
        `Module slot ${slot} is invalid. Valid slots: 0-2.`,
        { slot, moduleId: module.id },
      );
    }
    this.modules[slot] = module;
  }

  unequipModule(slot: number): ShipModule | null {
    if (slot < 0 || slot > 2) {
      throw new GameBusinessException(
        "INVALID_MODULE_SLOT",
        `Module slot ${slot} is invalid. Valid slots: 0-2.`,
        { slot },
      );
    }
    const mod = this.modules[slot];
    this.modules[slot] = null;
    return mod;
  }

  repair(): void {
    this.hullHP = this.maxHull;
    this.shields = this.maxShields;
    this.energy = this.maxEnergy;
  }
}
