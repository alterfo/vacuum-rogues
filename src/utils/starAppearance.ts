import { SeededRNG } from "./seededRNG";

/**
 * Per-instance sun appearance jitter (Task 2, per-instance planet/star variety).
 *
 * A `StarType` alone fixes a sun's tint/corona/glow, so two red dwarfs look
 * identical. `starAppearanceJitter` returns a deterministic, *bounded* jitter
 * keyed by `systemId` — a corona-size multiplier, a glow-intensity multiplier,
 * and a colour-temperature shift — applied on top of the StarType base so each
 * sun is distinct without breaking the type's identity. Same id → same jitter.
 */
export interface StarAppearanceJitter {
  /** Multiplier on each glow-layer radius (corona size). 1 ± CORONA_SPREAD. */
  coronaScale: number;
  /** Multiplier on each glow-layer alpha (glow intensity). 1 ± GLOW_SPREAD. */
  glowIntensity: number;
  /** Colour-temperature shift in [-1, 1]: + warmer (R up / B down), - cooler. */
  tempShift: number;
}

/** Corona radius varies ±12% around the StarType base. */
export const CORONA_SPREAD = 0.12;
/** Glow alpha varies ±18% around the StarType base. */
export const GLOW_SPREAD = 0.18;
/** Max per-channel colour shift (bytes) at |tempShift| = 1. */
const TEMP_AMOUNT = 26;

export function starAppearanceJitter(systemId: string): StarAppearanceJitter {
  const rng = new SeededRNG(`star_jitter_${systemId}`);
  return {
    coronaScale: 1 + rng.nextFloat(-CORONA_SPREAD, CORONA_SPREAD),
    glowIntensity: 1 + rng.nextFloat(-GLOW_SPREAD, GLOW_SPREAD),
    tempShift: rng.nextFloat(-1, 1),
  };
}

/**
 * Nudge a base `0xRRGGBB` tint warmer (positive shift: R up, B down) or cooler
 * (negative: R down, B up), green nearly fixed. The shift is bounded by
 * `TEMP_AMOUNT` and every channel is clamped to the 0..255 byte range, so the
 * result stays a believable variant of the base — never a different colour.
 */
export function shiftTemperature(base: number, tempShift: number): number {
  const r0 = (base >> 16) & 0xff;
  const g0 = (base >> 8) & 0xff;
  const b0 = base & 0xff;
  const d = Math.round(tempShift * TEMP_AMOUNT);
  const clamp = (v: number): number => Math.max(0, Math.min(255, v)) & 0xff;
  const r = clamp(r0 + d);
  const g = clamp(g0 + Math.round(d * 0.15)); // green barely moves
  const b = clamp(b0 - d);
  return (r << 16) | (g << 8) | b;
}
