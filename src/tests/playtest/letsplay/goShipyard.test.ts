import { describe, it, expect } from "vitest";
import { SceneType } from "@/types";
import {
  legalActionsForScene,
  type Observation,
  type PlayerSnapshot,
  type SystemSnapshot,
} from "./observe";
import { createMemory } from "./AgentMemory";
import {
  decideWithMemory,
  isBattleReady,
  REFIT_WARCHEST,
  BATTLE_READY_MAX_HULL,
  BATTLE_READY_WEAPON_DAMAGE,
} from "./MemoryHeuristicPolicy";
import { directedHopDistancesTo } from "./engineQueries";

function player(over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    credits: REFIT_WARCHEST + 500,
    hull: 140,
    maxHull: 140,
    hullFraction: 1,
    fuel: 50,
    maxFuel: 50,
    fuelFraction: 1,
    cargo: [],
    cargoUsed: 0,
    cargoCapacity: 20,
    systemId: "sysA",
    position: null,
    weaponDamage: BATTLE_READY_WEAPON_DAMAGE + 5,
    ...over,
  };
}

interface ObsOpts {
  player?: Partial<PlayerSnapshot>;
  neighbors?: SystemSnapshot["neighbors"];
  shipyardHere?: boolean;
}

function obs(opts: ObsOpts = {}): Observation {
  const scene = SceneType.SPACE_FLIGHT;
  const system: SystemSnapshot = {
    id: "sysA",
    name: "A",
    planets: [{ id: "pA", name: "pA", availableQuests: 0 }],
    stations: [],
    connections: 2,
    neighbors: opts.neighbors,
  };
  return {
    scene,
    hasPlayer: true,
    player: player(opts.player),
    system,
    currentPlanet: null,
    npcs: [],
    hostiles: [],
    quests: [],
    shipyardHere: opts.shipyardHere,
    legalActions: legalActionsForScene(scene, {
      hasPlayer: true,
      planetCount: 1,
      stationCount: 0,
      hostileCount: 0,
      connectionCount: 2,
      availableQuestCount: 0,
    }),
  };
}

const shipyardNeighbors: SystemSnapshot["neighbors"] = [
  { systemId: "far", visited: true, overmindHeld: false, hopsToShipyard: 2 },
  { systemId: "yard", visited: true, overmindHeld: false, hopsToShipyard: 0 },
];

describe("go-shipyard — a funded, under-hulled ship seeks the nearest hull-selling system", () => {
  it("rich + small hull + reachable shipyard ⇒ warps toward the closest shipyard system", () => {
    const here = obs({ neighbors: shipyardNeighbors });
    expect(isBattleReady(here)).toBe(false);
    const action = decideWithMemory(here, createMemory());
    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("go-shipyard");
    expect(action.targetId).toBe("yard");
  });

  it("below the warchest ⇒ no shipyard detour (keeps earning)", () => {
    const here = obs({
      neighbors: shipyardNeighbors,
      player: { credits: REFIT_WARCHEST - 1 },
    });
    const action = decideWithMemory(here, createMemory());
    expect(action.reason).not.toContain("go-shipyard");
  });

  it("already battle-ready hull ⇒ no shipyard detour", () => {
    const here = obs({
      neighbors: shipyardNeighbors,
      player: {
        maxHull: BATTLE_READY_MAX_HULL,
        hull: BATTLE_READY_MAX_HULL,
      },
    });
    const action = decideWithMemory(here, createMemory());
    expect(action.reason).not.toContain("go-shipyard");
  });

  it("already standing in a shipyard system ⇒ no warp churn (buys locally instead)", () => {
    const here = obs({ neighbors: shipyardNeighbors, shipyardHere: true });
    const action = decideWithMemory(here, createMemory());
    expect(action.reason).not.toContain("go-shipyard");
  });

  it("no known route to any shipyard ⇒ falls through to the ordinary ladder", () => {
    const here = obs({
      neighbors: [{ systemId: "b", visited: true, overmindHeld: false }],
    });
    const action = decideWithMemory(here, createMemory());
    expect(action.reason).not.toContain("go-shipyard");
  });
});

describe("directedHopDistancesTo — shipyard hops respect one-way warp lanes (no ping-pong)", () => {
  const sys = (id: string, to: string[]) => ({
    id,
    connections: to.map((toSystemId) => ({ toSystemId })),
  });

  it("computes true directed distances along a chain", () => {
    const systems = [sys("A", ["B"]), sys("B", ["A", "C"]), sys("C", ["B"])];
    const d = directedHopDistancesTo(systems, ["C"]);
    expect(d.get("C")).toBe(0);
    expect(d.get("B")).toBe(1);
    expect(d.get("A")).toBe(2);
  });

  it("a system that cannot reach the seed via directed lanes gets NO distance", () => {
    const systems = [sys("A", []), sys("B", ["A"])];
    const d = directedHopDistancesTo(systems, ["B"]);
    expect(d.get("B")).toBe(0);
    expect(d.has("A")).toBe(false);
  });

  it("multi-seed takes the nearest reachable seed", () => {
    const systems = [
      sys("A", ["B", "C"]),
      sys("B", ["Y1"]),
      sys("C", ["B"]),
      sys("Y1", []),
      sys("Y2", ["C"]),
    ];
    const d = directedHopDistancesTo(systems, ["Y1", "Y2"]);
    expect(d.get("B")).toBe(1);
    expect(d.get("A")).toBe(2);
    expect(d.get("Y2")).toBe(0);
  });
});
