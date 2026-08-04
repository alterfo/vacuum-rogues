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
  BATTLE_READY_MAX_HULL,
  BATTLE_READY_WEAPON_DAMAGE,
} from "./MemoryHeuristicPolicy";

function player(over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    credits: 5000,
    hull: BATTLE_READY_MAX_HULL,
    maxHull: BATTLE_READY_MAX_HULL,
    hullFraction: 1,
    fuel: 50,
    maxFuel: 50,
    fuelFraction: 1,
    cargo: [],
    cargoUsed: 0,
    cargoCapacity: 20,
    systemId: "sysA",
    position: null,
    weaponDamage: BATTLE_READY_WEAPON_DAMAGE + 10,
    ...over,
  };
}

function obs(neighbors: SystemSnapshot["neighbors"]): Observation {
  const scene = SceneType.SPACE_FLIGHT;
  const system: SystemSnapshot = {
    id: "sysA",
    name: "A",
    planets: [],
    stations: [],
    connections: neighbors?.length ?? 0,
    neighbors,
  };
  return {
    scene,
    hasPlayer: true,
    player: player(),
    system,
    currentPlanet: null,
    npcs: [],
    hostiles: [],
    quests: [],
    legalActions: legalActionsForScene(scene, {
      hasPlayer: true,
      planetCount: 0,
      stationCount: 0,
      hostileCount: 0,
      connectionCount: neighbors?.length ?? 0,
      availableQuestCount: 0,
    }),
  };
}

describe("slayer advance — core-ward bias (the win is breaking the core, not whack-a-mole)", () => {
  it("between two held neighbours, advances toward the one closer to the CORE", () => {
    const action = decideWithMemory(
      obs([
        {
          systemId: "frontFar",
          visited: true,
          overmindHeld: true,
          hopsToOvermindFront: 0,
          hopsToCore: 3,
        },
        {
          systemId: "frontNear",
          visited: true,
          overmindHeld: true,
          hopsToOvermindFront: 0,
          hopsToCore: 1,
        },
      ]),
      createMemory(),
    );
    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("slayer-advance");
    expect(action.targetId).toBe("frontNear");
  });

  it("with no core hops annotated, falls back to the nearest-front pick (pinned behavior preserved)", () => {
    const action = decideWithMemory(
      obs([
        {
          systemId: "far",
          visited: true,
          overmindHeld: false,
          hopsToOvermindFront: 3,
        },
        {
          systemId: "near",
          visited: true,
          overmindHeld: false,
          hopsToOvermindFront: 1,
        },
      ]),
      createMemory(),
    );
    expect(action.kind).toBe("warp");
    expect(action.targetId).toBe("near");
  });

  it("un-held neighbours also break front-hop ties core-ward", () => {
    const action = decideWithMemory(
      obs([
        {
          systemId: "sideways",
          visited: true,
          overmindHeld: false,
          hopsToOvermindFront: 1,
          hopsToCore: 4,
        },
        {
          systemId: "coreward",
          visited: true,
          overmindHeld: false,
          hopsToOvermindFront: 1,
          hopsToCore: 2,
        },
      ]),
      createMemory(),
    );
    expect(action.kind).toBe("warp");
    expect(action.targetId).toBe("coreward");
  });
});
