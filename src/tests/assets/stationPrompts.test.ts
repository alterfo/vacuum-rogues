import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { STATION_TEXTURE_PREFIX } from "@/presentation/flight/stationArt";

interface AssetCategory {
  size?: [number, number];
  variants?: number;
  alpha?: boolean;
  template: string;
  negative: string;
  name_order: string[];
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

describe("station art prompt — shape guard", () => {
  it("declares a `station` category", () => {
    expect(prompts.categories.station).toBeDefined();
  });

  const cat = prompts.categories.station;

  it("has a non-empty `template`", () => {
    expect(typeof cat.template).toBe("string");
    expect(cat.template.trim().length).toBeGreaterThan(0);
  });

  it("renders a transparent top-down sprite (alpha, 1024², ≥4 variants)", () => {
    expect(cat.alpha).toBe(true);
    expect(cat.size).toEqual([1024, 1024]);
    expect(cat.variants ?? 1).toBeGreaterThanOrEqual(4);
    expect(cat.template.toLowerCase()).toContain("top-down");
  });

  it("keys art axes by `type`", () => {
    expect(cat.name_order).toEqual(["type"]);
  });

  it("has exactly one `axes.type` prompt per STATION_TEXTURE_PREFIX value", () => {
    const prefixes = Object.values(STATION_TEXTURE_PREFIX).sort();
    const axisKeys = Object.keys(cat.axes.type).sort();
    expect(axisKeys).toEqual(prefixes);
  });

  it("gives every station prefix a non-empty prompt", () => {
    for (const prefix of Object.values(STATION_TEXTURE_PREFIX)) {
      const prompt = cat.axes.type[prefix];
      expect(prompt, `missing prompt for "${prefix}"`).toBeTruthy();
      expect(prompt.trim().length).toBeGreaterThan(0);
    }
  });

  it("carries an anti-perspective / anti-scenery negative", () => {
    const neg = cat.negative.toLowerCase();
    expect(neg).toContain("perspective view");
    expect(neg).toContain("scenery");
  });
});
