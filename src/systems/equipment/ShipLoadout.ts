import type { Faction } from "@/types/faction";
import type { ShipLoadoutSnapshot } from "@/types";
import {
  GearKind,
  EquipmentClass,
  gearById,
  slotCategoryFor,
  MICRO_MODULES,
  hullMicroModuleById,
  hullMicromoduleEffectKind,
  DEFAULT_HULL_MICROMODULE_SLOTS,
  type Gear,
  type HullSpec,
  type WeaponSpec,
  type EquipmentSpec,
  type SlotCategory,
} from "@/systems/equipment/GearCatalog";

export interface Micromodule {
  readonly id: string;
  readonly name: string;
  readonly level: 1 | 2 | 3;
  readonly incompatibleFactions?: Faction[];
}

export function micromoduleBonus(level: 1 | 2 | 3): number {
  return level === 1 ? 0.2 : level === 2 ? 0.12 : 0.06;
}

const MICROMODULE_CATALOG: Micromodule[] = [
  { id: "mm_amplifier_1", name: "Усилитель ур.1", level: 1 },
  { id: "mm_amplifier_2", name: "Усилитель ур.2", level: 2 },
  { id: "mm_amplifier_3", name: "Усилитель ур.3", level: 3 },
];

export function micromoduleById(id: string): Micromodule | undefined {
  const local = MICROMODULE_CATALOG.find((m) => m.id === id);
  if (local) return local;
  const craft =
    MICRO_MODULES.find((m) => m.id === id) ?? hullMicroModuleById(id);
  return craft
    ? { id: craft.id, name: craft.name, level: craft.bonusTier }
    : undefined;
}

interface SlottedGear {
  readonly gearId: string;
  micromoduleId?: string;
  upgrades?: number;
}

export interface DerivedStats {
  readonly hull: string; // hull id
  readonly maxHull: number;
  readonly cargo: number;
  readonly slotsTotal: number;
  readonly slotsUsed: number;
  readonly categories: Readonly<
    Record<SlotCategory, { readonly used: number; readonly total: number }>
  >;
  readonly massUsed: number;
  readonly massCapacity: number;
  readonly massFree: number;
  readonly weaponDamage: number;
  readonly weaponCount: number;
  readonly speed: number; // 0 with no engine → cannot move
  readonly radarRange: number;
  readonly scannerStrength: number;
  readonly scanPower: number;
  readonly shields: number;
  readonly shieldPower: number;
  readonly repairRate: number;
  readonly fuelCapacity: number;
  readonly gravTractorRange: number;
  readonly grappleStrength: number;
  readonly canTakeOff: boolean;
}

export class ShipLoadout {
  private hullId: string;
  private hullMicromoduleIds: string[] = [];
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

  hullMicromoduleSlots(): number {
    return this.hull.micromoduleSlots ?? DEFAULT_HULL_MICROMODULE_SLOTS;
  }

  hullMicromodules(): readonly string[] {
    return [...this.hullMicromoduleIds];
  }

  private hullEffectMults(): {
    defense: number;
    cargo: number;
    weapon: number;
    engine: number;
  } {
    const mults = { defense: 1, cargo: 1, weapon: 1, engine: 1 };
    for (const id of this.hullMicromoduleIds) {
      mults[hullMicromoduleEffectKind(id)] *= this.mult(id);
    }
    return mults;
  }

  swapHull(hullId: string): Array<{
    gearId: string;
    micromoduleId?: string;
    upgrades?: number;
  }> {
    const h = gearById(hullId);
    if (!h || h.kind !== GearKind.HULL) return [];
    this.hullId = hullId;
    const dropped = this.evictToCurrentHullCapacity();
    this.hullMicromoduleIds = [];
    return dropped.map((s) => ({
      gearId: s.gearId,
      micromoduleId: s.micromoduleId,
      upgrades: s.upgrades,
    }));
  }

  private evictToCurrentHullCapacity(): SlottedGear[] {
    const dropped: SlottedGear[] = [];
    const cats: SlotCategory[] = ["weapon", "engine", "radar", "equipment"];
    for (const cat of cats) {
      while (this.countByCategory(cat) > this.slotCapacity(cat)) {
        const idx = this.lastIndexInCategory(cat);
        if (idx < 0) break;
        dropped.push(this.slotted.splice(idx, 1)[0]);
      }
    }
    while (
      this.usedMass() > this.hull.massCapacity &&
      this.slotted.length > 0
    ) {
      dropped.push(this.slotted.splice(this.lastDroppableForMass(), 1)[0]);
    }
    return dropped;
  }

