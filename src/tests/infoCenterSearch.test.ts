import { describe, it, expect } from "vitest";
import {
  GalacticRegistry,
  type GearListing,
} from "@/systems/info/GalacticRegistry";
import { gearById } from "@/systems/equipment/GearCatalog";
import type { StarSystem } from "@/domain/StarSystem";

function sys(id: string, toIds: string[]): StarSystem {
  return {
    id,
    name: `System-${id}`,
    connections: toIds.map((toSystemId) => ({
      fromSystemId: id,
      toSystemId,
      fuelCost: 5,
    })),
    planets: [
      {
        id: `${id}P1`,
        name: `Planet-${id}-1`,
      },
    ],
  } as unknown as StarSystem;
}

function listing(systemId: string, gearId: string, price: number): GearListing {
  return {
    systemId,
    planetId: `${systemId}P1`,
    gear: gearById(gearId)!,
    price,
  };
}

describe("GalacticRegistry — findEquipment (InfoCenter faceted search)", () => {
  it("findEquipment({ type: 'engine' }) returns results with planet, system, price", () => {
    const systems = [sys("A", ["B"]), sys("B", ["A"])];
    const gear: GearListing[] = [
      listing("A", "eq_engine_i", 2500),
      listing("B", "eq_engine_iii", 9000),
      listing("A", "hull_scout", 4000), // hull — should NOT appear
      listing("B", "wpn_pulse", 2200), // weapon — should NOT appear
    ];
    const reg = new GalacticRegistry(systems, [], gear);

    const hits = reg.findEquipment({ originSystemId: "A", type: "engine" });

    expect(hits.length).toBe(2);
    for (const hit of hits) {
      expect(hit).toHaveProperty("planet");
      expect(hit).toHaveProperty("system");
      expect(hit).toHaveProperty("price");
      expect(hit).toHaveProperty("gear");
      expect(hit).toHaveProperty("jumps");
      expect(typeof hit.planet).toBe("string");
      expect(typeof hit.system).toBe("string");
      expect(typeof hit.price).toBe("number");
    }
  });

  it("returns only hull when facet is 'hull'", () => {
    const systems = [sys("A", [])];
    const gear: GearListing[] = [
      listing("A", "hull_scout", 4000),
      listing("A", "eq_engine_i", 2500),
    ];
    const reg = new GalacticRegistry(systems, [], gear);

    const hits = reg.findEquipment({ originSystemId: "A", type: "hull" });
    expect(hits.length).toBe(1);
    expect(hits[0].gear.id).toBe("hull_scout");
  });

  it("returns only weapons when facet is 'weapon'", () => {
    const systems = [sys("A", [])];
    const gear: GearListing[] = [
      listing("A", "wpn_pulse", 2500),
      listing("A", "eq_engine_i", 2500),
    ];
    const reg = new GalacticRegistry(systems, [], gear);

    const hits = reg.findEquipment({ originSystemId: "A", type: "weapon" });
    expect(hits.length).toBe(1);
    expect(hits[0].gear.id).toBe("wpn_pulse");
  });

  it("returns shield equipment when facet is 'shield'", () => {
    const systems = [sys("A", [])];
    const gear: GearListing[] = [
      listing("A", "eq_shield", 12000),
      listing("A", "eq_engine_i", 2500),
      listing("A", "eq_scanner", 4800),
    ];
    const reg = new GalacticRegistry(systems, [], gear);

    const hits = reg.findEquipment({ originSystemId: "A", type: "shield" });
    expect(hits.length).toBe(1);
    expect(hits[0].gear.id).toBe("eq_shield");
  });

  it("returns scanner equipment when facet is 'scanner'", () => {
    const systems = [sys("A", [])];
    const gear: GearListing[] = [
      listing("A", "eq_scanner", 4800),
      listing("A", "eq_shield", 12000),
    ];
    const reg = new GalacticRegistry(systems, [], gear);

    const hits = reg.findEquipment({ originSystemId: "A", type: "scanner" });
    expect(hits.length).toBe(1);
    expect(hits[0].gear.id).toBe("eq_scanner");
  });

  it("returns all types when no facet filter given", () => {
    const systems = [sys("A", [])];
    const gear: GearListing[] = [
      listing("A", "hull_scout", 4000),
      listing("A", "wpn_pulse", 2500),
      listing("A", "eq_engine_i", 2500),
    ];
    const reg = new GalacticRegistry(systems, [], gear);

    const hits = reg.findEquipment({ originSystemId: "A" });
    expect(hits.length).toBe(3);
  });

  it("respects maxPrice filter", () => {
    const systems = [sys("A", [])];
    const gear: GearListing[] = [
      listing("A", "eq_engine_i", 2500),
      listing("A", "eq_engine_iii", 9000),
    ];
    const reg = new GalacticRegistry(systems, [], gear);

    const hits = reg.findEquipment({
      originSystemId: "A",
      type: "engine",
      maxPrice: 5000,
    });
    expect(hits.length).toBe(1);
    expect(hits[0].gear.id).toBe("eq_engine_i");
  });

  it("resolves system name for each hit", () => {
    const systems = [sys("X", [])];
    const gear: GearListing[] = [listing("X", "eq_engine_i", 2500)];
    const reg = new GalacticRegistry(systems, [], gear);

    const hits = reg.findEquipment({ originSystemId: "X", type: "engine" });
    expect(hits[0].system).toBe("System-X");
  });
});
