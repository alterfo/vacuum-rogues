import type { Graphics } from "pixi.js";

export const SHIELD_FLASH_COLOR = 0x66ccff;

export interface ShieldFlashSpec {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly alpha: number;
  readonly color?: number;
}

export interface ShieldFlashGraphics {
  clear(): void;
  circle(x: number, y: number, radius: number): unknown;
  fill(style: { color: number; alpha: number }): void;
}

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
