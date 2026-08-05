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

import { SpaceBackgroundLayer } from "@/presentation/SpaceBackgroundLayer";
import type { Renderer } from "@/presentation/Renderer";
import { SeededRNG } from "@/utils/seededRNG";

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

type SwarmLayer = {
  container: {
    rotation: number;
    alpha: number;
    filters: unknown[];
    addChild: { mock: { calls: unknown[][] } };
  };
  rotSpeed: number;
};

describe("swarmGlow: glowing, slowly-spinning cosmic swarms", () => {
  let background: SpaceBackgroundLayer;
  let s: Record<string, unknown>;

  beforeEach(() => {
    const renderer = makeMockRenderer();
    background = new SpaceBackgroundLayer(
      renderer,
      {
        addChild: vi.fn(),
        children: [],
      } as unknown as import("pixi.js").Container,
      "swarm-test",
      () => ({ panX: 0, panY: 0, zoom: 1 }),
      () => null,
    );
    s = background as unknown as Record<string, unknown>;
    s.nebulaeContainer = {
      addChild: vi.fn(),
      children: [] as unknown[],
    };
    const rng = new SeededRNG("swarm-test");
    const palette = [0x3366ff, 0x66ccff, 0xffffff];
    (
      background as unknown as {
        createSwarms(rng: SeededRNG, palette: number[]): void;
      }
    ).createSwarms(rng, palette);
  });

  it("creates at least one swarm layer", () => {
    const layers = s.swarmLayers as SwarmLayer[];
    expect(layers.length).toBeGreaterThan(0);
  });

  it("keeps swarm motes blur-free (per-frame blurs removed for FPS)", () => {
    const layers = s.swarmLayers as SwarmLayer[];
    for (const layer of layers) {
      expect(layer.container.filters.length).toBe(0);
      const moteGraphics = layer.container.addChild.mock.calls[0][0] as {
        filters: unknown[];
      };
      const filters = Array.isArray(moteGraphics.filters)
        ? moteGraphics.filters
        : [];
      expect(filters.length).toBe(0);
    }
  });

  it("gives every swarm a small organic spin (±0.0002 rad/frame)", () => {
    const layers = s.swarmLayers as SwarmLayer[];
    for (const layer of layers) {
      expect(typeof layer.rotSpeed).toBe("number");
      expect(Math.abs(layer.rotSpeed)).toBeLessThanOrEqual(0.0002);
    }
  });

  it("rotates each swarm container by its rotSpeed on update", () => {
    const layers = s.swarmLayers as SwarmLayer[];
    const before = layers.map((l) => l.container.rotation);
    (
      background as unknown as { updateSwarms(bgElapsed: number): void }
    ).updateSwarms(0);
    layers.forEach((layer, i) => {
      expect(layer.container.rotation).toBeCloseTo(
        before[i] + layer.rotSpeed,
        10,
      );
    });
  });
});
