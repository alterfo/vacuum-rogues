import { Container, Sprite } from "pixi.js";
import { pickVariantKey, tex } from "../textures";
import {
  GearKind,
  EquipmentClass,
  type Gear,
  type EquipmentSpec,
  type WeaponSpec,
} from "@/systems/equipment/GearCatalog";

const FAMILY_FALLBACK_ICON: Partial<Record<EquipmentClass, string>> = {
  [EquipmentClass.ENGINE]: "icons/engine",
  [EquipmentClass.FUEL_TANK]: "icons/fuel_tank",
  [EquipmentClass.RADAR]: "icons/radar",
  [EquipmentClass.SHIELD]: "icons/shield",
  [EquipmentClass.REPAIR_DROID]: "icons/repair_droid",
};
const WEAPON_FALLBACK_ICON = "icons/laser";

function iconTier(techLevel: number): "low" | "mid" | "high" {
  if (techLevel <= 2) return "low";
  if (techLevel <= 5) return "mid";
  return "high";
}

function gearIconPrefix(gear: Gear): string | undefined {
  if (gear.kind === GearKind.WEAPON) {
    const weaponClass = (gear as WeaponSpec).weaponClass.toLowerCase();
    return `wpn_${weaponClass}_${iconTier(gear.techLevel)}`;
  }
  if (gear.kind === GearKind.EQUIPMENT) {
    const equipmentClass = (gear as EquipmentSpec).equipmentClass.toLowerCase();
    return `eq_${equipmentClass}_${iconTier(gear.techLevel)}`;
  }
  return undefined;
}

export function gearIconKey(gear: Gear): string | undefined {
  const prefix = gearIconPrefix(gear);
  const tiered = prefix ? pickVariantKey("icons", prefix, gear.id) : undefined;
  if (tiered) return tiered;
  if (gear.kind === GearKind.WEAPON) return WEAPON_FALLBACK_ICON;
  if (gear.kind === GearKind.EQUIPMENT) {
    return FAMILY_FALLBACK_ICON[(gear as EquipmentSpec).equipmentClass];
  }
  return undefined;
}

export function mountGearIcon(
  container: Container,
  gear: Gear,
  x: number,
  y: number,
  size: number,
): number {
  const key = gearIconKey(gear);
  const texture = key ? tex(key) : undefined;
  if (!texture) return 0;
  const sp = new Sprite(texture);
  sp.anchor.set(0, 0.5);
  sp.width = size;
  sp.height = size;
  sp.x = x;
  sp.y = y;
  sp.eventMode = "none";
  container.addChild(sp);
  return size + 4;
}
