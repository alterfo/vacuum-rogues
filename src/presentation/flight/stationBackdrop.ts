import { StationType } from "@/types";
import { pickVariantKey } from "../textures";
import { STATION_TEXTURE_PREFIX } from "./stationArt";

export const STATION_BACKDROP_ACCENT: Record<StationType, number> = {
  [StationType.TRADE_POST]: 0xffcc44,
  [StationType.REPAIR_DOCK]: 0x44aaff,
  [StationType.MILITARY_BASE]: 0xff5544,
  [StationType.RESEARCH_LAB]: 0xcc88ff,
  [StationType.CRAFT_CENTER]: 0xffaa22,
};

export function stationBackdropAccent(type: StationType): number {
  return STATION_BACKDROP_ACCENT[type] ?? 0x4488cc;
}

export function resolveStationBackdropKey(
  type: StationType,
  id: string,
): string | null {
  return (
    pickVariantKey("station_interior", STATION_TEXTURE_PREFIX[type], id) ?? null
  );
}

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
