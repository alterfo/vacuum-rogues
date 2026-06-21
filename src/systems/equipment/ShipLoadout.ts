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
import type { ShipLoadoutSnapshot } from "@/types";
import {
  GearKind,
  EquipmentClass,
  gearById,
  slotCategoryFor,
  MICRO_MODULES,
  DEFAULT_HULL_MICROMODULE_SLOTS,
  type Gear,
  type HullSpec,
  type WeaponSpec,
  type EquipmentSpec,
  type SlotCategory,
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
  const local = MICROMODULE_CATALOG.find((m) => m.id === id);
  if (local) return local;
  // Bridge the GearCatalog craft micromodules (bought at CRAFT_CENTER stations,
  // dual-hull Task 3): once applied in the hangar they live in the loadout, so
  // the loadout must resolve them too. `bonusTier` maps 1:1 onto `level`
  // (1 = strongest), so the derived-stat bonus is identical to a same-tier
  // amplifier.
  const craft = MICRO_MODULES.find((m) => m.id === id);
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
  /**
   * Per-category slot usage (SR-canon §11.3): the weapon bank, the single
   * engine/radar slots and the shared additional-equipment bank, each as
   * `{used, total}`. `total` comes from the hull (`weaponSlots`/`equipmentSlots`,
   * 1 for engine and 1 for radar).
   */
  readonly categories: Readonly<
    Record<SlotCategory, { readonly used: number; readonly total: number }>
  >;
  /** Σ mass of installed gear (МАССА used). */
  readonly massUsed: number;
  /** The hull's total mass budget (МАССА). */
  readonly massCapacity: number;
  /** Remaining mass budget (СВОБОДНО): `massCapacity − massUsed`. */
  readonly massFree: number;
  readonly weaponDamage: number;
  readonly weaponCount: number;
  readonly speed: number; // 0 with no engine → cannot move
  readonly radarRange: number;
  readonly scannerStrength: number;
  /** Tech level of the best installed scanner — used for NPC scan check. */
  readonly scanPower: number;
  readonly shields: number;
  /** Tech level of the best installed shield generator — used for NPC scan check. */
  readonly shieldPower: number;
  readonly repairRate: number;
  readonly fuelCapacity: number;
  /** Auto-pickup range (px) of the best installed gravity tractor; 0 with none. */
  readonly gravTractorRange: number;
  readonly canTakeOff: boolean;
}

export class ShipLoadout {
  private hullId: string;
  /**
   * Micromodules fitted into the hull's own micromodule slots (canon §11.3,
   * multi-slot per the install/micromodule overhaul). Bounded by the hull's
   * `micromoduleSlots`; a hull swap clears them (the displaced hull's slots no
   * longer exist). Replaces the former single `hullMicromoduleId`.
   */
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

  /** Number of hull micromodule slots this hull provides (1–4). */
  hullMicromoduleSlots(): number {
    return this.hull.micromoduleSlots ?? DEFAULT_HULL_MICROMODULE_SLOTS;
  }

  /** Micromodules currently fitted in the hull's slots (read-only copy). */
  hullMicromodules(): readonly string[] {
    return [...this.hullMicromoduleIds];
  }

  /** Combined hull-micromodule multiplier (product over the fitted hull slots). */
  private hullMult(): number {
    let m = 1;
    for (const id of this.hullMicromoduleIds) m *= this.mult(id);
    return m;
  }

