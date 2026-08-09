import { Container, Graphics, Sprite, Text } from "pixi.js";
import { pickVariantKey, tex } from "../textures";
import {
  GearKind,
  EquipmentClass,
  WeaponClass,
  type Gear,
  type EquipmentSpec,
  type WeaponSpec,
} from "@/systems/equipment/GearCatalog";
import { KIND_COLOR } from "@/systems/equipment/GearBridge";

const FAMILY_FALLBACK_ICON: Partial<Record<EquipmentClass, string>> = {
  [EquipmentClass.ENGINE]: "icons/engine",
  [EquipmentClass.FUEL_TANK]: "icons/fuel_tank",
  [EquipmentClass.RADAR]: "icons/radar",
  [EquipmentClass.SHIELD]: "icons/shield",
  [EquipmentClass.REPAIR_DROID]: "icons/repair_droid",
};
// ENERGY weapons reuse the laser sprite; FRAGMENT/MISSILE have no matching
// committed art, so they fall through to a category glyph instead of a
// misleading laser icon.
const WEAPON_FALLBACK_ICON: Partial<Record<WeaponClass, string>> = {
  [WeaponClass.ENERGY]: "icons/laser",
};

// Families with no committed sprite art at all — a colored glyph badge
// (drawn, not a texture) stands in so mountGearIcon never returns 0.
const EQUIPMENT_GLYPH: Partial<Record<EquipmentClass, string>> = {
  [EquipmentClass.SCANNER]: "SC",
  [EquipmentClass.GRAPPLE]: "GR",
  [EquipmentClass.GRAV_TRACTOR]: "GT",
};
const WEAPON_GLYPH: Partial<Record<WeaponClass, string>> = {
  [WeaponClass.FRAGMENT]: "FR",
  [WeaponClass.MISSILE]: "MS",
};
const HULL_GLYPH = "HL";

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
  if (gear.kind === GearKind.WEAPON) {
    return WEAPON_FALLBACK_ICON[(gear as WeaponSpec).weaponClass];
  }
  if (gear.kind === GearKind.EQUIPMENT) {
    return FAMILY_FALLBACK_ICON[(gear as EquipmentSpec).equipmentClass];
  }
  return undefined;
}

function gearGlyphLabel(gear: Gear): string | undefined {
  if (gear.kind === GearKind.HULL) return HULL_GLYPH;
  if (gear.kind === GearKind.WEAPON) {
    return WEAPON_GLYPH[(gear as WeaponSpec).weaponClass];
  }
  if (gear.kind === GearKind.EQUIPMENT) {
    return EQUIPMENT_GLYPH[(gear as EquipmentSpec).equipmentClass];
  }
  return undefined;
}

function mountCategoryGlyph(
  container: Container,
  label: string,
  x: number,
  y: number,
  size: number,
  color: number,
): void {
  const badge = new Graphics();
  badge
    .rect(0, 0, size, size)
    .fill({ color, alpha: 0.28 })
    .stroke({ width: 1, color });
  badge.x = x;
  badge.y = y - size / 2;
  badge.eventMode = "none";
  container.addChild(badge);

  const glyph = new Text({
    text: label,
    style: {
      fontSize: Math.max(7, Math.round(size * 0.42)),
      fill: color,
      fontWeight: "bold",
    },
  });
  glyph.anchor.set(0.5);
  glyph.x = x + size / 2;
  glyph.y = y;
  glyph.eventMode = "none";
  container.addChild(glyph);
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
  if (texture) {
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
  const glyphLabel = gearGlyphLabel(gear);
  if (glyphLabel) {
    mountCategoryGlyph(
      container,
      glyphLabel,
      x,
      y,
      size,
      KIND_COLOR[gear.kind],
    );
    return size + 4;
  }
  return 0;
}
