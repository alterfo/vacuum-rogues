import type { Graphics } from "pixi.js";
import type { RangeCircle } from "./combatWeaponTargeting";

const RANGE_CIRCLE_DASHES = 60;

export interface RangeCircleGraphics {
  clear(): void;
  moveTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  stroke(style: { color: number; width: number; alpha: number }): void;
}

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
