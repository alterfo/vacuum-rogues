import { describe, it, expect } from "vitest";
import { PlanetGenerator, ORBIT_ZONES } from "@/systems/PlanetGenerator";
import { SYSTEM_GEOMETRY } from "@/config/balance";
import { PlanetType } from "@/types";

/** Map a planet's orbital radius back to its orbit index. */
function orbitIndexFor(radius: number): number {
  return SYSTEM_GEOMETRY.orbitRadii.indexOf(radius as never);
}

const HABITABLE: readonly PlanetType[] = [
  PlanetType.TERRESTRIAL,
  PlanetType.INDUSTRIAL,
  PlanetType.HABITAT,
];

describe("PlanetGenerator frost-line zones", () => {
  it("places every planet's type within its orbit's allowed zone", async () => {
    for (let seed = 0; seed < 50; seed++) {
      const gen = new PlanetGenerator("galaxy-seed", `system-${seed}`);
      const planets = await gen.generate(`Sys${seed}`);

      for (const planet of planets) {
        const idx = orbitIndexFor(planet.orbitalRadius);
        expect(idx).toBeGreaterThanOrEqual(0);
        const allowed = ORBIT_ZONES[idx];
        expect(
          allowed,
          `orbit index ${idx} has no zone for ${planet.name}`,
        ).toBeDefined();
        expect(
          allowed.includes(planet.type),
          `planet ${planet.name} type ${planet.type} not allowed at orbit ${idx} (allowed: ${allowed.join(", ")})`,
        ).toBe(true);
      }
    }
  });

  it("respects the frost line: inner orbits never gas/ice, outer orbit only gas/ice", async () => {
    for (let seed = 100; seed < 130; seed++) {
      const gen = new PlanetGenerator("galaxy-seed", `frost-${seed}`);
      const planets = await gen.generate(`Frost${seed}`);

      for (const planet of planets) {
        const idx = orbitIndexFor(planet.orbitalRadius);
        if (idx === 0) {
          // Hottest orbit: no gas giants, no ice worlds.
          expect(planet.type).not.toBe(PlanetType.GAS_GIANT);
          expect(planet.type).not.toBe(PlanetType.ICE);
        }
        if (idx === 4) {
          // Coldest orbit: only gas giants and ice.
          expect([PlanetType.GAS_GIANT, PlanetType.ICE]).toContain(planet.type);
        }
      }
    }
  });

  it("guarantees at least one habitable planet per system", async () => {
    for (let seed = 200; seed < 250; seed++) {
      const gen = new PlanetGenerator("galaxy-seed", `hab-${seed}`);
      const planets = await gen.generate(`Hab${seed}`);

      const habitableCount = planets.filter((p) =>
        HABITABLE.includes(p.type),
      ).length;
      expect(
        habitableCount,
        `system hab-${seed} has no habitable planet`,
      ).toBeGreaterThanOrEqual(1);
      // The guaranteed habitable planet is also flagged on the domain object.
      expect(planets.some((p) => p.isHabitable)).toBe(true);
    }
  });
});
