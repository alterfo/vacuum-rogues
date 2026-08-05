import { describe, it, expect } from "vitest";
import { pickVariant, pickVariantKey } from "@/presentation/textures";
import { allTextures } from "@/assets/manifest";

const TERRAN = "terrestrial";
const IDS = Array.from({ length: 200 }, (_, i) => `planet-${i}`);

function availableTerran(category: string): string[] {
  const wanted = `${category}/${TERRAN}`;
  return allTextures(category)
    .filter((k) => k === wanted || k.startsWith(`${wanted}_`))
    .sort();
}

for (const category of ["planet_maps", "planets"] as const) {
  describe(`terran variant selection — ${category}`, () => {
    const available = availableTerran(category);

    it("ships at least one terran variant to select from", () => {
      expect(available.length).toBeGreaterThan(0);
    });

    it("is deterministic per planet id", () => {
      for (const id of ["sys7-planet2", "alpha-3", "id-xyz"]) {
        const first = pickVariantKey(category, TERRAN, id);
        expect(first).toBeDefined();
        for (let i = 0; i < 5; i++) {
          expect(pickVariantKey(category, TERRAN, id)).toBe(first);
        }
      }
    });

    it("only ever selects a real globbed terran variant", () => {
      const set = new Set(available);
      for (const id of IDS) {
        const key = pickVariantKey(category, TERRAN, id);
        expect(key).toBeDefined();
        expect(set.has(key!)).toBe(true);
      }
    });

    it("ranges over every available terran variant (none unreachable)", () => {
      const seen = new Set(
        IDS.map((id) => pickVariantKey(category, TERRAN, id)),
      );
      for (const key of available) {
        expect(seen.has(key)).toBe(true);
      }
    });

    it("spreads distinct ids across variants when more than one exists", () => {
      if (available.length < 2) return;
      const seen = new Set(
        IDS.map((id) => pickVariantKey(category, TERRAN, id)),
      );
      expect(seen.size).toBeGreaterThan(1);
    });
  });
}

describe("terran variant selection — missing-variant fallback", () => {
  it("returns undefined (no throw) for an absent terran prefix", () => {
    expect(() =>
      pickVariantKey("planet_maps", "no_such_world", "p1"),
    ).not.toThrow();
    expect(
      pickVariantKey("planet_maps", "no_such_world", "p1"),
    ).toBeUndefined();
    expect(() =>
      pickVariant("planet_maps", "no_such_world", "p1"),
    ).not.toThrow();
    expect(pickVariant("planet_maps", "no_such_world", "p1")).toBeUndefined();
  });

  it("returns undefined (no throw) for an absent category", () => {
    expect(pickVariantKey("not_a_category", TERRAN, "p1")).toBeUndefined();
    expect(pickVariant("not_a_category", TERRAN, "p1")).toBeUndefined();
  });

  it("falls back when the manifest key exists but no texture is loaded", () => {
    expect(pickVariantKey("planet_maps", TERRAN, "p1")).toBeDefined();
    expect(pickVariant("planet_maps", TERRAN, "p1")).toBeUndefined();
  });
});
