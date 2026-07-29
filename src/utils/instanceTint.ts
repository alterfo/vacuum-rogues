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

/**
 * Tint for a planet's backdrop sprite (Task 4, terran-biome collision mitigation).
 *
 * Generated `surfaces/*` art ships only **four** variants per biome, so many
 * planet ids hash to the *same* base image by pigeonhole — two TERRESTRIAL
 * worlds (e.g. Резонанс/Спика) can land on `terran_02.webp` and read as
 * identical. The default {@link tintFromSeed} band is deliberately tiny (subtle
 * variety over already-distinct shared panoramas), too weak to disambiguate a
 * shared base image. For surface art we widen the per-id band (lower floor +
 * larger warm/cool spread) so two same-base worlds still read as distinct —
 * code-only, no new art. Non-surface backdrops keep the original subtle tint.
 */
export function planetBackdropTint(
  planetId: string,
  backdropKey: string,
): number {
  if (backdropKey.startsWith("surfaces/")) {
    return tintFromSeed(planetId, { floor: 0.6, warmth: 0.16 });
  }
  return tintFromSeed(planetId);
}
