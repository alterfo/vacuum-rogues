import { describe, it, expect, vi, beforeEach } from "vitest";
import { StationType } from "@/types";

const tx = vi.hoisted(() => ({
  pickVariantKey:
    vi.fn<(cat: string, prefix: string, seed: string) => string | undefined>(),
}));

vi.mock("@/presentation/textures", async () => {
  const actual = await vi.importActual<
    typeof import("@/presentation/textures")
  >("@/presentation/textures");
  return { ...actual, pickVariantKey: tx.pickVariantKey };
});

import {
  STATION_TEXTURE_PREFIX,
  stationSpriteKey,
} from "@/presentation/flight/stationArt";

const ALL_TYPES = Object.values(StationType) as StationType[];

describe("stationSpriteKey — delegates to pickVariantKey('station', <prefix>, id)", () => {
  beforeEach(() => {
    tx.pickVariantKey.mockReset();
  });

  it("queries the `station` category with each type's literal prefix", () => {
    for (const type of ALL_TYPES) {
      tx.pickVariantKey.mockReset();
      tx.pickVariantKey.mockReturnValue(undefined);
      stationSpriteKey(type, "sys7-station2");
      expect(tx.pickVariantKey).toHaveBeenCalledTimes(1);
      expect(tx.pickVariantKey).toHaveBeenCalledWith(
        "station",
        STATION_TEXTURE_PREFIX[type],
        "sys7-station2",
      );
    }
  });

  it("returns the resolved key verbatim when art exists (lights up when art lands)", () => {
    tx.pickVariantKey.mockReturnValue("station/trade_03");
    expect(stationSpriteKey(StationType.TRADE_POST, "sid-1")).toBe(
      "station/trade_03",
    );
  });

  it("normalises a missing match to null (not undefined) for the diamond fallback", () => {
    tx.pickVariantKey.mockReturnValue(undefined);
    expect(stationSpriteKey(StationType.MILITARY_BASE, "sid-1")).toBeNull();
  });
});
