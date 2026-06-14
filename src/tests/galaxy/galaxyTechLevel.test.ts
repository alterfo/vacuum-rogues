import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Station } from "@/domain/Station";
import { Overmind } from "@/domain/Overmind";
import { StationType } from "@/types";
import type { Faction } from "@/types/faction";
import type { StarType } from "@/types";
import { advanceTech } from "@/systems/GalaxySimulator";

const FACTION = "INDEPENDENT" as Faction;
const STAR_TYPE = "YELLOW_DWARF" as StarType;

function makeSystem(id: string, stationType?: StationType): StarSystem {
  const stations = stationType
    ? [
        new Station(
          `${id}_station`,
          `Station ${id}`,
          stationType,
          FACTION,
          1000,
          0,
        ),
      ]
    : [];
  return new StarSystem(
    id,
    `System ${id}`,
    { q: 0, r: 0 },
    STAR_TYPE,
    [],
    FACTION,
    [],
    stations,
  );
}

function makeGalaxy(
  systems: StarSystem[],
  overmindSystems: string[] = [],
  pirateSystems: string[] = [],
): Galaxy {
  return new Galaxy(
    "test_galaxy",
    systems,
    new Overmind(),
    [],
    [],
    overmindSystems,
    "",
    pirateSystems,
  );
}

/** Advance galaxy gameDays to a target day by calling advanceTech after each increment. */
function advanceToDay(galaxy: Galaxy, targetDay: number): void {
  while (galaxy.gameDays < targetDay) {
    galaxy.simulateDay();
    advanceTech(galaxy);
  }
}

describe("advanceTech", () => {
  it("RESEARCH_LAB system advances from 1 to 2 at day 50", () => {
    const sys = makeSystem("s0", StationType.RESEARCH_LAB);
    const galaxy = makeGalaxy([sys]);
    expect(sys.techLevel).toBe(1);

    advanceToDay(galaxy, 49);
    expect(sys.techLevel).toBe(1);

    advanceToDay(galaxy, 50);
    expect(sys.techLevel).toBe(2);
  });

  it("plain system (no RESEARCH_LAB) advances from 1 to 2 at day 100, not earlier", () => {
    const sys = makeSystem("s0");
    const galaxy = makeGalaxy([sys]);

    advanceToDay(galaxy, 99);
    expect(sys.techLevel).toBe(1);

    advanceToDay(galaxy, 100);
    expect(sys.techLevel).toBe(2);
  });

  it("RESEARCH_LAB system advances each 50-day interval", () => {
    const sys = makeSystem("s0", StationType.RESEARCH_LAB);
    const galaxy = makeGalaxy([sys]);

    advanceToDay(galaxy, 50);
    expect(sys.techLevel).toBe(2);

    advanceToDay(galaxy, 100);
    expect(sys.techLevel).toBe(3);

    advanceToDay(galaxy, 150);
    expect(sys.techLevel).toBe(4);
  });

  it("plain system advances each 100-day interval", () => {
    const sys = makeSystem("s0");
    const galaxy = makeGalaxy([sys]);

    advanceToDay(galaxy, 100);
    expect(sys.techLevel).toBe(2);

    advanceToDay(galaxy, 200);
    expect(sys.techLevel).toBe(3);
  });

  it("Overmind-controlled system never advances", () => {
    const sys = makeSystem("s0", StationType.RESEARCH_LAB);
    const galaxy = makeGalaxy([sys], ["s0"]);

    advanceToDay(galaxy, 250);
    expect(sys.techLevel).toBe(1);
  });

  it("pirate-controlled system never advances", () => {
    const sys = makeSystem("s0");
    const galaxy = makeGalaxy([sys], [], ["s0"]);

    advanceToDay(galaxy, 200);
    expect(sys.techLevel).toBe(1);
  });

  it("techLevel is capped at 8", () => {
    const sys = makeSystem("s0", StationType.RESEARCH_LAB);
    const galaxy = makeGalaxy([sys]);

    advanceToDay(galaxy, 500);
    expect(sys.techLevel).toBe(TECH_MAX);
  });

  it("day 0 triggers no advancement", () => {
    const sys = makeSystem("s0", StationType.RESEARCH_LAB);
    const galaxy = makeGalaxy([sys]);
    advanceTech(galaxy);
    expect(sys.techLevel).toBe(1);
  });
});

const TECH_MAX = 8;
