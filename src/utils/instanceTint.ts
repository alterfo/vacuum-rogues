import { SeededRNG } from "./seededRNG";

/**
 * Per-instance backdrop tint (Task 1, per-instance planet/star variety).
 *
 * Returns a deterministic, *subtle* RGB tint (PixiJS `sprite.tint` format,
 * `0xRRGGBB`) keyed by a seed (e.g. `planet.id`). The goal is to make every
 * planet's shared-asset backdrop look distinct without garish recoloring:
 * an overall brightness offset plus a small warm/cool channel shift, with
 * every channel clamped to a believable band so we never get near-black or
 * neon. Same seed → same tint; distinct seeds → distinct tints.
 */
export interface TintOptions {
  /** Lower bound for any channel multiplier (0..1). Default 0.75. */
  floor?: number;
  /** Max warm/cool channel shift (warm = R up / B down). Default 0.07. */
  warmth?: number;
}

const DEFAULT_FLOOR = 0.75;
const DEFAULT_WARMTH = 0.07;

export function tintFromSeed(seed: string, opts: TintOptions = {}): number {
  const floor = opts.floor ?? DEFAULT_FLOOR;
  const warmth = opts.warmth ?? DEFAULT_WARMTH;

  const rng = new SeededRNG(`tint_${seed}`);
  // Overall brightness in the upper part of the band, so a downward channel
  // shift cannot drag any channel below `floor` after clamping.
  const brightness = rng.nextFloat(floor + warmth, 1.0);
  const warmShift = rng.nextFloat(-warmth, warmth); // + = warmer
  const greenShift = rng.nextFloat(-warmth * 0.5, warmth * 0.5);

  const clampBand = (v: number): number => Math.max(floor, Math.min(1, v));
  const byte = (v: number): number => Math.round(clampBand(v) * 255) & 0xff;

  const r = byte(brightness + warmShift);
  const g = byte(brightness + greenShift);
  const b = byte(brightness - warmShift);

  return (r << 16) | (g << 8) | b;
}
