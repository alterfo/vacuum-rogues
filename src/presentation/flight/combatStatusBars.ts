/**
 * Draw the small floating hull/shield bar over a ship in flight (Task 12). Today only the HUD
 * side-panel shows target/player hull bars; nothing floats over the sprites. This thin presentation
 * seam strokes a compact stacked bar (hull below, shield above) at a ship's world position, sized
 * from the pure `combatShield.ts` (`barFraction`, `SHIELD_COMBAT`).
 *
 * Kept a thin drawing seam (mirrors `combatShieldFlash` / `combatWeaponRangeOverlay`): the
 * fractions/geometry are the pure module's; this only turns them into rounded-rect fills. Unit-tested
 * with a fake `Graphics` recorder, the same discipline as `combatWeaponRangeOverlay`.
 */

import type { Graphics } from "pixi.js";
import { barFraction } from "./combatShield";

/** Bar background (empty portion) — a dim translucent slate. */
export const BAR_BG_COLOR = 0x0a1622;
/** Hull-fill tint for a friendly ship (the player); enemy ships pass a red via `hullColor`. */
export const HULL_BAR_COLOR = 0x44ff88;
/** Shield-fill tint — a cold cyan, matching the shield-flash sphere. */
export const SHIELD_BAR_COLOR = 0x66ccff;

/** One ship's floating hull/shield bar: where to draw it and the current hull/shield state. */
export interface ShipStatusBarSpec {
  /** Ship centre world x (the bar is centred on this). */
  readonly x: number;
  /** Ship centre world y — the bar floats `barYOffset` above this. */
  readonly y: number;
  /** Current hull HP. */
  readonly hull: number;
  /** Hull max (bar is empty if ≤ 0). */
  readonly maxHull: number;
  /** Current shield value; the shield bar is omitted when this or `maxShields` is absent/≤ 0. */
  readonly shields?: number;
  /** Shield max; the shield bar is omitted when ≤ 0 (a shield-less ship shows hull only). */
  readonly maxShields?: number;
  /** Hull-fill tint; defaults to {@link HULL_BAR_COLOR}. */
  readonly hullColor?: number;
}

/** Geometry the bars are laid out from; mirrors the `SHIELD_COMBAT` subset the scene passes. */
export interface StatusBarGeometry {
  readonly barWidth: number;
  readonly barHeight: number;
  readonly barGap: number;
  readonly barYOffset: number;
}

/** The narrow `Graphics` surface the bars draw onto (structural subset for testing). */
export interface StatusBarGraphics {
  clear(): void;
  roundRect(x: number, y: number, w: number, h: number, r: number): unknown;
  fill(style: { color: number; alpha?: number }): void;
}

/**
 * Redraw `g` as the floating hull/shield bars for `ships`. Each ship gets a background track + a
 * hull fill (width = hull fraction × `barWidth`); a ship with a positive `maxShields` also gets a
 * shield track + fill one row above (a `barGap` gap), so a shield-less ship reads as a single hull
 * bar with no empty shield slot. Bars are centred on each ship's x and float `barYOffset` above it.
 * Clears `g` first so calling it each frame keeps the bars anchored to the moving ships. A ship with
 * a non-positive `maxHull` draws nothing.
 */
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
    // Hull bar sits at the base of the stack; the shield bar (if any) is one row above it.
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
