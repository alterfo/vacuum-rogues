/**
 * Ship loadout & fitting (EPIC-007, US-073/075) over the {@link GearCatalog}.
 *
 * A pure value object: a chosen hull plus gear slotted into the hull's slots,
 * optional micromodules on items, and the derived ship stats that result. It
 * enforces the canon rules (canon §11.3/§11.4): the hull caps the number of
 * slots; a micromodule modifies one item's primary stat, is one-per-item and
 * cannot be removed; some micromodules are faction-incompatible; a ship needs an
 * engine and a fuel tank to take off.
 *
 * No PixiJS/DOM/persistence — fully unit-testable. The equipment-shop UI and the
 * "Корабль" dialog (later) drive this; combat (EPIC-002) reads its derived stats.
 */
import type { Faction } from "@/types/faction";
import {
  GearKind,
  EquipmentClass,
  gearById,
  type Gear,
  type HullSpec,
  type WeaponSpec,
  type EquipmentSpec,
} from "@/systems/equipment/GearCatalog";

/** A micromodule: modifies one item's primary stat (canon §11.3). */
export interface Micromodule {
  readonly id: string;
  readonly name: string;
  /** 1 = strongest, 3 = weakest. */
  readonly level: 1 | 2 | 3;
  /** Factions that reject this micromodule, if any. */
  readonly incompatibleFactions?: Faction[];
}

/** Fractional bonus a micromodule grants by level (level 1 = max). */
export function micromoduleBonus(level: 1 | 2 | 3): number {
  return level === 1 ? 0.2 : level === 2 ? 0.12 : 0.06;
}

const MICROMODULE_CATALOG: Micromodule[] = [
  { id: "mm_amplifier_1", name: "Усилитель ур.1", level: 1 },
  { id: "mm_amplifier_2", name: "Усилитель ур.2", level: 2 },
  { id: "mm_amplifier_3", name: "Усилитель ур.3", level: 3 },
];

export function micromoduleById(id: string): Micromodule | undefined {
  return MICROMODULE_CATALOG.find((m) => m.id === id);
}

interface SlottedGear {
  readonly gearId: string;
  micromoduleId?: string;
}

export interface DerivedStats {
  readonly hull: string; // hull id
  readonly maxHull: number;
  readonly cargo: number;
  readonly slotsTotal: number;
  readonly slotsUsed: number;
  readonly weaponDamage: number;
  readonly weaponCount: number;
  readonly speed: number; // 0 with no engine → cannot move
  readonly radarRange: number;
  readonly scannerStrength: number;
  readonly shields: number;
  readonly repairRate: number;
  readonly fuelCapacity: number;
  readonly canTakeOff: boolean;
}

export class ShipLoadout {
  private hullId: string;
  private hullMicromoduleId?: string;
  private readonly slotted: SlottedGear[] = [];
  private readonly faction?: Faction;

  constructor(hullId: string, faction?: Faction) {
    const hull = gearById(hullId);
    if (!hull || hull.kind !== GearKind.HULL) {
      throw new Error(`ShipLoadout: '${hullId}' is not a valid hull`);
    }
    this.hullId = hullId;
    this.faction = faction;
  }

  get hull(): HullSpec {
    return gearById(this.hullId) as HullSpec;
  }

  /** Replace the hull (keeps slotted gear only if it still fits). */
  setHull(hullId: string): boolean {
    const h = gearById(hullId);
    if (!h || h.kind !== GearKind.HULL) return false;
    this.hullId = hullId;
    // Drop excess gear that no longer fits the new slot count.
    while (this.slotted.length > (h as HullSpec).slots) this.slotted.pop();
    this.hullMicromoduleId = undefined;
    return true;
  }

  /** Gear ids currently installed (excluding the hull). */
  installedGearIds(): string[] {
    return this.slotted.map((s) => s.gearId);
  }

  /** Can this gear be installed right now (exists, not a hull, free slot)? */
  canInstall(gearId: string): boolean {
    const g = gearById(gearId);
    if (!g || g.kind === GearKind.HULL) return false;
    return this.slotted.length < this.hull.slots;
  }

  /** Install gear into a free slot. Returns false if it can't be installed. */
  install(gearId: string): boolean {
    if (!this.canInstall(gearId)) return false;
    this.slotted.push({ gearId });
    return true;
  }

  /** Remove the first installed copy of this gear. */
  remove(gearId: string): boolean {
    const i = this.slotted.findIndex((s) => s.gearId === gearId);
    if (i < 0) return false;
    this.slotted.splice(i, 1);
    return true;
  }

