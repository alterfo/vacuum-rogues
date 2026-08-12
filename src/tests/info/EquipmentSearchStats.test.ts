import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import {
  GalacticRegistry,
  type GearListing,
} from "@/systems/info/GalacticRegistry";
import { gearById } from "@/systems/equipment/GearCatalog";

function sys(id: string, toIds: string[]): StarSystem {
  return {
    id,
    name: id,
    connections: toIds.map((toSystemId) => ({
      fromSystemId: id,
      toSystemId,
      fuelCost: 5,
    })),
    planets: [],
  } as unknown as StarSystem;
}

function chain(): StarSystem[] {
  return [sys("A", ["B"]), sys("B", ["A"])];
}

function listing(systemId: string, gearId: string, price: number): GearListing {
  return { systemId, planetId: `${systemId}1`, gear: gearById(gearId)!, price };
}

describe("GalacticRegistry.findEquipment — stat-threshold filters (Task 11)", () => {
  it("minHp/minSlots/minCargo filter hulls below the threshold", () => {
    const gear: GearListing[] = [
      listing("A", "hull_courier", 6000), // hp 120
      listing("B", "hull_warden", 20000), // hp 220
    ];
    const reg = new GalacticRegistry(chain(), [], gear);

    const hits = reg.findEquipment({
      originSystemId: "A",
      types: ["hull"],
      minHp: 200,
    });
    expect(hits.map((h) => h.gear.id)).toEqual(["hull_warden"]);
  });

  it("minDamage/minRange filter weapons below the threshold", () => {
    const gear: GearListing[] = [
      listing("A", "wpn_pulse", 2500), // dmg 14, range 240
      listing("B", "wpn_torpedo", 16000), // dmg 55, range 420
    ];
    const reg = new GalacticRegistry(chain(), [], gear);

    const hits = reg.findEquipment({
      originSystemId: "A",
      types: ["weapon"],
      minDamage: 25,
    });
    expect(hits.map((h) => h.gear.id)).toEqual(["wpn_torpedo"]);

    const byRange = reg.findEquipment({
      originSystemId: "A",
      types: ["weapon"],
      minRange: 400,
    });
    expect(byRange.map((h) => h.gear.id)).toEqual(["wpn_torpedo"]);
  });

  it("combining a facet + stat threshold + price narrows correctly", () => {
    const gear: GearListing[] = [
      listing("A", "hull_courier", 6000), // hp 120, cheap
      listing("A", "hull_warden", 20000), // hp 220, over price cap
      listing("B", "hull_bastion", 9000), // hp 360, within price cap
    ];
    const reg = new GalacticRegistry(chain(), [], gear);

    const hits = reg.findEquipment({
      originSystemId: "A",
      types: ["hull"],
      minHp: 200,
      maxPrice: 10000,
    });
    expect(hits.map((h) => h.gear.id)).toEqual(["hull_bastion"]);
  });

  it("empty thresholds behave exactly like the pre-existing facet/price search", () => {
    const gear: GearListing[] = [
      listing("A", "hull_courier", 6000),
      listing("B", "hull_warden", 20000),
    ];
    const reg = new GalacticRegistry(chain(), [], gear);

    const withoutThresholds = reg.findEquipment({
      originSystemId: "A",
      types: ["hull"],
    });
    const withUndefinedThresholds = reg.findEquipment({
      originSystemId: "A",
      types: ["hull"],
      minHp: undefined,
      minSlots: undefined,
      minCargo: undefined,
    });
    expect(withUndefinedThresholds).toEqual(withoutThresholds);
    expect(withoutThresholds.map((h) => h.gear.id)).toEqual([
      "hull_courier",
      "hull_warden",
    ]);
  });

  it("sorts by hp/damage (strongest first) when asked", () => {
    const hulls: GearListing[] = [
      listing("A", "hull_courier", 6000),
      listing("B", "hull_bastion", 30000),
    ];
    const regHull = new GalacticRegistry(chain(), [], hulls);
    const byHp = regHull.findEquipment({
      originSystemId: "A",
      types: ["hull"],
      sort: "hp",
    });
    expect(byHp.map((h) => h.gear.id)).toEqual([
      "hull_bastion",
      "hull_courier",
    ]);

    const weapons: GearListing[] = [
      listing("A", "wpn_pulse", 2500),
      listing("B", "wpn_torpedo", 16000),
    ];
    const regWeapon = new GalacticRegistry(chain(), [], weapons);
    const byDamage = regWeapon.findEquipment({
      originSystemId: "A",
      types: ["weapon"],
      sort: "damage",
    });
    expect(byDamage.map((h) => h.gear.id)).toEqual([
      "wpn_torpedo",
      "wpn_pulse",
    ]);
  });
});
