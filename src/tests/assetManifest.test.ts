import { describe, it, expect } from "vitest";
import { allTextures, texture } from "@/assets/manifest";

const name = (key: string): string => key.split("/")[1] ?? "";

describe("asset manifest — nebula parallax layers", () => {
  const keys = allTextures("nebula");

  it("exposes all 24 palette × layer × variant tiles", () => {
    expect(keys).toHaveLength(24);
  });

  it("covers every palette × layer combination with 2 variants (<palette>_<layer>_01/_02)", () => {
    const palettes = ["red", "blue", "green", "teal"];
    const layers = ["far", "mid", "near"];
    for (const palette of palettes) {
      for (const layer of layers) {
        expect(texture(`nebula/${palette}_${layer}_01`)).toBeDefined();
        expect(texture(`nebula/${palette}_${layer}_02`)).toBeDefined();
      }
    }
  });
});

describe("asset manifest — star surface maps", () => {
  const keys = allTextures("star_maps");

  it("provides at least one map per star type", () => {
    const types = [
      "yellow",
      "blue_giant",
      "red_dwarf",
      "white_dwarf",
      "neutron",
    ];
    for (const type of types) {
      expect(keys.some((k) => name(k).startsWith(`${type}_`))).toBe(true);
    }
  });
});

describe("asset manifest — landing panoramas", () => {
  const keys = allTextures("panoramas");
  const names = keys.map(name);

  it("ships the five faction city panoramas", () => {
    for (const faction of [
      "bastions",
      "syndicate",
      "outlanders",
      "progressors",
      "paradoxes",
    ]) {
      expect(names).toContain(`${faction}_city`);
    }
  });

  it("ships the three wilderness biome panoramas", () => {
    for (const biome of ["desert", "jungle", "tundra"]) {
      expect(names).toContain(`wilderness_${biome}`);
    }
  });

  it("meets the 8-panorama minimum", () => {
    expect(keys.length).toBeGreaterThanOrEqual(8);
  });

  it("exposes the outlanders_city fallback used by the PlanetScene backdrop", () => {
    expect(texture("panoramas/outlanders_city")).toBeDefined();
  });
});

describe("asset manifest — planet surface maps", () => {
  const keys = allTextures("planet_maps");
  const names = keys.map(name);

  it("keeps the CC BY 4.0 Solar System Scope originals (_04 / _05)", () => {
    for (const type of [
      "terrestrial",
      "gas",
      "ice",
      "volcanic",
      "industrial",
    ]) {
      expect(names.some((n) => n.startsWith(`${type}_0`))).toBe(true);
    }
    expect(texture("planet_maps/terrestrial_04")).toBeDefined();
    expect(texture("planet_maps/gas_04")).toBeDefined();
  });

  it("provides the default rotation-shader texture (<type>_04)", () => {
    expect(texture("planet_maps/habitat_04")).toBeDefined();
  });
});
