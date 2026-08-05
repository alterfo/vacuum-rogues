import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pixi.js", () => {
  const Sprite = vi.fn().mockImplementation((texture?: unknown) => ({
    texture,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    anchor: { set: vi.fn() },
    eventMode: "auto",
    cursor: "auto",
    filters: undefined,
    destroyed: false,
    on: vi.fn(),
    destroy: vi.fn(),
  }));
  const Container = vi.fn().mockImplementation(() => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    x: 0,
    y: 0,
    visible: true,
    eventMode: "auto",
    cursor: "default",
    hitArea: null,
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
  }));
  const Graphics = vi.fn().mockImplementation(() => ({
    rect: vi.fn().mockReturnThis(),
    roundRect: vi.fn().mockReturnThis(),
    circle: vi.fn().mockReturnThis(),
    fill: vi.fn().mockReturnThis(),
    stroke: vi.fn().mockReturnThis(),
    clear: vi.fn().mockReturnThis(),
    addChild: vi.fn(),
    eventMode: "none",
    cursor: "default",
    on: vi.fn(),
    destroy: vi.fn(),
  }));
  const Text = vi.fn().mockImplementation((opts?: { text?: string }) => ({
    text: opts?.text ?? "",
    x: 0,
    y: 0,
    width: 60,
    height: 16,
    style: {},
    visible: true,
    anchor: { set: vi.fn() },
    eventMode: "none",
    cursor: "auto",
    on: vi.fn(),
    destroy: vi.fn(),
  }));
  const Rectangle = vi.fn().mockImplementation(() => ({}));
  return { Sprite, Container, Graphics, Text, Rectangle };
});

vi.mock("@/presentation/textures", () => ({
  panoramaTex: vi.fn(() => ({ width: 4096, height: 2048 })),
  tex: vi.fn(() => ({ width: 4096, height: 2048 })), // resolved backdrop key
  pickVariant: vi.fn(() => undefined), // planet body falls back to gradient
  pickVariantKey: vi.fn(() => undefined), // no surfaces art → panorama fallback
  loadTextureAsync: vi.fn(() => Promise.resolve(undefined)),
}));

import { Graphics } from "pixi.js";
import {
  PlanetScene,
  clampPanoramaX,
  PLANET_BACKDROP_OVERLAY_ALPHA,
} from "@/presentation/PlanetScene";
import type { Renderer } from "@/presentation/Renderer";

interface MockLayer {
  children: unknown[];
  addChild: (c: unknown) => void;
  addChildAt: (c: unknown) => void;
  removeChild: (c: unknown) => void;
}

function makeLayer(): MockLayer {
  const children: unknown[] = [];
  return {
    children,
    addChild: (c) => {
      children.push(c);
    },
    addChildAt: (c) => {
      children.push(c);
    },
    removeChild: (c) => {
      const i = children.indexOf(c);
      if (i !== -1) children.splice(i, 1);
    },
  };
}

function makeRenderer(): {
  renderer: Renderer;
  gameLayer: MockLayer;
  uiLayer: MockLayer;
} {
  const gameLayer = makeLayer();
  const uiLayer = makeLayer();
  const stage = { eventMode: "auto", hitArea: null, on: vi.fn(), off: vi.fn() };
  const renderer = {
    app: { screen: { width: 1280, height: 720 }, stage },
    gameLayer,
    uiLayer,
    clearGameLayer() {
      gameLayer.children.length = 0;
    },
    clearUILayer() {
      uiLayer.children.length = 0;
    },
  } as unknown as Renderer;
  return { renderer, gameLayer, uiLayer };
}

