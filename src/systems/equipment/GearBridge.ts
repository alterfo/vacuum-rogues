import { ShipModule } from "@/domain/ShipModule";
import { ModuleCategory } from "@/types";
import type { PlayerShip } from "@/domain/PlayerShip";
import type { Player } from "@/domain/Player";
import type { ShipLoadout } from "./ShipLoadout";
import type { LoadoutPreset, LoadoutPresetName } from "@/types";
import {
  GearKind,
  EquipmentClass,
  gearById,
  slotCategoryFor,
  microModuleById,
  hullMicroModuleById,
  type Gear,
  type EquipmentSpec,
  type SlotCategory,
} from "./GearCatalog";

export function gearToModule(gear: Gear): ShipModule {
  return new ShipModule(
    gear.id,
    gear.kind as unknown as ModuleCategory,
    gear.name,
    { type: gear.kind.toLowerCase(), value: gear.techLevel * 10 },
    gear.techLevel,
  );
}

export function slotToBagModule(
  gear: Gear,
  slot: { micromoduleId?: string; upgrades?: number },
): ShipModule {
  const mod = gearToModule(gear);
  if (slot.micromoduleId) mod.micromoduleId = slot.micromoduleId;
  if (slot.upgrades) mod.upgrades = slot.upgrades;
  return mod;
}

export function applyLoadoutHullToShip(
  ship: PlayerShip,
  loadout: ShipLoadout,
): void {
  ship.hullClass = loadout.hull.hullClass;
  const maxHull = loadout.derivedStats().maxHull;
  ship.maxHull = maxHull;
  ship.hullHP = Math.min(ship.hullHP, maxHull);
}

export function cargoCapacityOf(
  loadout: ShipLoadout | null | undefined,
): number {
  return loadout ? loadout.derivedStats().cargo : 0;
}

export function ownedUninstalledGear(
  player: Player,
  _loadout?: ShipLoadout | null,
): string[] {
  return [...(player.inventory.ownedGearIds ?? [])];
}

export function acquireUninstalledGear(player: Player, gearId: string): void {
  player.inventory.addOwnedGear(gearId);
}

const LEGACY_MODULE_GEAR_MAP: Record<string, string> = {
  weapon_laser_1: "wpn_pulse", // «Лазер МК-1» → Импульсный лазер
  shield_basic_1: "eq_shield", // «Базовый щит» → Генератор поля
  engine_fast_1: "eq_engine_i", // «Быстрый двигатель» → Двигатель Тип-I
};

const LEGACY_CATEGORY_GEAR: Record<string, string> = {
  WEAPON: "wpn_pulse",
  SHIELD: "eq_shield",
  ENGINE: "eq_engine_i",
  EQUIPMENT: "eq_scanner",
};

export function legacyModuleToGearId(module: {
  id: string;
  category?: string;
}): string | undefined {
  if (gearById(module.id)) return undefined;
  const explicit = LEGACY_MODULE_GEAR_MAP[module.id];
  if (explicit) return explicit;
  if (module.category) return LEGACY_CATEGORY_GEAR[module.category];
  return undefined;
}

export function convertLegacyBagToOwnedGear(player: Player): number {
  const bag = player.inventory.modules;
  let converted = 0;
  for (let i = bag.length - 1; i >= 0; i--) {
    const gearId = legacyModuleToGearId(bag[i]);
    if (!gearId) continue;
    player.inventory.addOwnedGear(gearId);
    bag.splice(i, 1);
    converted++;
  }
  return converted;
}

export function installOwnedGear(
  player: Player,
  loadout: ShipLoadout,
  gearId: string,
): boolean {
  const displaced = loadout.displacedBy(gearId);
  if (!loadout.install(gearId)) return false;
  player.inventory.removeOwnedGear(gearId);
  if (displaced) player.inventory.addOwnedGear(displaced);
  return true;
}

export function jettisonOwnedGear(player: Player, gearId: string): boolean {
  return player.inventory.removeOwnedGear(gearId);
}

export function uninstallToOwned(
  player: Player,
  loadout: ShipLoadout,
  slotIndex: number,
): boolean {
  const slot = loadout.installedSlots()[slotIndex];
  if (!slot) return false;
  if (!loadout.removeAt(slotIndex)) return false;
  player.inventory.addOwnedGear(slot.gearId);
  return true;
}

export type GearFit =
  | { status: "fits" }
  | { status: "no-slot"; category: SlotCategory; used: number; total: number }
  | { status: "over-mass"; mass: number; massFree: number }
  | { status: "n/a" };

