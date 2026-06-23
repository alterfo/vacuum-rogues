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
  resolvePlanetBackdropKey,
} from "@/presentation/PlanetScene";
import { tintFromSeed } from "@/utils/instanceTint";

describe("resolvePlanetBackdropKey (per-planet generated backdrops)", () => {
  // The ComfyUI `surfaces` art is now generated, so the resolver "auto-upgrades"
  // (as the original fallback comment anticipated): each planet maps to a
  // per-biome surface texture (keyed per-planet) instead of the shared panorama.
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
    // With `surfaces` art present it wins over the type/faction panorama, so a
    // TERRESTRIAL planet resolves to a `terran` surface regardless of faction or
    // habitability (the faction-city panoramas are now a fallback only).
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
    // The core fix: adjacent planets of different types are NOT identical.
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
    // INDEPENDENT/OVERMIND have no *_city art → jungle, the most liveable-looking fallback.
    expect(panoramaKeyForPlanet("HABITAT", "INDEPENDENT", true)).toBe(
      "wilderness_jungle",
    );
    expect(panoramaKeyForPlanet("HABITAT", "OVERMIND", true)).toBe(
      "wilderness_jungle",
    );
  });

  it("gives INDUSTRIAL a distinct uninhabitable backdrop (not wilderness_jungle)", () => {
    // Uninhabitable INDUSTRIAL under non-city factions must not silently return
    // the same jungle key as uninhabitable TERRESTRIAL.
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
    // Core bug fix: before, only HABITAT/INDUSTRIAL types got the city backdrop.
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
  // Two ICE worlds both resolve to per-biome `surfaces/ice_*` art (keyed per
  // planet id), and PlanetScene additionally tints the sprite by `planet.id` so
  // even a hash-collision on the surface variant stays visibly distinct.
  it("gives two ICE planets per-biome surface art, disambiguated per id (tint)", () => {
    const keyA = resolvePlanetBackdropKey("ICE", "sys1-ice-a", "INDEPENDENT");
    const keyB = resolvePlanetBackdropKey("ICE", "sys1-ice-b", "INDEPENDENT");
    expect(keyA).toMatch(/^surfaces\/ice_/);
    expect(keyB).toMatch(/^surfaces\/ice_/);
    // The per-id tint always disambiguates them.
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
