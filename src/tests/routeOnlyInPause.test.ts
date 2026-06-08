/**
 * Verifies that route building and NPC/planet panel interactions are blocked
 * while a turn is running (isTurnRunning=true).
 *
 * Task 2 guard logic: onPlanetClick and onNpcClick return early when
 * isTurnRunning=true so plannedRoute is never changed mid-turn.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pixi.js and all presentation helpers that import it.
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

import { SpaceFlightScene } from "@/presentation/SpaceFlightScene";
import type { Renderer } from "@/presentation/Renderer";
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
  let scene: SpaceFlightScene;
  let s: Record<string, unknown>;

  beforeEach(() => {
    const renderer = makeMockRenderer();
    scene = new SpaceFlightScene(renderer);
    s = scene as unknown as Record<string, unknown>;

    // Inject minimal private state so onPlanetClick can be called safely.
    s.isTurnRunning = false;
    s.plannedRoute = null;
    s.routeTargetPlanetId = null;
    s.shipPhysics = {
      shipX: 100,
      shipY: 100,
      isMoving: false,
    };
    s.planetSprites = [];
    s.followNpcId = null;
    s.planetInfoPanel = null;
    s.gameEngine = { galaxy: { systems: [] }, player: null };
    // Stub planRouteTo so it doesn't blow up without a full scene.
    s.planRouteTo = vi.fn();
    s.executeRouteTo = vi.fn();
    s.showMessage = vi.fn();
    s.turnHintShown = false;
  });

  it("onPlanetClick sets routeTargetPlanetId when paused", () => {
    s.isTurnRunning = false;
    const planet = makeMockPlanet("p1");

    // Inject a matching sprite so onPlanetClick can find it.
    s.planetSprites = [
      {
        planet,
        screenX: 400,
        screenY: 300,
        displayRadius: 60,
        graphics: { cursor: "pointer" },
        destroy: vi.fn(),
      },
    ];

    (scene as unknown as { onPlanetClick(p: Planet): void }).onPlanetClick(
      planet,
    );

    expect(s.routeTargetPlanetId).toBe("p1");
  });

  it("onPlanetClick does NOT change routeTargetPlanetId when turn is running", () => {
    s.isTurnRunning = true;
    s.routeTargetPlanetId = null;
    const planet = makeMockPlanet("p2");

    (scene as unknown as { onPlanetClick(p: Planet): void }).onPlanetClick(
      planet,
    );

    expect(s.routeTargetPlanetId).toBeNull();
    expect(s.planRouteTo).not.toHaveBeenCalled();
  });

  it("onNpcClick is blocked when turn is running", () => {
    s.isTurnRunning = true;
    s.contactNpcId = null;
    const npc = { id: "npc-1", role: "TRADER", name: "NPC" };
    s.npcSprites = [];
    s.npcContactPanel = null;

    // closeNpcContactPanel must exist to avoid errors when turn is NOT running.
    s.closeNpcContactPanel = vi.fn();

    (scene as unknown as { onNpcClick(n: unknown): void }).onNpcClick(npc);

    // contactNpcId should not be set because onNpcClick returns early.
    expect(s.contactNpcId).toBeNull();
    expect(s.closeNpcContactPanel).not.toHaveBeenCalled();
  });

  it("onNpcClick proceeds normally when turn is paused", () => {
    s.isTurnRunning = false;
    s.contactNpcId = null;
    const npc = { id: "npc-2", role: "TRADER", name: "NPC" };
    s.npcSprites = [];
    s.npcContactPanel = null;
    s.closeNpcContactPanel = vi.fn();
    // Stub NpcContactPanel creation.
    (s as unknown as { npcContactPanel: unknown }).npcContactPanel = null;
    s.gameEngine = {
      playerLoadout: {
        derivedStats: vi.fn().mockReturnValue({ scanPower: 0 }),
      },
      player: { shipX: 0, shipY: 0 },
    };
    // Provide a minimal uiLayer stub on the renderer.
    (
      scene as unknown as { renderer: { uiLayer: { addChild: unknown } } }
    ).renderer.uiLayer.addChild = vi.fn();

    (scene as unknown as { onNpcClick(n: unknown): void }).onNpcClick(npc);

    expect(s.closeNpcContactPanel).toHaveBeenCalled();
    expect(s.contactNpcId).toBe("npc-2");
  });
});
