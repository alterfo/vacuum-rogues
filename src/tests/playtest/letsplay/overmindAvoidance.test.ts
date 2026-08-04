import { describe, it, expect, vi } from "vitest";
import { SceneType, FactionType, StationType } from "@/types";
import {
  legalActionsForScene,
  type Observation,
  type PlayerSnapshot,
  type SystemSnapshot,
  type NpcSnapshot,
} from "./observe";
import { createMemory } from "./AgentMemory";
import {
  decideWithMemory,
  MemoryHeuristicPolicy,
  OVERMIND_THREAT_HULL_FRACTION,
  OVERMIND_THREAT_SHARE,
} from "./MemoryHeuristicPolicy";
import { RealEngineHarness, type RecordedError } from "../realEngineHarness";
import { PlayerAgent } from "./PlayerAgent";
import { pickWarpTarget } from "./engineQueries";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

function playerFixture(over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
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
  planets?: { id: string; name: string; availableQuests: number }[];
  stations?: { id: string; name: string; type: StationType }[];
  connections?: number;
  hostiles?: NpcSnapshot[];
  nearOvermindCore?: boolean;
  overmindShare?: number;
}

function obs(opts: ObsOpts = {}): Observation {
  const scene = opts.scene ?? SceneType.SPACE_FLIGHT;
  const planets = opts.planets ?? [];
  const stations = opts.stations ?? [];
  const connections = opts.connections ?? 1;
  const hostiles = opts.hostiles ?? [];

  const system: SystemSnapshot = {
    id: "sysA",
    name: "A",
    planets,
    stations,
    connections,
  };

  const legalActions = legalActionsForScene(scene, {
    hasPlayer: true,
    planetCount: planets.length,
    stationCount: stations.length,
    hostileCount: hostiles.length,
    connectionCount: connections,
    availableQuestCount: 0,
  });

  return {
    scene,
    hasPlayer: true,
    player: playerFixture(opts.player),
    system,
    currentPlanet: null,
    npcs: hostiles,
    hostiles,
    quests: [],
    legalActions,
    nearOvermindCore: opts.nearOvermindCore,
    overmindShare: opts.overmindShare,
  };
}

const WEAK_HULL = OVERMIND_THREAT_HULL_FRACTION - 0.1;
const BATTLE_READY = OVERMIND_THREAT_HULL_FRACTION + 0.1;

describe("decideWithMemory — threat/Overmind-avoidance tier (pure)", () => {
  it("near the Overmind core while weak, with no hostile ⇒ warps away instead of idling", () => {
    const here = obs({
      nearOvermindCore: true,
      player: { hullFraction: WEAK_HULL },
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("flee-overmind-front");
  });

  it("galaxy-wide Overmind share rising above the threshold also triggers the flee, even off-core", () => {
    const here = obs({
      overmindShare: OVERMIND_THREAT_SHARE + 0.05,
      player: { hullFraction: WEAK_HULL },
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("flee-overmind-front");
  });

  it("near the Overmind core but battle-ready ⇒ does not trigger the flee reaction", () => {
    const here = obs({
      nearOvermindCore: true,
      player: { hullFraction: BATTLE_READY },
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.reason).not.toContain("flee-overmind-front");
  });

  it("Overmind share below the threshold, off-core ⇒ no flee reaction", () => {
    const here = obs({
      overmindShare: OVERMIND_THREAT_SHARE - 0.05,
      player: { hullFraction: WEAK_HULL },
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.reason).not.toContain("flee-overmind-front");
  });

  it("fuel-critical near the front ⇒ still refuels first rather than fleeing on an empty tank", () => {
    const here = obs({
      nearOvermindCore: true,
      player: { hullFraction: WEAK_HULL, fuelFraction: 0.05 },
      planets: [{ id: "P", name: "P", availableQuests: 0 }],
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("land");
    expect(action.reason).toContain("refuel-critical");
  });

  it("a present hostile near the front, hurt ⇒ the existing fight-or-flee-by-hull reaction still wins (flee)", () => {
    const hostile: NpcSnapshot = {
      id: "raider-1",
      name: "raider-1",
      faction: FactionType.SYNDICATE,
      hostile: true,
      hullHP: 80,
    };
    const here = obs({
      nearOvermindCore: true,
      hostiles: [hostile],
      player: { hullFraction: 0.1 },
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("flee");
    expect(action.reason).toContain("flee-low-hull");
  });

  it("a present hostile near the front, healthy ⇒ still engages (attack) rather than fleeing the front", () => {
    const hostile: NpcSnapshot = {
      id: "raider-1",
      name: "raider-1",
      faction: FactionType.SYNDICATE,
      hostile: true,
      hullHP: 80,
    };
    const here = obs({
      nearOvermindCore: true,
      hostiles: [hostile],
      player: { hullFraction: 0.95 },
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("attack");
  });
});

describe("pickWarpTarget — biased away from Overmind-held systems", () => {
  it("skips an Overmind-held neighbour in favor of a clean unvisited one", () => {
    const connections = [{ toSystemId: "B" }, { toSystemId: "C" }];
    const target = pickWarpTarget(
      connections,
      "A",
      new Set(["A"]),
      new Set(["B"]),
    );
    expect(target).toBe("C");
  });

  it("falls back to an Overmind-held system when it's the only way out", () => {
    const connections = [{ toSystemId: "B" }];
    const target = pickWarpTarget(
      connections,
      "A",
      new Set(["A"]),
      new Set(["B"]),
    );
    expect(target).toBe("B");
  });

  it("an empty avoid set behaves exactly like the unbiased pick", () => {
    const connections = [{ toSystemId: "B" }, { toSystemId: "C" }];
    const target = pickWarpTarget(
      connections,
      "A",
      new Set(["A", "B"]),
      new Set(),
    );
    expect(target).toBe("C");
  });
});

function formatRecorded(errors: RecordedError[]): string {
  return errors.map((e) => `[${e.source}] ${e.message}`).join("\n");
}

describe("PlayerAgent — real-engine Overmind avoidance (Task 3)", () => {
  it("leaves a system adjacent to the Overmind core instead of idling there while weak", async () => {
    const harness = await RealEngineHarness.boot({
      seed: "LETSPLAY_OVERMIND",
      systemCount: 24,
    });
    try {
      await harness.newGame();
      const engine = harness.engine;
      const galaxy = harness.galaxy()!;
      const player = engine.player!;
      const startSystemId = player.currentSystemId;
      const startSystem = galaxy.systems.find((s) => s.id === startSystemId)!;
      const neighborId = startSystem.connections[0]?.toSystemId;
      expect(neighborId).toBeDefined();

      galaxy.overmindCoreSystemId = neighborId!;
      player.ship.hullHP = Math.floor(
        player.ship.maxHull * (OVERMIND_THREAT_HULL_FRACTION - 0.1),
      );

      const agent = new PlayerAgent(harness, new MemoryHeuristicPolicy());
      let fled = false;
      let leftStartSystem = false;
      const errors: RecordedError[] = [];
      for (let i = 0; i < 40; i++) {
        const res = await agent.run(1);
        errors.push(...res.errors);
        if (
          res.steps.some((s) =>
            s.action.reason?.includes("flee-overmind-front"),
          )
        ) {
          fled = true;
        }
        if (player.currentSystemId !== startSystemId) leftStartSystem = true;
      }

      expect(errors, formatRecorded(errors)).toEqual([]);
      expect(fled).toBe(true);
      expect(leftStartSystem).toBe(true);
    } finally {
      harness.dispose();
    }
  });
});
