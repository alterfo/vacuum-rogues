import { StationType } from "@/types";
import { pickVariantKey } from "../textures";

export const STATION_TEXTURE_PREFIX: Record<StationType, string> = {
  [StationType.TRADE_POST]: "trade",
  [StationType.REPAIR_DOCK]: "drydock",
  [StationType.MILITARY_BASE]: "military",
  [StationType.RESEARCH_LAB]: "science",
  [StationType.CRAFT_CENTER]: "fabricator",
};

export function stationSpriteKey(type: StationType, id: string): string | null {
  return pickVariantKey("station", STATION_TEXTURE_PREFIX[type], id) ?? null;
}
