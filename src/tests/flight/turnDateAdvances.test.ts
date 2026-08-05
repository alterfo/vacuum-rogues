import { describe, it, expect, vi, afterEach } from "vitest";

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

import { Container, Text } from "pixi.js";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { SpaceFlightScene } from "@/presentation/SpaceFlightScene";
import { FlightHud } from "@/presentation/flight/FlightHud";
import { setFontScale } from "@/utils/fontScale";
import { GAME_BALANCE } from "@/config/balance";

afterEach(() => setFontScale("M")); // never leak a scale into other tests

const DISTANCE_PER_DAY = GAME_BALANCE.pixelsPerDay; // 500 px = 1 game day

function makeRenderer(): Renderer {
  return {
    app: { screen: { width: 800, height: 600 } },
    stage: new Container(),
    uiLayer: new Container(),
    gameLayer: new Container(),
  } as unknown as Renderer;
}

describe("a turn advances sub-day time (the date SOURCE moves)", () => {
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
    };
    s.npcManager = { followNpcId: null, refresh: vi.fn() };
    s.combatModule = { isActive: false };
    s.pendingWarp = null;
    s.gameEngine = {
      player: { ship: { hullHP: 100, maxHull: 100 } },
      galaxy,
      advanceGalaxyDay: vi.fn(() => {
        galaxy.gameDays++;
      }),
    };
    const updateShip = (dt: number) =>
      (scene as unknown as { updateShip(dt: number): void }).updateShip(dt);
    const currentDay = () => s.currentDay as number;
    const expectedDay = () =>
      galaxy.gameDays +
      (s.distanceTraveled as number) / DISTANCE_PER_DAY +
      (s.waitDayAccum as number);
    return { s, galaxy, updateShip, currentDay, expectedDay };
  }

  it("a short moving turn advances the fractional day but NOT the whole-day counter", () => {
    const physics = {
      shipX: 0,
      shipY: 0,
      isMoving: true,
      currentSpeed: 1,
      timeScale: 1,
      update: vi.fn(function (this: { shipX: number }) {
        this.shipX += 120;
      }),
    };
    const { s, galaxy, updateShip, currentDay, expectedDay } =
      buildScene(physics);
    s.isTurnRunning = true;

    const dayBefore = currentDay();
    updateShip(16);
    updateShip(16);
    updateShip(16); // 3 × 120 = 360 px < 500 → still day 0

    expect(galaxy.gameDays).toBe(0); // whole-day counter frozen mid-turn …
    expect(s.distanceTraveled as number).toBeGreaterThan(0); // … but distance accrued
    expect(currentDay()).toBeGreaterThan(dayBefore); // real getter's fractional day advanced
    expect(currentDay()).toBe(expectedDay()); // … and matches the canonical formula
  });

  it("a short wait turn advances the fractional day but NOT the whole-day counter", () => {
    const physics = {
      shipX: 0,
      shipY: 0,
      isMoving: false,
      currentSpeed: 0,
      timeScale: 1,
      update: vi.fn(),
    };
    const { s, galaxy, updateShip, currentDay, expectedDay } =
      buildScene(physics);
    s.isTurnRunning = true;

    const dayBefore = currentDay();
    updateShip(300);
    updateShip(300); // 2 × 300 ms = 0.6 wait-day < 1000 ms/day → still day 0

    expect(galaxy.gameDays).toBe(0); // whole-day counter frozen mid-wait …
    expect(s.waitDayAccum as number).toBeGreaterThan(0); // … but wait-time accrued
    expect(currentDay()).toBeGreaterThan(dayBefore); // real getter's fractional day advanced
    expect(currentDay()).toBe(expectedDay()); // … and matches the canonical formula
  });

  it("a real scene turn moves the real HUD date label (composed end-to-end)", () => {
    const physics = {
      shipX: 0,
      shipY: 0,
      isMoving: true,
      currentSpeed: 1,
      timeScale: 1,
      update: vi.fn(function (this: { shipX: number }) {
        this.shipX += 120;
      }),
    };
    const { s, updateShip, currentDay } = buildScene(physics);
    s.isTurnRunning = true;

    const hudEngine = {
      galaxy: { gameDays: 0 },
      audio: { playUiClick() {}, playUiHover() {}, playToast() {} },
      questManager: {},
      player: { getReputation: () => 0 },
    } as unknown as GameEngine;
    const hud = new FlightHud(makeRenderer(), hudEngine, new Container());
    hud.initialize();
    hud.setDayProvider(() => currentDay()); // mirrors the production wiring shape
    const label = () =>
      (hud as unknown as { dayCounterText: Text }).dayCounterText.text;

    hud.update(16, 0);
    const before = label();
    updateShip(16);
    updateShip(16);
    updateShip(16);
    updateShip(16);
    updateShip(16);
    hud.update(16, 0);

    expect(label()).not.toBe(before); // the rendered label moved, driven by the scene turn
    hud.destroy();
  });
});

describe("the HUD date the player sees advances during a turn", () => {
  function buildHud() {
    const uiLayer = new Container();
    const galaxy: { gameDays: number } = { gameDays: 0 };
    const gameEngine = {
      galaxy,
      audio: {
        playUiClick: () => {},
        playUiHover: () => {},
        playToast: () => {},
      },
      questManager: {},
      player: { getReputation: () => 0 },
    } as unknown as GameEngine;
    const hud = new FlightHud(makeRenderer(), gameEngine, uiLayer);
    hud.initialize();
    const shownDate = () =>
      (hud as unknown as { dayCounterText: Text }).dayCounterText.text;
    const render = (day: number) => {
      galaxy.gameDays = day; // the day-of-turn the HUD has to surface
      hud.update(16, 0);
      return shownDate();
    };
    return { hud, render };
  }

  it("baseline: a whole-day tick visibly changes the date", () => {
    const { hud, render } = buildHud();
    const d0 = render(0);
    const d1 = render(1);
    expect(d1).not.toBe(d0);
    hud.destroy();
  });

  it("sub-day progress within one whole day is not shown (clock removed)", () => {
    const { hud, render } = buildHud();
    const atDayStart = render(5.0);
    const atQuarterDay = render(5.25);
    const atThreeQuarterDay = render(5.75);

    expect(atQuarterDay).toBe(atDayStart);
    expect(atThreeQuarterDay).toBe(atDayStart);
    hud.destroy();
  });
});
