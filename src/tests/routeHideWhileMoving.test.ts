/**
 * SpaceFlightScene.plotRoute() must clear the route overlay while the turn is
 * running (isTurnRunning=true) and draw it only when paused.
 *
 * Behaviour added in response to user request: "Маршрут во время движения
 * можно не показывать" — the route is a planning aid, not a live tracker.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pixi.js", () => {
  const makeContainer = () => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    eventMode: "auto",
    cursor: "pointer",
    blendMode: "normal",
    sortableChildren: false,
    rotation: 0,
    x: 0,
    y: 0,
    alpha: 1,
    zIndex: 0,
    scale: { set: vi.fn() },
    filters: [],
    hitArea: null,
    mask: null,
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
      bezierCurveTo: vi.fn().mockReturnThis(),
      closePath: vi.fn().mockReturnThis(),
      clear: vi.fn().mockReturnThis(),
    })),
    Text: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      anchor: { set: vi.fn() },
      text: "",
      style: {},
      width: 100,
      height: 20,
    })),
    Sprite: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      anchor: { set: vi.fn() },
      width: 0,
      height: 0,
      tint: 0xffffff,
      texture: {},
    })),
    TilingSprite: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      tileScale: { set: vi.fn() },
      tilePosition: { x: 0, y: 0 },
      tint: 0xffffff,
    })),
    Texture: { from: vi.fn().mockReturnValue({}) },
    BlurFilter: vi.fn().mockImplementation(() => ({ strength: 0, padding: 0 })),
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
vi.mock("@/presentation/PlanetSprite", () => ({ PlanetSprite: vi.fn() }));
vi.mock("@/presentation/PlanetInfoPanel", () => ({ PlanetInfoPanel: vi.fn() }));
vi.mock("@/presentation/SystemMiniMap", () => ({ SystemMiniMap: vi.fn() }));
vi.mock("@/presentation/QuestJournalUI", () => ({ QuestJournalUI: vi.fn() }));
vi.mock("@/presentation/NpcShipSprite", () => ({ NpcShipSprite: vi.fn() }));
vi.mock("@/presentation/NpcContactPanel", () => ({
  NpcContactPanel: vi.fn(),
}));
vi.mock("@/presentation/textures", () => ({
  pickVariant: vi.fn().mockReturnValue(null),
  pickVariantKey: vi.fn().mockReturnValue(null),
  loadTextureAsync: vi.fn().mockResolvedValue(null),
  tex: vi.fn().mockReturnValue(null),
}));
vi.mock("@/presentation/cursor", () => ({
  installGameCursors: vi.fn(),
  setCanvasCursor: vi.fn(),
}));

import { SpaceFlightScene } from "@/presentation/SpaceFlightScene";
import { ShipPhysics } from "@/systems/ShipPhysics";
import type { Renderer } from "@/presentation/Renderer";

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

describe("plotRoute: route overlay visibility while moving", () => {
  let scene: SpaceFlightScene;
  let s: Record<string, unknown>;
  let clearRoute: ReturnType<typeof vi.fn>;
  let drawRoute: ReturnType<typeof vi.fn>;
  let drawDayMarker: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scene = new SpaceFlightScene(makeMockRenderer());
    s = scene as unknown as Record<string, unknown>;
    clearRoute = vi.fn();
    drawRoute = vi.fn();
    drawDayMarker = vi.fn();
    s.routeRenderer = {
      clearRoute,
      drawRoute,
      drawLandingMarker: vi.fn(),
      drawNavigationMarker: vi.fn(),
      drawDayMarker,
    };
    s.shipPhysics = new ShipPhysics(100, 100, 0.1);
    s.plannedRoute = { x: 500, y: 500 };
    s.routePath = [];
    s.planetManager = { getPlanetAt: vi.fn().mockReturnValue(null) };
  });

  it("clears route and returns early while isTurnRunning=true", () => {
    s.isTurnRunning = true;
    (scene as unknown as { plotRoute(): void }).plotRoute();
    expect(clearRoute).toHaveBeenCalledTimes(1);
    expect(drawRoute).not.toHaveBeenCalled();
    expect(drawDayMarker).not.toHaveBeenCalled();
  });

  it("draws route when isTurnRunning=false (paused)", () => {
    s.isTurnRunning = false;
    (scene as unknown as { plotRoute(): void }).plotRoute();
    expect(drawRoute).toHaveBeenCalledTimes(1);
    expect(clearRoute).not.toHaveBeenCalled();
  });

  it("does nothing if plannedRoute is null", () => {
    s.isTurnRunning = false;
    s.plannedRoute = null;
    (scene as unknown as { plotRoute(): void }).plotRoute();
    expect(clearRoute).not.toHaveBeenCalled();
    expect(drawRoute).not.toHaveBeenCalled();
  });
});