export function gearFit(loadout: ShipLoadout, gearId: string): GearFit {
  const gear = gearById(gearId);
  if (!gear || gear.kind === GearKind.HULL) return { status: "n/a" };
  if (loadout.canInstall(gearId)) return { status: "fits" };
  const cat = slotCategoryFor(gear);
  const stats = loadout.derivedStats();
  if (cat && cat !== "engine" && cat !== "radar") {
    const c = stats.categories[cat];
    if (c.used >= c.total) {
      return { status: "no-slot", category: cat, used: c.used, total: c.total };
    }
  }
  const displaced = loadout.displacedBy(gearId);
  const replacedMass = displaced ? (gearById(displaced)?.mass ?? 0) : 0;
  return {
    status: "over-mass",
    mass: gear.mass,
    massFree: stats.massFree + replacedMass,
  };
}

export const KIND_LABEL: Record<GearKind, string> = {
  [GearKind.HULL]: "Корпус",
  [GearKind.WEAPON]: "Оружие",
  [GearKind.EQUIPMENT]: "Снаряжение",
};

export function gearMicromoduleCategory(gear: Gear): ModuleCategory | null {
  if (gear.kind === GearKind.WEAPON) return ModuleCategory.WEAPON;
  if (gear.kind === GearKind.EQUIPMENT) {
    const cls = (gear as EquipmentSpec).equipmentClass;
    if (cls === EquipmentClass.ENGINE) return ModuleCategory.ENGINE;
    if (cls === EquipmentClass.SHIELD) return ModuleCategory.SHIELD;
    return ModuleCategory.EQUIPMENT;
  }
  return null;
}

export function micromoduleTargetCategory(
  id: string,
): ModuleCategory | undefined {
  return (microModuleById(id) ?? hullMicroModuleById(id))?.targetCategory;
}

export type MicromoduleDropTarget =
  | { readonly kind: "gear"; readonly slotIndex: number }
  | { readonly kind: "hull" };

export type MicromoduleDropOutcome =
  | "ok"
  | "unknown" // not a real micromodule id
  | "no-target" // dropped on an empty/invalid gear slot
  | "wrong-category" // module category ≠ what the target accepts
  | "occupied" // gear slot already holds a micromodule (one per item)
  | "hull-full" // no free hull micromodule slot
  | "incompatible"; // rejected by the ship's faction

export function evaluateMicromoduleDrop(
  loadout: ShipLoadout,
  target: MicromoduleDropTarget,
  micromoduleId: string,
): MicromoduleDropOutcome {
  const category = micromoduleTargetCategory(micromoduleId);
  if (category === undefined) return "unknown";
  if (!loadout.isMicromoduleCompatible(micromoduleId)) return "incompatible";

  if (target.kind === "hull") {
    if (category !== ModuleCategory.HULL) return "wrong-category";
    if (loadout.hullMicromodules().length >= loadout.hullMicromoduleSlots()) {
      return "hull-full";
    }
    return "ok";
  }

  const slot = loadout.installedSlots()[target.slotIndex];
  if (!slot) return "no-target";
  const gear = gearById(slot.gearId);
  if (!gear) return "no-target";
  if (slot.micromoduleId) return "occupied";
  if (gearMicromoduleCategory(gear) !== category) return "wrong-category";
  return "ok";
}

export function applyMicromoduleDrop(
  loadout: ShipLoadout,
  target: MicromoduleDropTarget,
  micromoduleId: string,
): MicromoduleDropOutcome {
  const outcome = evaluateMicromoduleDrop(loadout, target, micromoduleId);
  if (outcome !== "ok") return outcome;
  const applied =
    target.kind === "hull"
      ? loadout.applyMicromodule(loadout.hull.id, micromoduleId)
      : loadout.applyMicromoduleAt(target.slotIndex, micromoduleId);
  return applied ? "ok" : "no-target";
}

export function micromoduleDropHint(outcome: MicromoduleDropOutcome): string {
  switch (outcome) {
    case "ok":
      return "Микромодуль установлен";
    case "unknown":
      return "Неизвестный микромодуль";
    case "no-target":
      return "Перетащите на установленный модуль или корпус";
    case "wrong-category":
      return "Микромодуль не подходит к этому слоту";
    case "occupied":
      return "В этом модуле уже есть микромодуль";
    case "hull-full":
      return "Нет свободных слотов корпуса";
    case "incompatible":
      return "Фракция корабля отвергает этот микромодуль";
  }
}

