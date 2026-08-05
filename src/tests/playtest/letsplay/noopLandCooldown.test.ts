import { describe, it, expect } from "vitest";
import { SceneType, ResourceType } from "@/types";
import {
  legalActionsForScene,
  type Observation,
  type PlayerSnapshot,
  type SystemSnapshot,
  type CurrentPlanetSnapshot,
  type QuestSnapshot,
} from "./observe";
import { createMemory, updateMemory, type AgentMemory } from "./AgentMemory";
import { decideWithMemory } from "./MemoryHeuristicPolicy";

const M = ResourceType.METALS;

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
  currentPlanet?: CurrentPlanetSnapshot | null;
  quests?: QuestSnapshot[];
}

function obs(opts: ObsOpts = {}): Observation {
  const scene = opts.scene ?? SceneType.SPACE_FLIGHT;
  const currentPlanet = opts.currentPlanet ?? null;
  const systemId = opts.systemId ?? "sysA";
  const system: SystemSnapshot = {
    id: systemId,
    name: systemId,
    planets: [{ id: "A", name: "A", availableQuests: 0 }],
    stations: [],
    connections: 0,
  };
  return {
    scene,
    hasPlayer: true,
    player: player(opts.player),
    system,
    currentPlanet,
    npcs: [],
    hostiles: [],
    quests: opts.quests ?? [],
    legalActions: legalActionsForScene(scene, {
      hasPlayer: true,
      planetCount: 1,
      stationCount: 0,
      hostileCount: 0,
      connectionCount: 0,
      availableQuestCount: currentPlanet?.availableQuests ?? 0,
    }),
  };
}

const landedA = (): CurrentPlanetSnapshot => ({
  id: "A",
  name: "A",
  availableQuests: 0,
  market: [{ resource: M, buy: 100, sell: 80 }],
});

function foldBarrenCycle(mem: AgentMemory): AgentMemory {
  return updateMemory(
    mem,
    obs({ scene: SceneType.PLANET, currentPlanet: landedA() }),
  );
}

describe("no-op-land cooldown — the land-side anti-ping-pong guard", () => {
  it("breaks the land↔take-off cycle on a barren planet instead of looping forever", () => {
    let mem = createMemory();
    let lands = 0;
    let broke = false;
    for (let i = 0; i < 10; i++) {
      const flight = obs();
      mem = updateMemory(mem, flight);
      const decision = decideWithMemory(flight, mem);
      if (decision.kind !== "land") {
        broke = true;
        break;
      }
      lands++;
      const stayObs = obs({
        scene: SceneType.PLANET,
        currentPlanet: landedA(),
      });
      mem = updateMemory(mem, stayObs);
      expect(decideWithMemory(stayObs, mem).kind).toBe("move");
    }
    expect(broke).toBe(true);
    expect(lands).toBeLessThanOrEqual(4);
  });

  it("counts consecutive barren stays per planet, resetting on a productive first landing", () => {
    let mem = createMemory();
    mem = updateMemory(mem, obs());
    mem = foldBarrenCycle(mem);
    mem = updateMemory(mem, obs()); // take-off fold evaluates the stay
    expect(mem.noopLandStreak).toBe(0);

    mem = foldBarrenCycle(mem);
    mem = updateMemory(mem, obs());
    expect(mem.noopLandPlanetId).toBe("A");
    expect(mem.noopLandStreak).toBe(1);

    mem = foldBarrenCycle(mem);
    mem = updateMemory(mem, obs());
    expect(mem.noopLandStreak).toBe(2);
  });

  it("a stay that moves cargo is productive — the streak resets", () => {
    let mem = createMemory();
    mem = updateMemory(mem, obs());
    mem = foldBarrenCycle(mem);
    mem = updateMemory(mem, obs());
    mem = foldBarrenCycle(mem);
    mem = updateMemory(mem, obs());
    expect(mem.noopLandStreak).toBe(1);

    mem = foldBarrenCycle(mem);
    mem = updateMemory(
      mem,
      obs({ player: { cargo: [{ type: M, amount: 5 }], cargoUsed: 5 } }),
    );
    expect(mem.noopLandStreak).toBe(0);
    expect(mem.noopLandPlanetId).toBeNull();
  });

  it("a stay that takes a quest is productive — the streak resets", () => {
    let mem = createMemory();
    mem = updateMemory(mem, obs());
    mem = foldBarrenCycle(mem);
    mem = updateMemory(mem, obs());
    mem = foldBarrenCycle(mem);
    mem = updateMemory(mem, obs());
    expect(mem.noopLandStreak).toBe(1);

    mem = foldBarrenCycle(mem);
    const q: QuestSnapshot = {
      id: "q1",
      title: "q1",
      type: "DELIVERY" as QuestSnapshot["type"],
      targetSystemId: null,
    };
    mem = updateMemory(mem, obs({ quests: [q] }));
    expect(mem.noopLandStreak).toBe(0);
  });

  it("a system change resets the streak — a fresh system's planet is fair game", () => {
    let mem = createMemory();
    mem = updateMemory(mem, obs());
    mem = foldBarrenCycle(mem);
    mem = updateMemory(mem, obs());
    mem = foldBarrenCycle(mem);
    mem = updateMemory(mem, obs());
    expect(mem.noopLandStreak).toBe(1);

    mem = updateMemory(mem, obs({ systemId: "sysB" }));
    expect(mem.noopLandStreak).toBe(0);
    expect(mem.noopLandPlanetId).toBeNull();
  });

  it("critical-fuel refuelling still lands even with the streak tripped", () => {
    let mem = createMemory();
    for (let i = 0; i < 6; i++) {
      mem = updateMemory(mem, obs());
      mem = foldBarrenCycle(mem);
    }
    const thirsty = obs({ player: { fuel: 5, fuelFraction: 0.1 } });
    mem = updateMemory(mem, thirsty);
    const decision = decideWithMemory(thirsty, mem);
    expect(decision.kind).toBe("land");
    expect(decision.reason).toContain("refuel");
  });
});
