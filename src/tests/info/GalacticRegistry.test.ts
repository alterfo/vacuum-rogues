import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import type { NpcShip } from "@/domain/NpcShip";
import { Market } from "@/domain/Market";
import { ResourceType, NpcRole } from "@/types";
import { Faction } from "@/types/faction";
import { GalacticRegistry } from "@/systems/info/GalacticRegistry";

/** Build a Market whose getPrice() returns exactly the given price per resource. */
function market(prices: Partial<Record<ResourceType, number>>): Market {
  const resources = Object.keys(prices) as ResourceType[];
  // getPrice = round((demand/supply)*100); supply=1 → demand = price/100.
  const demand = resources.map((r) => (prices[r] ?? 0) / 100);
  const supply = resources.map(() => 1);
  return new Market(resources, demand, supply);
}

function sys(
  id: string,
  name: string,
  toIds: string[],
  planets: { id: string; market?: Market }[],
): StarSystem {
  return {
    id,
    name,
    connections: toIds.map((toSystemId) => ({
      fromSystemId: id,
      toSystemId,
      fuelCost: 5,
    })),
    planets,
  } as unknown as StarSystem;
}

function ship(
  id: string,
  systemId: string,
  role: NpcRole,
  faction: Faction,
): NpcShip {
  return { id, name: id, role, faction, currentSystemId: systemId } as NpcShip;
}

/** A—B—C—D chain (origin A). METALS sold in B@200, C@120, D@90. */
function galaxy(): StarSystem[] {
  return [
    sys("A", "Альфа", ["B"], [{ id: "A1" }]),
    sys(
      "B",
      "Бета",
      ["A", "C"],
      [{ id: "B1", market: market({ [ResourceType.METALS]: 200 }) }],
    ),
    sys(
      "C",
      "Гамма",
      ["B", "D"],
      [{ id: "C1", market: market({ [ResourceType.METALS]: 120 }) }],
    ),
    sys(
      "D",
      "Дельта",
      ["C"],
      [{ id: "D1", market: market({ [ResourceType.METALS]: 90 }) }],
    ),
  ];
}

