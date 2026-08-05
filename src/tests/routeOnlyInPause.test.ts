import { describe, it, expect, vi } from "vitest";

vi.mock("pixi.js", () => {
  const makeContainer = () => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    eventMode: "auto",
    cursor: "pointer",
    sortableChildren: false,
    x: 0,
    y: 0,
    alpha: 1,
    zIndex: 0,
    scale: { set: vi.fn() },
    filters: [],
    hitArea: null,
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
  });
  return {
    Container: vi.fn().mockImplementation(makeContainer),
    Graphics: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      fill: vi.fn().mockReturnThis(),
      rect: vi.fn().mockReturnThis(),
      circle: vi.fn().mockReturnThis(),
      ellipse: vi.fn().mockReturnThis(),
      stroke: vi.fn().mockReturnThis(),
      poly: vi.fn().mockReturnThis(),
      moveTo: vi.fn().mockReturnThis(),
      lineTo: vi.fn().mockReturnThis(),
      clear: vi.fn().mockReturnThis(),
      mask: null,
    })),
    Text: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      anchor: { set: vi.fn() },
      text: "",
      style: { fill: 0, fontFamily: "", fontSize: 12 },
      width: 100,
      height: 20,
    })),
    Sprite: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      anchor: { set: vi.fn() },
      width: 0,
      height: 0,
      tint: 0xffffff,
      mask: null,
      texture: {},
    })),
    TilingSprite: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      tileScale: { set: vi.fn() },
      tilePosition: { x: 0, y: 0 },
      tint: 0xffffff,
      mask: null,
    })),
    BlurFilter: vi.fn().mockImplementation(() => ({
      strength: 0,
      padding: 0,
      resolution: 1,
    })),
    Circle: vi.fn().mockImplementation((x: number, y: number, r: number) => ({
      x,
      y,
      radius: r,
    })),
  };
});

vi.mock("@/presentation/sphereMesh", () => ({
  buildSphereMesh: vi.fn().mockReturnValue(null),
}));

vi.mock("@/presentation/PlanetSprite", () => ({
  PlanetSprite: vi.fn().mockImplementation(() => ({
    planet: {},
    screenX: 400,
    screenY: 300,
    displayRadius: 60,
    container: { addChild: vi.fn(), children: [] },
    graphics: { eventMode: "static", cursor: "pointer", on: vi.fn() },
    destroy: vi.fn(),
    createHitArea: vi.fn(),
    setTooltipHandlers: vi.fn(),
    update: vi.fn(),
    setOrbitForDay: vi.fn(),
  })),
}));

vi.mock("@/presentation/PlanetInfoPanel", () => ({
  PlanetInfoPanel: vi.fn().mockImplementation(() => ({
    container: { addChild: vi.fn() },
    destroy: vi.fn(),
  })),
}));

vi.mock("@/presentation/SystemMiniMap", () => ({
  SystemMiniMap: vi.fn().mockImplementation(() => ({
    container: { addChild: vi.fn() },
    destroy: vi.fn(),
    updateWithSprites: vi.fn(),
  })),
}));

vi.mock("@/presentation/QuestJournalUI", () => ({
  QuestJournalUI: vi.fn().mockImplementation(() => ({
    container: { addChild: vi.fn() },
    destroy: vi.fn(),
  })),
}));

vi.mock("@/presentation/NpcShipSprite", () => ({
  NpcShipSprite: vi.fn().mockImplementation(() => ({
    npc: {},
    x: 0,
    y: 0,
    mapColor: 0xffffff,
    container: { addChild: vi.fn(), cursor: "pointer" },
    destroy: vi.fn(),
    setClickHandler: vi.fn(),
    setHoverHandler: vi.fn(),
    update: vi.fn(),
    updateHitArea: vi.fn(),
  })),
}));

vi.mock("@/presentation/NpcContactPanel", () => ({
  NpcContactPanel: vi.fn().mockImplementation(() => ({
    container: { addChild: vi.fn() },
    destroy: vi.fn(),
  })),
}));

vi.mock("@/presentation/textures", () => ({
  pickVariant: vi.fn().mockReturnValue(null),
  tex: vi.fn().mockReturnValue(null),
}));

vi.mock("@/presentation/cursor", () => ({
  installGameCursors: vi.fn(),
  setCanvasCursor: vi.fn(),
}));

import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import {
  PlanetManager,
  type PlanetManagerDeps,
} from "@/presentation/flight/PlanetManager";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { PlanetSprite } from "@/presentation/PlanetSprite";
import type { Planet } from "@/domain/Planet";