  /**
   * Replace the hull, returning the **full** dropped-slot records (gear id plus
   * any attached micromodule and artifact-upgrade count) for gear that no longer
   * fits a smaller hull. Callers re-bag these losslessly via `slotToBagModule`
   * so the micromodules/artifacts the player spent are not destroyed. Returns an
   * empty array for an invalid hull id (the hull is unchanged) or a no-drop swap.
   */
  swapHull(hullId: string): Array<{
    gearId: string;
    micromoduleId?: string;
    upgrades?: number;
  }> {
    const h = gearById(hullId);
    if (!h || h.kind !== GearKind.HULL) return [];
    this.hullId = hullId;
    const dropped: SlottedGear[] = [];
    // 1. Per-category overflow: drop the last-installed items of any bank that
    //    now exceeds the new hull's capacity. The flat `hull.slots` total is NOT
    //    the real cap under the category model (it omits the dedicated engine +
    //    radar slots, so a valid loadout can hold `slots + 2` items); popping to
    //    it kept over-cap weapons while dropping the engine/radar and leaving an
    //    unflyable ship. Weapon/equipment banks shrink to their new cap; engine/
    //    radar (cap 1) shed any duplicate carried over from a legacy save.
    const cats: SlotCategory[] = ["weapon", "engine", "radar", "equipment"];
    for (const cat of cats) {
      while (this.countByCategory(cat) > this.slotCapacity(cat)) {
        const idx = this.lastIndexInCategory(cat);
        if (idx < 0) break;
        dropped.push(this.slotted.splice(idx, 1)[0]);
      }
    }
    // 2. Mass overflow: a smaller hull also carries less mass budget, so a swap
    //    that stays within every category cap can still be over МАССА. Drop
    //    further gear (preferring non-essential parts so the ship keeps its
    //    engine + fuel and can still take off) until Σ mass fits the new hull.
    while (
      this.usedMass() > this.hull.massCapacity &&
      this.slotted.length > 0
    ) {
      dropped.push(this.slotted.splice(this.lastDroppableForMass(), 1)[0]);
    }
    // The previous hull's micromodule slots no longer exist on the new hull.
    this.hullMicromoduleIds = [];
    return dropped.map((s) => ({
      gearId: s.gearId,
      micromoduleId: s.micromoduleId,
      upgrades: s.upgrades,
    }));
  }

  /** Index of the last-installed item in a category bank, or -1 if none. */
  private lastIndexInCategory(cat: SlotCategory): number {
    for (let i = this.slotted.length - 1; i >= 0; i--) {
      const g = gearById(this.slotted[i].gearId);
      if (g && slotCategoryFor(g) === cat) return i;
    }
    return -1;
  }

  /** A part the ship needs to take off (engine or fuel tank), so mass-eviction keeps it. */
  private isTakeoffEssential(gearId: string): boolean {
    const g = gearById(gearId);
    if (!g || g.kind !== GearKind.EQUIPMENT) return false;
    const cls = (g as EquipmentSpec).equipmentClass;
    return cls === EquipmentClass.ENGINE || cls === EquipmentClass.FUEL_TANK;
  }

  /** Slot to drop when over mass: the last non-essential part, else the last slot. */
  private lastDroppableForMass(): number {
    for (let i = this.slotted.length - 1; i >= 0; i--) {
      if (!this.isTakeoffEssential(this.slotted[i].gearId)) return i;
    }
    return this.slotted.length - 1;
  }

  /**
   * Replace the hull, returning just the dropped gear ids. Thin id-projection
   * over {@link swapHull} for callers that don't need the micromodule/upgrade
   * detail when re-bagging.
   */
  setHull(hullId: string): string[] {
    return this.swapHull(hullId).map((s) => s.gearId);
  }

  /** Gear ids currently installed (excluding the hull). */
  installedGearIds(): string[] {
    return this.slotted.map((s) => s.gearId);
  }

  /**
   * Read view of each occupied slot — gear id, attached micromodule and upgrade
   * count. Used by the hangar panel (dual-hull Task 3) to render the loadout as
   * the editable fitting, replacing the legacy `ship.modules` array.
   */
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

  /** Slots the hull provides for a category (weapon/equipment banks; engine/radar = 1). */
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

  /** How many installed items currently occupy a category's bank. */
  private countByCategory(cat: SlotCategory): number {
    let n = 0;
    for (const s of this.slotted) {
      const g = gearById(s.gearId);
      if (g && slotCategoryFor(g) === cat) n++;
    }
    return n;
  }

  /** Total mass of installed gear (the hull's own frame mass is not counted). */
  private usedMass(): number {
    let m = 0;
    for (const s of this.slotted) {
      m += gearById(s.gearId)?.mass ?? 0;
    }
    return m;
  }

