import { describe, it, expect } from "vitest";
import { seedMarket } from "@/systems/galaxy/marketSeeding";
import { EconomyType, ResourceType } from "@/types";

const ALL = Object.values(ResourceType) as ResourceType[];

function supplyOf(
  v: { availableResources: ResourceType[]; supplyVector: number[] },
  r: ResourceType,
): number {
  return v.supplyVector[v.availableResources.indexOf(r)];
}

function demandOf(
  v: { availableResources: ResourceType[]; demandVector: number[] },
  r: ResourceType,
): number {
  return v.demandVector[v.availableResources.indexOf(r)];
}

describe("seedMarket — deterministic market population", () => {
  it("is deterministic: same economy + planetId yields identical vectors", () => {
    const a = seedMarket(EconomyType.AGRICULTURAL, "planet-42");
    const b = seedMarket(EconomyType.AGRICULTURAL, "planet-42");
    expect(b).toEqual(a);
  });

  it("differs between planets (per-planet jitter)", () => {
    const a = seedMarket(EconomyType.MIXED, "alpha");
    const b = seedMarket(EconomyType.MIXED, "beta");
    // On MIXED every baseline is 1.0, so any difference is purely the jitter —
    // proves the per-planet seed actually varies the vectors.
    expect(b.supplyVector).not.toEqual(a.supplyVector);
  });

  it("trades the full resource catalogue with matching vector lengths", () => {
    const v = seedMarket(EconomyType.INDUSTRIAL, "p");
    expect(v.availableResources).toEqual(ALL);
    expect(v.supplyVector).toHaveLength(ALL.length);
    expect(v.demandVector).toHaveLength(ALL.length);
  });

  it("keeps every vector entry strictly positive (no div-by-zero in pricing)", () => {
    for (const econ of Object.values(EconomyType)) {
      const v = seedMarket(econ, `bounds-${econ}`);
      for (const s of v.supplyVector) expect(s).toBeGreaterThan(0);
      for (const d of v.demandVector) expect(d).toBeGreaterThan(0);
    }
  });

  it("AGRICULTURAL: food is abundant, tech is scarce", () => {
    const v = seedMarket(EconomyType.AGRICULTURAL, "agri-world");
    // ORGANICS baseline 0.7 (cheap) ⇒ more supply, less demand than
    // ELECTRONICS baseline 1.4 (dear). Jitter ±15% can't flip this.
    expect(supplyOf(v, ResourceType.ORGANICS)).toBeGreaterThan(
      supplyOf(v, ResourceType.ELECTRONICS),
    );
    expect(demandOf(v, ResourceType.ORGANICS)).toBeLessThan(
      demandOf(v, ResourceType.ELECTRONICS),
    );
  });

  it("INDUSTRIAL: tech is abundant, food is scarce", () => {
    const v = seedMarket(EconomyType.INDUSTRIAL, "forge-world");
    // ELECTRONICS baseline 0.7 (cheap) ⇒ more supply than ORGANICS baseline 1.3.
    expect(supplyOf(v, ResourceType.ELECTRONICS)).toBeGreaterThan(
      supplyOf(v, ResourceType.ORGANICS),
    );
    expect(demandOf(v, ResourceType.ELECTRONICS)).toBeLessThan(
      demandOf(v, ResourceType.ORGANICS),
    );
  });

  it("MIXED: no economy bias — supply and demand sit near parity", () => {
    const v = seedMarket(EconomyType.MIXED, "neutral");
    // baseline 1.0 ⇒ both supply and demand land in the jitter band [0.85, 1.15].
    for (const s of v.supplyVector) {
      expect(s).toBeGreaterThanOrEqual(0.85);
      expect(s).toBeLessThanOrEqual(1.15);
    }
    for (const d of v.demandVector) {
      expect(d).toBeGreaterThanOrEqual(0.85);
      expect(d).toBeLessThanOrEqual(1.15);
    }
  });
});
