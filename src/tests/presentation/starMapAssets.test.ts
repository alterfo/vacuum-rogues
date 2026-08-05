import { describe, it, expect } from "vitest";
import { textures } from "@/assets/manifest";

describe("star_maps manifest (F4 — baked collage-seam maps stay deleted)", () => {
  it.each([
    "star_maps/yellow_01",
    "star_maps/yellow_04",
    "star_maps/neutron_01",
  ])("does not contain the seam-row map %s", (key) => {
    expect(textures[key]).toBeUndefined();
  });

  it("still has at least one map per deleted star type", () => {
    const keys = Object.keys(textures);
    expect(keys.some((k) => k.startsWith("star_maps/yellow_"))).toBe(true);
    expect(keys.some((k) => k.startsWith("star_maps/neutron_"))).toBe(true);
  });
});
