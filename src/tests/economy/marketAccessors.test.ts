import { describe, it, expect } from "vitest";
import { Market } from "@/domain/Market";
import { ResourceType } from "@/types";

const RESOURCES = Object.values(ResourceType) as ResourceType[];

function fullMarket(): Market {
  return new Market(
    RESOURCES,
    RESOURCES.map(() => 1.0),
    RESOURCES.map(() => 1.0),
  );
}

describe("Market resource-keyed accessors", () => {
  it("hasResource returns true for a traded resource", () => {
    const m = fullMarket();
    expect(m.hasResource(ResourceType.ORGANICS)).toBe(true);
    expect(m.hasResource(ResourceType.DATA_CORES)).toBe(true);
  });

  it("hasResource returns false for an absent resource", () => {
    const m = new Market(
      [ResourceType.FUEL, ResourceType.METALS],
      [1.0, 1.0],
      [1.0, 1.0],
    );
    expect(m.hasResource(ResourceType.FUEL)).toBe(true);
    expect(m.hasResource(ResourceType.LUXURY)).toBe(false);
  });

  it("hasResource returns false on an empty stub market", () => {
    const m = new Market([], [], []);
    expect(m.hasResource(ResourceType.ORGANICS)).toBe(false);
  });

  it("multiplierFor resolves the multiplier by key, not array index", () => {
    const m = new Market(
      [ResourceType.FUEL, ResourceType.LUXURY],
      [1.0, 1.0],
      [1.0, 1.0],
    );
    m.applyTradeImpact(ResourceType.LUXURY, 0.5);
    expect(m.multiplierFor(ResourceType.LUXURY)).toBeCloseTo(1.5);
    expect(m.multiplierFor(ResourceType.FUEL)).toBeCloseTo(1.0);
  });

  it("multiplierFor returns the neutral default (1.0) for an absent resource", () => {
    const m = new Market([ResourceType.FUEL], [1.0], [1.0]);
    expect(m.multiplierFor(ResourceType.WEAPONS)).toBe(1.0);
  });

  it("multiplierFor returns 1.0 on an empty stub market", () => {
    const m = new Market([], [], []);
    expect(m.multiplierFor(ResourceType.ORGANICS)).toBe(1.0);
  });
});
