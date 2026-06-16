import { describe, it, expect } from "vitest";
import { GalaxySimulator } from "@/systems/GalaxySimulator";
import { GalaxySchema } from "@/validation/schemas";

/**
 * Task 3 (EPIC-001): every planet built by `generateGalaxy` must come out of
 * generation with a *live* market — non-empty `availableResources` and the
 * three parallel vectors all the same length — so the already-shipped dynamic
 * pricing layer (drift, trade impact, events) has data to act on. Previously
 * every market was the empty `new Market([], [], [])` stub.
 */
describe("market population — generated planets have live markets", () => {
  it("populates non-empty markets with parallel vector lengths and real prices", async () => {
    const galaxy = await new GalaxySimulator().generateGalaxy("market-pop", 8);

    let planetCount = 0;
    for (const sys of galaxy.systems) {
      for (const planet of sys.planets) {
        planetCount++;
        const m = planet.market;
        expect(m.availableResources.length).toBeGreaterThan(0);
        // priceMultipliers / supply / demand must stay parallel to resources.
        expect(m.priceMultipliers).toHaveLength(m.availableResources.length);
        expect(m.supplyVector).toHaveLength(m.availableResources.length);
        expect(m.demandVector).toHaveLength(m.availableResources.length);
        // Every populated resource now resolves to a real (non-zero) price —
        // empty stubs returned 0 for everything (idx < 0).
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

    // JSON.stringify is the real save path (SaveStateSerializer) — NOT
    // GalaxySchema. The populated market arrays must survive that round-trip.
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
    // All four parallel arrays must persist at the same length.
    expect(m.supplyVector).toHaveLength(m.availableResources.length);
    expect(m.demandVector).toHaveLength(m.availableResources.length);
    expect(m.priceMultipliers).toHaveLength(m.availableResources.length);

    // Sanity: a populated galaxy still passes galaxy-level schema validation.
    // NOTE: StarSystemSchema has no `planets` field, so Zod strips planets and
    // this does NOT validate market structure — the JSON assertions above are
    // what actually guard market persistence.
    expect(() => GalaxySchema.parse(plain)).not.toThrow();
  });
});
