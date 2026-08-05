import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { SceneType, ResourceType, StationType } from "@/types";
import {
  legalActionsForScene,
  type Observation,
  type PlayerSnapshot,
  type SystemSnapshot,
  type CurrentPlanetSnapshot,
} from "./observe";
import { createMemory, type AgentMemory } from "./AgentMemory";
import {
  decideWithMemory,
  MemoryHeuristicPolicy,
} from "./MemoryHeuristicPolicy";
import { RealEngineHarness, type RecordedError } from "../realEngineHarness";
import { PlayerAgent, type AgentRunResult } from "./PlayerAgent";

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
  currentPlanet?: CurrentPlanetSnapshot | null;
  hasCraftCenter?: boolean;
  questDeliveryHere?: boolean;
  cheapestGearPrice?: number | null;
  bestHullPrice?: number | null;
}

function obs(opts: ObsOpts = {}): Observation {
  const scene = opts.scene ?? SceneType.SPACE_FLIGHT;
  const planets = opts.planets ?? [];
  const stations = opts.stations ?? [];
  const connections = opts.connections ?? 0;
  const currentPlanet = opts.currentPlanet ?? null;
  const player = playerFixture(opts.player);
  const hasCraftCenter = opts.hasCraftCenter ?? false;
  const cheapestGearPrice = opts.cheapestGearPrice ?? null;
  const bestHullPrice = opts.bestHullPrice ?? null;

  const system: SystemSnapshot = {
    id: "sysA",
    name: "A",
    planets,
    stations,
    connections,
  };

  const availableQuestCount =
    currentPlanet?.availableQuests ??
    planets.reduce((max, p) => Math.max(max, p.availableQuests), 0);

  const legalActions = legalActionsForScene(scene, {
    hasPlayer: true,
    planetCount: planets.length,
    stationCount: stations.length,
    hostileCount: 0,
    connectionCount: connections,
    availableQuestCount,
    credits: player.credits,
    cargoUsed: player.cargoUsed,
    hasCraftCenter,
    cheapestGearPrice,
    bestHullPrice,
  });

  return {
    scene,
    hasPlayer: true,
    player,
    system,
    currentPlanet,
    npcs: [],
    hostiles: [],
    quests: [],
    legalActions,
    warpInTransit: false,
    hasCraftCenter,
    questDeliveryHere: opts.questDeliveryHere ?? false,
    cheapestGearPrice,
    bestHullPrice,
  };
}

