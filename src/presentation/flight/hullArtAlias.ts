export const HULL_ART_ALIAS: Record<string, string> = {
  cruiser: "destroyer",
  heavy_freighter: "transport",
};

export function resolveHullArtKey(hullClassKey: string): string {
  return HULL_ART_ALIAS[hullClassKey] ?? hullClassKey;
}
