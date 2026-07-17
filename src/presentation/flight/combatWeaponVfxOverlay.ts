/**
 * Draw a fired shot in its weapon-type visual style (Task 13). A thin presentation seam mirroring
 * `combatShieldFlash` / `combatWeaponRangeOverlay` / `combatCoursePreview`: all *which-style*
 * decisions are the pure `combatWeaponVfx.ts`'s (`selectWeaponVfx` → `WeaponVfxVariant`); this only
 * turns a resolved variant + geometry into strokes/fills on a shared `Graphics`. Unit-tested with a
 * fake `Graphics` recorder, the same discipline as `combatShieldFlash`.
 *
 * The four styles (see `WeaponVfxKind`):
 * - `BEAM` — one solid continuous line shooter→target (a laser beam).
 * - `BURST` — a short bright bolt near the target plus a small impact spark (a plasma blaster).
 * - `MISSILE_TRAIL` — a curved white smoke-trail polyline along the missile's flown path.
 * - the `distortion` overlay — a faint expanding ripple ring at the impact for the heaviest tier,
 *   drawn *over* the base kind (an apex-weapon space-warp flourish).
 */

import type { Graphics } from "pixi.js";
import {
  WeaponVfxKind,
  type Vec2,
  type WeaponVfxVariant,
} from "./combatWeaponVfx";

/** Default beam/bolt tint — a hot cyan, distinct from the cold shield cyan. */
export const WEAPON_VFX_COLOR = 0x9ffcff;
/** Smoke-trail tint — near-white exhaust. */
export const MISSILE_TRAIL_COLOR = 0xf2f2f2;
/** Distortion-ripple tint — a faint violet space-warp. */
export const DISTORTION_COLOR = 0xc7a3ff;

/** One shot to draw: its resolved variant, endpoints, and (for a missile) its flown trail path. */
export interface WeaponVfxSpec {
  readonly variant: WeaponVfxVariant;
  /** Shooter muzzle position (world px). */
  readonly from: Vec2;
  /** Impact / target position (world px). */
  readonly to: Vec2;
  /** Missile trail polyline (`missileTrailPoints`) — required for `MISSILE_TRAIL`, else ignored. */
  readonly trail?: readonly Vec2[];
  /** Draw opacity (0..1); a fading shot dims as one object. Defaults to 1. */
  readonly alpha?: number;
  /** Tint override for the base kind; defaults per kind. */
  readonly color?: number;
}

/** The narrow `Graphics` surface the overlay draws onto (structural subset for testing). */
export interface WeaponVfxGraphics {
  clear(): void;
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  stroke(style: { color: number; width: number; alpha: number }): unknown;
  circle(x: number, y: number, radius: number): unknown;
  fill(style: { color: number; alpha: number }): void;
}

function drawBeam(
  g: WeaponVfxGraphics,
  s: WeaponVfxSpec,
  color: number,
  a: number,
): void {
  g.moveTo(s.from.x, s.from.y);
  g.lineTo(s.to.x, s.to.y);
  g.stroke({ color, width: 3, alpha: 0.95 * a });
}

function drawBurst(
  g: WeaponVfxGraphics,
  s: WeaponVfxSpec,
  color: number,
  a: number,
): void {
  // A short bolt streaking into the impact plus a bright spark — reads faster/harder than a beam.
  const dx = s.to.x - s.from.x;
  const dy = s.to.y - s.from.y;
  const len = Math.hypot(dx, dy) || 1;
  const tailLen = Math.min(24, len);
  const tailX = s.to.x - (dx / len) * tailLen;
  const tailY = s.to.y - (dy / len) * tailLen;
  g.moveTo(tailX, tailY);
  g.lineTo(s.to.x, s.to.y);
  g.stroke({ color, width: 4, alpha: a });
  g.circle(s.to.x, s.to.y, 3);
  g.fill({ color, alpha: a });
}

function drawMissileTrail(
  g: WeaponVfxGraphics,
  s: WeaponVfxSpec,
  a: number,
): void {
  const pts = s.trail && s.trail.length >= 2 ? s.trail : [s.from, s.to];
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.stroke({ color: MISSILE_TRAIL_COLOR, width: 2, alpha: 0.7 * a });
}

function drawDistortion(
  g: WeaponVfxGraphics,
  s: WeaponVfxSpec,
  a: number,
): void {
  // A faint expanding ripple ring at the impact — the heaviest-tier space-warp flourish.
  g.circle(s.to.x, s.to.y, 14);
  g.stroke({ color: DISTORTION_COLOR, width: 2, alpha: 0.5 * a });
}

/**
 * Redraw `g` as the live weapon shots, each in its resolved visual style. Clears `g` first, so
 * calling it each frame keeps the shots anchored and drops the finished ones. A shot with
 * `alpha ≤ 0` contributes nothing. The `distortion` ripple draws over the base kind for a
 * heaviest-tier weapon. No-op-safe on an empty list.
 */
export function drawWeaponVfx(
  g: WeaponVfxGraphics | Graphics,
  shots: readonly WeaponVfxSpec[],
): void {
  const gg = g as WeaponVfxGraphics;
  gg.clear();
  for (const s of shots) {
    const a = s.alpha ?? 1;
    if (a <= 0) continue;
    const color = s.color ?? WEAPON_VFX_COLOR;
    switch (s.variant.kind) {
      case WeaponVfxKind.BEAM:
        drawBeam(gg, s, color, a);
        break;
      case WeaponVfxKind.BURST:
        drawBurst(gg, s, color, a);
        break;
      case WeaponVfxKind.MISSILE_TRAIL:
        drawMissileTrail(gg, s, a);
        break;
    }
    if (s.variant.distortion) drawDistortion(gg, s, a);
  }
}
