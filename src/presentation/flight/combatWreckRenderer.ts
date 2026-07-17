/**
 * Draw drifting ship wrecks (Task 14): a dark, jagged hull silhouette for each destroyed ship,
 * rotated to the wreck's tumbling heading and drawn at its current drift alpha. The drift kinematics
 * + fade curve are the pure `combatWreck.ts`'s (`advanceWreck`, `wreckAlpha`, `WRECK`); this thin
 * presentation seam only turns a `{x, y, angle, alpha, size}` descriptor into a filled polygon on a
 * shared `Graphics`.
 *
 * Kept a thin drawing seam (mirrors `combatShieldFlash` / `combatStatusBars`): all timing/geometry
 * decisions are the pure module's; this only turns numbers into fills. Unit-tested with a fake
 * `Graphics` recorder, the same discipline as those siblings.
 */

import type { Graphics } from "pixi.js";

/** Default wreck tint — a scorched dark hull chunk. */
export const WRECK_HULL_COLOR = 0x3a3f47;
/** A faint ember glow filling the wreck's core, so a fresh wreck still reads as recently-destroyed. */
export const WRECK_EMBER_COLOR = 0x552211;

/** One drifting wreck to draw: where it is, how it's tumbling, how faded, and how big. */
export interface WreckRenderSpec {
  readonly x: number;
  readonly y: number;
  /** Heading (radians) — the silhouette rotates with the wreck's tumble. */
  readonly angle: number;
  /** Current drift alpha from `wreckAlpha` (0 = fully faded / despawned). */
  readonly alpha: number;
  /** Hull half-size (world px) — the destroyed ship's rough radius. */
  readonly size: number;
  /** Hull tint; defaults to {@link WRECK_HULL_COLOR}. */
  readonly color?: number;
}

/** The narrow `Graphics` surface the wreck draws onto (structural subset for testing). */
export interface WreckGraphics {
  clear(): void;
  poly(points: number[]): unknown;
  fill(style: { color: number; alpha: number }): void;
}

/** The unit wreck silhouette — a broken, asymmetric hull chunk (points in ship-local space,
 *  size 1). Deliberately not a clean triangle so it reads as debris, not an intact ship. */
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

/**
 * Redraw `g` as the drifting wrecks. Each spec draws its hull silhouette (rotated to `angle`,
 * scaled by `size`, translated to `x,y`) as a filled polygon at the spec's current alpha, plus a
 * dim ember core so a fresh wreck still glows. Clears `g` first, so calling it each frame keeps the
 * wrecks anchored to their drifting positions and drops the ones that have faded. A zero-size or
 * fully-faded (`alpha ≤ 0`) spec contributes nothing. No-op-safe on an empty list.
 */
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
