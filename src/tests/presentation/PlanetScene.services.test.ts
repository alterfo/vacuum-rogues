import { describe, it, expect, vi } from "vitest";

// PlanetScene imports pixi.js at module load; mock it so the pure helper can be
// imported without a real renderer.
vi.mock("pixi.js", () => ({
  Container: vi.fn(),
  Graphics: vi.fn(),
  Text: vi.fn(),
}));

import {
  visiblePlanetServices,
  panoramaKeyForPlanet,
} from "@/presentation/PlanetScene";

describe("panoramaKeyForPlanet (playtest5 — distinct backdrops per planet)", () => {
  it("gives different wilderness backdrops to different terrain types", () => {
    const ice = panoramaKeyForPlanet("ICE", "INDEPENDENT");
    const volcanic = panoramaKeyForPlanet("VOLCANIC", "INDEPENDENT");
    const terrestrial = panoramaKeyForPlanet("TERRESTRIAL", "INDEPENDENT");
    expect(ice).toBe("wilderness_tundra");
    expect(volcanic).toBe("wilderness_desert");
    expect(terrestrial).toBe("wilderness_jungle");
    // The core fix: adjacent planets of different types are NOT identical.
    expect(new Set([ice, volcanic, terrestrial]).size).toBe(3);
  });

  it("dresses settled worlds (HABITAT/INDUSTRIAL) in their faction's city", () => {
    expect(panoramaKeyForPlanet("HABITAT", "SYNDICATE")).toBe("syndicate_city");
    expect(panoramaKeyForPlanet("INDUSTRIAL", "BASTIONS")).toBe(
      "bastions_city",
    );
  });

  it("falls back to a wilderness backdrop for settled worlds without a faction city", () => {
    // INDEPENDENT/OVERMIND have no *_city art → terrain backdrop, not a city.
    expect(panoramaKeyForPlanet("HABITAT", "INDEPENDENT")).toBe(
      "wilderness_jungle",
    );
  });

  it("never returns an empty/undefined key (always a real asset)", () => {
    for (const t of [
      "ICE",
      "VOLCANIC",
      "GAS_GIANT",
      "TERRESTRIAL",
      "HABITAT",
      "INDUSTRIAL",
      "UNKNOWN",
    ]) {
      const key = panoramaKeyForPlanet(t, "OUTLANDERS");
      expect(key.length).toBeGreaterThan(0);
    }
  });
});

const ALL = [
  { label: "Губернатор" },
  { label: "Верфь" },
  { label: "Маркет" },
  { label: "Исследования" },
  { label: "Взлёт" },
];

describe("visiblePlanetServices (US-070 #12)", () => {
  it("shows the full service set on inhabited worlds", () => {
    expect(visiblePlanetServices(true, ALL)).toEqual(ALL);
  });

  it("shows only take-off on uninhabited worlds (no garage/research/market)", () => {
    const visible = visiblePlanetServices(false, ALL);
    expect(visible.map((b) => b.label)).toEqual(["Взлёт"]);
  });
});
