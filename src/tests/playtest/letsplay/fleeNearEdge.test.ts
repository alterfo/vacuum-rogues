/**
 * Three-Year Campaign — Task 9 (iv): a ship committed to fleeing jumps from the
 * NEAREST usable escape edge instead of beelining across the whole system to the
 * exit-direction edge, past its pursuers.
 *
 * The dominant campaign death path (measured in Task 9 (i)–(iii)) was
 * flee-crossing EXPOSURE: `SpaceFlightScene` routed a pending hyperjump to the
 * exit-direction boundary (`centre + exitVector·boundaryRadius`), so a ship
 * fleeing from the far side of the star flew the whole diameter while
 * un-outrunnable interceptors fired the entire crossing. When the warp is
 * re-plotted from a preserved mid-system position (a flee/re-plot,
 * `lastFlightShipPos` set), the escape now fires from the boundary point radially
 * outward from the ship — the shortest crossing to open space. The destination is
 * fixed by `targetSystemId`, so the shorter exit never changes where it arrives.
 *
 * Real-engine tier: boots the real GameEngine, drives the real
 * `StarMapScene.performWarpJumpTo` → `SpaceFlightScene` transition, and inspects
 * the plotted escape route against the live system geometry.
 */
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

  /** Direction (unit vector) from the origin system to `targetId`, in galaxy coords. */
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

    // Read the live system geometry from the flight scene we're in (the star sits
    // at the system centre; the boundary radius is the hyperjump edge).
    const before = flightProbe();
    const center = {
      x: before.starRenderer.centerX,
      y: before.starRenderer.centerY,
    };
    const R = before.SYSTEM_BOUNDARY_RADIUS;

    // Simulate a flee: the ship is caught on the FAR side of the star from the
    // destination. Preserving `lastFlightShipPos` (as returnToStarMap does) makes
    // the re-entered flight scene spawn the ship there — the flee/re-plot path.
    // `lastFlightWasFleeing` is the actual "this was a genuine flee, not a
    // routine star-map trip" signal (`saveShipPosition` sets it from
    // `combatModule.isActive`) — a plain lastFlightShipPos alone no longer
    // triggers the near-edge escape (that was firing on every hyperjump).
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

    // The escape edge sits on the boundary circle...
    expect(Math.hypot(route.x - center.x, route.y - center.y)).toBeCloseTo(
      R,
      0,
    );

    // ...on the SAME side as the ship (opposite the exit direction), NOT the
    // exit-direction far edge the old beeline used.
    const routeDotExit =
      (route.x - center.x) * exit.x + (route.y - center.y) * exit.y;
    expect(routeDotExit).toBeLessThan(0);

    // ...and the crossing to it is far shorter than the old exit-direction edge.
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

    // No lastFlightShipPos → a fresh system-entry warp keeps the established
    // exit-direction routing (the non-flee path is unchanged).
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
