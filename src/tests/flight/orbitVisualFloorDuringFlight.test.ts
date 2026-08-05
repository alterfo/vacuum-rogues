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

function buildScene(physics: Record<string, unknown>) {
  const scene = new SpaceFlightScene(makeRenderer());
  const s = scene as unknown as Record<string, unknown>;
  const galaxy = { gameDays: 0 };
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
  s.pendingWarp = null;
  s.gameEngine = {
    player: { ship: { hullHP: 100, maxHull: 100 } },
    galaxy,
    advanceGalaxyDay: vi.fn(() => {
      galaxy.gameDays++;
    }),
  };
  s.isTurnRunning = true;

  const updateShip = (dt: number) =>
    (scene as unknown as { updateShip(dt: number): void }).updateShip(dt);
  const orbitalVisualDay = () => s.orbitalVisualDay as number;
  const currentDay = () => s.currentDay as number;
  const endTurn = () => (scene as unknown as { endTurn(): void }).endTurn();
  return { s, galaxy, updateShip, orbitalVisualDay, currentDay, endTurn };
}

describe("planet orbit visuals keep pace while the ship is genuinely moving", () => {
  it("a slow-engine flight tops up the orbital-visual day near the wait-turn rate, without inflating gameDays", () => {
    const physics = {
      shipX: 0,
      shipY: 0,
      isMoving: true,
      currentSpeed: 1,
      timeScale: 1,
      update: vi.fn(function (this: { shipX: number }) {
        this.shipX += 2;
      }),
    };
    const { galaxy, updateShip, orbitalVisualDay, currentDay } =
      buildScene(physics);

    const dayBefore = currentDay();
    const visualBefore = orbitalVisualDay();
    for (let i = 0; i < 60; i++) updateShip(16); // 60 x 16ms = 960ms of flight

    expect(galaxy.gameDays).toBe(0);
    expect(currentDay() - dayBefore).toBeLessThan(0.3);
    expect(orbitalVisualDay() - visualBefore).toBeGreaterThan(0.8);
  });

  it("leaves the stationary wait-turn path byte-for-byte unchanged (no double counting)", () => {
    const physics = {
      shipX: 0,
      shipY: 0,
      isMoving: false,
      currentSpeed: 0,
      timeScale: 1,
      update: vi.fn(),
    };
    const { updateShip, orbitalVisualDay, currentDay } = buildScene(physics);

    const dayBefore = currentDay();
    for (let i = 0; i < 60; i++) updateShip(16);

    expect(orbitalVisualDay()).toBe(currentDay());
    expect(currentDay()).toBeGreaterThan(dayBefore);
  });

  it("settles the boost to 0 on endTurn, same as the existing waitDayAccum/distanceTraveled settle", () => {
    const physics = {
      shipX: 0,
      shipY: 0,
      isMoving: true,
      currentSpeed: 1,
      timeScale: 1,
      update: vi.fn(function (this: { shipX: number }) {
        this.shipX += 2;
      }),
      setTarget: vi.fn(),
    };
    const { updateShip, orbitalVisualDay, currentDay, endTurn } =
      buildScene(physics);

    for (let i = 0; i < 60; i++) updateShip(16);
    expect(orbitalVisualDay()).toBeGreaterThan(currentDay());

    endTurn();
    expect(orbitalVisualDay()).toBe(currentDay());
  });

  it("freezes the top-up while the combat active-pause is up (pause freezes orbits with movement)", () => {
    const physics = {
      shipX: 0,
      shipY: 0,
      isMoving: true,
      currentSpeed: 1,
      timeScale: 1,
      update: vi.fn(),
    };
    const { s, updateShip, orbitalVisualDay, currentDay } = buildScene(physics);
    s.combatPause = { paused: true };

    for (let i = 0; i < 60; i++) updateShip(16);

    expect(orbitalVisualDay()).toBe(currentDay());
  });

  it("scales the top-up by ShipPhysics.timeScale (fast-forward spins orbits faster)", () => {
    const physics = {
      shipX: 0,
      shipY: 0,
      isMoving: true,
      currentSpeed: 1,
      timeScale: 2,
      update: vi.fn(function (this: { shipX: number }) {
        this.shipX += 2;
      }),
    };
    const { updateShip, orbitalVisualDay } = buildScene(physics);

    const visualBefore = orbitalVisualDay();
    for (let i = 0; i < 60; i++) updateShip(16); // 960ms at 2× ≈ 1.92 wait-days

    expect(orbitalVisualDay() - visualBefore).toBeGreaterThan(1.6);
  });
});

describe("production wiring guard", () => {
  it("SpaceFlightScene hands PlanetManager the boosted orbitalVisualDay, not plain currentDay", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/presentation/SpaceFlightScene.ts", "utf-8");
    expect(src).toMatch(/getOrbitalDay:\s*\(\)\s*=>\s*this\.orbitalVisualDay/);
  });
});
