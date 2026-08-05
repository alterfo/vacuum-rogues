import type { Graphics } from "pixi.js";
import { barFraction } from "./combatShield";

export const BAR_BG_COLOR = 0x0a1622;
export const HULL_BAR_COLOR = 0x44ff88;
export const SHIELD_BAR_COLOR = 0x66ccff;

export interface ShipStatusBarSpec {
  readonly x: number;
  readonly y: number;
  readonly hull: number;
  readonly maxHull: number;
  readonly shields?: number;
  readonly maxShields?: number;
  readonly hullColor?: number;
}

export interface StatusBarGeometry {
  readonly barWidth: number;
  readonly barHeight: number;
  readonly barGap: number;
  readonly barYOffset: number;
}

export interface StatusBarGraphics {
  clear(): void;
  roundRect(x: number, y: number, w: number, h: number, r: number): unknown;
  fill(style: { color: number; alpha?: number }): void;
}

export function drawShipStatusBars(
  g: StatusBarGraphics | Graphics,
  ships: readonly ShipStatusBarSpec[],
  geom: StatusBarGeometry,
): void {
  const gg = g as StatusBarGraphics;
  gg.clear();
  const { barWidth: w, barHeight: h, barGap: gap, barYOffset: yOff } = geom;
  if (w <= 0 || h <= 0) return;
  for (const s of ships) {
    if (!Number.isFinite(s.maxHull) || s.maxHull <= 0) continue;
    const left = s.x - w / 2;
    const hasShield =
      s.maxShields != null && Number.isFinite(s.maxShields) && s.maxShields > 0;
    const hullY = s.y - yOff;
    const hullFrac = barFraction(s.hull, s.maxHull);
    gg.roundRect(left, hullY, w, h, 1);
    gg.fill({ color: BAR_BG_COLOR, alpha: 0.8 });
    if (hullFrac > 0) {
      gg.roundRect(left, hullY, w * hullFrac, h, 1);
      gg.fill({ color: s.hullColor ?? HULL_BAR_COLOR });
    }
    if (hasShield) {
      const shieldY = hullY - (h + gap);
      const shieldFrac = barFraction(s.shields ?? 0, s.maxShields ?? 0);
      gg.roundRect(left, shieldY, w, h, 1);
      gg.fill({ color: BAR_BG_COLOR, alpha: 0.8 });
      if (shieldFrac > 0) {
        gg.roundRect(left, shieldY, w * shieldFrac, h, 1);
        gg.fill({ color: SHIELD_BAR_COLOR });
      }
    }
  }
}
