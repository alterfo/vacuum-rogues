import { describe, it, expect, vi } from "vitest";
import { StarType } from "@/types";
import { SeededRNG } from "@/utils/seededRNG";
import {
  STAR_TYPE_WEIGHTS,
  pickStarType,
} from "@/systems/galaxy/starTypeDistribution";
import { pickVariantKey } from "@/presentation/textures";
import { allTextures } from "@/assets/manifest";

vi.mock("pixi.js", async () =>
  (await import("../playtest/pixiStub")).makePixiStub(),
);

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
    expect(commonest / N).toBeLessThan(0.6);
    for (const [type] of STAR_TYPE_WEIGHTS) {
      expect(
        counts.get(type) ?? 0,
        `star type ${type} never drawn`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("same-type entities spread across art variants — no variant collapse", () => {
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
      const picked = new Set<string>();
      for (let i = 0; i < 60; i++) {
        const key = pickVariantKey(category, prefix, `${prefix}_entity_${i}`);
        if (key) picked.add(key);
      }
      expect(picked.size).toBeGreaterThanOrEqual(2);
    },
  );
});