  /**
   * Can this gear be installed right now? The gear must exist and not be a hull,
   * its **category** bank must have room, and it must fit the hull's **mass
   * budget** (МАССА/СВОБОДНО). Weapon and additional-equipment banks reject once
   * full (`hull.weaponSlots`/`equipmentSlots`). Engine and radar are single
   * dedicated slots that always have room — a new one *replaces* the current
   * fitting (SR-canon swap), so the replaced item's mass is freed first. An
   * install is rejected when it would push Σ mass over `hull.massCapacity`,
   * **even if the slot is free** (canon: a heavy bank overloads the ship).
   */
  canInstall(gearId: string): boolean {
    const g = gearById(gearId);
    if (!g || g.kind === GearKind.HULL) return false;
    const cat = slotCategoryFor(g);
    if (!cat) return false;
    const single = cat === "engine" || cat === "radar";
    if (!single && this.countByCategory(cat) >= this.slotCapacity(cat)) {
      return false;
    }
    // Mass budget: a swapped-out single-slot fitting frees its mass first.
    const replacedMass = single ? this.massInSingleSlot(cat) : 0;
    return this.usedMass() - replacedMass + g.mass <= this.hull.massCapacity;
  }

  /** Mass of the item occupying a single-slot category (engine/radar), or 0. */
  private massInSingleSlot(cat: SlotCategory): number {
    const existing = this.slotted.find((s) => {
      const sg = gearById(s.gearId);
      return sg !== undefined && slotCategoryFor(sg) === cat;
    });
    return existing ? (gearById(existing.gearId)?.mass ?? 0) : 0;
  }

  /**
   * Install gear into its category bank. Returns false if it can't be installed.
   * Installing an engine or radar drops the existing one in that single slot so
   * the new fitting replaces it rather than stacking a second copy the hull has
   * no slot for.
   */
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

  /**
   * The gear id occupying the single slot (engine/radar) that installing
   * `gearId` would replace — i.e. the item {@link install} silently drops when
   * it swaps the single fitting. Returns null for a multi-slot category (weapon/
   * equipment), an empty single slot, or an unknown id. Install callers re-home
   * this id (warehouse/bag) so a swap does not *destroy* the paid-for fitting.
   */
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

  /** Remove the first installed copy of this gear. */
  remove(gearId: string): boolean {
    const i = this.slotted.findIndex((s) => s.gearId === gearId);
    if (i < 0) return false;
    this.slotted.splice(i, 1);
    return true;
  }

  /**
   * Remove the installed gear at a specific slot index. Targets the exact slot
   * rather than the first id-match, so the hangar removes the clicked copy even
   * when two identical items are fitted (one possibly micro-modded).
   */
  removeAt(index: number): boolean {
    if (index < 0 || index >= this.slotted.length) return false;
    this.slotted.splice(index, 1);
    return true;
  }

  /** Micromodule attached to the gear at a slot index, if any. */
  micromoduleAt(index: number): string | undefined {
    return this.slotted[index]?.micromoduleId;
  }

