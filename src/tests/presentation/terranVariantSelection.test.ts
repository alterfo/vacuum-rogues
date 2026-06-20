/**
 * Terran variant-selection guard (plan 20260620-alien-terran-planet-art, Task 3).
 *
 * Alien-terran variety is glob-driven: landing more `terrestrial_NN` files into
 * src/assets/planet_maps|planets widens variety with no code change, because
 * pickVariant/pickVariantKey hash the planet id across ALL matching variants.
 * These tests pin that contract:
 *  - selection is deterministic per planet id (stable across reloads),
 *  - it ranges over every globbed terran variant (no variant is unreachable),
 *  - distinct ids spread across variants (worlds don't all twin),
 *  - a missing / absent variant falls back to undefined without throwing.
 *
 * Note: in unit tests the texture cache is empty (preloadTextures is never
 * called), so pickVariant — which only returns *loaded* textures — yields
 * undefined here; that exercises the graceful-fallback path. The manifest-level
 * mirror pickVariantKey is what drives the lazy planet_maps sphere upgrade in
 * production, so the determinism/spread contract is asserted through it.
 */
import { describe, it, expect } from "vitest";
import { pickVariant, pickVariantKey } from "@/presentation/textures";
import { allTextures } from "@/assets/manifest";

const TERRAN = "terrestrial";
// A large, fixed (hence deterministic — never flaky) spread of planet ids.
const IDS = Array.from({ length: 200 }, (_, i) => `planet-${i}`);

/** The globbed terran variant keys for a category, mirroring pickVariant's filter. */
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
    // planet_maps is lazy-loaded (never eagerly cached); here the cache is empty,
    // so the cached-only pickVariant falls back to undefined even though a
    // manifest key resolves — the production lazy-upgrade path then loads it.
    expect(pickVariantKey("planet_maps", TERRAN, "p1")).toBeDefined();
    expect(pickVariant("planet_maps", TERRAN, "p1")).toBeUndefined();
  });
});
