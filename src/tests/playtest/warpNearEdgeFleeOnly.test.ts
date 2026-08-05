import { describe, it, expect, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { SceneType } from "@/types";
import { SYSTEM_GEOMETRY } from "@/config/balance";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

interface FlightPrivates {
  plannedRoute: { x: number; y: number } | null;
}

function screenCenter(harness: RealEngineHarness): { x: number; y: number } {
  const screen = harness.engine.renderer!.app.screen;
  return { x: screen.width / 2, y: screen.height / 2 };
}

describe("Hyperjump near-edge escape fires only on a genuine flee, not every jump", () => {
  let harness: RealEngineHarness;

  afterEach(() => {
    harness?.dispose();
  });

  it("a routine star-map-planned jump exits at the exit-direction edge, ignoring the ship's last position", async () => {
    harness = await RealEngineHarness.boot();
    await harness.newGame();

    const player = harness.player()!;
    const galaxy = harness.galaxy()!;
    const target = galaxy.systems.find((s) => s.id !== player.currentSystemId)!;
    const exitVector = { x: 1, y: 0 }; // destination straight to the "east"

    harness.engine.lastFlightShipPos = { x: -900, y: 0 };
    harness.engine.lastFlightWasFleeing = false;

    await harness.goTo(SceneType.SPACE_FLIGHT, {
      pendingWarp: { targetSystemId: target.id, fuelCost: 0, exitVector },
    });

    const scene = harness.currentScene() as unknown as FlightPrivates;
    expect(scene.plannedRoute).not.toBeNull();
    const center = screenCenter(harness);
    expect(scene.plannedRoute!.x).toBeCloseTo(
      center.x + exitVector.x * SYSTEM_GEOMETRY.boundaryRadius,
      -1,
    );
    expect(scene.plannedRoute!.y).toBeCloseTo(
      center.y + exitVector.y * SYSTEM_GEOMETRY.boundaryRadius,
      -1,
    );
    expect(harness.errors()).toEqual([]);
  });

  it("a genuine mid-fight flee/re-plot exits at the near edge (radially out from the ship)", async () => {
    harness = await RealEngineHarness.boot();
    await harness.newGame();

    const player = harness.player()!;
    const galaxy = harness.galaxy()!;
    const target = galaxy.systems.find((s) => s.id !== player.currentSystemId)!;
    const exitVector = { x: 1, y: 0 };

    harness.engine.lastFlightShipPos = { x: -900, y: 0 };
    harness.engine.lastFlightWasFleeing = true;

    await harness.goTo(SceneType.SPACE_FLIGHT, {
      pendingWarp: { targetSystemId: target.id, fuelCost: 0, exitVector },
    });

    const scene = harness.currentScene() as unknown as FlightPrivates;
    expect(scene.plannedRoute).not.toBeNull();
    const center = screenCenter(harness);
    const farEdgeX = center.x + exitVector.x * SYSTEM_GEOMETRY.boundaryRadius;
    expect(scene.plannedRoute!.x).not.toBeCloseTo(farEdgeX, -1);
    expect(harness.errors()).toEqual([]);
  });
});