export const KIND_COLOR: Record<GearKind, number> = {
  [GearKind.HULL]: 0x88ccff,
  [GearKind.WEAPON]: 0xff8888,
  [GearKind.EQUIPMENT]: 0x88ffcc,
};

export function captureLoadoutPreset(
  name: LoadoutPresetName,
  loadout: ShipLoadout,
): LoadoutPreset {
  return {
    name,
    slots: loadout.installedSlots().map((s) => ({
      gearId: s.gearId,
      micromoduleId: s.micromoduleId,
      upgrades: s.upgrades || undefined,
    })),
    hullMicromoduleIds: loadout.hullMicromodules(),
  };
}

export function upsertLoadoutPreset(
  presets: readonly LoadoutPreset[],
  preset: LoadoutPreset,
): LoadoutPreset[] {
  const idx = presets.findIndex((p) => p.name === preset.name);
  if (idx < 0) return [...presets, preset];
  const next = [...presets];
  next[idx] = preset;
  return next;
}

export function removeLoadoutPreset(
  presets: readonly LoadoutPreset[],
  name: LoadoutPresetName,
): LoadoutPreset[] {
  return presets.filter((p) => p.name !== name);
}

export interface LoadoutPresetApplyResult {
  readonly applied: string[];
  readonly skipped: string[];
}

export function applyLoadoutPreset(
  player: Player,
  loadout: ShipLoadout,
  preset: LoadoutPreset,
): LoadoutPresetApplyResult {
  for (let i = loadout.installedSlots().length - 1; i >= 0; i--) {
    const slot = loadout.installedSlots()[i];
    const gear = gearById(slot.gearId);
    if (gear && loadout.removeAt(i)) {
      player.inventory.addItem(slotToBagModule(gear, slot));
    }
  }

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const presetSlot of preset.slots) {
    if (
      installFromBagOrOwned(
        player,
        loadout,
        presetSlot.gearId,
        presetSlot.micromoduleId,
        presetSlot.upgrades,
      )
    ) {
      applied.push(presetSlot.gearId);
    } else {
      skipped.push(presetSlot.gearId);
    }
  }
  const alreadyFitted = new Map<string, number>();
  for (const id of loadout.hullMicromodules()) {
    alreadyFitted.set(id, (alreadyFitted.get(id) ?? 0) + 1);
  }
  for (const micromoduleId of preset.hullMicromoduleIds ?? []) {
    const carried = alreadyFitted.get(micromoduleId) ?? 0;
    if (carried > 0) {
      alreadyFitted.set(micromoduleId, carried - 1);
      continue;
    }
    const ownedIdx = player.inventory.micromodules.findIndex(
      (m) => m.id === micromoduleId,
    );
    if (
      ownedIdx >= 0 &&
      loadout.applyMicromodule(loadout.hull.id, micromoduleId)
    ) {
      player.inventory.micromodules.splice(ownedIdx, 1);
      applied.push(micromoduleId);
    } else {
      skipped.push(micromoduleId);
    }
  }
  return { applied, skipped };
}

function installFromBagOrOwned(
  player: Player,
  loadout: ShipLoadout,
  gearId: string,
  preferredMicromoduleId?: string,
  preferredUpgrades?: number,
): boolean {
  const bag = player.inventory.modules;
  const legacyIdx = bag.findIndex(
    (m) =>
      m.id === gearId &&
      (preferredMicromoduleId === undefined ||
        m.micromoduleId === preferredMicromoduleId),
  );
  const idx =
    legacyIdx >= 0 ? legacyIdx : bag.findIndex((m) => m.id === gearId);
  if (idx >= 0) {
    const mod = bag[idx];
    const displaced = loadout.displacedBy(gearId);
    if (!loadout.install(gearId)) return false;
    const lastSlot = loadout.installedGearIds().length - 1;
    if (mod.micromoduleId)
      loadout.applyMicromoduleAt(lastSlot, mod.micromoduleId);
    const upgrades = preferredUpgrades ?? mod.upgrades;
    if (upgrades) loadout.setSlotUpgrades(lastSlot, upgrades);
    bag.splice(idx, 1);
    if (displaced) {
      const dg = gearById(displaced);
      if (dg) player.inventory.addItem(gearToModule(dg));
    }
    return true;
  }
  if ((player.inventory.ownedGearIds ?? []).includes(gearId)) {
    const installed = installOwnedGear(player, loadout, gearId);
    if (installed && preferredUpgrades) {
      const lastSlot = loadout.installedGearIds().length - 1;
      loadout.setSlotUpgrades(lastSlot, preferredUpgrades);
    }
    return installed;
  }
  return false;
}
