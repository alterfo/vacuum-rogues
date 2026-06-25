/**
 * isSystemKnown(player, galaxy, systemId) — partial-observability predicate.
 *
 * A system is "known" when it has been revealed on the star-map
 * (StarSystem.explored) OR physically visited (Player.hasVisited). Used to gate
 * InfoCenter trade margins so the player can't read the profit of a route into a
 * system they've never discovered.
 */
import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import type { StarSystem } from "@/domain/StarSystem";
import type { Player } from "@/domain/Player";
import type { Overmind } from "@/domain/Overmind";
import type { GalacticEvent } from "@/domain/GalacticEvent";
import { isSystemKnown } from "@/systems/galaxy/systemKnown";

function makeSystem(id: string, explored: boolean): StarSystem {
  return {
    id,
    name: id,
    planets: [],
    connections: [],
    explored,
    fogOfWar: !explored,
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

/** Minimal Player stub — isSystemKnown only consults hasVisited. */
function makePlayer(visited: string[]): Player {
  const visitedSystems = [...visited];
  return {
    visitedSystems,
    hasVisited: (id: string) => visitedSystems.includes(id),
  } as unknown as Player;
}

describe("isSystemKnown", () => {
  const galaxy = makeGalaxy([
    makeSystem("sys_explored", true),
    makeSystem("sys_hidden", false),
    makeSystem("sys_visited", false),
  ]);

  it("is true for an explored-only system", () => {
    const player = makePlayer([]);
    expect(isSystemKnown(player, galaxy, "sys_explored")).toBe(true);
  });

  it("is true for a visited-only system (not explored on the map)", () => {
    const player = makePlayer(["sys_visited"]);
    expect(isSystemKnown(player, galaxy, "sys_visited")).toBe(true);
  });

  it("is false for a system that is neither explored nor visited", () => {
    const player = makePlayer([]);
    expect(isSystemKnown(player, galaxy, "sys_hidden")).toBe(false);
  });

  it("is false for an unknown / missing system id", () => {
    const player = makePlayer([]);
    expect(isSystemKnown(player, galaxy, "no_such_system")).toBe(false);
  });

  it("a visited id is known even when absent from the galaxy", () => {
    const player = makePlayer(["ghost_sys"]);
    expect(isSystemKnown(player, galaxy, "ghost_sys")).toBe(true);
  });
});
