/**
 * Task 9 (SOLID refactor): PlanetManager owns planet sprites, station markers,
 * the info panel and the route-target state extracted from SpaceFlightScene.
 * These exercise the module directly with mocked PlanetSprite/PlanetInfoPanel so
 * no WebGL/texture context is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pixi.js", () => {
  const makeContainer = () => ({
    addChild: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    eventMode: "auto",
    cursor: "pointer",
    zIndex: 0,
    x: 0,
    y: 0,
    on: vi.fn(),
    destroy: vi.fn(),
  });
  return {
    Container: vi.fn().mockImplementation(makeContainer),
    Graphics: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      circle: vi.fn().mockReturnThis(),
      poly: vi.fn().mockReturnThis(),
      fill: vi.fn().mockReturnThis(),
      stroke: vi.fn().mockReturnThis(),
    })),
    Text: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      anchor: { set: vi.fn() },
      text: "",
      style: {},
    })),
  };
});

vi.mock("@/presentation/PlanetSprite", () => ({
  PlanetSprite: vi.fn().mockImplementation((planet) => ({
    planet,
    screenX: 100,
    screenY: 200,
    displayRadius: 60,
    container: { addChild: vi.fn(), children: [], zIndex: 0 },
    graphics: { cursor: "pointer" },
    createHitArea: vi.fn(),
    setTooltipHandlers: vi.fn(),
    setOrbitForDay: vi.fn(),
    update: vi.fn(),
    destroy: vi.fn(),
  })),
}));

vi.mock("@/presentation/PlanetInfoPanel", () => ({
  PlanetInfoPanel: vi.fn().mockImplementation(() => ({
    container: { addChild: vi.fn() },
    destroy: vi.fn(),
  })),
}));

import {
  PlanetManager,
  type PlanetManagerDeps,
} from "@/presentation/flight/PlanetManager";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { Planet } from "@/domain/Planet";

function makeMockRenderer(): Renderer {
  const makeLayer = () => ({
    addChild: vi.fn(),
    removeChild: vi.fn(),
    children: [],
  });
  return {
    app: { screen: { width: 800, height: 600 } },
    gameLayer: makeLayer(),
    uiLayer: makeLayer(),
  } as unknown as Renderer;
}

function makePlanet(id: string): Planet {
  return { id, name: id.toUpperCase() } as unknown as Planet;
}

function makeHarness(planets: Planet[]): {
  manager: PlanetManager;
  gameLayer: { addChild: ReturnType<typeof vi.fn> };
  deps: PlanetManagerDeps;
} {
  const renderer = makeMockRenderer();
  const gameEngine = {
    player: { currentSystemId: "sys_a" },
    galaxy: {
      gameDays: 0,
      systems: [
        { id: "sys_a", planets, stations: [], ownerFaction: "INDEPENDENT" },
      ],
    },
    questManager: { getActiveQuestLocations: () => [] },
  } as unknown as GameEngine;

  const deps: PlanetManagerDeps = {
    getShipPhysics: () => ({ shipX: 0, shipY: 0 }) as unknown as ShipPhysics,
    getStarCenter: () => ({ x: 400, y: 300 }),
    isTurnRunning: () => false,
    getOrbitalDay: () => 0,
    showPlanetTooltip: () => {},
    hideTooltip: () => {},
    clearFollow: () => {},
  };

  const manager = new PlanetManager(
    renderer,
    gameEngine,
    renderer.gameLayer,
    renderer.uiLayer,
    deps,
  );
  return {
    manager,
    gameLayer: renderer.gameLayer as unknown as {
      addChild: ReturnType<typeof vi.fn>;
    },
    deps,
  };
}

describe("PlanetManager", () => {
  let manager: PlanetManager;
  let gameLayer: { addChild: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    ({ manager, gameLayer } = makeHarness([
      makePlanet("pa"),
      makePlanet("pb"),
    ]));
  });

  it("creates one sprite per planet in the current system", () => {
    expect(manager.planetSprites.length).toBe(0);
    manager.initialize();
    expect(manager.planetSprites.length).toBe(2);
    // Each planet disc is mounted on the game layer.
    expect(gameLayer.addChild).toHaveBeenCalledTimes(2);
  });

  it("landingThreshold is the disc radius plus the fixed approach margin", () => {
    manager.initialize();
    const sprite = manager.planetSprites[0];
    expect(manager.landingThreshold(sprite)).toBe(sprite.displayRadius + 60);
  });

  it("getPlanetAt returns the planet whose disc the point falls within (else null)", () => {
    manager.initialize();
    // Sprites are mocked at (100, 200).
    expect(manager.getPlanetAt(100, 200)).not.toBeNull();
    expect(manager.getPlanetAt(5000, 5000)).toBeNull();
    expect(manager.getStationAt(0, 0)).toBeNull();
  });

  it("handlePlanetClick fans the route request out to the scene", () => {
    manager.initialize();
    const requested: string[] = [];
    manager.onPlanetRouteRequested = (id) => requested.push(id);
    manager.handlePlanetClick(manager.planetSprites[0].planet);
    expect(requested).toEqual(["pa"]);
    expect(manager.hasInfoPanel).toBe(true);
  });

  it("update() and destroy() run cleanly and leave no sprites behind", () => {
    manager.initialize();
    expect(() => manager.update(1 / 60, 100)).not.toThrow();
    manager.destroy();
    expect(manager.planetSprites.length).toBe(0);
    expect(manager.stationMarkers.length).toBe(0);
    expect(manager.routeTargetPlanetId).toBeNull();
  });

  it("skips creation when the system has no planets", () => {
    const empty = makeHarness([]);
    empty.manager.initialize();
    expect(empty.manager.planetSprites.length).toBe(0);
  });
});
