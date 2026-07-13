/**
 * Weapon-type VFX variant selection — pure, PixiJS-free.
 *
 * Task 13 of the pause-and-plan combat rework
 * (`docs/plans/20260713-tactical-pause-combat-rework.md`). Today `CombatHud.flashShot` draws one
 * generic cyan/red tracer for **every** weapon — the `GearCatalog.WeaponClass` field is
 * flavor-only for visuals (Task 6/7 finally consumed it for *behaviour*; this consumes it for
 * *visuals*). This module is the pure **dispatch**: given a weapon's class + tier it picks which
 * of four visual styles a fired shot should draw, so the thin drawing seam
 * (`combatWeaponVfxOverlay.ts`) can branch without re-deriving the rule per call:
 *
 * - `WeaponClass.ENERGY`  → a continuous **beam** (laser).
 * - `WeaponClass.FRAGMENT` → a fast plasma/physical **burst** (blaster).
 * - `WeaponClass.MISSILE`  → a curved white **smoke-trail arc** that tracks the projectile's
 *   actual flight path (ties into Task 7's `MissileState` — the trail follows the flown points,
 *   not a static shooter→target line).
 * - The **heaviest weapon tier** additionally gets a space-**distortion ripple** overlay on top of
 *   its base kind (an apex-weapon flourish, class-independent).
 *
 * **Heaviest-tier threshold (recorded, Task 13 decision)**: a weapon qualifies for the distortion
 * ripple when it is `rare` (the apex/endgame stock — `wpn_torpedo` T6, `wpn_singularity_lance` T8)
 * **or** its `techLevel >= distortionMinTech` (default 7 — captures the T7 `wpn_disruptor`, which the
 * catalog names "редкий" but does not flag `rare`). This is the smallest rule that reads as "only
 * the very heaviest guns warp space" against the current catalog (weapons span techLevel 1..8), and
 * lives in `balance.ts` (`WEAPON_VFX`) so the cutoff is tuned in one place.
 *
 * Kept a pure module (no PixiJS / no scene deps), unit-tested standalone — the same discipline as
 * `combatMissile` / `combatShield` / `combatWeaponTargeting`. The variant it returns is a plain
 * value the drawing seam dispatches on; no pixel output lives here.
 */

import { WeaponClass } from "@/systems/equipment/GearCatalog";
import type { Vec2 } from "./combatTrajectory";

export type { Vec2 };

/** The base visual style a fired shot draws, one per `WeaponClass`. */
export enum WeaponVfxKind {
  /** ENERGY: a continuous beam shooter→target (laser). */
  BEAM = "BEAM",
  /** FRAGMENT: a fast plasma/physical burst (blaster). */
  BURST = "BURST",
  /** MISSILE: a curved white smoke-trail arc tracking the projectile's flight path. */
  MISSILE_TRAIL = "MISSILE_TRAIL",
}

/** The resolved VFX for one shot: its base kind plus whether it warps space (heaviest tier). */
export interface WeaponVfxVariant {
  readonly kind: WeaponVfxKind;
  /** True for the heaviest weapon tier — draws a space-distortion ripple over the base kind. */
  readonly distortion: boolean;
}

/** The minimal weapon surface the VFX dispatch reads (a `WeaponSpec` structural subset). */
export interface WeaponVfxInput {
  /** Drives the base kind (BEAM / BURST / MISSILE_TRAIL). */
  readonly weaponClass: WeaponClass;
  /** Tech tier 1..8 — with `rare`, decides the distortion-ripple overlay. */
  readonly techLevel: number;
  /** Apex/endgame stock flag — a rare weapon always qualifies for the distortion ripple. */
  readonly rare?: boolean;
}

/** Tuning for the VFX dispatch; mirrors `WEAPON_VFX` in `balance.ts`. */
export interface WeaponVfxConfig {
  /**
   * A non-rare weapon at/above this `techLevel` still gets the distortion ripple — the
   * "heaviest weapon tier" cutoff (a rare weapon of any tech qualifies regardless).
   */
  distortionMinTech: number;
}

/** Module-local default, mirroring `WEAPON_VFX` so this file stays import-light for tests. */
export const DEFAULT_WEAPON_VFX: WeaponVfxConfig = {
  distortionMinTech: 7,
};

/** The base VFX kind for a weapon class (independent of tier). */
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

/**
 * Whether a weapon is the "heaviest tier" that draws the space-distortion ripple: `rare`
 * (apex/endgame stock) **or** `techLevel >= distortionMinTech`. The recorded Task 13 threshold.
 */
export function isDistortionTier(
  weapon: WeaponVfxInput,
  config: WeaponVfxConfig = DEFAULT_WEAPON_VFX,
): boolean {
  return weapon.rare === true || weapon.techLevel >= config.distortionMinTech;
}

/**
 * Pick the VFX variant a fired shot draws: the base kind from its `weaponClass`, plus the
 * distortion-ripple overlay flag from its tier. Pure dispatch — the drawing seam branches on the
 * returned value; no pixels are produced here.
 */
export function selectWeaponVfx(
  weapon: WeaponVfxInput,
  config: WeaponVfxConfig = DEFAULT_WEAPON_VFX,
): WeaponVfxVariant {
  return {
    kind: weaponVfxKind(weapon.weaponClass),
    distortion: isDistortionTier(weapon, config),
  };
}

/**
 * Sample a missile's flight path into a smoothed trail polyline the smoke-trail arc draws along.
 * Reuses Task 7's flown points (`MissileState.pos` history the caller collects); keeps at most the
 * last `maxPoints` so a long flight's trail stays a bounded arc that tracks the projectile's actual
 * path rather than a static shooter→target line. Fewer than two points yields the points unchanged
 * (nothing to interpolate). Never mutates the input.
 */
export function missileTrailPoints(
  path: readonly Vec2[],
  maxPoints = 12,
): Vec2[] {
  const cap = Math.max(2, Math.trunc(maxPoints));
  if (path.length <= cap) return path.map((p) => ({ x: p.x, y: p.y }));
  return path.slice(path.length - cap).map((p) => ({ x: p.x, y: p.y }));
}
