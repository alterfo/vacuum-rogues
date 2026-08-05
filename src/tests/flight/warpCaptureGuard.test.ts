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

function buildFlightScene() {
  const scene = new SpaceFlightScene(makeRenderer());
  const s = scene as unknown as Record<string, unknown>;
  const recordLiveFlightPos = vi.fn();
  s.shipPhysics = {
    shipX: 0,
    shipY: 0,
    isMoving: false,
    currentSpeed: 0,
    timeScale: 1,
    update: vi.fn(),
  };
  s.asteroidBelt = { update: vi.fn() };
  s.starRenderer = {
    update: vi.fn(),
    updateSunContactDamage: () => false,
    centerX: 0,
    centerY: 0,
  };
  s.warpFx = { update: vi.fn() };
  s.playerShip = { isArcActive: () => false, update: vi.fn() };
  s.camera = { update: vi.fn() };
  s.npcManager = {
    updateCombat: vi.fn(),
    update: vi.fn(),
    refresh: vi.fn(),
    followNpcId: null,
    getNpcDots: () => [],
  };
  s.combatModule = { isActive: false, update: vi.fn() };
  s.planetManager = {
    update: vi.fn(),
    routeTargetStationId: null,
    routeTargetPlanetId: null,
    planetSprites: [],
    stationMarkers: [],
    landingThreshold: () => 0,
  };
  s.hud = {
    miniMap: undefined,
    setTurnRunning: vi.fn(),
    update: vi.fn(),
    showMessage: vi.fn(),
  };
  s.combatPause = { paused: false };
  s.pendingWarp = null;
  s.isTurnRunning = false;
  s.flightAutosave = { accumMs: 0, lastPos: null };
  s.gameEngine = {
    recordLiveFlightPos,
    player: { ship: { hullHP: 100, maxHull: 100 } },
    galaxy: { gameDays: 0 },
  };
  const update = (dt: number) =>
    (scene as unknown as { update(dt: number): void }).update(dt);
  return { s, update, recordLiveFlightPos };
}

describe("warp-window live-capture guard", () => {
  it("does NOT capture the live position while warpInProgress (stale edge coords)", () => {
    const { s, update, recordLiveFlightPos } = buildFlightScene();
    s.warpInProgress = true; // hyperjump in flight, new systemId already set

    update(16);

    expect(recordLiveFlightPos).not.toHaveBeenCalled();
  });

  it("captures the live position during normal flight (positive control)", () => {
    const { s, update, recordLiveFlightPos } = buildFlightScene();
    s.warpInProgress = false;

    update(16);

    expect(recordLiveFlightPos).toHaveBeenCalled();
  });
});