  revalidateToCurrentHull(): Array<{
    gearId: string;
    micromoduleId?: string;
    upgrades?: number;
  }> {
    return this.evictToCurrentHullCapacity().map((s) => ({
      gearId: s.gearId,
      micromoduleId: s.micromoduleId,
      upgrades: s.upgrades,
    }));
  }

  private lastIndexInCategory(cat: SlotCategory): number {
    for (let i = this.slotted.length - 1; i >= 0; i--) {
      const g = gearById(this.slotted[i].gearId);
      if (g && slotCategoryFor(g) === cat) return i;
    }
    return -1;
  }

  private isTakeoffEssential(gearId: string): boolean {
    const g = gearById(gearId);
    if (!g || g.kind !== GearKind.EQUIPMENT) return false;
    const cls = (g as EquipmentSpec).equipmentClass;
    return cls === EquipmentClass.ENGINE || cls === EquipmentClass.FUEL_TANK;
  }

  private lastDroppableForMass(): number {
    for (let i = this.slotted.length - 1; i >= 0; i--) {
      if (!this.isTakeoffEssential(this.slotted[i].gearId)) return i;
    }
    return this.slotted.length - 1;
  }

  setHull(hullId: string): string[] {
    return this.swapHull(hullId).map((s) => s.gearId);
  }

  installedGearIds(): string[] {
    return this.slotted.map((s) => s.gearId);
  }

  installedSlots(): ReadonlyArray<{
    gearId: string;
    micromoduleId?: string;
    upgrades: number;
  }> {
    return this.slotted.map((s) => ({
      gearId: s.gearId,
      micromoduleId: s.micromoduleId,
      upgrades: s.upgrades ?? 0,
    }));
  }

  private slotCapacity(cat: SlotCategory): number {
    const hull = this.hull;
    switch (cat) {
      case "weapon":
        return hull.weaponSlots;
      case "engine":
        return 1;
      case "radar":
        return 1;
      case "equipment":
        return hull.equipmentSlots;
    }
  }

  private countByCategory(cat: SlotCategory): number {
    let n = 0;
    for (const s of this.slotted) {
      const g = gearById(s.gearId);
      if (g && slotCategoryFor(g) === cat) n++;
    }
    return n;
  }

  private usedMass(): number {
    let m = 0;
    for (const s of this.slotted) {
      m += gearById(s.gearId)?.mass ?? 0;
    }
    return m;
  }

  canInstall(gearId: string): boolean {
    const g = gearById(gearId);
    if (!g || g.kind === GearKind.HULL) return false;
    const cat = slotCategoryFor(g);
    if (!cat) return false;
    const single = cat === "engine" || cat === "radar";
    if (!single && this.countByCategory(cat) >= this.slotCapacity(cat)) {
      return false;
    }
    const replacedMass = single ? this.massInSingleSlot(cat) : 0;
    return this.usedMass() - replacedMass + g.mass <= this.hull.massCapacity;
  }

  private massInSingleSlot(cat: SlotCategory): number {
    const existing = this.slotted.find((s) => {
      const sg = gearById(s.gearId);
      return sg !== undefined && slotCategoryFor(sg) === cat;
    });
    return existing ? (gearById(existing.gearId)?.mass ?? 0) : 0;
  }

  install(gearId: string): boolean {
    if (!this.canInstall(gearId)) return false;
    const g = gearById(gearId) as Gear;
    const cat = slotCategoryFor(g);
    if (cat === "engine" || cat === "radar") {
      const existing = this.slotted.findIndex((s) => {
        const sg = gearById(s.gearId);
        return sg !== undefined && slotCategoryFor(sg) === cat;
      });
      if (existing >= 0) this.slotted.splice(existing, 1);
    }
    this.slotted.push({ gearId });
    return true;
  }

