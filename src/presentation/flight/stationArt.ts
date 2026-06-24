/**
 * Station art resolution — pure, deterministic, glob-driven.
 *
 * Mirrors the planet-disc pattern (`PLANET_TEXTURE_PREFIX` + `pickVariant`):
 * each {@link StationType} maps to an art-asset name prefix
 * (`src/assets/station/<prefix>_NN`), and {@link stationSpriteKey} picks a stable
 * variant for a given station id via {@link pickVariantKey}.
 *
 * Fallback-first: with no `station/` art committed, `pickVariantKey` returns
 * `undefined`, so {@link stationSpriteKey} returns `null` and the renderer draws
 * the existing colour-coded diamond. Sprites light up automatically once
 * `src/assets/station/*` is committed (Vite glob manifest) — no code change.
 */
import { StationType } from "@/types";
import { pickVariantKey } from "../textures";

/** Maps a station type to its art-asset name prefix (src/assets/station/<prefix>_NN). */
export const STATION_TEXTURE_PREFIX: Record<StationType, string> = {
  [StationType.TRADE_POST]: "trade",
  [StationType.REPAIR_DOCK]: "drydock",
  [StationType.MILITARY_BASE]: "military",
  [StationType.RESEARCH_LAB]: "science",
  [StationType.CRAFT_CENTER]: "fabricator",
};

/**
 * Resolve the manifest key of a stable station sprite variant for the given
 * station type + id, or `null` when no matching art is committed (graceful
 * diamond fallback). Deterministic per id (same id → same variant).
 */
export function stationSpriteKey(type: StationType, id: string): string | null {
  return pickVariantKey("station", STATION_TEXTURE_PREFIX[type], id) ?? null;
}
