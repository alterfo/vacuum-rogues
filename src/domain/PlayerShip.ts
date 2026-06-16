import { type FactionType, HullClass } from "@/types";

/**
 * The player's live ship: its in-combat HP/shield/energy pools, movement stats,
 * and a `hullClass` label.
 *
 * Ship fitting is NOT modelled here — the canonical {@link ShipLoadout} (over
 * {@link GearCatalog}) is the single source of truth for the hull and every
 * derived stat (cargo, slots, weapon damage, speed, …). The legacy 3-slot
 * `modules` array and the `HULL_CLASS_SPECS` stat getters were removed in the
 * dual-hull unification (Task 5); `hullClass`, `maxHull` and `hullHP` are
 * projected onto this ship from the loadout at hull-change time via
 * {@link applyLoadoutHullToShip}.
 */
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
