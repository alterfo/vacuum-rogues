import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import { SceneType } from "@/types";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

interface FlightSceneProbe {
  pendingWarp: unknown;
  plannedRoute: { x: number; y: number } | null;
  shipPhysics: { shipX: number; shipY: number } | null;
  starRenderer: { centerX: number; centerY: number };
  SYSTEM_BOUNDARY_RADIUS: number;
}

describe("flee jump fires from the near edge (Task 9 iv)", () => {
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

  function exitVectorTo(
    originId: string,
    targetId: string,
  ): { x: number; y: number } {
    const systems = harness.galaxy()!.systems;
    const from = systems.find((s) => s.id === originId)!;
    const to = systems.find((s) => s.id === targetId)!;
    const dx = to.coordinates.q - from.coordinates.q;
    const dy = to.coordinates.r - from.coordinates.r;
    const d = Math.hypot(dx, dy) || 1;
    return { x: dx / d, y: dy / d };
  }

  function flightProbe(): FlightSceneProbe {
    return harness.currentScene() as unknown as FlightSceneProbe;
  }

  it("routes to the boundary point radially out from the ship, not the exit-direction edge", async () => {
    const origin = harness.engine.player!.currentSystemId;
    const sys = harness.galaxy()!.systems.find((s) => s.id === origin)!;
    const target = sys.connections[0].toSystemId;
    const exit = exitVectorTo(origin, target);

    const before = flightProbe();
    const center = {
      x: before.starRenderer.centerX,
      y: before.starRenderer.centerY,
    };
    const R = before.SYSTEM_BOUNDARY_RADIUS;

    harness.engine.lastFlightShipPos = {
      x: center.x - exit.x * R * 0.9,
      y: center.y - exit.y * R * 0.9,
    };
    harness.engine.lastFlightWasFleeing = true;

    await harness.goTo(SceneType.STAR_MAP);
    const starMap = harness.currentScene() as unknown as {
      performWarpJumpTo(id: string): Promise<void>;
    };
    await starMap.performWarpJumpTo(target);
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    const scene = flightProbe();
    expect(scene.pendingWarp).toBeTruthy();
    const route = scene.plannedRoute!;
    const ship = scene.shipPhysics!;

    expect(Math.hypot(route.x - center.x, route.y - center.y)).toBeCloseTo(
      R,
      0,
    );

    const routeDotExit =
      (route.x - center.x) * exit.x + (route.y - center.y) * exit.y;
    expect(routeDotExit).toBeLessThan(0);

    const nearDist = Math.hypot(route.x - ship.shipX, route.y - ship.shipY);
    const farDist = Math.hypot(
      center.x + exit.x * R - ship.shipX,
      center.y + exit.y * R - ship.shipY,
    );
    expect(nearDist).toBeLessThan(farDist);
    expect(harness.errors()).toEqual([]);
  });

  it("a fresh warp (no preserved position) still exits toward the destination", async () => {
    const origin = harness.engine.player!.currentSystemId;
    const sys = harness.galaxy()!.systems.find((s) => s.id === origin)!;
    const target = sys.connections[0].toSystemId;
    const exit = exitVectorTo(origin, target);

    const before = flightProbe();
    const center = {
      x: before.starRenderer.centerX,
      y: before.starRenderer.centerY,
    };

    harness.engine.lastFlightShipPos = null;

    await harness.goTo(SceneType.STAR_MAP);
    const starMap = harness.currentScene() as unknown as {
      performWarpJumpTo(id: string): Promise<void>;
    };
    await starMap.performWarpJumpTo(target);
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    const scene = flightProbe();
    const route = scene.plannedRoute!;
    const routeDotExit =
      (route.x - center.x) * exit.x + (route.y - center.y) * exit.y;
    expect(routeDotExit).toBeGreaterThan(0); // exits toward the destination
    expect(harness.errors()).toEqual([]);
  });
});
