import { Texture } from "pixi.js";

/**
 * Soft-glow texture for the flight scene's nebula / sun halo / absorption
 * pillars (per-instance planet/star variety + FPS work, 2026-06-12).
 *
 * A single white radial-gradient texture (bright centre → transparent edge) is
 * baked ONCE via Canvas2D and shared by every soft element: tint + scale + alpha
 * + blendMode a `Sprite` of it to get a smooth glow with **zero per-frame cost**
 * — replacing the per-frame `BlurFilter`s that dragged the flight scene to ~15
 * FPS. (A stacked-`Graphics` fallback handles the no-canvas case, but it bands.)
 *
 * Returns `null` when no 2D canvas context is available (jsdom / unit tests) so
 * callers fall back to a `Graphics` approximation instead of crashing.
 */
let cached: Texture | null | undefined;

export function softGlowTexture(): Texture | null {
  if (cached !== undefined) return cached;

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    cached = null;
    return null;
  }

  const r = size / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  // Bright concentrated centre fading smoothly to nothing — the falloff a
  // strength-72/80 blur produced, baked once.
  grad.addColorStop(0.0, "rgba(255,255,255,1)");
  grad.addColorStop(0.2, "rgba(255,255,255,0.6)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.28)");
  grad.addColorStop(0.7, "rgba(255,255,255,0.1)");
  grad.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  cached = Texture.from(canvas);
  return cached;
}
