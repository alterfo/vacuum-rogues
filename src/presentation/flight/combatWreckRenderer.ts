import type { Graphics } from "pixi.js";

export const WRECK_HULL_COLOR = 0x3a3f47;
export const WRECK_EMBER_COLOR = 0x552211;

export interface WreckRenderSpec {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly alpha: number;
  readonly size: number;
  readonly color?: number;
}

export interface WreckGraphics {
  clear(): void;
  poly(points: number[]): unknown;
  fill(style: { color: number; alpha: number }): void;
}

const WRECK_SHAPE: readonly (readonly [number, number])[] = [
  [1.0, 0.0],
  [0.1, 0.55],
  [-0.5, 0.35],
  [-0.85, 0.7],
  [-0.6, -0.15],
  [-0.9, -0.55],
  [-0.2, -0.45],
  [0.35, -0.6],
];

export function drawWrecks(
  g: WreckGraphics | Graphics,
  wrecks: readonly WreckRenderSpec[],
): void {
  const gg = g as WreckGraphics;
  gg.clear();
  for (const w of wrecks) {
    if (w.size <= 0 || w.alpha <= 0) continue;
    const cos = Math.cos(w.angle);
    const sin = Math.sin(w.angle);
    const pts: number[] = [];
    for (const [lx, ly] of WRECK_SHAPE) {
      const sx = lx * w.size;
      const sy = ly * w.size;
      pts.push(w.x + sx * cos - sy * sin, w.y + sx * sin + sy * cos);
    }
    const color = w.color ?? WRECK_HULL_COLOR;
    gg.poly(pts);
    gg.fill({ color, alpha: w.alpha });
    gg.poly(pts);
    gg.fill({ color: WRECK_EMBER_COLOR, alpha: w.alpha * 0.35 });
  }
}
