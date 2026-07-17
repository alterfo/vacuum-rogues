/**
 * Draw the tactical-planning per-weapon range circles (Task 5). The pure geometry +
 * colour logic lives in {@link combatWeaponTargeting}; this thin presentation seam
 * strokes each {@link RangeCircle} onto a shared `Graphics` in the same dashed style
 * `CombatHud`'s single range circle uses, so the player sees one distinctly tinted ring
 * per fitted weapon around the ship during planning.
 *
 * Kept a thin drawing seam (mirrors `combatCoursePreview`): all range/colour decisions
 * are the pure module's; this only turns circles into strokes. Unit-tested with a fake
 * `Graphics` recorder, the same discipline as `combatCoursePreview`.
 */

import type { Graphics } from "pixi.js";
import type { RangeCircle } from "./combatWeaponTargeting";

/** Dash count for the stroked range ring (mirrors `CombatHud.drawRangeCircle`). */
const RANGE_CIRCLE_DASHES = 60;

/** The narrow `Graphics` surface the overlay strokes onto (structural subset). */
export interface RangeCircleGraphics {
  clear(): void;
  moveTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  stroke(style: { color: number; width: number; alpha: number }): void;
}

/**
 * Redraw `g` as a dashed range ring per weapon circle. Each circle is stroked in its own
 * colour; a zero-radius circle contributes nothing. Clears `g` first, so calling it each
 * planning frame keeps the rings anchored to the moving ship. No-op-safe on an empty list.
 */
export function drawWeaponRangeCircles(
  g: RangeCircleGraphics | Graphics,
  circles: readonly RangeCircle[],
): void {
  const gg = g as RangeCircleGraphics;
  gg.clear();
  const step = (Math.PI * 2) / RANGE_CIRCLE_DASHES;
  for (const c of circles) {
    if (c.radius <= 0) continue;
    for (let i = 0; i < RANGE_CIRCLE_DASHES; i += 2) {
      const a0 = i * step;
      gg.moveTo(c.x + Math.cos(a0) * c.radius, c.y + Math.sin(a0) * c.radius);
      gg.arc(c.x, c.y, c.radius, a0, a0 + step);
    }
    gg.stroke({ color: c.color, width: 2, alpha: 0.5 });
  }
}
