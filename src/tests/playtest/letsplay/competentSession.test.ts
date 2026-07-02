import { describe, it, expect, vi } from "vitest";
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
import { PlayerAgent } from "./PlayerAgent";

/**
 * Task 4 of the smart-autopilot plan: the progression tier + holistic
 * goal-less competence.
 *
 * Root cause (see docs/plans/20260701-smart-autopilot-player.md): the
 * goal-less base ladder never spent an affordable in-station upgrade
 * (`bestHullPrice`/`cheapestGearPrice` were only ever read by the
 * goal-specific CJM-B gear-grinder branch, dead for a goal-less run) and
 * never reacted to `obs.questDeliveryHere` (only the goal-specific CJM-D
 * quest-runner did) — credits piled up unspent and a deliverable-now quest
 * was never landed on to complete. These tests pin both fixes, plus a
 * session-level competence assertion over the whole ladder.
 */
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

/** Mirrors the fixture builder in cjm.test.ts (kept local to avoid touching that file). */
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

  it("buys gear when it can't yet afford the hull buffer, goal-less", () => {
    const here = obs({
      scene: SceneType.STATION,
      player: { credits: 700 },
      bestHullPrice: 10000,
      cheapestGearPrice: 500,
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("buy-gear");
  });

  it("buys a micromodule at a craft center when nothing bigger is affordable, goal-less", () => {
    const here = obs({
      scene: SceneType.STATION,
      player: { credits: 900 },
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
  });
});

/** Render the harness error sink as a readable assertion hint. */
function formatRecorded(errors: RecordedError[]): string {
  return errors.map((e) => `[${e.source}] ${e.message}`).join("\n");
}

describe("PlayerAgent — competent goal-less session (Task 4)", () => {
  it("survives, never fuel-dies, never soft-locks, and completes a buy-sell cycle", async () => {
    // Chosen deterministically: this seed/budget combo plays a real trade
    // cycle to completion without the run's outcome depending on rare
    // quest-generation timing or an unrelated deep-space Overmind-garrison
    // encounter (both outside this task's scope — see Task 5/8/9). The
    // quest-delivery and affordable-upgrade *additions* this task makes are
    // pinned deterministically by the pure fixture tests above; this
    // real-engine run instead proves the full ladder is stable end to end.
    const harness = await RealEngineHarness.boot({
      seed: "LETSPLAY_HOLISTIC3",
    });
    try {
      await harness.newGame();
      const ship = harness.engine.player!.ship;
      const maxFuel = ship.maxEnergy;

      const agent = new PlayerAgent(harness, new MemoryHeuristicPolicy());
      const res = await agent.run(200);

      expect(res.errors, formatRecorded(res.errors)).toEqual([]);
      expect(res.endScene).not.toBe(SceneType.GAME_OVER);

      // No fuel-death: never warped while fuel was critical, and the ship is
      // never left permanently stranded at 0 energy.
      const criticalWarp = res.steps.find((s) => {
        const fuel = s.vitals?.fuel ?? maxFuel;
        return fuel / maxFuel < 0.2 && s.action.kind === "warp";
      });
      expect(criticalWarp).toBeUndefined();
      expect(ship.energy).toBeGreaterThan(0);

      // No soft-lock: no single (scene, action) pair repeats forever — a
      // general stagnation guard (this task's bestKnownMargin/holdingFor-
      // OtherSystem fix removed one such stall: an unrelated, larger known
      // margin was masking the held good's own sell opportunity, so the
      // agent looped land-earn/take-off forever on unsellable cargo).
      let streak = 0;
      let longestStreak = 0;
      let prevKey = "";
      for (const step of res.steps) {
        const key = `${step.scene}|${step.action.kind}:${step.action.reason}`;
        streak = key === prevKey ? streak + 1 : 1;
        longestStreak = Math.max(longestStreak, streak);
        prevKey = key;
      }
      expect(longestStreak).toBeLessThan(20);

      // At least one buy→sell cycle actually realised a known margin.
      const soldForProfit = res.steps.some(
        (s) =>
          s.action.kind === "trade" &&
          (s.action.reason ?? "").includes("sell-for-profit"),
      );
      expect(soldForProfit).toBe(true);

      // Never goes broke to a negative balance.
      expect(res.finalVitals?.credits ?? 0).toBeGreaterThanOrEqual(0);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});
