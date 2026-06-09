/**
 * Sprint 3 Task 9: undocking from a station / re-entering SPACE_FLIGHT must
 * spawn the ship NEXT TO the body it left (station, else last-landed planet),
 * not fling it to the distant system edge.
 *
 * These exercise the spawn-resolution helpers directly (running the full
 * `initialize()` in jsdom isn't practical — PlanetSprite is mocked there), with
 * a real ShipPhysics so the actual world coordinates are asserted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Minimal pixi.js stub so SpaceFlightScene can be imported & constructed.
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

/** Star is at screen centre (400, 300); ship "spawns" far away at the edge. */
const STAR = { x: 400, y: 300 };
const EDGE = { x: 400, y: 3000 };

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

describe("Task 9: re-entry spawn beside station / landed planet", () => {
  let scene: SpaceFlightScene;
  let s: Record<string, unknown>;

  beforeEach(() => {
    scene = new SpaceFlightScene(makeMockRenderer());
    s = scene as unknown as Record<string, unknown>;
    // Star geometry now lives on the StarRenderer module; the spawn helpers read
    // its centre. Stub it directly since these tests bypass initialize().
    s.starRenderer = { centerX: STAR.x, centerY: STAR.y };
    s.shipPhysics = new ShipPhysics(EDGE.x, EDGE.y, 0.1);
    s.shipContainer = { x: 0, y: 0 };
    // Planet sprites + station markers now live on the PlanetManager module; the
    // spawn helpers read them through it. Stub it directly (these tests bypass
    // initialize(), so the real manager is never constructed).
    s.planetManager = {
      planetSprites: [
        {
          planet: { id: "planet-1" },
          screenX: 700,
          screenY: 300,
          displayRadius: 80,
        },
      ],
      stationMarkers: [{ station: { id: "station-1" }, x: 250, y: 520 }],
    };
  });

  it("spawnShipBeside parks the ship just outside the body, along the star radial", () => {
    (
      scene as unknown as {
        spawnShipBeside(x: number, y: number, r: number, m?: number): void;
      }
    ).spawnShipBeside(700, 300, 80);
    const phys = s.shipPhysics as ShipPhysics;
    // Body is due-east of the star → ship parks further east at radius+margin.
    expect(phys.shipX).toBeCloseTo(700 + 80 + 40, 5);
    expect(phys.shipY).toBeCloseTo(300, 5);
  });

  it("STATION → SPACE_FLIGHT spawns within 200px of the station, not at the edge", () => {
    (
      scene as unknown as { applyReentrySpawn(id?: string): void }
    ).applyReentrySpawn("station-1");
    const phys = s.shipPhysics as ShipPhysics;
    expect(dist(phys.shipX, phys.shipY, 250, 520)).toBeLessThanOrEqual(200);
    expect(dist(phys.shipX, phys.shipY, EDGE.x, EDGE.y)).toBeGreaterThan(200);
  });

  it("falls back to landedPlanetId when there is no station origin (within 200px)", () => {
    const player = { landedPlanetId: "planet-1" as string | null };
    s.gameEngine = { player };
    (
      scene as unknown as { applyReentrySpawn(id?: string): void }
    ).applyReentrySpawn(undefined);
    const phys = s.shipPhysics as ShipPhysics;
    expect(dist(phys.shipX, phys.shipY, 700, 300)).toBeLessThanOrEqual(200);
    // The landing site is consumed so later free-flight entries don't snap back.
    expect(player.landedPlanetId).toBeNull();
  });

  it("leaves the ship at its default spawn when neither station nor landing is known", () => {
    s.gameEngine = { player: { landedPlanetId: null } };
    (
      scene as unknown as { applyReentrySpawn(id?: string): void }
    ).applyReentrySpawn(undefined);
    const phys = s.shipPhysics as ShipPhysics;
    expect(phys.shipX).toBeCloseTo(EDGE.x, 5);
    expect(phys.shipY).toBeCloseTo(EDGE.y, 5);
  });
});
