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

const movingPhysics = () => ({
  shipX: 0,
  shipY: 0,
  isMoving: true,
  currentSpeed: 1,
  timeScale: 1,
  update: vi.fn(function (this: { shipX: number }) {
    this.shipX += 2;
  }),
  setTarget: vi.fn(),
});

describe("planet orbits never jump backward when a turn ends", () => {
  it("keeps the drawn orbital day monotonic across endTurn after a flight", () => {
    const { updateShip, orbitalVisualDay, endTurn } =
      buildScene(movingPhysics());

    for (let i = 0; i < 60; i++) updateShip(16);
    const visualBefore = orbitalVisualDay();
    expect(visualBefore).toBeGreaterThan(0.8);

    endTurn();
    expect(orbitalVisualDay()).toBeGreaterThanOrEqual(visualBefore);
  });

  it("keeps combat-accrued whole days in the drawn orbits when the fight's turn ends", () => {
    const { s, orbitalVisualDay, endTurn } = buildScene(movingPhysics());
    s.waitDayAccum = 3;

    const visualBefore = orbitalVisualDay();
    endTurn();

    expect(orbitalVisualDay()).toBeGreaterThanOrEqual(visualBefore);
  });

  it("never leaks the visual carry into the real calendar or the HUD day", () => {
    const { galaxy, updateShip, currentDay, endTurn } =
      buildScene(movingPhysics());

    for (let i = 0; i < 60; i++) updateShip(16);
    endTurn();

    expect(galaxy.gameDays).toBe(0);
    expect(currentDay()).toBe(0);
  });

  it("stays continuous across repeated turn ends (no per-turn drift backward)", () => {
    const { updateShip, orbitalVisualDay, endTurn } =
      buildScene(movingPhysics());

    let last = orbitalVisualDay();
    for (let turn = 0; turn < 3; turn++) {
      for (let i = 0; i < 20; i++) updateShip(16);
      expect(orbitalVisualDay()).toBeGreaterThanOrEqual(last);
      last = orbitalVisualDay();
      endTurn();
      expect(orbitalVisualDay()).toBeGreaterThanOrEqual(last);
      last = orbitalVisualDay();
    }
  });
});
