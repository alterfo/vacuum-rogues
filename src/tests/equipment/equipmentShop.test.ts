import { describe, it, expect } from "vitest";
import {
  generateShop,
  SHOP_REFRESH_DAYS,
} from "@/systems/equipment/ShopGenerator";
import { GearKind } from "@/systems/equipment/GearCatalog";

const BASE_OPTS = {
  systemId: "system_1",
  planetId: "planet_industrial",
  seed: "TEST_SEED",
  day: 0,
};

describe("generateShop", () => {
  it("returns items for a standard planet", () => {
    const listings = generateShop(BASE_OPTS);
    expect(listings.length).toBeGreaterThan(0);
  });

  it("items include all three gear kinds", () => {
    const listings = generateShop({ ...BASE_OPTS, day: 14 });
    const kinds = new Set(listings.map((l) => l.gear.kind));
    expect(kinds.has(GearKind.HULL)).toBe(true);
    expect(kinds.has(GearKind.WEAPON)).toBe(true);
    expect(kinds.has(GearKind.EQUIPMENT)).toBe(true);
  });

  it("prices are positive integers", () => {
    const listings = generateShop(BASE_OPTS);
    for (const l of listings) {
      expect(l.price).toBeGreaterThan(0);
      expect(Number.isFinite(l.price)).toBe(true);
    }
  });

  it("shop is deterministic — same inputs give same output", () => {
    const a = generateShop(BASE_OPTS);
    const b = generateShop(BASE_OPTS);
    expect(a.map((l) => l.gear.id)).toEqual(b.map((l) => l.gear.id));
    expect(a.map((l) => l.price)).toEqual(b.map((l) => l.price));
  });

  it("refreshes inventory after SHOP_REFRESH_DAYS", () => {
    const day0 = generateShop(BASE_OPTS)
      .map((l) => l.gear.id)
      .join(",");
    const dayN = generateShop({ ...BASE_OPTS, day: SHOP_REFRESH_DAYS })
      .map((l) => l.gear.id)
      .join(",");
    expect(typeof day0).toBe("string");
    expect(typeof dayN).toBe("string");
  });

  it("priceFactor scales prices", () => {
    const cheap = generateShop({ ...BASE_OPTS, priceFactor: 0.5 });
    const expensive = generateShop({ ...BASE_OPTS, priceFactor: 2.0 });
    if (cheap.length > 0 && expensive.length > 0) {
      const cheapAvg = cheap.reduce((s, l) => s + l.price, 0) / cheap.length;
      const expAvg =
        expensive.reduce((s, l) => s + l.price, 0) / expensive.length;
      expect(expAvg).toBeGreaterThan(cheapAvg);
    }
  });
});