  displacedBy(gearId: string): string | null {
    const g = gearById(gearId);
    if (!g) return null;
    const cat = slotCategoryFor(g);
    if (cat !== "engine" && cat !== "radar") return null;
    const existing = this.slotted.find((s) => {
      const sg = gearById(s.gearId);
      return sg !== undefined && slotCategoryFor(sg) === cat;
    });
    return existing?.gearId ?? null;
  }

  remove(gearId: string): boolean {
    const i = this.slotted.findIndex((s) => s.gearId === gearId);
    if (i < 0) return false;
    this.slotted.splice(i, 1);
    return true;
  }

  removeAt(index: number): boolean {
    if (index < 0 || index >= this.slotted.length) return false;
    this.slotted.splice(index, 1);
    return true;
  }

  micromoduleAt(index: number): string | undefined {
    return this.slotted[index]?.micromoduleId;
  }

  applyMicromodule(gearId: string, micromoduleId: string): boolean {
    if (!this.micromoduleAccepted(micromoduleId)) return false;
    if (gearId === this.hullId) {
      if (this.hullMicromoduleIds.length >= this.hullMicromoduleSlots()) {
        return false;
      }
      this.hullMicromoduleIds.push(micromoduleId);
      return true;
    }
    const slot = this.slotted.find((s) => s.gearId === gearId);
    if (!slot || slot.micromoduleId) return false; // not installed / already has one
    slot.micromoduleId = micromoduleId;
    return true;
  }

  applyMicromoduleAt(index: number, micromoduleId: string): boolean {
    if (index < 0 || index >= this.slotted.length) return false;
    if (!this.micromoduleAccepted(micromoduleId)) return false;
    const slot = this.slotted[index];
    if (slot.micromoduleId) return false; // one per item
    slot.micromoduleId = micromoduleId;
    return true;
  }

  isMicromoduleCompatible(micromoduleId: string): boolean {
    return this.micromoduleAccepted(micromoduleId);
  }

  private micromoduleAccepted(micromoduleId: string): boolean {
    const mm = micromoduleById(micromoduleId);
    if (!mm) return false;
    return !(
      this.faction !== undefined &&
      mm.incompatibleFactions?.includes(this.faction)
    );
  }

  private mult(micromoduleId?: string): number {
    if (!micromoduleId) return 1;
    const mm = micromoduleById(micromoduleId);
    return mm ? 1 + micromoduleBonus(mm.level) : 1;
  }