function makeMockRenderer(): Renderer {
  const makeLayer = () => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    eventMode: "auto",
    sortableChildren: false,
    scale: { set: vi.fn() },
    x: 0,
    y: 0,
  });
  return {
    app: {
      screen: { width: 800, height: 600 },
      canvas: Object.assign(document.createElement("canvas"), {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getBoundingClientRect: vi.fn().mockReturnValue({
          left: 0,
          top: 0,
          width: 800,
          height: 600,
        }),
        style: {},
      }),
      stage: {
        eventMode: "static",
        hitArea: null,
        addChild: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      },
    },
    gameLayer: makeLayer(),
    uiLayer: makeLayer(),
    stage: { addChild: vi.fn(), addChildAt: vi.fn() },
    clearGameLayer: vi.fn(),
    clearUILayer: vi.fn(),
  } as unknown as Renderer;
}

function makeMockPlanet(id = "planet-1"): Planet {
  return {
    id,
    name: "TestPlanet",
    type: "TERRAN",
    faction: "OUTLANDERS",
    population: 1000,
    techLevel: 3,
    goods: [],
  } as unknown as Planet;
}

describe("routeOnlyInPause: route blocked while turn is running", () => {
  function makePlanetManager(
    turnRunning: boolean,
    onRoute?: (id: string, x: number, y: number) => void,
  ): PlanetManager {
    const renderer = makeMockRenderer();
    const deps: PlanetManagerDeps = {
      getShipPhysics: () =>
        ({ shipX: 100, shipY: 100 }) as unknown as ShipPhysics,
      getStarCenter: () => ({ x: 400, y: 300 }),
      isTurnRunning: () => turnRunning,
      getOrbitalDay: () => 0,
      showPlanetTooltip: () => {},
      hideTooltip: () => {},
      clearFollow: () => {},
    };
    const gameEngine = {
      galaxy: { systems: [] },
      player: null,
    } as unknown as GameEngine;
    const mgr = new PlanetManager(
      renderer,
      gameEngine,
      renderer.gameLayer,
      renderer.uiLayer,
      deps,
    );
    if (onRoute) mgr.onPlanetRouteRequested = onRoute;
    return mgr;
  }

  it("handlePlanetClick requests a route when paused", () => {
    let routedId: string | null = null;
    const mgr = makePlanetManager(false, (id) => {
      routedId = id;
    });
    const planet = makeMockPlanet("p1");
    mgr.planetSprites = [
      { planet, screenX: 400, screenY: 300, displayRadius: 60 },
    ] as unknown as PlanetSprite[];

    mgr.handlePlanetClick(planet);

    expect(routedId).toBe("p1");
  });

  it("handlePlanetClick does NOT request a route when the turn is running", () => {
    let routed = false;
    const mgr = makePlanetManager(true, () => {
      routed = true;
    });
    const planet = makeMockPlanet("p2");
    mgr.planetSprites = [
      { planet, screenX: 400, screenY: 300, displayRadius: 60 },
    ] as unknown as PlanetSprite[];

    mgr.handlePlanetClick(planet);

    expect(routed).toBe(false);
  });

  function makeNpcManager(turnRunning: boolean): NpcShipManager {
    const renderer = makeMockRenderer();
    const deps: NpcShipManagerDeps = {
      getShipPhysics: () => null,
      getPlanetSprites: () => [],
      getStarCenter: () => ({ x: 0, y: 0 }),
      isTurnRunning: () => turnRunning,
      showMessage: () => {},
      showTooltip: () => {},
      hideTooltip: () => {},
      executeRouteTo: () => {},
      clearRouteTarget: () => {},
      endTurn: () => {},
    };
    const gameEngine = {
      playerLoadout: {
        derivedStats: vi.fn().mockReturnValue({ scanPower: 0 }),
      },
      player: { shipX: 0, shipY: 0 },
    } as unknown as GameEngine;
    return new NpcShipManager(
      renderer,
      gameEngine,
      renderer.gameLayer,
      renderer.uiLayer,
      deps,
    );
  }

  it("onNpcClick opens the contact panel even while the turn is running", () => {
    const mgr = makeNpcManager(true);
    const npc = { id: "npc-1", role: "TRADER", name: "NPC" };

    (mgr as unknown as { onNpcClick(n: unknown): void }).onNpcClick(npc);

    expect(mgr.isContactPanelOpen).toBe(true);
  });

  it("onNpcClick proceeds normally when turn is paused", () => {
    const mgr = makeNpcManager(false);
    const npc = { id: "npc-2", role: "TRADER", name: "NPC" };

    (mgr as unknown as { onNpcClick(n: unknown): void }).onNpcClick(npc);

    expect(mgr.isContactPanelOpen).toBe(true);
    expect(
      (mgr as unknown as { contactNpcId: string | null }).contactNpcId,
    ).toBe("npc-2");
  });
});
