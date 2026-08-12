import { describe, it, expect } from "vitest";
import {
  GEAR_CATALOG,
  gearById,
  isRareGear,
  GearKind,
  type HullSpec,
  type EquipmentSpec,
} from "@/systems/equipment/GearCatalog";
import {
  generateShop,
  soldOutKey,
  shopBucket,
  SHOP_REFRESH_DAYS,
} from "@/systems/equipment/ShopGenerator";
import { techLevelWithUplift } from "@/systems/campaign/techUplift";
import { GALAXY_MAX_TECH_FLOOR } from "@/systems/galaxy/systemTechDistribution";
import { GalaxySchema } from "@/validation/schemas";

const MID_GAME_IDS = ["hull_marauder", "eq_engine_surge"];

describe("mid-game wealth-sink catalog additions (Task 20)", () => {
  it("both bridge items exist, are day-270-gated, and priced above the old 14k ceiling", () => {
    for (const id of MID_GAME_IDS) {
      const g = gearById(id);
      expect(g, id).toBeDefined();
      expect(g!.minDay, id).toBe(270);
      expect(g!.basePrice, id).toBeGreaterThan(14000);
      expect(g!.basePrice, id).toBeLessThan(68000);
      expect(isRareGear(g!), id).toBe(true);
    }
  });

  it("the new hull sits strictly between the bastion and the dreadnought in price and hp", () => {
    const bastion = gearById("hull_bastion") as HullSpec;
    const marauder = gearById("hull_marauder") as HullSpec;
    const dreadnought = gearById("hull_dreadnought") as HullSpec;
    expect(marauder.basePrice).toBeGreaterThan(bastion.basePrice);
    expect(marauder.basePrice).toBeLessThan(dreadnought.basePrice);
    expect(marauder.hp).toBeGreaterThan(bastion.hp);
    expect(marauder.hp).toBeLessThan(dreadnought.hp);
  });

  it("the new engine slots between the apex engine and the endgame courier engine on both price and potency", () => {
    const apex = gearById("eq_engine_v") as EquipmentSpec;
    const surge = gearById("eq_engine_surge") as EquipmentSpec;
    const courier = gearById("eq_engine_vi") as EquipmentSpec;
    expect(surge.basePrice).toBeGreaterThan(apex.basePrice);
    expect(surge.basePrice).toBeLessThan(courier.basePrice);
    expect(surge.potency).toBeGreaterThan(apex.potency);
    expect(surge.potency).toBeLessThan(courier.potency);
  });

  it("reachable at day 270 in an uplifted system, matching production tech-cap params", () => {
    const maxTechLevel = techLevelWithUplift(GALAXY_MAX_TECH_FLOOR, 270);
    expect(maxTechLevel).toBeGreaterThanOrEqual(7);
    let stocked = 0;
    for (let i = 0; i < 300; i++) {
      const listings = generateShop({
        systemId: "S",
        planetId: `P${i}`,
        seed: "mid-game-sink",
        day: 270,
        maxTechLevel,
      });
      if (listings.some((l) => MID_GAME_IDS.includes(l.gear.id))) stocked++;
    }
    expect(stocked).toBeGreaterThan(0);
  });

  it("never stocked before day 270", () => {
    const maxTechLevel = techLevelWithUplift(GALAXY_MAX_TECH_FLOOR, 269);
    for (let i = 0; i < 100; i++) {
      const listings = generateShop({
        systemId: "S",
        planetId: `P${i}`,
        seed: "mid-game-sink",
        day: 269,
        maxTechLevel,
      });
      expect(listings.some((l) => MID_GAME_IDS.includes(l.gear.id))).toBe(
        false,
      );
    }
  });
});

