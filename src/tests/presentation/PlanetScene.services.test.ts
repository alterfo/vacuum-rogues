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
  // No surfaces/ art is bundled in the test manifest, so the resolver falls
  // back to the shared type/faction panorama — proving the game is unchanged
  // until the ComfyUI `surfaces` art is generated, then auto-upgrades.
  it("falls back to the type/faction panorama when no surface art exists", () => {
    expect(
      resolvePlanetBackdropKey("ICE", "planet-x", "INDEPENDENT", false),
    ).toBe("panoramas/wilderness_tundra");
    expect(resolvePlanetBackdropKey("HABITAT", "p", "SYNDICATE", true)).toBe(
      "panoramas/syndicate_city",
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

  it("habitable TERRESTRIAL planet shows faction city, not wilderness", () => {
    // Bug: before this fix, isHabitable was not passed → wilderness_jungle on
    // a settled TERRESTRIAL planet. Now habitable = city if faction has one.
    expect(
      resolvePlanetBackdropKey("TERRESTRIAL", "p", "OUTLANDERS", true),
    ).toBe("panoramas/outlanders_city");
    expect(resolvePlanetBackdropKey("TERRESTRIAL", "p", "BASTIONS", true)).toBe(
      "panoramas/bastions_city",
    );
    // Uninhabitable stays wilderness.
    expect(
      resolvePlanetBackdropKey("TERRESTRIAL", "p", "OUTLANDERS", false),
    ).toBe("panoramas/wilderness_jungle");
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
  // The playtest5 residual: two same-type, same-faction worlds resolve to the
  // SAME backdrop key, so the panorama art is shared. PlanetScene tints that
  // sprite by `planet.id` to keep them visibly distinct.
  it("gives two planets sharing a backdrop key distinct tints", () => {
    const keyA = resolvePlanetBackdropKey("ICE", "sys1-ice-a", "INDEPENDENT");
    const keyB = resolvePlanetBackdropKey("ICE", "sys1-ice-b", "INDEPENDENT");
    expect(keyA).toBe(keyB); // shared art...
    // ...but the per-id tint disambiguates them.
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
