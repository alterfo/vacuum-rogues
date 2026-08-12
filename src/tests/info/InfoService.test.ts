import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import type { NpcShip } from "@/domain/NpcShip";
import { Faction } from "@/types/faction";
import { NpcRole, ResourceType, StationType } from "@/types";
import { Market } from "@/domain/Market";
import { GearKind } from "@/systems/equipment/GearCatalog";
import { buildRegistry, factionPriceFactor } from "@/systems/info/InfoService";
import { generateShop } from "@/systems/equipment/ShopGenerator";
import { techLevelWithUplift } from "@/systems/campaign/techUplift";

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
  planets: { id: string; market?: Market; isHabitable?: boolean }[],
  techLevel?: number,
  stations: { id: string; type: StationType }[] = [],
): StarSystem {
  return {
    id,
    name: id,
    ownerFaction: owner,
    techLevel,
    connections: toIds.map((toSystemId) => ({
      fromSystemId: id,
      toSystemId,
      fuelCost: 5,
    })),
    planets,
    stations,
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
    newsFeed: [],
  };
}

describe("InfoService.buildRegistry", () => {
  it("composes ships, market goods and per-planet gear shops", () => {
    const reg = buildRegistry(galaxy(), "seed", 0);

    expect(reg.findShip("t1")?.systemId).toBe("B");
    expect(
      reg.cheapestResource({
        resource: ResourceType.METALS,
        originSystemId: "A",
      })?.systemId,
    ).toBe("A");
    expect(reg.gearListingCount).toBeGreaterThan(0);

    const hulls = reg.findGear({ originSystemId: "A", kind: GearKind.HULL });
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

describe("InfoService.buildRegistry — stock parity with the real shop", () => {
  function galaxyWithTech(techLevel: number) {
    return {
      systems: [
        sys("A", ["B"], Faction.OUTLANDERS, [{ id: "A1" }], techLevel),
        sys("B", ["A"], Faction.BASTIONS, [{ id: "B1" }], 1),
      ],
      npcShips: [],
      newsFeed: [],
    };
  }

  function idsFor(reg: ReturnType<typeof buildRegistry>, systemId: string) {
    return new Set(
      reg
        .findGear({ originSystemId: systemId, maxJumps: 0 })
        .map((h) => h.gear.id),
    );
  }

  function shopIdsFor(
    systemId: string,
    planetId: string,
    day: number,
    techLevel: number,
  ) {
    const maxTechLevel = techLevelWithUplift(techLevel, day);
    return new Set(
      generateShop({ systemId, planetId, seed: "seed", day, maxTechLevel }).map(
        (l) => l.gear.id,
      ),
    );
  }

  it("does not list an item the real shop's tech cap filters out (low-tech system)", () => {
    const day = 0;
    const reg = buildRegistry(galaxyWithTech(1), "seed", day);
    const maxTechLevel = techLevelWithUplift(1, day);
    const listed = reg.findGear({ originSystemId: "A", maxJumps: 0 });
    for (const hit of listed) {
      expect(hit.gear.techLevel).toBeLessThanOrEqual(maxTechLevel);
    }
  });

  it("matches the real shop's stocked id set for a low-tech system", () => {
    const day = 0;
    const reg = buildRegistry(galaxyWithTech(1), "seed", day);
    expect(idsFor(reg, "A")).toEqual(shopIdsFor("A", "A1", day, 1));
  });

  it("matches the real shop's stocked id set for a high-tech system", () => {
    const day = 0;
    const reg = buildRegistry(galaxyWithTech(8), "seed", day);
    expect(idsFor(reg, "A")).toEqual(shopIdsFor("A", "A1", day, 8));
  });

  it("matches at the uplift cap boundary once the tech cap has grown from play time", () => {
    const day = 2000;
    const reg = buildRegistry(galaxyWithTech(3), "seed", day);
    expect(idsFor(reg, "A")).toEqual(shopIdsFor("A", "A1", day, 3));
  });
});

describe("InfoService.buildRegistry — gate listings to real shop locations", () => {
  it("lists no gear for an uninhabited planet", () => {
    const g = {
      systems: [
        sys(
          "A",
          ["B"],
          Faction.OUTLANDERS,
          [{ id: "A1", isHabitable: false }],
          5,
        ),
        sys("B", ["A"], Faction.BASTIONS, [{ id: "B1" }], 1),
      ],
      npcShips: [],
      newsFeed: [],
    };
    const reg = buildRegistry(g, "seed", 0);
    const hits = reg.findGear({ originSystemId: "A", maxJumps: 0 });
    expect(hits).toHaveLength(0);
  });

  it("still lists gear for an inhabited planet in the same registry", () => {
    const g = {
      systems: [
        sys(
          "A",
          ["B"],
          Faction.OUTLANDERS,
          [{ id: "A1", isHabitable: false }, { id: "A2" }],
          5,
        ),
        sys("B", ["A"], Faction.BASTIONS, [{ id: "B1" }], 1),
      ],
      npcShips: [],
      newsFeed: [],
    };
    const reg = buildRegistry(g, "seed", 0);
    const hits = reg.findGear({ originSystemId: "A", maxJumps: 0 });
    expect(hits.every((h) => h.planetId === "A2")).toBe(true);
    expect(reg.gearListingCount).toBeGreaterThan(0);
  });

  it("lists gear for a shop-service station (e.g. a trade post)", () => {
    const g = {
      systems: [
        sys("A", ["B"], Faction.OUTLANDERS, [], 5, [
          { id: "A_station", type: StationType.TRADE_POST },
        ]),
        sys("B", ["A"], Faction.BASTIONS, [{ id: "B1" }], 1),
      ],
      npcShips: [],
      newsFeed: [],
    };
    const reg = buildRegistry(g, "seed", 0);
    const hits = reg.findGear({ originSystemId: "A", maxJumps: 0 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.planetId === "A_station")).toBe(true);
  });

  it("does not list gear for a station type with no shop service (e.g. a military base)", () => {
    const g = {
      systems: [
        sys("A", ["B"], Faction.OUTLANDERS, [], 5, [
          { id: "A_station", type: StationType.MILITARY_BASE },
        ]),
        sys("B", ["A"], Faction.BASTIONS, [{ id: "B1" }], 1),
      ],
      npcShips: [],
      newsFeed: [],
    };
    const reg = buildRegistry(g, "seed", 0);
    const hits = reg.findGear({ originSystemId: "A", maxJumps: 0 });
    expect(hits).toHaveLength(0);
  });

  it("a station's registry id-set is a subset of what the real shop sells there (no hulls, tech-capped)", () => {
    const day = 0;
    const g = {
      systems: [
        sys("A", ["B"], Faction.OUTLANDERS, [], 8, [
          { id: "A_station", type: StationType.TRADE_POST },
        ]),
        sys("B", ["A"], Faction.BASTIONS, [{ id: "B1" }], 1),
      ],
      npcShips: [],
      newsFeed: [],
    };
    const reg = buildRegistry(g, "seed", day);
    const registryIds = new Set(
      reg.findGear({ originSystemId: "A", maxJumps: 0 }).map((h) => h.gear.id),
    );
    const maxTechLevel = techLevelWithUplift(8, day);
    const realShopIds = new Set(
      generateShop({
        systemId: "A",
        planetId: "A_station",
        seed: "seed",
        day,
        maxTechLevel,
      })
        .filter((l) => l.gear.kind !== GearKind.HULL)
        .map((l) => l.gear.id),
    );
    for (const id of registryIds) expect(realShopIds.has(id)).toBe(true);
  });
});
