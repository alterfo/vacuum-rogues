/**
 * Task 9 (SOLID refactor): PlanetManager owns planet sprites, station markers,
 * the info panel and the route-target state extracted from SpaceFlightScene.
 * These exercise the module directly with mocked PlanetSprite/PlanetInfoPanel so
 * no WebGL/texture context is needed.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

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

// ---------------------------------------------------------------------------
// The hover tooltip surfaces the landing-denial reason. The seam under test is
// the closure PlanetManager hands to PlanetSprite.setTooltipHandlers — it must
// thread this.landingDenial(p) into deps.showPlanetTooltip's 5th arg. Capture
// (overmind / pirate) is tracked per-system on the galaxy, NOT on
// planet.capturedBy, so this can only be verified through the wired manager.
// ---------------------------------------------------------------------------
describe("PlanetManager hover tooltip threads the landing denial", () => {
  function makeHoverHarness(opts: {
    overmind?: boolean;
    pirate?: boolean;
    rep?: number;
  }): { manager: PlanetManager; showPlanetTooltip: Mock } {
    const renderer = makeMockRenderer();
    const showPlanetTooltip = vi.fn();
    const planet = makePlanet("pa");
    const gameEngine = {
      player: {
        currentSystemId: "sys_a",
        getReputation: () => opts.rep ?? 0,
      },
      galaxy: {
        gameDays: 0,
        systems: [
          {
            id: "sys_a",
            planets: [planet],
            stations: [],
            ownerFaction: "INDEPENDENT",
          },
        ],
        isOvermindSystem: (id: string) => !!opts.overmind && id === "sys_a",
        isPirateSystem: (id: string) => !!opts.pirate && id === "sys_a",
      },
      questManager: { getActiveQuestLocations: () => [] },
    } as unknown as GameEngine;
    const deps: PlanetManagerDeps = {
      getShipPhysics: () => ({ shipX: 0, shipY: 0 }) as unknown as ShipPhysics,
      getStarCenter: () => ({ x: 400, y: 300 }),
      isTurnRunning: () => false,
      getOrbitalDay: () => 0,
      showPlanetTooltip,
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
    return { manager, showPlanetTooltip };
  }

  /** Drive the onOver closure the manager registered for the first sprite. */
  function hoverFirstPlanet(manager: PlanetManager): void {
    manager.initialize();
    const sprite = manager.planetSprites[0];
    const onOver = (sprite.setTooltipHandlers as unknown as Mock).mock
      .calls[0][0] as (p: Planet, sx: number, sy: number) => void;
    onOver(sprite.planet, 10, 20);
  }

  it("passes 'overmind' as the 5th arg in an Overmind-held system", () => {
    const { manager, showPlanetTooltip } = makeHoverHarness({ overmind: true });
    hoverFirstPlanet(manager);
    expect(showPlanetTooltip).toHaveBeenCalledTimes(1);
    expect(showPlanetTooltip.mock.calls[0][4]).toBe("overmind");
  });

  it("passes 'pirate-rep' when a pirate system is held without good rep", () => {
    const { manager, showPlanetTooltip } = makeHoverHarness({
      pirate: true,
      rep: -10,
    });
    hoverFirstPlanet(manager);
    expect(showPlanetTooltip.mock.calls[0][4]).toBe("pirate-rep");
  });

  it("passes null when landing is allowed (no capture)", () => {
    const { manager, showPlanetTooltip } = makeHoverHarness({});
    hoverFirstPlanet(manager);
    expect(showPlanetTooltip.mock.calls[0][4]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Playtest4 C: planetLeadPoint leads a pursuit course ahead of an orbiting
// planet. This is the only non-trivial new math on the planet side — the
// px/game-day → px/ms unit conversion feeding the intercept solver. A wrong
// conversion (dropped/inverted scale) would aim wildly off with no other test
// catching it (only the orbital-velocity primitive is pinned elsewhere).
// ---------------------------------------------------------------------------
describe("PlanetManager.planetLeadPoint (playtest4 C lead)", () => {
  function makeLeadManager(
    getShipPhysics: PlanetManagerDeps["getShipPhysics"],
  ): PlanetManager {
    const renderer = makeMockRenderer();
    const gameEngine = {
      player: { currentSystemId: "sys_a" },
      galaxy: {
        gameDays: 0,
        systems: [{ id: "sys_a", planets: [], stations: [] }],
      },
      questManager: { getActiveQuestLocations: () => [] },
    } as unknown as GameEngine;
    const deps: PlanetManagerDeps = {
      getShipPhysics,
      getStarCenter: () => ({ x: 400, y: 300 }),
      isTurnRunning: () => false,
      getOrbitalDay: () => 0,
      showPlanetTooltip: () => {},
      hideTooltip: () => {},
      clearFollow: () => {},
    };
    return new PlanetManager(
      renderer,
      gameEngine,
      renderer.gameLayer,
      renderer.uiLayer,
      deps,
    );
  }

  // A planet drifting +y; a sprite stub exposing only what planetLeadPoint reads.
  const makeDriftingSprite = (vyPerDay: number) =>
    ({
      screenX: 500,
      screenY: 0,
      orbitalVelocityPerDay: () => ({ vx: 0, vy: vyPerDay }),
    }) as unknown as import("@/presentation/PlanetSprite").PlanetSprite;

  it("aims AHEAD of the planet along its orbital drift (not at its current centre)", () => {
    // Ship at origin, faster than the (converted) planet drift → an intercept
    // solves. Planet at (500,0) moving +y at 100 px/game-day.
    const manager = makeLeadManager(
      () =>
        ({
          shipX: 0,
          shipY: 0,
          getMaxSpeed: () => 0.5,
        }) as unknown as ShipPhysics,
    );
    const lead = manager.planetLeadPoint(makeDriftingSprite(100));

    // Pure +y drift → x is unchanged, y leads ahead of the current centre (0).
    // A no-lead implementation would return (500,0); lead.y>0 distinguishes it.
    expect(lead.x).toBeCloseTo(500, 3);
    expect(lead.y).toBeGreaterThan(0);
  });

  it("falls back to the planet's current centre when no ship physics is available", () => {
    const manager = makeLeadManager(() => null);
    const lead = manager.planetLeadPoint(makeDriftingSprite(100));
    expect(lead).toEqual({ x: 500, y: 0 });
  });
});
