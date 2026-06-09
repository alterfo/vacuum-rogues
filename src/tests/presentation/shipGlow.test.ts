/**
 * Sprint 3 Task 5: add a ship outline + volumetric glow so the player ship has
 * 3D presence and stays visible against dark space.
 *
 * After createShip() the scene must own a `shipGlow` Graphics that is blurred
 * (one filter) and drawn behind the hull. drawShip() must re-stroke the hull
 * polygon so the silhouette has a crisp cyan rim. This guards against a
 * regression that drops the outline or the volumetric glow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirror the pixi.js + presentation mocks from starHalo.test.ts so the
// SpaceFlightScene can be constructed in jsdom without a real renderer.
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
    pivot: { set: vi.fn() },
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
      texture: {},
    })),
    TilingSprite: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      tileScale: { set: vi.fn() },
      tilePosition: { x: 0, y: 0 },
      tint: 0xffffff,
    })),
    Texture: { from: vi.fn().mockReturnValue({}) },
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

vi.mock("@/presentation/PlanetSprite", () => ({ PlanetSprite: vi.fn() }));
vi.mock("@/presentation/PlanetInfoPanel", () => ({ PlanetInfoPanel: vi.fn() }));
vi.mock("@/presentation/SystemMiniMap", () => ({ SystemMiniMap: vi.fn() }));
vi.mock("@/presentation/QuestJournalUI", () => ({ QuestJournalUI: vi.fn() }));
vi.mock("@/presentation/NpcShipSprite", () => ({ NpcShipSprite: vi.fn() }));
vi.mock("@/presentation/NpcContactPanel", () => ({ NpcContactPanel: vi.fn() }));

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
        getBoundingClientRect: vi
          .fn()
          .mockReturnValue({ left: 0, top: 0, width: 800, height: 600 }),
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

type GraphicsMock = {
  circle: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  poly: ReturnType<typeof vi.fn>;
  filters: unknown[];
};

describe("shipGlow: outline + volumetric glow give the ship 3D presence", () => {
  let scene: SpaceFlightScene;
  let s: Record<string, unknown>;

  beforeEach(() => {
    scene = new SpaceFlightScene(makeMockRenderer());
    s = scene as unknown as Record<string, unknown>;
    // createShip returns early without ship physics; supply a minimal stub.
    s.shipPhysics = { shipX: 0, shipY: 0, isMoving: false };
    (scene as unknown as { createShip(): void }).createShip();
  });

  it("creates a blurred glow blob behind the ship", () => {
    const glow = s.shipGlow as GraphicsMock | null;
    expect(glow).not.toBeNull();
    expect(glow).toBeDefined();
    // The glow is a filled circle (the volumetric blob)...
    expect(glow!.circle).toHaveBeenCalled();
    expect(glow!.fill).toHaveBeenCalled();
    // ...with exactly one blur filter applied.
    expect(Array.isArray(glow!.filters)).toBe(true);
    expect(glow!.filters.length).toBe(1);
  });

  it("re-strokes the procedural hull for a crisp rim outline", () => {
    const g = s.shipGraphics as GraphicsMock;
    // Procedural path (no ship texture in the mock): hull is filled AND stroked.
    expect(g.poly).toHaveBeenCalled();
    expect(g.fill).toHaveBeenCalled();
    expect(g.stroke).toHaveBeenCalled();
  });

  it("draws an engine flame only while moving", () => {
    const g = s.shipGraphics as GraphicsMock;
    const polyAtRest = g.poly.mock.calls.length;
    // While moving, drawShip adds the engine-glow polygon → more poly calls.
    (s.shipPhysics as { isMoving: boolean }).isMoving = true;
    (scene as unknown as { drawShip(): void }).drawShip();
    expect(g.poly.mock.calls.length).toBeGreaterThan(polyAtRest);
  });

  it("nulls the glow reference on destroy", () => {
    (scene as unknown as { destroy(): void }).destroy();
    expect(s.shipGlow).toBeNull();
  });
});
