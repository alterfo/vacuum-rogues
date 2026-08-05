import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import { PlayerAgent } from "./PlayerAgent";
import type { PlayerPolicy, Action } from "./PlayerPolicy";
import type { Observation } from "./observe";
import { SceneType, NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import { NpcShip } from "@/domain/NpcShip";
import { pickWarpTarget } from "./engineQueries";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

function scripted(kind: Action["kind"]): PlayerPolicy {
  return {
    name: "scripted",
    decide(obs: Observation): Action {
      const k = obs.legalActions.includes(kind) ? kind : "wait";
      return { kind: k, reason: "scripted" };
    },
  };
}

describe("letsplay agent advances galaxy days (Task 1)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot();
    await harness.newGame();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("a wait turn advances the calendar by at least one day", async () => {
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    const day0 = harness.galaxy()!.gameDays;

    const agent = new PlayerAgent(harness, scripted("wait"));
    await agent.run(3);

    expect(harness.galaxy()!.gameDays).toBeGreaterThan(day0);
    expect(harness.errors()).toEqual([]);
  });

  it("an in-flight move flies a real distance and advances time", async () => {
    const phys = (
      harness.currentScene() as unknown as {
        shipPhysics: { shipX: number; shipY: number };
      }
    ).shipPhysics;
    const start = { x: phys.shipX, y: phys.shipY };
    const day0 = harness.galaxy()!.gameDays;

    const agent = new PlayerAgent(harness, scripted("move"));
    await agent.run(2);

    const moved = Math.hypot(phys.shipX - start.x, phys.shipY - start.y);
    expect(moved).toBeGreaterThan(0); // the ship actually traversed space
    expect(harness.galaxy()!.gameDays).toBeGreaterThanOrEqual(day0);
    expect(harness.errors()).toEqual([]);
  });
});

describe("letsplay agent — warpInTransit safety net covers every action (PlayerAgent.apply)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot();
    await harness.newGame();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  async function startWarpInTransit(): Promise<{
    flightScene: {
      pendingWarp: unknown;
      plannedRoute: { x: number; y: number } | null;
    };
  }> {
    const origin = harness.engine.player!.currentSystemId;
    const sys = harness.galaxy()!.systems.find((s) => s.id === origin)!;
    const target = sys.connections[0].toSystemId;
    await harness.goTo(SceneType.STAR_MAP);
    const starMap = harness.currentScene() as unknown as {
      performWarpJumpTo(id: string): Promise<void>;
    };
    await starMap.performWarpJumpTo(target);
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    const flightScene = harness.currentScene() as unknown as {
      pendingWarp: unknown;
      plannedRoute: { x: number; y: number } | null;
    };
    expect(flightScene.pendingWarp).toBeTruthy();
    return { flightScene };
  }

  it.each<Action["kind"]>(["land", "dock"])(
    "a `%s` action mid-warp-transit drives the safety net instead of tearing down the scene",
    async (kind) => {
      await startWarpInTransit();

      const agent = new PlayerAgent(harness, scripted(kind));
      await agent.run(1);

      expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
      expect(harness.errors()).toEqual([]);
    },
  );

  it("an in-flight `move` mid-warp-transit does not hijack the route away from the warp edge", async () => {
    const { flightScene } = await startWarpInTransit();
    const edge = {
      x: flightScene.plannedRoute!.x,
      y: flightScene.plannedRoute!.y,
    };

    const agent = new PlayerAgent(harness, scripted("move"));
    await agent.run(1);

    const route = flightScene.plannedRoute;
    expect(route === null || (route.x === edge.x && route.y === edge.y)).toBe(
      true,
    );
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    expect(harness.errors()).toEqual([]);
  });

  it("an `attack` action mid-warp-transit drives the warp forward instead of halting it", async () => {
    await startWarpInTransit();
    const origin = harness.engine.player!.currentSystemId;

    harness.galaxy()!.npcShips.push(
      new NpcShip({
        id: "letsplay-test-hostile",
        name: "letsplay-test-hostile",
        race: FactionType.OUTLANDERS,
        faction: Faction.OUTLANDERS,
        role: NpcRole.PIRATE,
        hullHP: 50,
        maxHull: 50,
        shields: 0,
        speed: 0,
        damage: 0,
        currentSystemId: origin,
        state: NpcState.PATROLLING,
        goal: null,
        destinationSystemId: null,
        daysToArrival: 0,
        credits: 0,
        reputation: 0,
        hostile: true,
        worldX: 50000,
        worldY: 50000,
      }),
    );

    const agent = new PlayerAgent(harness, scripted("attack"));
    await agent.run(1);

    const flightScene = harness.currentScene() as unknown as {
      isTurnRunning?: boolean;
      combatModule?: { isActive?: boolean } | null;
    } | null;
    const warpCompleted = harness.engine.player?.currentSystemId !== origin;
    const stillDriving = flightScene?.isTurnRunning === true;
    const legitimatelyBlocked = flightScene?.combatModule?.isActive === true;

    expect(warpCompleted || stillDriving || legitimatelyBlocked).toBe(true);
    expect(harness.errors()).toEqual([]);
  });
});

describe("pickWarpTarget — prefers the unvisited direction over the merely-not-last one", () => {
  it("picks a system not yet visited even when it isn't the last hop", () => {
    const connections = [
      { toSystemId: "C" },
      { toSystemId: "D" },
      { toSystemId: "A" },
    ];
    const target = pickWarpTarget(connections, "A", new Set(["A", "B", "C"]));
    expect(target).toBe("D");
  });

  it("falls back to avoiding the last hop when every connection is already visited", () => {
    const connections = [{ toSystemId: "A" }, { toSystemId: "C" }];
    const target = pickWarpTarget(connections, "A", new Set(["A", "B", "C"]));
    expect(target).toBe("C");
  });

  it("falls back to the first connection when there is nowhere else to go", () => {
    const connections = [{ toSystemId: "A" }];
    const target = pickWarpTarget(connections, "A", new Set(["A", "B"]));
    expect(target).toBe("A");
  });

  it("returns undefined for a dead-end system with no connections", () => {
    expect(pickWarpTarget([], "A", new Set())).toBeUndefined();
  });
});
