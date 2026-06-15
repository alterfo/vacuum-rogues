/**
 * Galaxy.revealSystemsWithinHops() — star-map purchase reveal (Task 3).
 *
 * Buying an N-hop star map on a habitable planet marks every system within N
 * warp jumps as explored (fogOfWar = false) and returns the count of *newly*
 * revealed systems. The BFS runs over the undirected warp graph — a warp link
 * is traversable in either direction — and stops once the hop budget is spent,
 * so systems beyond N hops stay hidden.
 */
import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import type { StarSystem } from "@/domain/StarSystem";
import type { Overmind } from "@/domain/Overmind";
import type { GalacticEvent } from "@/domain/GalacticEvent";

/** Build a star system with bidirectional warp connections to `neighbours`. */
function makeSystem(id: string, neighbours: string[]): StarSystem {
  return {
    id,
    name: id,
    planets: [],
    connections: neighbours.map((to) => ({
      fromSystemId: id,
      toSystemId: to,
      fuelCost: 1,
    })),
    explored: false,
    fogOfWar: true,
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

/** A → B → C → D → E chain (bidirectional links). */
function makeChain(): Galaxy {
  return makeGalaxy([
    makeSystem("sys_a", ["sys_b"]),
    makeSystem("sys_b", ["sys_a", "sys_c"]),
    makeSystem("sys_c", ["sys_b", "sys_d"]),
    makeSystem("sys_d", ["sys_c", "sys_e"]),
    makeSystem("sys_e", ["sys_d"]),
  ]);
}

const byId = (g: Galaxy, id: string): StarSystem =>
  g.systems.find((s) => s.id === id)!;

describe("Galaxy.revealSystemsWithinHops", () => {
  it("reveals exactly the systems within `hops` jumps and leaves the rest hidden", () => {
    const g = makeChain();

    const revealed = g.revealSystemsWithinHops("sys_a", 2);

    // sys_b (1 hop) and sys_c (2 hops) become explored.
    expect(byId(g, "sys_b").explored).toBe(true);
    expect(byId(g, "sys_b").fogOfWar).toBe(false);
    expect(byId(g, "sys_c").explored).toBe(true);
    expect(byId(g, "sys_c").fogOfWar).toBe(false);

    // sys_d (3 hops) and sys_e (4 hops) stay hidden.
    expect(byId(g, "sys_d").explored).toBe(false);
    expect(byId(g, "sys_d").fogOfWar).toBe(true);
    expect(byId(g, "sys_e").explored).toBe(false);

    // Origin is marked explored; only the two newcomers are counted.
    expect(byId(g, "sys_a").explored).toBe(true);
    expect(revealed).toBe(2);
  });

  it("counts only newly-revealed systems (already-explored neighbours don't count)", () => {
    const g = makeChain();
    byId(g, "sys_b").explored = true;
    byId(g, "sys_b").fogOfWar = false;

    const revealed = g.revealSystemsWithinHops("sys_a", 2);

    // sys_b was already explored → only sys_c is new.
    expect(revealed).toBe(1);
    expect(byId(g, "sys_c").explored).toBe(true);
  });

  it("a 1-hop purchase reveals only the immediate neighbour", () => {
    const g = makeChain();

    const revealed = g.revealSystemsWithinHops("sys_a", 1);

    expect(revealed).toBe(1);
    expect(byId(g, "sys_b").explored).toBe(true);
    expect(byId(g, "sys_c").explored).toBe(false);
  });

  it("clamps to the galaxy size when hops exceed the graph diameter", () => {
    const g = makeChain();

    const revealed = g.revealSystemsWithinHops("sys_a", 10);

    // All four non-origin systems revealed; never more than the galaxy holds.
    expect(revealed).toBe(4);
    for (const id of ["sys_b", "sys_c", "sys_d", "sys_e"]) {
      expect(byId(g, id).explored).toBe(true);
    }
  });

  it("returns 0 for an unknown origin system", () => {
    const g = makeChain();
    expect(g.revealSystemsWithinHops("nope", 3)).toBe(0);
  });
});