  derivedStats(): DerivedStats {
    const hull = this.hull;
    const hullEff = this.hullEffectMults();
    const maxHull = Math.round(hull.hp * hullEff.defense);
    let weaponDamage = 0;
    let weaponCount = 0;
    let bestEngineSpeed = 0;
    let radarRange = 0;
    let scannerStrength = 0;
    let scanPower = 0;
    let shields = 0;
    let shieldPower = 0;
    let repairRate = 0;
    let fuelCapacity = 0;
    let gravTractorRange = 0;
    let grappleStrength = 0;
    let hasEngine = false;
    let hasFuel = false;

    for (const s of this.slotted) {
      const baseGear = gearById(s.gearId);
      if (!baseGear) continue;
      const upgradeBonus = s.upgrades ?? 0;
      const g =
        upgradeBonus > 0
          ? {
              ...baseGear,
              techLevel: Math.min(8, baseGear.techLevel + upgradeBonus),
            }
          : baseGear;
      const m = this.mult(s.micromoduleId);
      if (g.kind === GearKind.WEAPON) {
        weaponDamage += (g as WeaponSpec).damage * m;
        weaponCount++;
      } else if (g.kind === GearKind.EQUIPMENT) {
        const e = g as EquipmentSpec;
        switch (e.equipmentClass) {
          case EquipmentClass.ENGINE: {
            const spd = (0.066 + e.techLevel * 0.022) * m;
            if (spd > bestEngineSpeed) bestEngineSpeed = spd;
            hasEngine = true;
            break;
          }
          case EquipmentClass.FUEL_TANK:
            fuelCapacity += Math.round((50 + e.potency) * m);
            hasFuel = true;
            break;
          case EquipmentClass.RADAR: {
            const upgradeRatio =
              upgradeBonus > 0 ? g.techLevel / baseGear.techLevel : 1;
            radarRange = Math.max(
              radarRange,
              Math.round(e.potency * upgradeRatio * m),
            );
            break;
          }
          case EquipmentClass.SCANNER:
            scannerStrength = Math.max(
              scannerStrength,
              Math.round(e.potency * m),
            );
            scanPower = Math.max(scanPower, e.techLevel);
            break;
          case EquipmentClass.SHIELD:
            shields += Math.round(e.techLevel * 30 * m);
            shieldPower = Math.max(shieldPower, e.techLevel);
            break;
          case EquipmentClass.REPAIR_DROID:
            repairRate = Math.max(repairRate, (1 + e.techLevel * 0.5) * m);
            break;
          case EquipmentClass.GRAV_TRACTOR:
            gravTractorRange = Math.max(
              gravTractorRange,
              Math.round(e.potency * m),
            );
            break;
          case EquipmentClass.GRAPPLE:
            grappleStrength = Math.max(
              grappleStrength,
              Math.round(e.potency * m),
            );
            break;
        }
      }
    }

    weaponDamage *= hullEff.weapon;
    bestEngineSpeed *= hullEff.engine;

    return {
      hull: this.hullId,
      maxHull,
      cargo: Math.round(hull.cargo * hullEff.cargo),
      slotsTotal: hull.slots,
      slotsUsed: this.slotted.length,
      categories: {
        weapon: {
          used: this.countByCategory("weapon"),
          total: this.slotCapacity("weapon"),
        },
        engine: {
          used: this.countByCategory("engine"),
          total: this.slotCapacity("engine"),
        },
        radar: {
          used: this.countByCategory("radar"),
          total: this.slotCapacity("radar"),
        },
        equipment: {
          used: this.countByCategory("equipment"),
          total: this.slotCapacity("equipment"),
        },
      },
      massUsed: this.usedMass(),
      massCapacity: hull.massCapacity,
      massFree: hull.massCapacity - this.usedMass(),
      weaponDamage: Math.round(weaponDamage),
      weaponCount,
      speed: hasEngine ? Number(bestEngineSpeed.toFixed(3)) : 0,
      radarRange,
      scannerStrength,
      scanPower,
      shields,
      shieldPower,
      repairRate: Number(repairRate.toFixed(2)),
      fuelCapacity,
      gravTractorRange,
      grappleStrength,
      canTakeOff: hasEngine && hasFuel,
    };
  }

  toJSON(): ShipLoadoutSnapshot {
    return {
      hullId: this.hullId,
      hullMicromoduleIds: [...this.hullMicromoduleIds],
      slotted: this.slotted.map((s) => ({ ...s })),
    };
  }

  static fromJSON(
    snapshot: ShipLoadoutSnapshot,
    faction?: Faction,
  ): ShipLoadout | null {
    const hull = gearById(snapshot.hullId);
    if (!hull || hull.kind !== GearKind.HULL) return null;
    const loadout = new ShipLoadout(snapshot.hullId, faction);
    const hullMms =
      snapshot.hullMicromoduleIds ??
      (snapshot.hullMicromoduleId ? [snapshot.hullMicromoduleId] : []);
    for (const id of hullMms) {
      loadout.applyMicromodule(snapshot.hullId, id);
    }
    for (const slot of snapshot.slotted) {
      const g = gearById(slot.gearId);
      if (!g || g.kind === GearKind.HULL) continue;
      const entry: SlottedGear = { gearId: slot.gearId };
      if (
        slot.micromoduleId &&
        loadout.micromoduleAccepted(slot.micromoduleId)
      ) {
        entry.micromoduleId = slot.micromoduleId;
      }
      if (slot.upgrades) {
        entry.upgrades = slot.upgrades;
      }
      loadout.slotted.push(entry);
    }
    return loadout;
  }

  slottedWithGear(): Array<{
    index: number;
    gearId: string;
    upgrades: number;
    gear: Gear | undefined;
  }> {
    return this.slotted.map((s, i) => ({
      index: i,
      gearId: s.gearId,
      upgrades: s.upgrades ?? 0,
      gear: gearById(s.gearId),
    }));
  }

  setSlotUpgrades(slotIndex: number, upgrades: number): boolean {
    if (slotIndex < 0 || slotIndex >= this.slotted.length) return false;
    this.slotted[slotIndex].upgrades = upgrades;
    return true;
  }
}

export type { Gear };
