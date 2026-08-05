import { describe, it, expect } from "vitest";
import { GalaxySimulator } from "@/systems/GalaxySimulator";
import { GalaxySchema } from "@/validation/schemas";

describe("market population — generated planets have live markets", () => {
  it("populates non-empty markets with parallel vector lengths and real prices", async () => {
    const galaxy = await new GalaxySimulator().generateGalaxy("market-pop", 8);

    let planetCount = 0;
    for (const sys of galaxy.systems) {
      for (const planet of sys.planets) {
        planetCount++;
        const m = planet.market;
        expect(m.availableResources.length).toBeGreaterThan(0);
        expect(m.priceMultipliers).toHaveLength(m.availableResources.length);
        expect(m.supplyVector).toHaveLength(m.availableResources.length);
        expect(m.demandVector).toHaveLength(m.availableResources.length);
        for (const r of m.availableResources) {
          expect(m.getPrice(r)).toBeGreaterThan(0);
        }
      }
    }
    expect(planetCount).toBeGreaterThan(0);
  });

  it("is deterministic: same seed regenerates identical market vectors", async () => {
    const marketsOf = (
      g: Awaited<ReturnType<GalaxySimulator["generateGalaxy"]>>,
    ) =>
      g.systems.flatMap((s) =>
        s.planets.map((p) => ({
          resources: p.market.availableResources,
          supply: p.market.supplyVector,
          demand: p.market.demandVector,
        })),
      );

    const a = await new GalaxySimulator().generateGalaxy("det-seed", 6);
    const b = await new GalaxySimulator().generateGalaxy("det-seed", 6);
    expect(marketsOf(b)).toEqual(marketsOf(a));
  });

  it("survives the JSON save round-trip with market vectors intact", async () => {
    const galaxy = await new GalaxySimulator().generateGalaxy("validate", 5);

    const plain = JSON.parse(JSON.stringify(galaxy));
    const firstPlanet = plain.systems.flatMap(
      (s: { planets: unknown[] }) => s.planets,
    )[0] as {
      market: {
        availableResources: unknown[];
        supplyVector: unknown[];
        demandVector: unknown[];
        priceMultipliers: unknown[];
      };
    };
    const m = firstPlanet.market;
    expect(m.availableResources.length).toBeGreaterThan(0);
    expect(m.supplyVector).toHaveLength(m.availableResources.length);
    expect(m.demandVector).toHaveLength(m.availableResources.length);
    expect(m.priceMultipliers).toHaveLength(m.availableResources.length);

    expect(() => GalaxySchema.parse(plain)).not.toThrow();
  });
});
