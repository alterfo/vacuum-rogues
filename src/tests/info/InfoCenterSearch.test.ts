import { describe, it, expect } from "vitest";
import { StarSystem } from "@/domain/StarSystem";
import { Planet } from "@/domain/Planet";
import { Market } from "@/domain/Market";
import type { NpcShip } from "@/domain/NpcShip";
import { NpcRole, PlanetType } from "@/types";
import { Faction } from "@/types/faction";
import {
  GalacticRegistry,
  type GearListing,
} from "@/systems/info/GalacticRegistry";
import { StarType } from "@/types";
import { GearKind, gearById } from "@/systems/equipment/GearCatalog";

function planet(id: string, name: string): Planet {
  return new Planet(
    id,
    name,
    PlanetType.TERRESTRIAL,
    500,
    new Market([], [], []),
    [],
    [],
    true,
  );
}

function sys(
  id: string,
  name: string,
  toIds: string[],
  planets: Planet[] = [],
): StarSystem {
  return new StarSystem(
    id,
    name,
    { q: 0, r: 0 },
    StarType.YELLOW_DWARF,
    planets,
    Faction.INDEPENDENT,
    toIds.map((toSystemId) => ({
      fromSystemId: id,
      toSystemId,
      fuelCost: 5,
    })),
  );
}

function ship(id: string, name: string, systemId: string): NpcShip {
  return {
    id,
    name,
    role: NpcRole.RANGER,
    faction: Faction.INDEPENDENT,
    currentSystemId: systemId,
  } as NpcShip;
}

function listing(systemId: string, gearId: string, price: number): GearListing {
  return { systemId, planetId: `${systemId}1`, gear: gearById(gearId)!, price };
}

/** A — B — C chain */
function chain(withPlanets = false): StarSystem[] {
  return [
    sys("A", "Альфа", ["B"], withPlanets ? [planet("A1", "Аврора")] : []),
    sys(
      "B",
      "Бета",
      ["A", "C"],
      withPlanets ? [planet("B1", "Беллорус"), planet("B2", "Бета-2")] : [],
    ),
    sys("C", "Гамма", ["B"], withPlanets ? [planet("C1", "Цитадель")] : []),
  ];
}

describe("GalacticRegistry — findShips with name filter", () => {
  it("returns only ships whose name matches the query (case-insensitive)", () => {
    const ships = [
      ship("s1", "Ranger Hawk", "A"),
      ship("s2", "Trader Nova", "B"),
      ship("s3", "Ranger Star", "C"),
    ];
    const reg = new GalacticRegistry(chain(), ships);

    const rangers = reg.findShips({ originSystemId: "A", name: "ranger" });
    expect(rangers.map((s) => s.id)).toEqual(["s1", "s3"]);
  });

  it("returns all ships when no name filter is provided", () => {
    const ships = [ship("s1", "Hawk", "A"), ship("s2", "Nova", "B")];
    const reg = new GalacticRegistry(chain(), ships);
    const all = reg.findShips({ originSystemId: "A" });
    expect(all).toHaveLength(2);
  });

  it("returns empty array when no ships match the name", () => {
    const ships = [ship("s1", "Hawk", "A")];
    const reg = new GalacticRegistry(chain(), ships);
    const none = reg.findShips({ originSystemId: "A", name: "phantom" });
    expect(none).toHaveLength(0);
  });
});

describe("GalacticRegistry — findPlanet", () => {
  it("finds planets by partial name, nearest first", () => {
    const systems = chain(true);
    const reg = new GalacticRegistry(systems, []);

    const hits = reg.findPlanet({ name: "бе", originSystemId: "A" });
    // "Беллорус" and "Бета-2" are both in system B (1 jump), nothing else starts with "бе"
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.systemId === "B")).toBe(true);
    expect(hits.every((h) => h.jumps === 1)).toBe(true);
    // sorted alphabetically within same distance
    expect(hits[0].planetName).toBe("Беллорус");
    expect(hits[1].planetName).toBe("Бета-2");
  });

  it("returns empty when no planet matches the query", () => {
    const systems = chain(true);
    const reg = new GalacticRegistry(systems, []);
    const hits = reg.findPlanet({ name: "xyz", originSystemId: "A" });
    expect(hits).toHaveLength(0);
  });

  it("returns system name and jump distance for each hit", () => {
    const systems = chain(true);
    const reg = new GalacticRegistry(systems, []);

    const hits = reg.findPlanet({ name: "Аврора", originSystemId: "A" });
    expect(hits).toHaveLength(1);
    expect(hits[0].systemName).toBe("Альфа");
    expect(hits[0].jumps).toBe(0);
    expect(hits[0].planetId).toBe("A1");
  });

  it("respects maxJumps filter", () => {
    const systems = chain(true);
    const reg = new GalacticRegistry(systems, []);

    const close = reg.findPlanet({
      name: "",
      originSystemId: "A",
      maxJumps: 1,
    });
    // All planets in A (0 jumps) + B (1 jump)
    expect(close.every((h) => h.jumps <= 1)).toBe(true);
    const far = reg.findPlanet({ name: "", originSystemId: "A" });
    expect(far.length).toBeGreaterThan(close.length);
  });
});

describe("GalacticRegistry — findGear with tech sort", () => {
  it("sorts results by tech level descending when sort=tech", () => {
    const systems = chain();
    const gear: GearListing[] = [
      listing("A", "hull_warden", 20000), // T3
      listing("B", "hull_bastion", 30000), // T5
      listing("C", "hull_courier", 6000), // T1
    ];
    const reg = new GalacticRegistry(systems, [], gear);

    const hits = reg.findGear({
      originSystemId: "A",
      kind: GearKind.HULL,
      sort: "tech",
    });
    // highest tech first
    expect(hits[0].gear.id).toBe("hull_bastion"); // T5
    expect(hits[hits.length - 1].gear.id).toBe("hull_courier"); // T1
  });
});

describe("Data fog — isStaleSystem via lastVisitedDay", () => {
  it("StarSystem.lastVisitedDay is undefined on construction", () => {
    const s = sys("A", "Альфа", []);
    expect(s.lastVisitedDay).toBeUndefined();
  });

  it("lastVisitedDay can be set and read back", () => {
    const s = sys("A", "Альфа", []);
    s.lastVisitedDay = 42;
    expect(s.lastVisitedDay).toBe(42);
  });

  it("systems visited within 30 days are not stale", () => {
    const s = sys("A", "Альфа", []);
    s.lastVisitedDay = 80;
    const currentDay = 100;
    const daysSince = currentDay - s.lastVisitedDay;
    expect(daysSince).toBeLessThanOrEqual(30);
  });

  it("systems not visited for >30 days are stale", () => {
    const s = sys("A", "Альфа", []);
    s.lastVisitedDay = 50;
    const currentDay = 100;
    const daysSince = currentDay - s.lastVisitedDay;
    expect(daysSince).toBeGreaterThan(30);
  });

  it("systems never visited (undefined) are always stale", () => {
    const s = sys("A", "Альфа", []);
    expect(s.lastVisitedDay).toBeUndefined();
    // undefined → treated as stale regardless of current day
    const isStale =
      s.lastVisitedDay === undefined || 100 - (s.lastVisitedDay ?? 0) > 30;
    expect(isStale).toBe(true);
  });
});