function makeScene(): {
  scene: PlanetScene;
  fields: Record<string, unknown>;
  gameLayer: MockLayer;
  uiLayer: MockLayer;
} {
  const scene = Object.create(PlanetScene.prototype) as PlanetScene;
  const { renderer, gameLayer, uiLayer } = makeRenderer();
  const fields = scene as unknown as Record<string, unknown>;
  fields.renderer = renderer;
  fields.bribed = false;
  fields.gameEngine = {
    galaxy: {
      systems: [
        { id: "sys-1", ownerFaction: "INDEPENDENT", planets: [{ id: "p1" }] },
      ],
    },
    player: {
      reputation: { INDEPENDENT: 0 },
      credits: 1000,
      ship: { hullHP: 80, maxHull: 100, energy: 40, maxEnergy: 50 },
      isHostileTo: () => false,
    },
  };
  fields.planet = {
    id: "p1",
    name: "Тест-планета",
    type: "TERRESTRIAL",
    isHabitable: true,
    capturedBy: null,
    drones: 0,
    market: { availableResources: ["FUEL", "METALS"] },
  };
  return { scene, fields, gameLayer, uiLayer };
}

function callCreateUI(scene: PlanetScene): void {
  (scene as unknown as { createUI(): void }).createUI();
}

describe("PlanetScene backdrop — flat-sprite light parallax (playtest3 F5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mounts a draggable flat panorama sprite as the primary backdrop", () => {
    const { scene, fields, gameLayer } = makeScene();
    callCreateUI(scene);

    const sprite = fields.panoramaSprite as {
      eventMode: string;
      cursor: string;
      filters: unknown;
    } | null;
    expect(sprite).not.toBeNull();
    expect(sprite!.eventMode).toBe("static");
    expect(sprite!.cursor).toBe("grab");
    expect(sprite!.filters).toBeFalsy();
    expect(gameLayer.children).toContain(sprite);
    expect(fields.panoramaWidth as number).toBeGreaterThan(0);
  });

  it("eases the panorama toward the parallax target on update", () => {
    const { scene, fields } = makeScene();
    callCreateUI(scene);

    const sprite = fields.panoramaSprite as { x: number };
    const startX = sprite.x;
    const w = 1280;
    const panW = fields.panoramaWidth as number;
    fields.panoramaTargetX = clampPanoramaX(-1e9, panW, w);
    expect(fields.panoramaTargetX as number).toBeLessThan(startX);

    (scene as unknown as { update(dt: number): void }).update(16);

    expect(sprite.x).toBeLessThan(startX);
    expect(sprite.x).toBeGreaterThanOrEqual(fields.panoramaTargetX as number);
  });

  it("dims the backdrop only lightly so the planet art reads through", () => {
    expect(PLANET_BACKDROP_OVERLAY_ALPHA).toBeLessThanOrEqual(0.4);
    expect(PLANET_BACKDROP_OVERLAY_ALPHA).toBeGreaterThan(0); // still takes the edge off
  });

  it("applies the lighter overlay alpha to the actual backdrop fill", () => {
    const { scene } = makeScene();
    callCreateUI(scene);

    const GraphicsMock = Graphics as unknown as {
      mock: {
        results: Array<{ value: { fill: { mock: { calls: unknown[][] } } } }>;
      };
    };
    const allFillArgs = GraphicsMock.mock.results.flatMap((r) =>
      r.value.fill.mock.calls.map((c) => c[0]),
    );
    expect(
      allFillArgs.some(
        (a) =>
          a != null &&
          typeof a === "object" &&
          (a as { alpha?: number }).alpha === PLANET_BACKDROP_OVERLAY_ALPHA,
      ),
    ).toBe(true);
  });

  it("leaves both layers empty after destroy (no leaked backdrop)", () => {
    const { scene, fields, gameLayer, uiLayer } = makeScene();
    callCreateUI(scene);
    expect(gameLayer.children.length).toBeGreaterThan(0);

    (scene as unknown as { destroy(): void }).destroy();

    expect(gameLayer.children.length).toBe(0);
    expect(uiLayer.children.length).toBe(0);
    expect(fields.panoramaSprite).toBeNull();
  });
});
