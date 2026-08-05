import { WeaponClass } from "@/systems/equipment/GearCatalog";
import type { Vec2 } from "./combatTrajectory";

export type { Vec2 };

export enum WeaponVfxKind {
  BEAM = "BEAM",
  BURST = "BURST",
  MISSILE_TRAIL = "MISSILE_TRAIL",
}

export interface WeaponVfxVariant {
  readonly kind: WeaponVfxKind;
  readonly distortion: boolean;
}

export interface WeaponVfxInput {
  readonly weaponClass: WeaponClass;
  readonly techLevel: number;
  readonly rare?: boolean;
}

export interface WeaponVfxConfig {
  distortionMinTech: number;
}

export const DEFAULT_WEAPON_VFX: WeaponVfxConfig = {
  distortionMinTech: 7,
};

export function weaponVfxKind(weaponClass: WeaponClass): WeaponVfxKind {
  switch (weaponClass) {
    case WeaponClass.ENERGY:
      return WeaponVfxKind.BEAM;
    case WeaponClass.FRAGMENT:
      return WeaponVfxKind.BURST;
    case WeaponClass.MISSILE:
      return WeaponVfxKind.MISSILE_TRAIL;
  }
}

export function isDistortionTier(
  weapon: WeaponVfxInput,
  config: WeaponVfxConfig = DEFAULT_WEAPON_VFX,
): boolean {
  return weapon.rare === true || weapon.techLevel >= config.distortionMinTech;
}

export function selectWeaponVfx(
  weapon: WeaponVfxInput,
  config: WeaponVfxConfig = DEFAULT_WEAPON_VFX,
): WeaponVfxVariant {
  return {
    kind: weaponVfxKind(weapon.weaponClass),
    distortion: isDistortionTier(weapon, config),
  };
}

export function missileTrailPoints(
  path: readonly Vec2[],
  maxPoints = 12,
): Vec2[] {
  const cap = Math.max(2, Math.trunc(maxPoints));
  if (path.length <= cap) return path.map((p) => ({ x: p.x, y: p.y }));
  return path.slice(path.length - cap).map((p) => ({ x: p.x, y: p.y }));
}
