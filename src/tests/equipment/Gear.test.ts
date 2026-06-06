import { describe, it, expect } from "vitest";
import {
  GEAR_CATALOG,
  GearKind,
  gearById,
  gearMarketPrice,
  type HullSpec,
  type WeaponSpec,
} from "@/systems/equipment/GearCatalog";
import { HullClass } from "@/types";
import { generateShop } from "@/systems/equipment/ShopGenerator";

describe("GearCatalog", () => {
  it("has hulls, weapons and equipment with unique ids", () => {
    const ids = GEAR_CATALOG.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(GEAR_CATALOG.some((g) => g.kind === GearKind.HULL)).toBe(true);
    expect(GEAR_CATALOG.some((g) => g.kind === GearKind.WEAPON)).toBe(true);
    expect(GEAR_CATALOG.some((g) => g.kind === GearKind.EQUIPMENT)).toBe(true);
  });

  it("prices rise with tech level and fall with size (canon §11.3)", () => {
    const base: HullSpec = {
      id: "x",
      name: "x",
      kind: GearKind.HULL,
      hullClass: HullClass.CORVETTE,
      techLevel: 3,
      size: 6,
      basePrice: 1000,
      hp: 100,
      slots: 4,
      weaponSlots: 2,
      equipmentSlots: 2,
      cargo: 10,
    };
    const higherTech = gearMarketPrice({ ...base, techLevel: 6 });
    const lowerTech = gearMarketPrice({ ...base, techLevel: 2 });
    expect(higherTech).toBeGreaterThan(lowerTech);

    const smaller = gearMarketPrice({ ...base, size: 2 });
    const bigger = gearMarketPrice({ ...base, size: 8 });
    expect(smaller).toBeGreaterThan(bigger);
  });

  it("gearById resolves catalog items", () => {
    const g = gearById("wpn_torpedo");
    expect(g?.kind).toBe(GearKind.WEAPON);
    expect((g as WeaponSpec).damage).toBeGreaterThan(0);
    expect(gearById("nope")).toBeUndefined();
  });
});

describe("ShopGenerator", () => {
  it("is deterministic per (planet, day-bucket)", () => {
    const opts = { systemId: "S", planetId: "P", seed: "seed", day: 1 };
    const a = generateShop(opts);
    const b = generateShop({ ...opts, day: 5 }); // same 7-day bucket
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("refreshes stock on a new bucket", () => {
    const a = generateShop({
      systemId: "S",
      planetId: "P",
      seed: "seed",
      day: 0,
    });
    const b = generateShop({
      systemId: "S",
      planetId: "P",
      seed: "seed",
      day: 14,
    });
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
  });

  it("stocks low-tech gear far more often than high-tech across many planets", () => {
    let lowSeen = 0;
    let highSeen = 0;
    const planets = 120;
    for (let i = 0; i < planets; i++) {
      const shop = generateShop({
        systemId: "S",
        planetId: `P${i}`,
        seed: "seed",
        day: 0,
      });
      const ids = new Set(shop.map((l) => l.gear.id));
      if (ids.has("eq_tank")) lowSeen++; // T1
      if (ids.has("hull_bastion")) highSeen++; // T7
    }
    expect(lowSeen).toBeGreaterThan(highSeen);
  });

  it("applies the price factor (cheaper hub vs pricier)", () => {
    const cheap = generateShop({
      systemId: "S",
      planetId: "P",
      seed: "s",
      day: 0,
      priceFactor: 0.8,
    });
    const dear = generateShop({
      systemId: "S",
      planetId: "P",
      seed: "s",
      day: 0,
      priceFactor: 1.2,
    });
    // Same stock (same seed), but every dear price ≥ its cheap counterpart.
    for (const c of cheap) {
      const d = dear.find((x) => x.gear.id === c.gear.id);
      expect(d).toBeDefined();
      if (d) expect(d.price).toBeGreaterThan(c.price);
    }
  });
});
