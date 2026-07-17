/**
 * Task 2 (autopilot-reliability-fixes plan): a genuine flee's near-edge exit
 * point (Task 9 iv, `warpEdgePoint`'s `fromMidSystem` path) is NOT aligned
 * with the straight-line direction to the target system — but `performWarp`
 * used to always mirror the stale straight-line `exitVector` into the arrival
 * entry vector/heading, so the ship always appeared to arrive "from nowhere"
 * instead of from the side it actually departed. Fixed by deriving the entry
 * vector from the REAL exit point (captured when the route was planned)
 * relative to the origin system's centre, falling back to the straight-line
 * `exitVector` only when no such point was captured.
 *
 * Real-engine tier: drives the real `StarMapScene.performWarpJumpTo` →
 * `SpaceFlightScene` handoff, same fixture as `fleeNearEdge.test.ts`, then
 * calls the real (private, direct-cast) `performWarp()` to observe the
 * arrival heading — mirroring `warpArrivalHeading.test.ts`'s own convention.
 */
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

    // Genuine flee: ship caught on the far side of the star from the
    // destination (same fixture as fleeNearEdge.test.ts's near-edge test).
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
    // Sanity: confirm this really is the near-edge escape (not the
    // straight-line edge) — else the fixture wouldn't exercise the bug.
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

    // No preserved position → fresh system-entry warp, the non-flee path.
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