describe("gear uniqueness — premium listings deplete on purchase (Task 20)", () => {
  const OPTS = {
    systemId: "S",
    planetId: "P1",
    seed: "uniqueness-seed",
    day: 270,
    maxTechLevel: 8,
  };

  it("marking a rare item sold in the current bucket removes it from that planet's stock", () => {
    const before = generateShop(OPTS);
    const rare = before.find((l) => isRareGear(l.gear));
    expect(rare).toBeDefined();

    const bucket = shopBucket(OPTS.day, SHOP_REFRESH_DAYS);
    const soldOutGear = {
      [soldOutKey(OPTS.planetId, rare!.gear.id)]: bucket,
    };
    const after = generateShop({ ...OPTS, soldOutGear });
    expect(after.some((l) => l.gear.id === rare!.gear.id)).toBe(false);
    expect(after.length).toBe(before.length - 1);
  });

  it("a sale from a past bucket does not suppress the current bucket's stock", () => {
    const before = generateShop(OPTS);
    const rare = before.find((l) => isRareGear(l.gear));
    expect(rare).toBeDefined();

    const staleBucket = shopBucket(OPTS.day, SHOP_REFRESH_DAYS) - 1;
    const soldOutGear = {
      [soldOutKey(OPTS.planetId, rare!.gear.id)]: staleBucket,
    };
    const after = generateShop({ ...OPTS, soldOutGear });
    expect(after.some((l) => l.gear.id === rare!.gear.id)).toBe(true);
  });

  it("marking a common (non-rare) item sold has no effect — common gear always restocks", () => {
    const before = generateShop(OPTS);
    const common = before.find((l) => !isRareGear(l.gear));
    expect(common).toBeDefined();

    const bucket = shopBucket(OPTS.day, SHOP_REFRESH_DAYS);
    const soldOutGear = {
      [soldOutKey(OPTS.planetId, common!.gear.id)]: bucket,
    };
    const after = generateShop({ ...OPTS, soldOutGear });
    expect(after.some((l) => l.gear.id === common!.gear.id)).toBe(true);
    expect(after.length).toBe(before.length);
  });

  it("without soldOutGear, behavior is unchanged (empty thresholds == current behavior)", () => {
    const withUndefined = generateShop(OPTS);
    const withEmpty = generateShop({ ...OPTS, soldOutGear: {} });
    expect(withEmpty).toEqual(withUndefined);
  });

  it("the depletion filter only ever removes rare/premium gear, never common gear", () => {
    for (const gear of GEAR_CATALOG) {
      if (isRareGear(gear)) continue;
      const soldOutGear = { [soldOutKey("anyPlanet", gear.id)]: 0 };
      const listings = generateShop({
        systemId: "S",
        planetId: "anyPlanet",
        seed: "sweep",
        day: gear.minDay ?? 0,
        maxTechLevel: 8,
        soldOutGear,
      });
      const withoutFilter = generateShop({
        systemId: "S",
        planetId: "anyPlanet",
        seed: "sweep",
        day: gear.minDay ?? 0,
        maxTechLevel: 8,
      });
      expect(
        listings.some((l) => l.gear.id === gear.id),
        gear.id,
      ).toBe(withoutFilter.some((l) => l.gear.id === gear.id));
    }
  });
});

describe("soldOutGear save compatibility — additive-optional field (Task 20)", () => {
  it("an old save's galaxy blob without soldOutGear parses with it left undefined", () => {
    const legacyGalaxy = {
      id: "g1",
      gameDays: 300,
      systems: [
        {
          id: "sys1",
          name: "Sys",
          coordinates: { q: 0, r: 0 },
          starType: "YELLOW_DWARF",
          explored: true,
          fogOfWar: false,
          techLevel: 5,
        },
      ],
    };
    const parsed = GalaxySchema.parse(legacyGalaxy);
    expect(parsed.soldOutGear).toBeUndefined();
  });

  it("an absent soldOutGear behaves identically to an empty one when generating shop stock", () => {
    const legacyGalaxy = {
      id: "g1",
      gameDays: 270,
      systems: [
        {
          id: "sys1",
          name: "Sys",
          coordinates: { q: 0, r: 0 },
          starType: "YELLOW_DWARF",
          explored: true,
          fogOfWar: false,
          techLevel: 5,
        },
      ],
    };
    const parsed = GalaxySchema.parse(legacyGalaxy);
    const listings = generateShop({
      systemId: "sys1",
      planetId: "P1",
      seed: "legacy-seed",
      day: parsed.gameDays,
      maxTechLevel: 8,
      soldOutGear: parsed.soldOutGear,
    });
    const baseline = generateShop({
      systemId: "sys1",
      planetId: "P1",
      seed: "legacy-seed",
      day: parsed.gameDays,
      maxTechLevel: 8,
    });
    expect(listings).toEqual(baseline);
  });
});

describe("hull tab is unaffected by gear kind filters (sanity, Task 20)", () => {
  it("the new hull is still classified as a HULL, excluded from the gear-tab listing filter", () => {
    const marauder = gearById("hull_marauder");
    expect(marauder?.kind).toBe(GearKind.HULL);
  });
});
