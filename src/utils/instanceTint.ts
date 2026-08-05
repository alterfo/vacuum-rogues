import { SeededRNG } from "./seededRNG";

export interface TintOptions {
  floor?: number;
  warmth?: number;
}

const DEFAULT_FLOOR = 0.75;
const DEFAULT_WARMTH = 0.07;

export function tintFromSeed(seed: string, opts: TintOptions = {}): number {
  const floor = opts.floor ?? DEFAULT_FLOOR;
  const warmth = opts.warmth ?? DEFAULT_WARMTH;

  const rng = new SeededRNG(`tint_${seed}`);
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

export function planetBackdropTint(
  planetId: string,
  backdropKey: string,
): number {
  if (backdropKey.startsWith("surfaces/")) {
    return tintFromSeed(planetId, { floor: 0.6, warmth: 0.16 });
  }
  return tintFromSeed(planetId);
}
