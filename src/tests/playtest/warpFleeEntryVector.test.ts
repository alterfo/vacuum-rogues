import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { SceneType } from "@/types";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

interface FlightSceneProbe {
  pendingWarp: unknown;
  plannedRoute: { x: number; y: number } | null;
  starRenderer: { centerX: number; centerY: number };
  SYSTEM_BOUNDARY_RADIUS: number;
  performWarp(): Promise<void>;
}

interface ArrivedSceneProbe {
  shipPhysics: { shipAngle: number } | null;
}

describe("Flee-jump entry vector mirrors the REAL exit angle (Task 2)", () => {
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

  it("arrival heading matches the actual near-edge departure angle, not the straight-line target direction", async () => {
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

    const departingScene = flightProbe();
    const route = departingScene.plannedRoute!;
    const farEdgeX = center.x + exit.x * R;
    expect(route.x).not.toBeCloseTo(farEdgeX, -1);

    const expectedDepartureVector = {
      x: (route.x - center.x) / R,
      y: (route.y - center.y) / R,
    };
    const expectedHeading = Math.atan2(
      expectedDepartureVector.y,
      expectedDepartureVector.x,
    );

    await departingScene.performWarp();
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    const arrivedScene = harness.currentScene() as unknown as ArrivedSceneProbe;
    expect(arrivedScene.shipPhysics?.shipAngle).toBeCloseTo(expectedHeading, 5);
    expect(harness.errors()).toEqual([]);
  });

  it("a routine (non-flee) jump's arrival heading is unaffected — still the straight-line exitVector", async () => {
    const origin = harness.engine.player!.currentSystemId;
    const sys = harness.galaxy()!.systems.find((s) => s.id === origin)!;
    const target = sys.connections[0].toSystemId;
    const exit = exitVectorTo(origin, target);

    harness.engine.lastFlightShipPos = null;
    harness.engine.lastFlightWasFleeing = false;

    await harness.goTo(SceneType.STAR_MAP);
    const starMap = harness.currentScene() as unknown as {
      performWarpJumpTo(id: string): Promise<void>;
    };
    await starMap.performWarpJumpTo(target);
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    const departingScene = flightProbe();
    const expectedHeading = Math.atan2(exit.y, exit.x);

    await departingScene.performWarp();
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    const arrivedScene = harness.currentScene() as unknown as ArrivedSceneProbe;
    expect(arrivedScene.shipPhysics?.shipAngle).toBeCloseTo(expectedHeading, 5);
    expect(harness.errors()).toEqual([]);
  });
});
