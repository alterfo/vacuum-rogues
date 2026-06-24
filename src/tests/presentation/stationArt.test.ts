/**
 * Station art resolver guard (plan 20260624-off-planet-base-art, Task 1).
 *
 * The prefix map and sprite-key resolver are pure and deterministic. These tests
 * pin two contracts:
 *  - STATION_TEXTURE_PREFIX is a TOTAL mapping over StationType (every type → a
 *    stable, non-empty, unique prefix; no undefined), so the art prefixes never
 *    drift out of sync with the enum.
 *  - stationSpriteKey is deterministic per id and degrades safely: with no
 *    `station/` art committed today, pickVariantKey("station", …) yields
 *    undefined, so the resolver returns null and the renderer falls back to the
 *    diamond. (When art lands, the same code returns a real key with no change.)
 */
import { describe, it, expect } from "vitest";
import { StationType } from "@/types";
import {
  STATION_TEXTURE_PREFIX,
  stationSpriteKey,
} from "@/presentation/flight/stationArt";

const ALL_TYPES = Object.values(StationType) as StationType[];

describe("STATION_TEXTURE_PREFIX — total, stable, unique mapping", () => {
  it("maps every StationType to a non-empty prefix (no undefined)", () => {
    for (const type of ALL_TYPES) {
      const prefix = STATION_TEXTURE_PREFIX[type];
      expect(prefix, `prefix for ${type}`).toBeTypeOf("string");
      expect(prefix.length).toBeGreaterThan(0);
    }
  });

  it("covers exactly the StationType enum (no extra/missing keys)", () => {
    expect(Object.keys(STATION_TEXTURE_PREFIX).sort()).toEqual(
      [...ALL_TYPES].sort(),
    );
  });

  it("assigns a unique prefix per type (no two types share art)", () => {
    const prefixes = ALL_TYPES.map((t) => STATION_TEXTURE_PREFIX[t]);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("pins the literal prefixes (the art-file ↔ code contract)", () => {
    expect(STATION_TEXTURE_PREFIX).toEqual({
      [StationType.TRADE_POST]: "trade",
      [StationType.REPAIR_DOCK]: "drydock",
      [StationType.MILITARY_BASE]: "military",
      [StationType.RESEARCH_LAB]: "science",
      [StationType.CRAFT_CENTER]: "fabricator",
    });
  });
});

describe("stationSpriteKey — graceful fallback + determinism", () => {
  it("resolves a real station/<prefix>_NN key now that art is committed", () => {
    // Art has landed (src/assets/station/*), so the same resolver that returned
    // null pre-art now yields a stable manifest key for every type.
    for (const type of ALL_TYPES) {
      const key = stationSpriteKey(type, "station-1");
      expect(key, `key for ${type}`).toMatch(
        new RegExp(`^station/${STATION_TEXTURE_PREFIX[type]}_\\d+$`),
      );
    }
  });

  it("never throws for any type/id (safe fallback)", () => {
    for (const type of ALL_TYPES) {
      expect(() => stationSpriteKey(type, "anything")).not.toThrow();
    }
  });

  it("is deterministic per id (same id → same result)", () => {
    for (const type of ALL_TYPES) {
      for (const id of ["sys7-station2", "alpha-3", "id-xyz"]) {
        const first = stationSpriteKey(type, id);
        for (let i = 0; i < 5; i++) {
          expect(stationSpriteKey(type, id)).toBe(first);
        }
      }
    }
  });

  it("resolves a key even for an empty id/seed (no throw)", () => {
    // Edge: pickVariantKey hashes any seed, including "" — an empty id still maps
    // to a real variant rather than throwing.
    expect(stationSpriteKey(StationType.TRADE_POST, "")).toMatch(
      /^station\/trade_\d+$/,
    );
  });
});
