import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import {
  GalacticRegistry,
  type GearListing,
} from "@/systems/info/GalacticRegistry";
import { GearKind, gearById } from "@/systems/equipment/GearCatalog";

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
  return [
    sys("A", ["B"]),
    sys("B", ["A", "C"]),
    sys("C", ["B", "D"]),
    sys("D", ["C"]),
  ];
}

function listing(systemId: string, gearId: string, price: number): GearListing {
  return { systemId, planetId: `${systemId}1`, gear: gearById(gearId)!, price };
}

describe("GalacticRegistry — gear parameter search (US-093/094)", () => {
  it("finds the best hull meeting an HP criterion, ranked by price with jumps", () => {
    const gear: GearListing[] = [
      listing("B", "hull_warden", 20000), // hp 220, 1 jump
      listing("C", "hull_bastion", 30000), // hp 360, 2 jumps
      listing("D", "hull_courier", 6000), // hp 120 (too low for minHp 200), 3 jumps
    ];
    const reg = new GalacticRegistry(chain(), [], gear);

    const hits = reg.findGear({
      originSystemId: "A",
      kind: GearKind.HULL,
      minHp: 200,
    });
    expect(hits.map((h) => h.gear.id)).toEqual(["hull_warden", "hull_bastion"]);
    expect(hits[0].jumps).toBe(1);
    expect(hits[1].jumps).toBe(2);
  });

  it("sorts hulls by hp (strongest first) when asked", () => {
    const gear = [
      listing("B", "hull_warden", 20000),
      listing("C", "hull_bastion", 30000),
    ];
    const reg = new GalacticRegistry(chain(), [], gear);
    const hits = reg.findGear({
      originSystemId: "A",
      kind: GearKind.HULL,
      sort: "hp",
    });
    expect(hits.map((h) => h.gear.id)).toEqual(["hull_bastion", "hull_warden"]);
  });

  it("finds weapons by damage/range and sorts by damage", () => {
    const gear = [
      listing("B", "wpn_pulse", 2500), // dmg 14, range 240
      listing("C", "wpn_torpedo", 16000), // dmg 55, range 420
      listing("D", "wpn_railgun", 7000), // dmg 26, range 360
    ];
    const reg = new GalacticRegistry(chain(), [], gear);

    const strong = reg.findGear({
      originSystemId: "A",
      kind: GearKind.WEAPON,
      minDamage: 25,
      sort: "damage",
    });
    expect(strong.map((h) => h.gear.id)).toEqual([
      "wpn_torpedo",
      "wpn_railgun",
    ]);

    const longRange = reg.findGear({
      originSystemId: "A",
      kind: GearKind.WEAPON,
      minRange: 400,
    });
    expect(longRange.map((h) => h.gear.id)).toEqual(["wpn_torpedo"]);
  });

  it("honours maxJumps, maxPrice and bestGear", () => {
    const gear = [
      listing("B", "wpn_torpedo", 16000), // 1 jump, dear
      listing("D", "wpn_torpedo", 12000), // 3 jumps, cheaper
    ];
    const reg = new GalacticRegistry(chain(), [], gear);

    const within2 = reg.bestGear({
      originSystemId: "A",
      kind: GearKind.WEAPON,
      maxJumps: 2,
    });
    expect(within2?.systemId).toBe("B");

    const cheap = reg.findGear({
      originSystemId: "A",
      kind: GearKind.WEAPON,
      maxPrice: 13000,
    });
    expect(cheap.map((h) => h.systemId)).toEqual(["D"]);
  });

  it("filters by tech level and size", () => {
    const gear = [
      listing("B", "wpn_pulse", 2500), // T2 size3
      listing("C", "wpn_torpedo", 16000), // T6 size6
    ];
    const reg = new GalacticRegistry(chain(), [], gear);
    const compactLowTech = reg.findGear({
      originSystemId: "A",
      maxTech: 4,
      maxSize: 4,
    });
    expect(compactLowTech.map((h) => h.gear.id)).toEqual(["wpn_pulse"]);
  });
});
