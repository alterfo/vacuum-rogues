import { describe, it, expect, vi } from "vitest";

vi.mock("pixi.js", () => ({
  Container: vi.fn(),
  Graphics: vi.fn(),
  Text: vi.fn(),
}));

import {
  visiblePlanetServices,
  panoramaKeyForPlanet,
  resolvePlanetBackdropKey,
} from "@/presentation/PlanetScene";
import { tintFromSeed } from "@/utils/instanceTint";

describe("resolvePlanetBackdropKey (per-planet generated backdrops)", () => {
  it("uses per-biome surface art (auto-upgraded from the panorama fallback)", () => {
    expect(
      resolvePlanetBackdropKey("ICE", "planet-x", "INDEPENDENT", false),
    ).toMatch(/^surfaces\/ice_/);
    expect(resolvePlanetBackdropKey("HABITAT", "p", "SYNDICATE", true)).toMatch(
      /^surfaces\/city_/,
    );
  });

  it("keeps different planet types distinct even in the fallback", () => {
    const ice = resolvePlanetBackdropKey("ICE", "a", "INDEPENDENT", false);
    const volcanic = resolvePlanetBackdropKey(
      "VOLCANIC",
      "b",
      "INDEPENDENT",
      false,
    );
    const terrestrial = resolvePlanetBackdropKey(
      "TERRESTRIAL",
      "c",
      "INDEPENDENT",
      false,
    );
    expect(new Set([ice, volcanic, terrestrial]).size).toBe(3);
  });

  it("maps TERRESTRIAL planets to per-biome terran surface art (surfaces take precedence)", () => {
    expect(
      resolvePlanetBackdropKey("TERRESTRIAL", "p", "OUTLANDERS", true),
    ).toMatch(/^surfaces\/terran_/);
    expect(
      resolvePlanetBackdropKey("TERRESTRIAL", "p", "BASTIONS", true),
    ).toMatch(/^surfaces\/terran_/);
    expect(
      resolvePlanetBackdropKey("TERRESTRIAL", "p", "OUTLANDERS", false),
    ).toMatch(/^surfaces\/terran_/);
  });
});

describe("panoramaKeyForPlanet (playtest5 — distinct backdrops per planet)", () => {
  it("gives different wilderness backdrops to different terrain types", () => {
    const ice = panoramaKeyForPlanet("ICE", "INDEPENDENT", false);
    const volcanic = panoramaKeyForPlanet("VOLCANIC", "INDEPENDENT", false);
    const terrestrial = panoramaKeyForPlanet(
      "TERRESTRIAL",
      "INDEPENDENT",
      false,
    );
    expect(ice).toBe("wilderness_tundra");
    expect(volcanic).toBe("wilderness_desert");
    expect(terrestrial).toBe("wilderness_jungle");
    expect(new Set([ice, volcanic, terrestrial]).size).toBe(3);
  });

  it("dresses settled worlds (HABITAT/INDUSTRIAL) in their faction's city", () => {
    expect(panoramaKeyForPlanet("HABITAT", "SYNDICATE", true)).toBe(
      "syndicate_city",
    );
    expect(panoramaKeyForPlanet("INDUSTRIAL", "BASTIONS", true)).toBe(
      "bastions_city",
    );
  });

  it("falls back to wilderness_jungle for habitable worlds without a faction city", () => {
    expect(panoramaKeyForPlanet("HABITAT", "INDEPENDENT", true)).toBe(
      "wilderness_jungle",
    );
    expect(panoramaKeyForPlanet("HABITAT", "OVERMIND", true)).toBe(
      "wilderness_jungle",
    );
  });

  it("gives INDUSTRIAL a distinct uninhabitable backdrop (not wilderness_jungle)", () => {
    const industrial = panoramaKeyForPlanet("INDUSTRIAL", "INDEPENDENT", false);
    const terrestrial = panoramaKeyForPlanet(
      "TERRESTRIAL",
      "INDEPENDENT",
      false,
    );
    expect(industrial).toBe("wilderness_desert");
    expect(industrial).not.toBe(terrestrial);
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
      const key = panoramaKeyForPlanet(t, "OUTLANDERS", false);
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it("habitable planet of any type shows faction city backdrop", () => {
    expect(panoramaKeyForPlanet("TERRESTRIAL", "PROGRESSORS", true)).toBe(
      "progressors_city",
    );
    expect(panoramaKeyForPlanet("ICE", "PARADOXES", true)).toBe(
      "paradoxes_city",
    );
    expect(panoramaKeyForPlanet("VOLCANIC", "SYNDICATE", true)).toBe(
      "syndicate_city",
    );
  });
});

const ALL = [
  { label: "Губернатор" },
  { label: "Верфь" },
  { label: "Маркет" },
  { label: "Исследования" },
  { label: "Взлёт" },
];

describe("per-instance backdrop tint (Task 1 — each planet distinct)", () => {
  it("gives two ICE planets per-biome surface art, disambiguated per id (tint)", () => {
    const keyA = resolvePlanetBackdropKey("ICE", "sys1-ice-a", "INDEPENDENT");
    const keyB = resolvePlanetBackdropKey("ICE", "sys1-ice-b", "INDEPENDENT");
    expect(keyA).toMatch(/^surfaces\/ice_/);
    expect(keyB).toMatch(/^surfaces\/ice_/);
    expect(tintFromSeed("sys1-ice-a")).not.toBe(tintFromSeed("sys1-ice-b"));
  });
});

describe("visiblePlanetServices (US-070 #12)", () => {
  it("shows the full service set on inhabited worlds", () => {
    expect(visiblePlanetServices(true, ALL)).toEqual(ALL);
  });

  it("shows only take-off on uninhabited worlds (no garage/research/market)", () => {
    const visible = visiblePlanetServices(false, ALL);
    expect(visible.map((b) => b.label)).toEqual(["Взлёт"]);
  });
});
