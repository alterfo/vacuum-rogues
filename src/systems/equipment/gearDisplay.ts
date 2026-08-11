import { formatStat, formatStatDelta } from "@/utils/formatStat";
import {
  GearKind,
  EquipmentClass,
  gearById,
  type Gear,
} from "@/systems/equipment/GearCatalog";

export function gearStatLine(gear: Gear): string {
  if (gear.kind === GearKind.HULL) {
    return `HP: ${gear.hp}  Слоты: ${gear.slots}  Трюм: ${gear.cargo}`;
  }
  if (gear.kind === GearKind.WEAPON) {
    return `Урон: ${gear.damage}  Дальность: ${gear.range}`;
  }
  if (gear.equipmentClass === EquipmentClass.ENGINE) {
    return `Тех.ур.: ${gear.techLevel}  Масса: ${gear.mass}`;
  }
  return `Мощность: ${formatStat(gear.potency)}`;
}

export function installedSameClass(
  installedIds: Iterable<string>,
  gear: Gear,
): Gear | null {
  if (gear.kind === GearKind.HULL) return null;
  for (const id of installedIds) {
    const inst = gearById(id);
    if (!inst) continue;
    if (
      gear.kind === GearKind.WEAPON &&
      inst.kind === GearKind.WEAPON &&
      inst.weaponClass === gear.weaponClass
    ) {
      return inst;
    }
    if (
      gear.kind === GearKind.EQUIPMENT &&
      inst.kind === GearKind.EQUIPMENT &&
      inst.equipmentClass === gear.equipmentClass
    ) {
      return inst;
    }
  }
  return null;
}

export function gearComparisonSuffix(gear: Gear, replacing: Gear): string {
  let delta: number;
  if (gear.kind === GearKind.WEAPON && replacing.kind === GearKind.WEAPON) {
    delta = gear.damage - replacing.damage;
  } else if (
    gear.kind === GearKind.EQUIPMENT &&
    replacing.kind === GearKind.EQUIPMENT
  ) {
    delta =
      gear.equipmentClass === EquipmentClass.ENGINE
        ? gear.techLevel - replacing.techLevel
        : gear.potency - replacing.potency;
  } else {
    delta = gear.techLevel - replacing.techLevel;
  }
  return `  (${formatStatDelta(delta)} vs ${replacing.name})`;
}
