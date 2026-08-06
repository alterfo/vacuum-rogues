import { describe, it, expect, vi } from "vitest";

vi.mock("@/presentation/PlanetSprite", async () => {
  const { Container: PixiContainer, Graphics } = await import("pixi.js");
  return {
    PlanetSprite: class {
      container = new PixiContainer();
      graphics = new Graphics();
      createHitArea(): void {}
      setTooltipHandlers(): void {}
      setOrbitForDay(): void {}
      update(): void {}
      destroy(): void {}
    },
  };
});
vi.mock("@/presentation/PlanetInfoPanel", () => ({
  PlanetInfoPanel: class {
    container = { addChild: (): void => {} };
    destroy(): void {}
  },
}));

import { Container } from "pixi.js";
import type { Renderer } from "@/presentation/Renderer";
import { SpaceFlightScene } from "@/presentation/SpaceFlightScene";

function makeRenderer(): Renderer {
  return {
    app: { screen: { width: 800, height: 600 } },
    stage: new Container(),
    uiLayer: new Container(),
    gameLayer: new Container(),
  } as unknown as Renderer;
}

function buildScene(shipPos: { x: number; y: number }) {
  const scene = new SpaceFlightScene(makeRenderer());
  const s = scene as unknown as Record<string, unknown>;
  const physics = {
    shipX: shipPos.x,
    shipY: shipPos.y,
    isMoving: true,
    currentSpeed: 1,
    timeScale: 1,
    update: vi.fn(function (this: { isMoving: boolean }) {
      this.isMoving = false;
    }),
    setTarget: vi.fn(),
  };
  s.shipPhysics = physics;
  s.hud = { showMessage: vi.fn() };
  s.playerShip = { isArcActive: () => false };
  s.starRenderer = { updateSunContactDamage: () => false };
  s.planetManager = {
    routeTargetStationId: null,
    routeTargetPlanetId: null,
    stationMarkers: [],
    planetSprites: [],
    landingThreshold: () => 0,
    setCursors: vi.fn(),
  };
  s.npcManager = { followNpcId: null, refresh: vi.fn(), setCursors: vi.fn() };
  s.combatModule = { isActive: false };
  s.combatPause = { paused: false };
  s.gameEngine = {
    player: { ship: { hullHP: 100, maxHull: 100 } },
    galaxy: { gameDays: 0 },
    advanceGalaxyDay: vi.fn(),
  };
  s.isTurnRunning = true;
  s.pendingWarp = {
    targetSystemId: "sys_2",
    fuelCost: 10,
    exitVector: { x: 1, y: 0 },
  };
  s.pendingWarpExitPoint = { x: 1000, y: 0 };
  const performWarp = vi.fn(() => Promise.resolve());
  s.performWarp = performWarp;
  const plotRoute = vi.fn();
  s.plotRoute = plotRoute;
  s.flightPathTo = vi.fn((x: number, y: number) => [{ x, y }]);

  const updateShip = (dt: number) =>
    (scene as unknown as { updateShip(dt: number): void }).updateShip(dt);
  return { s, physics, performWarp, plotRoute, updateShip };
}

describe("warp fires only from the system-edge exit point", () => {
  it("does not hyperjump when the ship stops mid-system with a warp pending", () => {
    const { s, performWarp, updateShip } = buildScene({ x: 100, y: 50 });

    updateShip(16);

    expect(performWarp).not.toHaveBeenCalled();
    expect(s.pendingWarp).not.toBeNull();
  });

  it("re-arms the route to the exit point after an interrupted stop", () => {
    const { s, plotRoute, updateShip } = buildScene({ x: 100, y: 50 });

    updateShip(16);

    expect(s.plannedRoute).toEqual({ x: 1000, y: 0 });
    expect(plotRoute).toHaveBeenCalled();
  });

  it("hyperjumps when the ship actually stops at the exit point", () => {
    const { performWarp, updateShip } = buildScene({ x: 995, y: 4 });

    updateShip(16);

    expect(performWarp).toHaveBeenCalledTimes(1);
  });

  it("still hyperjumps on arrival when no exit point was recorded", () => {
    const { s, performWarp, updateShip } = buildScene({ x: 100, y: 50 });
    s.pendingWarpExitPoint = null;

    updateShip(16);

    expect(performWarp).toHaveBeenCalledTimes(1);
  });
});
