import { describe, it, expect, vi } from "vitest";
import { SceneType, ResourceType, StationType } from "@/types";
import {
  legalActionsForScene,
  type Observation,
  type PlayerSnapshot,
  type SystemSnapshot,
} from "./observe";
import { createMemory, type AgentMemory } from "./AgentMemory";
import {
  decideWithMemory,
  MAX_CONSECUTIVE_WARPS_WITHOUT_LAND,
  MemoryHeuristicPolicy,
} from "./MemoryHeuristicPolicy";
import type { PriceRecord } from "./AgentMemory";
import { RealEngineHarness, type RecordedError } from "../realEngineHarness";
import { PlayerAgent } from "./PlayerAgent";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

const M = ResourceType.METALS;

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
}

function obs(opts: ObsOpts = {}): Observation {
  const scene = opts.scene ?? SceneType.SPACE_FLIGHT;
  const planets = opts.planets ?? [];
  const stations = opts.stations ?? [];
  const connections = opts.connections ?? 0;

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
    hostileCount: 0,
    connectionCount: connections,
    availableQuestCount: 0,
  });

  return {
    scene,
    hasPlayer: true,
    player: playerFixture(opts.player),
    system,
    currentPlanet: null,
    npcs: [],
    hostiles: [],
    quests: [],
    legalActions,
  };
}

const rec = (buy: number, sell: number): PriceRecord => ({
  buy,
  sell,
  seenAt: 1,
});

describe("decideWithMemory — land-before-warp economy tier (pure)", () => {
  it("holding cargo with an unvisited in-system planet ⇒ lands there instead of blind-warping", () => {
    const mem: AgentMemory = createMemory();
    mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
    const here = obs({
      planets: [{ id: "Q", name: "Q", availableQuests: 0 }],
      connections: 1,
    });

    const action = decideWithMemory(here, mem);

    expect(action.kind).toBe("land");
    expect(action.reason).toContain("discover-prices");
    expect(action.targetId).toBe("Q");
  });

  it("holding cargo with the in-system planet already visited ⇒ falls through to the cross-system warp", () => {
    const mem: AgentMemory = createMemory();
    mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
    mem.priceBook.set("Q", new Map([[M, rec(90, 70)]])); // already visited, no margin
    const here = obs({
      planets: [{ id: "Q", name: "Q", availableQuests: 0 }],
      connections: 1,
    });

    const action = decideWithMemory(here, mem);

    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("find-sell-destination");
  });

  it("go-sell (in-system remembered margin) still outranks the discover-prices loop-breaker", () => {
    const mem: AgentMemory = createMemory();
    mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
    mem.priceBook.set("A", new Map([[M, rec(100, 80)]]));
    mem.priceBook.set("B", new Map([[M, rec(200, 160)]])); // sells here for profit
    const here = obs({
      planets: [
        { id: "B", name: "B", availableQuests: 0 },
        { id: "Q", name: "Q", availableQuests: 0 }, // unvisited, would otherwise win
      ],
      connections: 1,
    });

    const action = decideWithMemory(here, mem);

    expect(action.kind).toBe("land");
    expect(action.reason).toContain("go-sell");
    expect(action.targetId).toBe("B");
  });
});

describe("decideWithMemory — anti-consecutive-warp cadence (pure)", () => {
  it("trips once the tally hits the cap, forcing a non-warp action", () => {
    const mem: AgentMemory = createMemory();
    mem.priceBook.set("A", new Map([[M, rec(100, 80)]]));
    mem.priceBook.set("B", new Map([[M, rec(200, 160)]]));
    mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
    mem.consecutiveWarpsWithoutLanding = MAX_CONSECUTIVE_WARPS_WITHOUT_LAND;
    const here = obs({ connections: 2 });

    const action = decideWithMemory(here, mem);

    expect(action.kind).not.toBe("warp");
  });

  it("below the cap, the same state still warps as before (no over-triggering)", () => {
    const mem: AgentMemory = createMemory();
    mem.priceBook.set("A", new Map([[M, rec(100, 80)]]));
    mem.priceBook.set("B", new Map([[M, rec(200, 160)]]));
    mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
    mem.consecutiveWarpsWithoutLanding = MAX_CONSECUTIVE_WARPS_WITHOUT_LAND - 1;
    const here = obs({ connections: 2 });

    const action = decideWithMemory(here, mem);

    expect(action.kind).toBe("warp");
  });
});

function formatRecorded(errors: RecordedError[]): string {
  return errors.map((e) => `[${e.source}] ${e.message}`).join("\n");
}

describe("PlayerAgent — real-engine no warp-forever loop (Task 2)", () => {
  it("plays a full session that lands on ≥2 distinct planets and never strings more than the cadence cap of consecutive warps", async () => {
    const harness = await RealEngineHarness.boot({ seed: "LETSPLAY_EXPLORE" });
    try {
      await harness.newGame();
      const agent = new PlayerAgent(harness, new MemoryHeuristicPolicy());
      const res = await agent.run(150);

      expect(res.errors, formatRecorded(res.errors)).toEqual([]);

      expect(agent.belief.priceBook.size).toBeGreaterThanOrEqual(2);

      let streak = 0;
      let longestStreak = 0;
      for (const step of res.steps) {
        if (
          step.action.kind === "land" ||
          step.action.kind === "dock" ||
          step.action.kind === "flee" ||
          step.action.reason?.startsWith("mem:flee")
        ) {
          streak = 0;
        } else if (
          step.action.kind === "warp" &&
          step.scene === SceneType.SPACE_FLIGHT
        ) {
          streak += 1;
          longestStreak = Math.max(longestStreak, streak);
        }
      }
      expect(longestStreak).toBeLessThanOrEqual(
        MAX_CONSECUTIVE_WARPS_WITHOUT_LAND,
      );
    } finally {
      harness.dispose();
    }
  });
});
