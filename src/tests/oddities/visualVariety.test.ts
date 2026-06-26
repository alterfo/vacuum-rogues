import { describe, it, expect, vi } from "vitest";
import { StarType } from "@/types";
import { SeededRNG } from "@/utils/seededRNG";
import {
  STAR_TYPE_WEIGHTS,
  pickStarType,
} from "@/systems/galaxy/starTypeDistribution";
import { pickVariantKey } from "@/presentation/textures";
import { allTextures } from "@/assets/manifest";

// textures.ts value-imports PixiJS (`Assets`/`Texture`); stub it so this pure
// data/selection oracle boots headlessly (we only call manifest-driven helpers).
vi.mock("pixi.js", async () =>
  (await import("../playtest/pixiStub")).makePixiStub(),
);

/**
 * Task 4 — the letsplay oracle's **visual-sameness** sweep (memory
 * `feedback-letsplay-oddity-hunting`: catch *visual sameness* like the all-yellow
 * suns, not just crashes).
 *
 * Two ways a galaxy collapses to sameness:
 *  1. **Type collapse** — every system the same star type (the historical
 *     all-yellow-dwarf bug). Guarded via the weighted `pickStarType`.
 *  2. **Variant collapse** — many entities of the *same* type all picking the
 *     *same* art file, either because the family ships only one variant or because
 *     the deterministic picker funnels every id to one. Guarded by asserting each
 *     production art family ships ≥2 variants AND `pickVariantKey` actually
 *     spreads distinct ids across them.
 *
 * (Pure pixel-level checks — "is the rendered sun actually yellow" — stay manual
 * via `window.__gameEngine` screenshots / the dev autopilot; this guards the data
 * that feeds the render.) The galaxy-level `GalaxySimulator` star spread is locked
 * by `src/tests/galaxy/starTypeVariety.test.ts`; here we assert the oracle-level
 * distribution + variant-spread invariants those don't cover.
 */

describe("star types are varied — not a field of identical suns", () => {
  it("many seeded systems draw ≥3 distinct star types", () => {
    const seen = new Set<StarType>();
    for (let i = 0; i < 400; i++) {
      seen.add(pickStarType(new SeededRNG(`sys_${i}`)));
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it("no single star type dominates the galaxy (no all-yellow collapse)", () => {
    const counts = new Map<StarType, number>();
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const t = pickStarType(new SeededRNG(`gal_${i}`));
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const commonest = Math.max(...counts.values());
    // Even the commonest (yellow) is well under a uniform field — leave generous
    // headroom over its configured share so a weight tweak doesn't churn this.
    expect(commonest / N).toBeLessThan(0.6);
    // Every art-backed type shows up at least once.
    for (const [type] of STAR_TYPE_WEIGHTS) {
      expect(
        counts.get(type) ?? 0,
        `star type ${type} never drawn`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("same-type entities spread across art variants — no variant collapse", () => {
  // Representative families per art category that production keys by entity id.
  // Each must ship multiple variants so two same-type entities can differ.
  const FAMILIES: ReadonlyArray<{ category: string; prefix: string }> = [
    { category: "planets", prefix: "terrestrial" },
    { category: "planet_maps", prefix: "terrestrial" },
    { category: "ships", prefix: "trader" },
    { category: "ships", prefix: "pirate" },
    { category: "star_maps", prefix: "yellow" },
    { category: "surfaces", prefix: "city" },
  ];

  function variantsOf(category: string, prefix: string): string[] {
    const wanted = `${category}/${prefix}`;
    return allTextures(category).filter(
      (k) => k === wanted || k.startsWith(`${wanted}_`),
    );
  }

  it.each(FAMILIES)(
    "$category/$prefix ships ≥2 variants (same-type entities can differ)",
    ({ category, prefix }) => {
      expect(variantsOf(category, prefix).length).toBeGreaterThanOrEqual(2);
    },
  );

  it.each(FAMILIES)(
    "pickVariantKey spreads many ids across the $category/$prefix variants",
    ({ category, prefix }) => {
      // pickVariantKey resolves against the manifest (no loaded cache needed), so
      // this exercises the real deterministic selection production uses.
      const picked = new Set<string>();
      for (let i = 0; i < 60; i++) {
        const key = pickVariantKey(category, prefix, `${prefix}_entity_${i}`);
        if (key) picked.add(key);
      }
      // The picker must use more than one variant — not funnel every entity to one.
      expect(picked.size).toBeGreaterThanOrEqual(2);
    },
  );
});