describe("GalacticRegistry", () => {
  it("locates a specific ship and lists ships per system", () => {
    const ships = [
      ship("pirate1", "C", NpcRole.PIRATE, Faction.INDEPENDENT),
      ship("trader1", "B", NpcRole.TRADER, Faction.OUTLANDERS),
    ];
    const reg = new GalacticRegistry(galaxy(), ships);

    expect(reg.findShip("pirate1")?.systemId).toBe("C");
    expect(reg.findShip("ghost")).toBeNull();
    expect(reg.shipsInSystem("B").map((s) => s.id)).toEqual(["trader1"]);
    expect(reg.shipsInSystem("A")).toEqual([]);
  });

  it("finds ships by role/faction within a jump radius, nearest first", () => {
    const ships = [
      ship("p_far", "D", NpcRole.PIRATE, Faction.INDEPENDENT), // 3 jumps
      ship("p_near", "B", NpcRole.PIRATE, Faction.INDEPENDENT), // 1 jump
      ship("t_mid", "C", NpcRole.TRADER, Faction.OUTLANDERS), // 2 jumps
    ];
    const reg = new GalacticRegistry(galaxy(), ships);

    const pirates = reg.findShips({
      originSystemId: "A",
      role: NpcRole.PIRATE,
    });
    expect(pirates.map((p) => p.id)).toEqual(["p_near", "p_far"]); // nearest first
    expect(pirates[0].jumps).toBe(1);

    const near = reg.findShips({
      originSystemId: "A",
      role: NpcRole.PIRATE,
      maxJumps: 2,
    });
    expect(near.map((p) => p.id)).toEqual(["p_near"]); // p_far (3 jumps) dropped
  });

  it("indexes market listings (price > 0 only)", () => {
    const reg = new GalacticRegistry(galaxy(), []);
    expect(reg.listingCount).toBe(3); // B, C, D sell METALS; A has no market
  });

  it("ranks a resource by price with hyperjump distance annotated", () => {
    const reg = new GalacticRegistry(galaxy(), []);
    const hits = reg.findResource({
      resource: ResourceType.METALS,
      originSystemId: "A",
    });
    expect(hits.map((h) => h.systemId)).toEqual(["D", "C", "B"]); // cheapest first
    expect(hits.map((h) => h.price)).toEqual([90, 120, 200]);
    expect(hits.find((h) => h.systemId === "D")?.jumps).toBe(3);
  });

  it("cheapestResource returns the single best buy", () => {
    const reg = new GalacticRegistry(galaxy(), []);
    const best = reg.cheapestResource({
      resource: ResourceType.METALS,
      originSystemId: "A",
    });
    expect(best?.systemId).toBe("D");
    expect(best?.price).toBe(90);
  });

  it("honours maxJumps and sort-by-jumps", () => {
    const reg = new GalacticRegistry(galaxy(), []);
    const within2 = reg.findResource({
      resource: ResourceType.METALS,
      originSystemId: "A",
      maxJumps: 2,
    });
    expect(within2.map((h) => h.systemId)).toEqual(["C", "B"]); // D (3 jumps) excluded

    const byJumps = reg.findResource({
      resource: ResourceType.METALS,
      originSystemId: "A",
      sort: "jumps",
    });
    expect(byJumps.map((h) => h.systemId)).toEqual(["B", "C", "D"]); // nearest first
  });

  it("returns nothing for a resource nobody sells", () => {
    const reg = new GalacticRegistry(galaxy(), []);
    expect(
      reg.findResource({
        resource: ResourceType.ARTIFACTS,
        originSystemId: "A",
      }),
    ).toEqual([]);
    expect(
      reg.cheapestResource({
        resource: ResourceType.ARTIFACTS,
        originSystemId: "A",
      }),
    ).toBeNull();
  });

  it("finds star systems by (partial, case-insensitive) name match, nearest first", () => {
    const reg = new GalacticRegistry(galaxy(), []);
    const hits = reg.findSystem({ name: "ет", originSystemId: "A" }); // matches "Бета"
    expect(hits.map((h) => h.systemId)).toEqual(["B"]);
    expect(hits[0].systemName).toBe("Бета");
    expect(hits[0].jumps).toBe(1);

    const upper = reg.findSystem({ name: "ГАММА", originSystemId: "A" });
    expect(upper.map((h) => h.systemId)).toEqual(["C"]);
  });

  it("system search honours maxJumps and returns nothing for no match", () => {
    const reg = new GalacticRegistry(galaxy(), []);
    expect(
      reg.findSystem({ name: "Дельта", originSystemId: "A", maxJumps: 2 }),
    ).toEqual([]); // D is 3 jumps away

    expect(reg.findSystem({ name: "нигдешния", originSystemId: "A" })).toEqual(
      [],
    );
  });

  it("Bug 6: finds ships/planets/systems reachable only via a one-way link's reverse direction", () => {
    // A --(one-way)--> B, no B->A edge — the star-map nav still lets the
    // player warp A<->B either direction, so a directed-only BFS from A would
    // wrongly report B unreachable and silently drop every hit inside it.
    const systems = [
      sys("A", "Альфа", ["B"], []),
      sys("B", "Бета", [], [{ id: "B1" }]),
    ];
    const reg = new GalacticRegistry(systems, [
      ship("s1", "B", NpcRole.TRADER, Faction.OUTLANDERS),
    ]);

    expect(
      reg.findShips({ originSystemId: "B", name: "s1" }).map((s) => s.id),
    ).toEqual(["s1"]);
    expect(
      reg
        .findPlanet({ name: "B1", originSystemId: "B" })
        .map((p) => p.planetId),
    ).toEqual(["B1"]);
    expect(
      reg
        .findSystem({ name: "Альфа", originSystemId: "B" })
        .map((s) => s.systemId),
    ).toEqual(["A"]);
  });
});
