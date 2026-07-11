/**
 * Gear icon resolution — one shared key lookup + PixiJS mount helper, used by
 * both `HangarPanel` and `EquipmentShopScene`'s gear listing (never forked).
 *
 * Mirrors the station-art pattern (`stationSpriteKey`): a per-item key is
 * derived from the item's family + a tech-tier bucket, then resolved via
 * `pickVariantKey`/`tex` against the eager `icons/` manifest category —
 * deterministic per item id (same id -> same variant if more than one art
 * variant lands for a family/tier). With no tiered art committed yet, every
 * lookup falls back to the flat family icon already shipped (`icons/laser`,
 * `icons/engine`, ...), and further to `undefined` (text-only) for families
 * with no art at all. New per-tier prompts/art land later (Task 7 Post-
 * Completion) and light up automatically via the Vite glob manifest — no
 * code change needed.
 */
import { Container, Sprite } from "pixi.js";
import { pickVariantKey, tex } from "../textures";
import {
  GearKind,
  EquipmentClass,
  type Gear,
  type EquipmentSpec,
  type WeaponSpec,
} from "@/systems/equipment/GearCatalog";

/** Flat single-icon fallback for module classes with committed (untiered) art. */
const FAMILY_FALLBACK_ICON: Partial<Record<EquipmentClass, string>> = {
  [EquipmentClass.ENGINE]: "icons/engine",
  [EquipmentClass.FUEL_TANK]: "icons/fuel_tank",
  [EquipmentClass.RADAR]: "icons/radar",
  [EquipmentClass.SHIELD]: "icons/shield",
  [EquipmentClass.REPAIR_DROID]: "icons/repair_droid",
};
const WEAPON_FALLBACK_ICON = "icons/laser";

/** 3-bucket tech-tier label used to key per-tier icon art (low/mid/high). */
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

/**
 * Manifest icon key (`icons/<key>`) for a catalog item, or `undefined` when
 * no art (tiered or fallback) exists yet — callers fall back to the text
 * label.
 */
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

/**
 * Mount the gear's icon at `(x, y)` (vertically centered), sized to `size`.
 * No-ops when the item has no icon key yet or the art isn't loaded (dev/
 * unit-test environments never preload textures) — callers offset their
 * text by the returned consumed width, 0 meaning "no icon drawn".
 */
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
