import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import type { NpcShip } from "@/domain/NpcShip";
import { Faction } from "@/types/faction";
import { NpcRole, ResourceType } from "@/types";
import { Market } from "@/domain/Market";
import { GearKind } from "@/systems/equipment/GearCatalog";
import { buildRegistry, factionPriceFactor } from "@/systems/info/InfoService";

function market(prices: Partial<Record<ResourceType, number>>): Market {
  const resources = Object.keys(prices) as ResourceType[];
  return new Market(
    resources,
    resources.map((r) => (prices[r] ?? 0) / 100),
    resources.map(() => 1),
  );
}

function sys(
  id: string,
  toIds: string[],
  owner: Faction,
  planets: { id: string; market?: Market }[],
): StarSystem {
  return {
    id,
    name: id,
    ownerFaction: owner,
    connections: toIds.map((toSystemId) => ({
      fromSystemId: id,
      toSystemId,
      fuelCost: 5,
    })),
    planets,
  } as unknown as StarSystem;
}

function ship(id: string, systemId: string): NpcShip {
  return {
    id,
    name: id,
    role: NpcRole.TRADER,
    faction: Faction.OUTLANDERS,
    currentSystemId: systemId,
  } as NpcShip;
}

function galaxy() {
  return {
    systems: [
      sys("A", ["B"], Faction.OUTLANDERS, [
        { id: "A1", market: market({ [ResourceType.METALS]: 150 }) },
      ]),
      sys("B", ["A"], Faction.BASTIONS, [{ id: "B1" }]),
    ],
    npcShips: [ship("t1", "B")],
  };
}

describe("InfoService.buildRegistry", () => {
  it("composes ships, market goods and per-planet gear shops", () => {
    const reg = buildRegistry(galaxy(), "seed", 0);

    // Ship index
    expect(reg.findShip("t1")?.systemId).toBe("B");
    // Market goods index
    expect(
      reg.cheapestResource({
        resource: ResourceType.METALS,
        originSystemId: "A",
      })?.systemId,
    ).toBe("A");
    // Gear shops were generated for both planets
    expect(reg.gearListingCount).toBeGreaterThan(0);

    const hulls = reg.findGear({ originSystemId: "A", kind: GearKind.HULL });
    // Every gear hit carries a jump distance from the origin.
    for (const h of hulls) expect(h.jumps).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic for the same (seed, day)", () => {
    const a = buildRegistry(galaxy(), "seed", 0).findGear({
      originSystemId: "A",
    });
    const b = buildRegistry(galaxy(), "seed", 0).findGear({
      originSystemId: "A",
    });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("prices trade-faction shops below militarised ones", () => {
    expect(factionPriceFactor(Faction.OUTLANDERS)).toBeLessThan(
      factionPriceFactor(Faction.BASTIONS),
    );
  });
});
