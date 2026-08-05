import { type FactionType, HullClass } from "@/types";

export class PlayerShip {
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

  repair(): void {
    this.hullHP = this.maxHull;
    this.shields = this.maxShields;
    this.energy = this.maxEnergy;
  }
}
