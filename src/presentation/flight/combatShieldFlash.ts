/**
 * Draw the shield-hit flash (Task 12): a brief translucent coloured sphere over a ship whose
 * shields just absorbed a hit — visually distinct from the existing hull-hit impact bloom
 * (`CombatHud`'s coloured tracer/impact flash). The fade curve + geometry are the pure
 * `combatShield.ts`'s (`shieldFlashAlpha`, `SHIELD_COMBAT`); this thin presentation seam only turns
 * a `{x, y, radius, alpha}` descriptor into concentric filled circles on a shared `Graphics`.
 *
 * Kept a thin drawing seam (mirrors `combatWeaponRangeOverlay` / `combatCoursePreview`): all timing
 * and sizing decisions are the pure module's; this only turns numbers into fills. Unit-tested with a
 * fake `Graphics` recorder, the same discipline as `combatWeaponRangeOverlay`.
 */

import type { Graphics } from "pixi.js";

/** Default shield-flash tint — a cold cyan sphere, unmistakable against the warm hull-hit bloom. */
export const SHIELD_FLASH_COLOR = 0x66ccff;

/** One live shield-flash to draw: where, how big, how opaque, and its tint. */
export interface ShieldFlashSpec {
  readonly x: number;
  readonly y: number;
  /** Sphere radius (world px) — the struck ship's radius × `shieldFlashRadiusScale`. */
  readonly radius: number;
  /** Current opacity from `shieldFlashAlpha` (0 = fully faded). */
  readonly alpha: number;
  /** Tint; defaults to {@link SHIELD_FLASH_COLOR} when omitted. */
  readonly color?: number;
}

/** The narrow `Graphics` surface the flash draws onto (structural subset for testing). */
export interface ShieldFlashGraphics {
  clear(): void;
  circle(x: number, y: number, radius: number): unknown;
  fill(style: { color: number; alpha: number }): void;
}

/**
 * Redraw `g` as the live shield-flash spheres. Each spec draws a soft translucent outer sphere plus
 * a brighter inner core (a shield shimmer, not a solid disc), both at the spec's current alpha, so a
 * fading flash dims as one object. Clears `g` first, so calling it each frame keeps the flashes
 * anchored to the moving ships and drops the ones that have faded/been removed. A zero-radius or
 * fully-faded (`alpha ≤ 0`) spec contributes nothing. No-op-safe on an empty list.
 */
export function drawShieldFlashes(
  g: ShieldFlashGraphics | Graphics,
  flashes: readonly ShieldFlashSpec[],
): void {
  const gg = g as ShieldFlashGraphics;
  gg.clear();
  for (const f of flashes) {
    if (f.radius <= 0 || f.alpha <= 0) continue;
    const color = f.color ?? SHIELD_FLASH_COLOR;
    gg.circle(f.x, f.y, f.radius);
    gg.fill({ color, alpha: f.alpha * 0.55 });
    gg.circle(f.x, f.y, f.radius * 0.6);
    gg.fill({ color, alpha: f.alpha });
  }
}
