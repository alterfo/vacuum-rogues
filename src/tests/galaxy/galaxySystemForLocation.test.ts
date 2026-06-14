/**
 * Galaxy.systemForLocation() — resolves a quest objective locationId to the
 * star system that contains it. Needed for cross-system "Лететь к цели"
 * routing (SpaceFlightScene.navigateToQuestObjective).
 */
import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import type { StarSystem } from "@/domain/StarSystem";
import type { Overmind } from "@/domain/Overmind";
import type { GalacticEvent } from "@/domain/GalacticEvent";

function makeSystem(id: string, planetIds: string[]): StarSystem {
  return {
    id,
    name: id,
    planets: planetIds.map((pid) => ({ id: pid })),
    connections: [],
    explored: false,
    fogOfWar: false,
  } as unknown as StarSystem;
}

function makeGalaxy(systems: StarSystem[]): Galaxy {
  return new Galaxy(
    "g1",
    systems,
    {} as Overmind,
    [] as GalacticEvent[],
    [],
    [],
    "",
    [],
  );
}

describe("Galaxy.systemForLocation", () => {
  it("finds system by planet id", () => {
    const g = makeGalaxy([
      makeSystem("sys_1", ["planet_a", "planet_b"]),
      makeSystem("sys_2", ["planet_c"]),
    ]);
    expect(g.systemForLocation("planet_b")?.id).toBe("sys_1");
    expect(g.systemForLocation("planet_c")?.id).toBe("sys_2");
  });

  it("finds system by system id when no planet matches", () => {
    const g = makeGalaxy([makeSystem("sys_1", ["planet_a"])]);
    expect(g.systemForLocation("sys_1")?.id).toBe("sys_1");
  });

  it("returns null for unknown id", () => {
    const g = makeGalaxy([makeSystem("sys_1", ["planet_a"])]);
    expect(g.systemForLocation("nope")).toBeNull();
  });

  it("prefers planet match over same-id system match", () => {
    // sys_2 contains a planet whose id is "sys_1"; system sys_1 also exists.
    // Planet match (find by planet id) fires first in the implementation.
    const g = makeGalaxy([
      makeSystem("sys_2", ["sys_1"]),
      makeSystem("sys_1", ["planet_a"]),
    ]);
    expect(g.systemForLocation("sys_1")?.id).toBe("sys_2");
  });
});
