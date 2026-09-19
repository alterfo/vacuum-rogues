import { describe, it, expect } from "vitest";
import { StarType } from "@/types";
import { Faction } from "@/types/faction";
import { StarSystem } from "@/domain/StarSystem";
import { Galaxy } from "@/domain/Galaxy";
import { Overmind } from "@/domain/Overmind";
import { WarpPath } from "@/domain/WarpPath";
import { BLACK_HOLE_JUMP_MISHAP_CHANCE } from "@/config/balance";
import {
  rollBlackHoleMishap,
  findNearestBlackHoleSystem,
} from "@/systems/galaxy/blackHoleMishap";

function system(
  id: string,
  connections: Array<[string, number]> = [],
): StarSystem {
  return new StarSystem(
    id,
    id,
    { q: 0, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    connections.map(
      ([toSystemId, fuelCost]) => new WarpPath(id, toSystemId, fuelCost),
    ),
  );
}

function galaxy(systems: StarSystem[]): Galaxy {
  return new Galaxy("mishap", systems, new Overmind(), [], []);
}

describe("rollBlackHoleMishap", () => {
  it("is deterministic for the same seed", () => {
    expect(rollBlackHoleMishap("jump_1")).toBe(rollBlackHoleMishap("jump_1"));
  });

  it("tracks BLACK_HOLE_JUMP_MISHAP_CHANCE over a large sample", () => {
    const samples = 30000;
    let hits = 0;
    for (let i = 0; i < samples; i++) {
      if (rollBlackHoleMishap(`jump_rate_${i}`)) hits++;
    }
    expect(
      Math.abs(hits / samples - BLACK_HOLE_JUMP_MISHAP_CHANCE),
    ).toBeLessThan(0.01);
  });
});

describe("findNearestBlackHoleSystem", () => {
  it("picks the fewest-hop reachable black-hole system", () => {
    const a = system("a", [["b", 1]]);
    const b = system("b", [["c", 1]]);
    const c = system("c");
    a.hasBlackHoleAnomaly = false;
    b.hasBlackHoleAnomaly = true;
    c.hasBlackHoleAnomaly = true;
    expect(findNearestBlackHoleSystem(galaxy([a, b, c]), "a")).toBe(b);
  });

  it("reaches a system through an incoming one-way edge, matching nav connectivity", () => {
    const a = system("a");
    const b = system("b", [["a", 1]]);
    b.hasBlackHoleAnomaly = true;
    expect(findNearestBlackHoleSystem(galaxy([a, b]), "a")).toBe(b);
  });

  it("returns null when the galaxy has no black-hole anomalies", () => {
    const a = system("a", [["b", 1]]);
    const b = system("b");
    expect(findNearestBlackHoleSystem(galaxy([a, b]), "a")).toBeNull();
  });

  it("returns null when no anomaly is reachable", () => {
    const a = system("a");
    const b = system("b", [["a", 1]]);
    b.hasBlackHoleAnomaly = true;
    expect(findNearestBlackHoleSystem(galaxy([a, b]), "b")).toBeNull();
  });

  it("does not choose the source system as its own mishap target", () => {
    const a = system("a", [["b", 1]]);
    const b = system("b");
    a.hasBlackHoleAnomaly = true;
    b.hasBlackHoleAnomaly = true;
    expect(findNearestBlackHoleSystem(galaxy([a, b]), "a")).toBe(b);
  });

  it("does not mutate the galaxy", () => {
    const a = system("a", [["b", 1]]);
    const b = system("b");
    b.hasBlackHoleAnomaly = true;
    const g = galaxy([a, b]);
    const before = JSON.stringify(g.systems.map((s) => s.hasBlackHoleAnomaly));
    findNearestBlackHoleSystem(g, "a");
    expect(JSON.stringify(g.systems.map((s) => s.hasBlackHoleAnomaly))).toBe(
      before,
    );
  });
});