  /**
   * Attach a micromodule to an installed item or the hull. One per item, cannot
   * be removed, and rejected if incompatible with the ship's faction.
   */
  applyMicromodule(gearId: string, micromoduleId: string): boolean {
    if (!this.micromoduleAccepted(micromoduleId)) return false;
    if (gearId === this.hullId) {
      // Bounded by the hull's micromodule-slot count (one micromodule per slot).
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

  /**
   * Attach a micromodule to the item at a specific slot index (vs the first
   * id-match in {@link applyMicromodule}). The hangar uses this so a micromodule
   * lands on the exact clicked copy when duplicate gear is fitted. One per item;
   * rejected if incompatible with the ship's faction.
   */
  applyMicromoduleAt(index: number, micromoduleId: string): boolean {
    if (index < 0 || index >= this.slotted.length) return false;
    if (!this.micromoduleAccepted(micromoduleId)) return false;
    const slot = this.slotted[index];
    if (slot.micromoduleId) return false; // one per item
    slot.micromoduleId = micromoduleId;
    return true;
  }

  /** A micromodule exists in the catalog and is compatible with the ship's faction. */
  private micromoduleAccepted(micromoduleId: string): boolean {
    const mm = micromoduleById(micromoduleId);
    if (!mm) return false;
    return !(
      this.faction !== undefined &&
      mm.incompatibleFactions?.includes(this.faction)
    );
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
    const maxHull = Math.round(hull.hp * this.hullMult());
    let weaponDamage = 0;
    let weaponCount = 0;
    // Best engine speed in px/ms: 0.05 + techLevel × 0.03
    let bestEngineSpeed = 0;
    let radarRange = 0;
    let scannerStrength = 0;
    let scanPower = 0;
    let shields = 0;
    let shieldPower = 0;
    let repairRate = 0;
    let fuelCapacity = 0;
    let gravTractorRange = 0;
    let hasEngine = false;
    let hasFuel = false;

    for (const s of this.slotted) {
      const baseGear = gearById(s.gearId);
      if (!baseGear) continue;
      const upgradeBonus = s.upgrades ?? 0;
      // Apply artifact upgrades: each upgrade gives +1 effective techLevel (cap 8).
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
            scanPower = Math.max(scanPower, e.techLevel);
            break;
          case EquipmentClass.SHIELD:
            // tech × 30 HP per shield module; micromodule scales it
            shields += Math.round(e.techLevel * 30 * m);
            shieldPower = Math.max(shieldPower, e.techLevel);
            break;
          case EquipmentClass.REPAIR_DROID:
            // 1 + tech × 0.5 HP/day; take the best droid if multiple installed
            repairRate = Math.max(repairRate, (1 + e.techLevel * 0.5) * m);
            break;
          case EquipmentClass.GRAV_TRACTOR:
            // Auto-pickup range = potency px; best tractor wins, micromodule scales it
            gravTractorRange = Math.max(
              gravTractorRange,
              Math.round(e.potency * m),
            );
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
      // Speed is in px/ms; 0 when no engine installed → cannot move or take off
      speed: hasEngine ? Number(bestEngineSpeed.toFixed(3)) : 0,
      radarRange,
      scannerStrength,
      scanPower,
      shields,
      shieldPower,
      repairRate: Number(repairRate.toFixed(2)),
      fuelCapacity,
      gravTractorRange,
      // Canon §11.4: cannot take off without an engine and a fuel tank.
      canTakeOff: hasEngine && hasFuel,
    };
  }

  /** Serialisable snapshot — persisted in SaveState and restored by fromJSON. */
  toJSON(): ShipLoadoutSnapshot {
    return {
      hullId: this.hullId,
      hullMicromoduleIds: [...this.hullMicromoduleIds],
      slotted: this.slotted.map((s) => ({ ...s })),
    };
  }

  /**
   * Rebuild a loadout from a saved snapshot. Returns null when the hull id is
   * unknown (e.g. a save from a newer catalog); unknown gear/micromodule ids
   * are skipped item-by-item so one bad entry doesn't void the whole loadout.
   */
  static fromJSON(
    snapshot: ShipLoadoutSnapshot,
    faction?: Faction,
  ): ShipLoadout | null {
    const hull = gearById(snapshot.hullId);
    if (!hull || hull.kind !== GearKind.HULL) return null;
    const loadout = new ShipLoadout(snapshot.hullId, faction);
    // New saves carry an array (migration converts the legacy single id). Read a
    // stray legacy `hullMicromoduleId` defensively for any snapshot built the old
    // way (e.g. one that bypassed the save-layer migration). Each id is bounded
    // by the hull's slot count via applyMicromodule.
    const hullMms =
      snapshot.hullMicromoduleIds ??
      (snapshot.hullMicromoduleId ? [snapshot.hullMicromoduleId] : []);
    for (const id of hullMms) {
      loadout.applyMicromodule(snapshot.hullId, id);
    }
    for (const slot of snapshot.slotted) {
      // Restore the saved fitting *as-is* (canon: an existing loadout is read
      // verbatim, no auto-eviction). Going through `install` would re-apply the
      // category/mass caps and silently drop any slot that overflows them — e.g.
      // the v22→v23 migration legitimately packs 3 weapons onto a 2-weapon-slot
      // hull, which `install` would truncate on every load. Unknown gear/hull
      // ids are still skipped item-by-item so one bad entry can't void the rest.
      const g = gearById(slot.gearId);
      if (!g || g.kind === GearKind.HULL) continue;
      const entry: SlottedGear = { gearId: slot.gearId };
      // Bind the micromodule per slot (not via applyMicromodule's first-gearId
      // match, which with two copies of the same gear would drop the second).
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

  /**
   * Returns slotted gear items with their current upgrade counts.
   * Used by ResearchUpgradePanel to list upgradeable equipment.
   */
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

  /**
   * Store a new upgrade count on a slotted item by index.
   * Called by ResearchUpgradePanel after a successful artifact upgrade.
   */
  setSlotUpgrades(slotIndex: number, upgrades: number): boolean {
    if (slotIndex < 0 || slotIndex >= this.slotted.length) return false;
    this.slotted[slotIndex].upgrades = upgrades;
    return true;
  }
}

/** Re-export so callers composing a loadout have the gear types handy. */
export type { Gear };
