import { describe, it, expect, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { SceneType } from "@/types";
import type { StationScene } from "@/presentation/StationScene";
import type { Station } from "@/domain/Station";
import { PlanetManager } from "@/presentation/flight/PlanetManager";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

describe("Bug 8: take-off from a station spawns beside it", () => {
  let harness: RealEngineHarness;

  afterEach(() => {
    harness?.dispose();
  });

  it("undocking spawns the ship near the station, not at the system edge", async () => {
    harness = await RealEngineHarness.boot();
    await harness.newGame();

    const galaxy = harness.galaxy()!;
    const system = galaxy.systems.find(
      (s) => s.id === harness.player()!.currentSystemId,
    )!;
    expect(system.stations.length).toBeGreaterThan(0); // every system has exactly 1 (GalaxySimulator)
    const station = system.stations[0];

    const flightScene = harness.currentScene() as unknown as {
      planetManager: {
        stationMarkers: { station: Station; x: number; y: number }[];
      };
      executeRouteTo(x: number, y: number): void;
      onDockAtStation(station: Station): Promise<void>;
    };
    const marker = flightScene.planetManager.stationMarkers.find(
      (m) => m.station.id === station.id,
    )!;
    expect(marker).toBeDefined();
    (
      flightScene as unknown as {
        planetManager: { routeTargetStationId: string | null };
      }
    ).planetManager.routeTargetStationId = station.id;
    flightScene.executeRouteTo(marker.x, marker.y);

    let docked = false;
    for (let i = 0; i < 2000 && !docked; i++) {
      harness.tick(100);
      docked = harness.currentSceneType() === SceneType.STATION;
    }
    expect(docked).toBe(true);
    expect(harness.currentSceneType()).toBe(SceneType.STATION);

    const stationScene = harness.currentScene() as unknown as StationScene;
    await stationScene.goBack();
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    const arrivedScene = harness.currentScene() as unknown as {
      shipPhysics: { shipX: number; shipY: number } | null;
      planetManager: {
        stationMarkers: { station: Station; x: number; y: number }[];
      };
      starRenderer: { centerX: number; centerY: number };
      SYSTEM_BOUNDARY_RADIUS: number;
    };
    const arrivedMarker = arrivedScene.planetManager.stationMarkers.find(
      (m) => m.station.id === station.id,
    )!;
    expect(arrivedMarker).toBeDefined();
    const phys = arrivedScene.shipPhysics!;

    expect(
      dist(phys.shipX, phys.shipY, arrivedMarker.x, arrivedMarker.y),
    ).toBeLessThanOrEqual(200);

    const distFromCenter = dist(
      phys.shipX,
      phys.shipY,
      arrivedScene.starRenderer.centerX,
      arrivedScene.starRenderer.centerY,
    );
    expect(distFromCenter).toBeLessThan(
      arrivedScene.SYSTEM_BOUNDARY_RADIUS * 0.9,
    );

    expect(harness.errors()).toEqual([]);
  });

  it("undocking from a REPAIR_DOCK (shipyard) also spawns beside it, not at the edge", async () => {
    harness = await RealEngineHarness.boot();
    await harness.newGame();

    const galaxy = harness.galaxy()!;
    const shipyardSystem = galaxy.systems.find((s) =>
      s.stations.some((st) => st.type === "REPAIR_DOCK"),
    )!;
    expect(shipyardSystem).toBeDefined();
    harness.player()!.currentSystemId = shipyardSystem.id;
    await harness.goTo(SceneType.SPACE_FLIGHT);

    const station = shipyardSystem.stations.find(
      (st) => st.type === "REPAIR_DOCK",
    )!;

    const flightScene = harness.currentScene() as unknown as {
      onDockAtStation(station: Station): Promise<void>;
    };
    await flightScene.onDockAtStation(station);
    expect(harness.currentSceneType()).toBe(SceneType.STATION);

    const stationScene = harness.currentScene() as unknown as StationScene;
    await stationScene.goBack();
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    const arrivedScene = harness.currentScene() as unknown as {
      shipPhysics: { shipX: number; shipY: number } | null;
      planetManager: {
        stationMarkers: { station: Station; x: number; y: number }[];
      };
    };
    const arrivedMarker = arrivedScene.planetManager.stationMarkers.find(
      (m) => m.station.id === station.id,
    )!;
    expect(arrivedMarker).toBeDefined();
    const phys = arrivedScene.shipPhysics!;

    expect(
      dist(phys.shipX, phys.shipY, arrivedMarker.x, arrivedMarker.y),
    ).toBeLessThanOrEqual(200);

    expect(harness.errors()).toEqual([]);
  });

  it("take-off from a planet also spawns beside it, not at the system edge", async () => {
    harness = await RealEngineHarness.boot();
    await harness.newGame();

    const flightScene = harness.currentScene() as unknown as {
      e2eLandOnPlanet(): Promise<void>;
    };
    await flightScene.e2eLandOnPlanet();
    expect(harness.currentSceneType()).toBe(SceneType.PLANET);

    const planetScene = harness.currentScene() as unknown as {
      planet?: { id: string };
      e2eTakeOff(): Promise<void>;
    };
    const planetId = planetScene.planet?.id;
    expect(planetId).toBeTruthy();
    await planetScene.e2eTakeOff();
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    const arrivedScene = harness.currentScene() as unknown as {
      shipPhysics: { shipX: number; shipY: number } | null;
      planetManager: {
        planetSprites: {
          planet: { id: string };
          screenX: number;
          screenY: number;
          displayRadius: number;
        }[];
      };
    };
    const sprite = arrivedScene.planetManager.planetSprites.find(
      (s) => s.planet.id === planetId,
    )!;
    expect(sprite).toBeDefined();
    const phys = arrivedScene.shipPhysics!;

    expect(
      dist(phys.shipX, phys.shipY, sprite.screenX, sprite.screenY),
    ).toBeLessThanOrEqual(sprite.displayRadius + 220);

    expect(harness.errors()).toEqual([]);
  });

  it("undocking still spawns beside the station when the live marker lookup misses (lookup-timing race)", async () => {
    harness = await RealEngineHarness.boot();
    await harness.newGame();

    const galaxy = harness.galaxy()!;
    const system = galaxy.systems.find(
      (s) => s.id === harness.player()!.currentSystemId,
    )!;
    const station = system.stations[0];

    const flightScene = harness.currentScene() as unknown as {
      onDockAtStation(station: Station): Promise<void>;
    };
    await flightScene.onDockAtStation(station);
    expect(harness.currentSceneType()).toBe(SceneType.STATION);

    const stationScene = harness.currentScene() as unknown as StationScene;
    const initSpy = vi
      .spyOn(PlanetManager.prototype, "initialize")
      .mockImplementation(() => {});
    try {
      await stationScene.goBack();
    } finally {
      initSpy.mockRestore();
    }
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    const arrivedScene = harness.currentScene() as unknown as {
      shipPhysics: { shipX: number; shipY: number } | null;
      starRenderer: { centerX: number; centerY: number };
      SYSTEM_BOUNDARY_RADIUS: number;
      planetManager: { stationMarkers: unknown[] };
    };
    expect(arrivedScene.planetManager.stationMarkers.length).toBe(0);

    const phys = arrivedScene.shipPhysics!;
    const distFromCenter = dist(
      phys.shipX,
      phys.shipY,
      arrivedScene.starRenderer.centerX,
      arrivedScene.starRenderer.centerY,
    );
    expect(distFromCenter).toBeLessThan(
      arrivedScene.SYSTEM_BOUNDARY_RADIUS * 0.9,
    );

    const expected = {
      x:
        arrivedScene.starRenderer.centerX +
        Math.cos(station.orbitAngle) * station.orbitRadius,
      y:
        arrivedScene.starRenderer.centerY +
        Math.sin(station.orbitAngle) * station.orbitRadius,
    };
    expect(
      dist(phys.shipX, phys.shipY, expected.x, expected.y),
    ).toBeLessThanOrEqual(200);

    expect(harness.errors()).toEqual([]);
  });
});
