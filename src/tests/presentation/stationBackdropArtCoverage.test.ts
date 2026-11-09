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
  resolveStationBackdropKey,
  stationBackdropAccent,
  stationBackdropBands,
} from "@/presentation/flight/stationBackdrop";
import { STATION_TEXTURE_PREFIX } from "@/presentation/flight/stationArt";

const ALL_TYPES = Object.values(StationType) as StationType[];

describe("resolveStationBackdropKey — station_interior slot", () => {
  beforeEach(() => {
    tx.pickVariantKey.mockReset();
  });

  it("queries the station_interior category with each type's literal prefix", () => {
    for (const type of ALL_TYPES) {
      tx.pickVariantKey.mockReset();
      tx.pickVariantKey.mockReturnValue(undefined);
      resolveStationBackdropKey(type, "sys7-station2");
      expect(tx.pickVariantKey).toHaveBeenCalledTimes(1);
      expect(tx.pickVariantKey).toHaveBeenCalledWith(
        "station_interior",
        STATION_TEXTURE_PREFIX[type],
        "sys7-station2",
      );
    }
  });

  it("returns the resolved key verbatim when interior art exists", () => {
    tx.pickVariantKey.mockReturnValue("station_interior/trade_01");
    expect(resolveStationBackdropKey(StationType.TRADE_POST, "sid-1")).toBe(
      "station_interior/trade_01",
    );
  });

  it("normalises a missing match to null so the procedural gradient can fall back", () => {
    tx.pickVariantKey.mockReturnValue(undefined);
    expect(
      resolveStationBackdropKey(StationType.MILITARY_BASE, "sid-1"),
    ).toBeNull();
  });
});

describe("stationBackdrop procedural fallback", () => {
  it("keeps a usable multi-band gradient for every station type when art is absent", () => {
    tx.pickVariantKey.mockReturnValue(undefined);
    for (const type of ALL_TYPES) {
      expect(resolveStationBackdropKey(type, "sid-1")).toBeNull();
      const bands = stationBackdropBands(stationBackdropAccent(type), 12);
      expect(bands).toHaveLength(12);
      expect(new Set(bands).size).toBeGreaterThan(1);
    }
  });
});
