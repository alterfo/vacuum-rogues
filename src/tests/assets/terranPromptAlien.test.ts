import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

interface AssetCategory {
  variants?: number;
  negative: string;
  axes: { type: Record<string, string> };
}
interface AssetPrompts {
  categories: Record<string, AssetCategory>;
}

const prompts: AssetPrompts = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "tools/comfyui/asset_prompts.json"),
    "utf-8",
  ),
);

const EARTH_TOKENS = [
  "earth",
  "satellite imagery",
  "green and brown continents",
  "green and brown landmasses",
  "blue marble",
];

const ANTI_EARTH_NEGATIVES = ["earth", "blue marble", "real-world"];

const EXOTIC_OCEAN_TOKENS = [
  "turquoise",
  "emerald",
  "indigo",
  "wine",
  "methane",
];
const ALIEN_VEGETATION_TOKENS = ["crimson", "violet", "amber", "cyan"];

describe("alien-terran prompt — planet_maps (equirect surface)", () => {
  const cat = prompts.categories.planet_maps;
  const terran = cat.axes.type.terrestrial.toLowerCase();

  it("carries no recognisable-Earth tokens", () => {
    for (const token of EARTH_TOKENS) {
      expect(terran).not.toContain(token);
    }
  });

  it("frames the world as explicitly alien", () => {
    expect(terran).toContain("alien");
  });

  it("includes exotic non-Earth ocean colours", () => {
    const hits = EXOTIC_OCEAN_TOKENS.filter((t) => terran.includes(t));
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it("includes non-Earth vegetation colours", () => {
    const hits = ALIEN_VEGETATION_TOKENS.filter((t) => terran.includes(t));
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it("excludes Earth in the category negative prompt", () => {
    const neg = cat.negative.toLowerCase();
    for (const token of ANTI_EARTH_NEGATIVES) {
      expect(neg).toContain(token);
    }
  });

  it("raises the variant count for variety (was 3)", () => {
    expect(cat.variants ?? 1).toBeGreaterThan(3);
  });
});

describe("alien-terran prompt — planets (globe sprite)", () => {
  const cat = prompts.categories.planets;
  const terran = cat.axes.type.terrestrial.toLowerCase();

  it("carries no recognisable-Earth tokens", () => {
    for (const token of EARTH_TOKENS) {
      expect(terran).not.toContain(token);
    }
  });

  it("frames the world as explicitly alien", () => {
    expect(terran).toContain("alien");
  });

  it("includes exotic non-Earth ocean colours", () => {
    const hits = EXOTIC_OCEAN_TOKENS.filter((t) => terran.includes(t));
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it("includes non-Earth vegetation colours", () => {
    const hits = ALIEN_VEGETATION_TOKENS.filter((t) => terran.includes(t));
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it("excludes Earth in the category negative prompt", () => {
    const neg = cat.negative.toLowerCase();
    for (const token of ANTI_EARTH_NEGATIVES) {
      expect(neg).toContain(token);
    }
  });

  it("raises the variant count for variety (was 6)", () => {
    expect(cat.variants ?? 1).toBeGreaterThan(6);
  });
});
