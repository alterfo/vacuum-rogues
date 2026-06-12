/**
 * Sprint 3 Task 5: add a ship outline + volumetric glow so the player ship has
 * 3D presence and stays visible against dark space.
 *
 * After initialize() the PlayerShipRenderer must own a `shipGlow` Graphics that
 * is blurred (one filter) and drawn behind the hull. drawShip() must re-stroke
 * the hull polygon so the silhouette has a crisp cyan rim. This guards against a
 * regression that drops the outline or the volumetric glow.
 *
 * Retargeted to PlayerShipRenderer after the SOLID refactor (Task 7) extracted
 * the ship rendering out of SpaceFlightScene.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pixi.js so the renderer can be exercised in jsdom without a real GPU
// context; the Graphics mock records circle/fill/stroke/poly calls for assertion.
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
    parent: null,
    destroyed: false,
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
    Sprite: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      anchor: { set: vi.fn() },
      width: 0,
      height: 0,
      tint: 0xffffff,
      texture: {},
    })),
    BlurFilter: vi.fn().mockImplementation(() => ({
      strength: 0,
      padding: 0,
      resolution: 1,
      destroy: vi.fn(),
    })),
  };
});

vi.mock("@/presentation/textures", () => ({
  pickVariant: vi.fn().mockReturnValue(null),
  pickVariantKey: vi.fn().mockReturnValue(null),
  loadTextureAsync: vi.fn().mockResolvedValue(null),
  tex: vi.fn().mockReturnValue(null),
}));

import { PlayerShipRenderer } from "@/presentation/flight/PlayerShipRenderer";
import type { Renderer } from "@/presentation/Renderer";
import type { ShipPhysics } from "@/systems/ShipPhysics";

type GraphicsMock = {
  circle: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  poly: ReturnType<typeof vi.fn>;
  filters: unknown[];
};

function makeShipPhysics(): ShipPhysics {
  return {
    shipX: 0,
    shipY: 0,
    shipAngle: 0,
    isMoving: false,
    timeScale: 1,
    getDistanceToTarget: () => 0,
    getTargetX: () => 0,
    getTargetY: () => 0,
    teleport: vi.fn(),
  } as unknown as ShipPhysics;
}

describe("shipGlow: outline + volumetric glow give the ship 3D presence", () => {
  let ship: PlayerShipRenderer;
  let physics: ShipPhysics;
  let s: Record<string, unknown>;

  beforeEach(() => {
    const gameLayer = { addChild: vi.fn(), removeChild: vi.fn() };
    const renderer = {
      app: { screen: { width: 800, height: 600 } },
      gameLayer,
    } as unknown as Renderer;
    physics = makeShipPhysics();
    ship = new PlayerShipRenderer(renderer, gameLayer as never, physics);
    s = ship as unknown as Record<string, unknown>;
    ship.initialize();
  });

  it("creates a stacked-fill glow blob behind the ship (no blur filter)", () => {
    const glow = s.shipGlow as GraphicsMock | null;
    expect(glow).not.toBeNull();
    expect(glow).toBeDefined();
    // The glow is filled circles (the volumetric blob)...
    expect(glow!.circle).toHaveBeenCalled();
    expect(glow!.fill).toHaveBeenCalled();
    // ...and carries NO blur filter (per-frame blurs removed for FPS).
    const filters = Array.isArray(glow!.filters) ? glow!.filters : [];
    expect(filters.length).toBe(0);
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
    physics.isMoving = true;
    (ship as unknown as { drawShip(): void }).drawShip();
    expect(g.poly.mock.calls.length).toBeGreaterThan(polyAtRest);
  });

  it("nulls the glow reference on destroy", () => {
    ship.destroy();
    expect(s.shipGlow).toBeNull();
  });
});
