/**
 * Station interior backdrop resolution — pure, deterministic.
 *
 * Mirrors the planet backdrop resolver (`resolvePlanetBackdropKey`) and the
 * station marker art resolver (`stationSpriteKey`): each {@link StationType}
 * carries an accent colour and a would-be art-asset prefix, and
 * {@link resolveStationBackdropKey} picks a stable interior-art variant for a
 * given station id via {@link pickVariantKey}.
 *
 * Fallback-first: no `station_interior/` art category is committed yet, so
 * {@link resolveStationBackdropKey} always returns `null` today and
 * `StationScene.renderMain` paints the procedural gradient built from
 * {@link stationBackdropBands}. A future real interior panorama drops in behind
 * the same resolver — the resolver starts returning a key and the sprite path
 * lights up with no further wiring change (same shape as the planet panorama).
 */
import { StationType } from "@/types";
import { pickVariantKey } from "../textures";
import { STATION_TEXTURE_PREFIX } from "./stationArt";

/**
 * The per-type accent colour of the station's interior mood — the tint the
 * procedural gradient fades toward, and the mood key an eventual art asset
 * would honour. Mirrors the marker-diamond / `TYPE_COLOR` coding so a station's
 * interior reads the same hue as its flight-map marker.
 */
export const STATION_BACKDROP_ACCENT: Record<StationType, number> = {
  [StationType.TRADE_POST]: 0xffcc44,
  [StationType.REPAIR_DOCK]: 0x44aaff,
  [StationType.MILITARY_BASE]: 0xff5544,
  [StationType.RESEARCH_LAB]: 0xcc88ff,
  [StationType.CRAFT_CENTER]: 0xffaa22,
};

/** Accent colour for a station type, with a neutral fallback for safety. */
export function stationBackdropAccent(type: StationType): number {
  return STATION_BACKDROP_ACCENT[type] ?? 0x4488cc;
}

/**
 * Resolve the manifest key of a station-interior backdrop art variant for the
 * given station type + id, or `null` when no matching art is committed
 * (graceful procedural-gradient fallback). Deterministic per id (same id → same
 * variant). Kept structurally identical to {@link resolvePlanetBackdropKey} and
 * {@link stationSpriteKey} so real art can be added with no scene change.
 */
export function resolveStationBackdropKey(
  type: StationType,
  id: string,
): string | null {
  return (
    pickVariantKey("station_interior", STATION_TEXTURE_PREFIX[type], id) ?? null
  );
}

/**
 * Vertical gradient bands from near-black at the top toward a dim, accent-tinted
 * floor at the bottom — the interim procedural station backdrop. Pure + exported
 * so a unit test can assert the tint tracks the station type without a renderer.
 * Mirrors `PlanetScene.skyGradientColors`: `t` runs 0 (top) → 1 (bottom) and the
 * accent is mixed in at a low ceiling so the panel + text stay legible over it.
 */
export function stationBackdropBands(accent: number, steps: number): number[] {
  const ar = (accent >> 16) & 0xff;
  const ag = (accent >> 8) & 0xff;
  const ab = accent & 0xff;
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    const t = steps <= 1 ? 1 : i / (steps - 1); // 0 at top → 1 at bottom
    const mix = t * 0.3; // dim ceiling — backdrop must not compete with the panel
    const r = Math.round(0x04 + (ar - 0x04) * mix);
    const g = Math.round(0x05 + (ag - 0x05) * mix);
    const b = Math.round(0x0c + (ab - 0x0c) * mix);
    out.push((r << 16) | (g << 8) | b);
  }
  return out;
}
