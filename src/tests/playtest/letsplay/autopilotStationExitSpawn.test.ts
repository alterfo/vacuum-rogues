import { describe, it, expect, afterEach, vi } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import { SceneType } from "@/types";
import { createLiveSceneController } from "./installAutopilotHook";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

describe("autopilot station exit spawns beside the station, not at the system edge", () => {
  let harness: RealEngineHarness;

  afterEach(() => {
    harness?.dispose();
  });

  it("leaveToFlight after docking places the ship near the station", async () => {
    harness = await RealEngineHarness.boot();
    await harness.newGame();

    const galaxy = harness.galaxy()!;
    const system = galaxy.systems.find(
      (s) => s.id === harness.player()!.currentSystemId,
    )!;
    const station = system.stations[0]!;
    expect(station).toBeDefined();

    await harness.goTo(SceneType.STATION, { station });
    expect(harness.currentSceneType()).toBe(SceneType.STATION);

    const controller = createLiveSceneController(harness.engine);
    await controller.leaveToFlight();
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    const scene = harness.currentScene() as unknown as {
      shipPhysics: { shipX: number; shipY: number } | null;
      planetManager: {
        stationMarkers: { station: { id: string }; x: number; y: number }[];
      };
      starRenderer: { centerX: number; centerY: number };
      SYSTEM_BOUNDARY_RADIUS: number;
    };
    const marker = scene.planetManager.stationMarkers.find(
      (m) => m.station.id === station.id,
    )!;
    expect(marker).toBeDefined();
    const phys = scene.shipPhysics!;

    expect(
      dist(phys.shipX, phys.shipY, marker.x, marker.y),
    ).toBeLessThanOrEqual(200);
    const distFromCenter = dist(
      phys.shipX,
      phys.shipY,
      scene.starRenderer.centerX,
      scene.starRenderer.centerY,
    );
    expect(distFromCenter).toBeLessThan(scene.SYSTEM_BOUNDARY_RADIUS * 0.9);
    expect(harness.errors()).toEqual([]);
  });
});
