import { describe, it, expect } from "vitest";
import { SceneType, StationType } from "@/types";
import {
  legalActionsForScene,
  type Observation,
  type PlayerSnapshot,
  type SystemSnapshot,
} from "./observe";
import { createMemory, updateMemory } from "./AgentMemory";
import { decideWithMemory } from "./MemoryHeuristicPolicy";

const STATION_ID = "st0";

function player(over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    credits: 1000,
    hull: 100,
    maxHull: 100,
    hullFraction: 1,
    fuel: 50,
    maxFuel: 50,
    fuelFraction: 1,
    cargo: [],
    cargoUsed: 0,
    cargoCapacity: 20,
    systemId: "sysA",
    position: null,
    ...over,
  };
}

interface ObsOpts {
  scene?: SceneType;
  player?: Partial<PlayerSnapshot>;
  systemId?: string;
}

function obs(opts: ObsOpts = {}): Observation {
  const scene = opts.scene ?? SceneType.SPACE_FLIGHT;
  const systemId = opts.systemId ?? "sysA";
  const system: SystemSnapshot = {
    id: systemId,
    name: systemId,
    planets: [],
    stations: [{ id: STATION_ID, name: "St", type: StationType.TRADE_POST }],
    connections: 0,
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
    legalActions: legalActionsForScene(scene, {
      hasPlayer: true,
      planetCount: 0,
      stationCount: 1,
      hostileCount: 0,
      connectionCount: 0,
      availableQuestCount: 0,
    }),
  };
}

describe("no-op-dock cooldown — the station-side anti-ping-pong guard", () => {
  it("breaks the dock↔leave cycle on a barren station instead of looping forever", () => {
    let mem = createMemory();
    let docks = 0;
    let broke = false;
    for (let i = 0; i < 10; i++) {
      const flight = obs();
      mem = updateMemory(mem, flight);
      const decision = decideWithMemory(flight, mem);
      if (decision.kind !== "dock") {
        broke = true;
        break;
      }
      docks++;
      const stayObs = obs({ scene: SceneType.STATION });
      mem = updateMemory(mem, stayObs);
    }
    expect(broke).toBe(true);
    expect(docks).toBeLessThanOrEqual(4);
  });

  it("counts consecutive barren stays per station, resetting on a productive stay", () => {
    let mem = createMemory();
    mem = updateMemory(mem, obs());
    mem = updateMemory(mem, obs({ scene: SceneType.STATION }));
    mem = updateMemory(mem, obs());
    expect(mem.noopDockStationId).toBe(STATION_ID);
    expect(mem.noopDockStreak).toBe(1);

    mem = updateMemory(mem, obs({ scene: SceneType.STATION }));
    mem = updateMemory(mem, obs());
    expect(mem.noopDockStreak).toBe(2);

    mem = updateMemory(mem, obs({ scene: SceneType.STATION }));
    mem = updateMemory(mem, obs({ player: { credits: 700 } }));
    expect(mem.noopDockStreak).toBe(0);
    expect(mem.noopDockStationId).toBeNull();
  });

  it("a system change resets the dock streak — a fresh system's station is fair game", () => {
    let mem = createMemory();
    mem = updateMemory(mem, obs());
    mem = updateMemory(mem, obs({ scene: SceneType.STATION }));
    mem = updateMemory(mem, obs());
    expect(mem.noopDockStreak).toBe(1);

    mem = updateMemory(mem, obs({ systemId: "sysB" }));
    expect(mem.noopDockStreak).toBe(0);
    expect(mem.noopDockStationId).toBeNull();
  });
});