  /**
   * Attach a micromodule to an installed item or the hull. One per item, cannot
   * be removed, and rejected if incompatible with the ship's faction.
   */
  applyMicromodule(gearId: string, micromoduleId: string): boolean {
    const mm = micromoduleById(micromoduleId);
    if (!mm) return false;
    if (
      this.faction !== undefined &&
      mm.incompatibleFactions?.includes(this.faction)
    ) {
      return false;
    }
    if (gearId === this.hullId) {
      if (this.hullMicromoduleId) return false; // one per item
      this.hullMicromoduleId = micromoduleId;
      return true;
    }
    const slot = this.slotted.find((s) => s.gearId === gearId);
    if (!slot || slot.micromoduleId) return false; // not installed / already has one
    slot.micromoduleId = micromoduleId;
    return true;
  }

  /** Multiplier for an item's primary stat from its attached micromodule (if any). */
  private mult(micromoduleId?: string): number {
    if (!micromoduleId) return 1;
    const mm = micromoduleById(micromoduleId);
    return mm ? 1 + micromoduleBonus(mm.level) : 1;
  }

  /** Compute the resulting ship stats from the installed gear. */
  derivedStats(): DerivedStats {
    const hull = this.hull;
    const maxHull = Math.round(hull.hp * this.mult(this.hullMicromoduleId));
    let weaponDamage = 0;
    let weaponCount = 0;
    // Best engine speed in px/ms: 0.05 + techLevel × 0.03
    let bestEngineSpeed = 0;
    let radarRange = 0;
    let scannerStrength = 0;
    let shields = 0;
    let repairRate = 0;
    let fuelCapacity = 0;
    let hasEngine = false;
    let hasFuel = false;

    for (const s of this.slotted) {
      const g = gearById(s.gearId);
      if (!g) continue;
      const m = this.mult(s.micromoduleId);
      if (g.kind === GearKind.WEAPON) {
        weaponDamage += (g as WeaponSpec).damage * m;
        weaponCount++;
      } else if (g.kind === GearKind.EQUIPMENT) {
        const e = g as EquipmentSpec;
        switch (e.equipmentClass) {
          case EquipmentClass.ENGINE: {
            // Higher tech level wins; micromodule scales the derived speed
            const spd = (0.05 + e.techLevel * 0.03) * m;
            if (spd > bestEngineSpeed) bestEngineSpeed = spd;
            hasEngine = true;
            break;
          }
          case EquipmentClass.FUEL_TANK:
            // 50-unit base reserve + tank potency; micromodule scales the whole tank
            fuelCapacity += Math.round((50 + e.potency) * m);
            hasFuel = true;
            break;
          case EquipmentClass.RADAR:
            // 600 base + tech × 200 px; micromodule scales the computed range
            radarRange = Math.max(
              radarRange,
              Math.round((600 + e.techLevel * 200) * m),
            );
            break;
          case EquipmentClass.SCANNER:
            scannerStrength = Math.max(
              scannerStrength,
              Math.round(e.potency * m),
            );
            break;
          case EquipmentClass.SHIELD:
            // tech × 30 HP per shield module; micromodule scales it
            shields += Math.round(e.techLevel * 30 * m);
            break;
          case EquipmentClass.REPAIR_DROID:
            // 1 + tech × 0.5 HP/day; take the best droid if multiple installed
            repairRate = Math.max(repairRate, (1 + e.techLevel * 0.5) * m);
            break;
          case EquipmentClass.GRAPPLE:
            break;
        }
      }
    }

    return {
      hull: this.hullId,
      maxHull,
      cargo: hull.cargo,
      slotsTotal: hull.slots,
      slotsUsed: this.slotted.length,
      weaponDamage: Math.round(weaponDamage),
      weaponCount,
      // Speed is in px/ms; 0 when no engine installed → cannot move or take off
      speed: hasEngine ? Number(bestEngineSpeed.toFixed(3)) : 0,
      radarRange,
      scannerStrength,
      shields,
      repairRate: Number(repairRate.toFixed(2)),
      fuelCapacity,
      // Canon §11.4: cannot take off without an engine and a fuel tank.
      canTakeOff: hasEngine && hasFuel,
    };
  }

  /** Serialisable snapshot (for persistence later). */
  toJSON(): {
    hullId: string;
    hullMicromoduleId?: string;
    slotted: SlottedGear[];
  } {
    return {
      hullId: this.hullId,
      hullMicromoduleId: this.hullMicromoduleId,
      slotted: this.slotted.map((s) => ({ ...s })),
    };
  }
}

/** Re-export so callers composing a loadout have the gear types handy. */
export type { Gear };
