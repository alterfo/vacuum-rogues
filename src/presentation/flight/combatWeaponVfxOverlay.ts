import type { Graphics } from "pixi.js";
import {
  WeaponVfxKind,
  type Vec2,
  type WeaponVfxVariant,
} from "./combatWeaponVfx";

export const WEAPON_VFX_COLOR = 0x9ffcff;
export const MISSILE_TRAIL_COLOR = 0xf2f2f2;
export const DISTORTION_COLOR = 0xc7a3ff;

export interface WeaponVfxSpec {
  readonly variant: WeaponVfxVariant;
  readonly from: Vec2;
  readonly to: Vec2;
  readonly trail?: readonly Vec2[];
  readonly alpha?: number;
  readonly color?: number;
}

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
  g.circle(s.to.x, s.to.y, 14);
  g.stroke({ color: DISTORTION_COLOR, width: 2, alpha: 0.5 * a });
}

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