describe("decideWithMemory — progression tier: affordable in-station upgrade (pure)", () => {
  it("buys the hull upgrade once credits clear the buffer, goal-less", () => {
    const here = obs({
      scene: SceneType.STATION,
      player: { credits: 12000 },
      bestHullPrice: 10000,
      cheapestGearPrice: 500,
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("upgrade-hull");
  });

  it("buys gear from surplus once battle-ready when the hull upgrade is out of reach", () => {
    const here = obs({
      scene: SceneType.STATION,
      player: { credits: 2000, maxHull: 220, weaponDamage: 35 },
      bestHullPrice: 10000,
      cheapestGearPrice: 500,
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("buy-gear");
  });

  it("defers gear shopping while not yet battle-ready (hull-first discipline)", () => {
    const here = obs({
      scene: SceneType.STATION,
      player: { credits: 2000 },
      bestHullPrice: 10000,
      cheapestGearPrice: 500,
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).not.toBe("buy-gear");
  });

  it("buys a micromodule at a craft center when nothing bigger is affordable, goal-less", () => {
    const here = obs({
      scene: SceneType.STATION,
      player: { credits: 1500, maxHull: 220, weaponDamage: 35 },
      hasCraftCenter: true,
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("buy-module");
  });

  it("defers to repair/leave when nothing is affordable yet, goal-less", () => {
    const here = obs({
      scene: SceneType.STATION,
      player: { credits: 100 },
      bestHullPrice: 10000,
      cheapestGearPrice: 5000,
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).not.toBe("upgrade-hull");
    expect(action.kind).not.toBe("buy-gear");
    expect(action.kind).not.toBe("buy-module");
  });
});

describe("decideWithMemory — progression tier: quest delivery here (pure)", () => {
  it("lands on an in-system planet to close out a deliverable-now quest, goal-less", () => {
    const here = obs({
      questDeliveryHere: true,
      planets: [{ id: "Q", name: "Q", availableQuests: 0 }],
      connections: 1,
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("land");
    expect(action.reason).toContain("quest-delivery");
    expect(action.targetId).toBe("Q");
  });

  it("a known cross-planet margin sell still outranks the delivery landing", () => {
    const mem: AgentMemory = createMemory();
    mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
    mem.priceBook.set("Q", new Map([[M, { buy: 100, sell: 80, seenAt: 1 }]]));
    mem.priceBook.set("R", new Map([[M, { buy: 200, sell: 160, seenAt: 1 }]])); // sells here
    const here = obs({
      questDeliveryHere: true,
      planets: [
        { id: "R", name: "R", availableQuests: 0 },
        { id: "Q", name: "Q", availableQuests: 0 },
      ],
      connections: 1,
    });

    const action = decideWithMemory(here, mem);

    expect(action.kind).toBe("land");
    expect(action.reason).toContain("go-sell");
    expect(action.targetId).toBe("R");
  });

  it("with no in-system planet to land on, does not invent a target (falls through safely)", () => {
    const here = obs({ questDeliveryHere: true, connections: 1 });

    const action = decideWithMemory(here, createMemory());

    expect(here.legalActions).toContain(action.kind);
    expect(action.kind).not.toBe("land");
  });
});

function formatRecorded(errors: RecordedError[]): string {
  return errors.map((e) => `[${e.source}] ${e.message}`).join("\n");
}

describe("PlayerAgent — competent goal-less session (Task 4)", () => {
  let harness: RealEngineHarness;
  let res: AgentRunResult;
  let maxFuel: number;

  beforeAll(async () => {
    harness = await RealEngineHarness.boot({ seed: "LETSPLAY_HOLISTIC3" });
    await harness.newGame();
    maxFuel = harness.engine.player!.ship.maxEnergy;

    const agent = new PlayerAgent(harness, new MemoryHeuristicPolicy());
    res = await agent.run(200);
  }, 30_000);

  afterAll(() => {
    harness.dispose();
  });

  it("survives, never fuel-dies, and never soft-locks", () => {
    expect(res.errors, formatRecorded(res.errors)).toEqual([]);
    if (res.endScene === SceneType.GAME_OVER) {
      const lastDay = res.steps[res.steps.length - 1]?.day ?? 0;
      const galaxy = harness.engine.galaxy!;
      const share = galaxy.overmindSystems.length / galaxy.systems.length;
      expect(
        lastDay,
        "death before the adaptive grace window ended",
      ).toBeGreaterThanOrEqual(120);
      expect(
        share,
        "death in a galaxy the war had not consumed",
      ).toBeGreaterThanOrEqual(0.35);
    }

    const criticalWarp = res.steps.find((s) => {
      const fuel = s.vitals?.fuel ?? maxFuel;
      return fuel / maxFuel < 0.2 && s.action.kind === "warp";
    });
    expect(criticalWarp).toBeUndefined();
    expect(harness.engine.player!.ship.energy).toBeGreaterThan(0);

    let streak = 0;
    let longestStreak = 0;
    let prevKey = "";
    for (const step of res.steps) {
      if (step.scene === SceneType.GAME_OVER) break;
      const key = `${step.scene}|${step.action.kind}:${step.action.reason}`;
      streak = key === prevKey ? streak + 1 : 1;
      longestStreak = Math.max(longestStreak, streak);
      prevKey = key;
    }
    expect(longestStreak).toBeLessThan(20);

    expect(res.finalVitals?.credits ?? 0).toBeGreaterThanOrEqual(0);
  });

  it("completes a DELIVERY quest for its contractual reward", () => {
    const completedQuest = res.steps.some(
      (s) => (s.vitals?.questsCompleted ?? 0) > 0,
    );
    expect(completedQuest).toBe(true);
  });

  it("realises a known-margin sell-for-profit cycle", () => {
    const soldForProfit = res.steps.some(
      (s) =>
        s.action.kind === "trade" &&
        (s.action.reason ?? "").includes("sell-for-profit"),
    );
    expect(soldForProfit).toBe(true);
  });
});
