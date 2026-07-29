import { describe, it, expect, vi } from "vitest";

// PlanetScene imports pixi.js at module load; mock it so the pure resolver can
// be imported without a real renderer (mirrors PlanetScene.services.test.ts).
vi.mock("pixi.js", () => ({
  Container: vi.fn(),
  Graphics: vi.fn(),
  Text: vi.fn(),
}));

import { resolvePlanetBackdropKey } from "@/presentation/PlanetScene";
import { planetBackdropTint, tintFromSeed } from "@/utils/instanceTint";

/**
 * Task 4 (terran-biome collision mitigation): the generated `surfaces/*` art
 * ships only 4 variants per biome, so many TERRESTRIAL planet ids pigeonhole
 * onto the same base image. `planetBackdropTint` must give any two colliding
 * ids visibly different tints so worlds like Резонанс/Спика don't read as
 * identical.
 */
describe("planetBackdropTint (Task 4 — terran collision disambiguation)", () => {
  /** Find two TERRESTRIAL ids whose backdrop resolves to the *same* base key. */
  function findCollidingTerranPair(): [string, string, string] {
    const byKey = new Map<string, string>();
    for (let i = 0; i < 500; i++) {
      const id = `terran-collide-${i}`;
      const key = resolvePlanetBackdropKey("TERRESTRIAL", id, "INDEPENDENT");
      const prev = byKey.get(key);
      if (prev) return [prev, id, key];
      byKey.set(key, id);
    }
    throw new Error(
      "expected a terran surface-variant collision within 500 ids",
    );
  }

  it("gives two ids that hash-collide to the same terran base image different tints", () => {
    const [idA, idB, sharedKey] = findCollidingTerranPair();
    // Precondition: they really do share the same base art (collision).
    expect(resolvePlanetBackdropKey("TERRESTRIAL", idA, "INDEPENDENT")).toBe(
      sharedKey,
    );
    expect(resolvePlanetBackdropKey("TERRESTRIAL", idB, "INDEPENDENT")).toBe(
      sharedKey,
    );
    expect(sharedKey).toMatch(/^surfaces\/terran_/);
    // The tint disambiguates them even though the base image is identical.
    expect(planetBackdropTint(idA, sharedKey)).not.toBe(
      planetBackdropTint(idB, sharedKey),
    );
  });

  it("widens the surface-art band beyond the default subtle instance tint", () => {
    // A `surfaces/*` key uses the wider band, so its tint differs from the
    // default subtle band a shared panorama would get for the same id.
    const id = "terran-band-check";
    expect(planetBackdropTint(id, "surfaces/terran_02")).not.toBe(
      tintFromSeed(id),
    );
  });

  it("keeps the original subtle band for non-surface (panorama) backdrops", () => {
    const id = "panorama-planet";
    expect(planetBackdropTint(id, "panoramas/outlanders_city")).toBe(
      tintFromSeed(id),
    );
  });

  it("is deterministic — same id + key always yields the same tint", () => {
    expect(planetBackdropTint("p", "surfaces/terran_01")).toBe(
      planetBackdropTint("p", "surfaces/terran_01"),
    );
  });
});
