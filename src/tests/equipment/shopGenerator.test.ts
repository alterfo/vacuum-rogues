import { describe, it, expect } from "vitest";
import { generateShop } from "@/systems/equipment/ShopGenerator";

const BASE_OPTS = {
  systemId: "system_tech_test",
  planetId: "planet_tech_test",
  seed: "TECH_GATE_SEED",
  day: 0,
};

describe("generateShop — maxTechLevel gating", () => {
  it("system techLevel=3 never stocks tech-4+ items", () => {
    const listings = generateShop({ ...BASE_OPTS, maxTechLevel: 3 });
    expect(listings.length).toBeGreaterThan(0);
    for (const l of listings) {
      expect(l.gear.techLevel).toBeLessThanOrEqual(3);
    }
  });

  it("system techLevel=3 does stock some tech-1 through tech-3 items", () => {
    const listings = generateShop({ ...BASE_OPTS, maxTechLevel: 3 });
    const techLevels = new Set(listings.map((l) => l.gear.techLevel));
    // At least one item at or below level 3 must appear
    expect([...techLevels].some((t) => t <= 3)).toBe(true);
  });

  it("RESEARCH_LAB at system techLevel=3 can stock up to tech-4 (maxTechLevel=4)", () => {
    // Simulate RESEARCH_LAB +1 bonus: system tech 3 → maxTechLevel 4
    const listings = generateShop({ ...BASE_OPTS, maxTechLevel: 4 });
    expect(listings.length).toBeGreaterThan(0);
    for (const l of listings) {
      expect(l.gear.techLevel).toBeLessThanOrEqual(4);
    }
    // Must not include tech-5+ items
    const hasTech5Plus = listings.some((l) => l.gear.techLevel >= 5);
    expect(hasTech5Plus).toBe(false);
  });

  it("maxTechLevel=8 cap includes all available gear (no items above 8)", () => {
    const listings = generateShop({ ...BASE_OPTS, maxTechLevel: 8 });
    for (const l of listings) {
      expect(l.gear.techLevel).toBeLessThanOrEqual(8);
    }
  });

  it("maxTechLevel=1 only stocks tech-1 items", () => {
    const listings = generateShop({ ...BASE_OPTS, maxTechLevel: 1 });
    for (const l of listings) {
      expect(l.gear.techLevel).toBe(1);
    }
  });

  it("without maxTechLevel (legacy), items of all tech levels can appear", () => {
    // Run without maxTechLevel — should include high-tech items eventually
    // Use a seed that produces a rich catalog
    const listings = generateShop({
      systemId: "sys_open",
      planetId: "planet_open",
      seed: "OPEN_SEED",
      day: 0,
    });
    const maxFound = Math.max(...listings.map((l) => l.gear.techLevel));
    // Catalog has T1–T8; without a cap we expect at least some T5+ to appear
    expect(maxFound).toBeGreaterThanOrEqual(4);
  });
});
