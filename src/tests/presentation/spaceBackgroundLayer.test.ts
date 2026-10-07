import { describe, it, expect, vi } from "vitest";
import { Container, Graphics, Texture } from "pixi.js";
import {
  SpaceBackgroundLayer,
  type BackgroundCamera,
  type BackgroundShipVelocity,
} from "@/presentation/SpaceBackgroundLayer";
import type { Renderer } from "@/presentation/Renderer";
import { BACKGROUND_DIM } from "@/config/balance";

vi.mock("@/presentation/textures", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/presentation/textures")>();
  return {
    ...actual,
    pickVariantKey: vi.fn(() => "nebula/test_backdrop"),
    pickVariant: vi.fn(() => Texture.WHITE),
    loadTextureAsync: vi.fn(async () => null),
  };
});

function makeHarness(): {
  layer: SpaceBackgroundLayer;
  stage: Container;
  uiLayer: Container;
  gameLayer: Container;
  skyContainer: Container;
} {
  const stage = new Container();
  const uiLayer = new Container();
  const gameLayer = new Container();
  const skyContainer = new Container();
  stage.addChild(skyContainer);

  const renderer = {
    app: { screen: { width: 800, height: 600 } },
    stage,
    uiLayer,
    gameLayer,
  } as unknown as Renderer;

  const camera: BackgroundCamera = { panX: 0, panY: 0, zoom: 1 };
  const velocity: BackgroundShipVelocity = { angle: 0, speed: 0 };

  const layer = new SpaceBackgroundLayer(
    renderer,
    skyContainer,
    "test-system",
    () => camera,
    () => velocity,
  );

  return { layer, stage, uiLayer, gameLayer, skyContainer };
}

interface BackgroundInternals {
  twinkleStars: unknown[];
  swarmLayers: unknown[];
  starLayers: unknown[];
  dimmer: Graphics | null;
  nebulaLayers: { container: { x: number; y: number } }[];
  nebulaeContainer: Container | null;
}

describe("SpaceBackgroundLayer (extracted FlightModule)", () => {
  it("populates twinkle stars and swarms after initialize()", () => {
    const { layer } = makeHarness();
    const internal = layer as unknown as BackgroundInternals;

    expect(internal.twinkleStars.length).toBe(0);
    expect(internal.swarmLayers.length).toBe(0);

    layer.initialize();

    expect(internal.twinkleStars.length).toBeGreaterThan(0);
    expect(internal.swarmLayers.length).toBeGreaterThan(0);
    expect(internal.starLayers.length).toBeGreaterThan(0);

    layer.destroy();
  });

  it("mounts the sky/mid-ground/UI display objects into the injected layers", () => {
    const { layer, stage, uiLayer, skyContainer } = makeHarness();

    layer.initialize();

    expect(skyContainer.children.length).toBeGreaterThan(0);
    expect(stage.children.length).toBeGreaterThan(1);
    expect(uiLayer.children.length).toBeGreaterThan(0);

    layer.destroy();
  });

  it("mounts a readability dimmer above all sky content at BACKGROUND_DIM strength (F2)", () => {
    const { layer, gameLayer, skyContainer } = makeHarness();
    layer.initialize();

    const internal = layer as unknown as BackgroundInternals;
    const dimmer = internal.dimmer;
    expect(dimmer).not.toBeNull();
    expect(dimmer!.parent).toBe(skyContainer);
    expect(skyContainer.getChildIndex(dimmer!)).toBe(
      skyContainer.children.length - 1,
    );
    expect(dimmer!.alpha).toBeCloseTo(BACKGROUND_DIM);

    layer.destroy();
    expect(gameLayer.children.length).toBe(0);
    expect(internal.dimmer).toBeNull();
  });

  it("idle motion moves the nebula layers each frame", () => {
    const moving = makeHarness();
    moving.layer.initialize();
    const movingInternal = moving.layer as unknown as BackgroundInternals;
    const before = movingInternal.nebulaLayers.map((n) => ({
      x: n.container.x,
      y: n.container.y,
    }));
    moving.layer.update(1000, 1000);
    const movedDelta = movingInternal.nebulaLayers.reduce(
      (sum, n, i) =>
        sum +
        Math.abs(n.container.x - before[i].x) +
        Math.abs(n.container.y - before[i].y),
      0,
    );
    expect(movedDelta).toBeGreaterThan(0);
    moving.layer.destroy();
  });

  it("runs an update tick and tears down cleanly without throwing", () => {
    const { layer } = makeHarness();
    layer.initialize();

    expect(() => layer.update(1 / 60, 100)).not.toThrow();
    expect(() => layer.destroy()).not.toThrow();

    const internal = layer as unknown as BackgroundInternals;
    expect(internal.twinkleStars.length).toBe(0);
    expect(internal.swarmLayers.length).toBe(0);
  });

  it("renders a dense starfield: parallax dot layers total well over 6000 stars, twinkle stars over 150 (F15)", () => {
    const { layer } = makeHarness();
    layer.initialize();
    const internal = layer as unknown as BackgroundInternals;
    const starLayers = internal.starLayers as { container: Container }[];

    const totalDots = starLayers.reduce(
      (sum, l) => sum + l.container.children.length,
      0,
    );
    expect(totalDots).toBeGreaterThan(6000);
    expect(internal.twinkleStars.length).toBeGreaterThan(150);

    layer.destroy();
  });

  it("builds nebula clouds via the Graphics fallback when no 2D canvas context is available", () => {
    const { layer } = makeHarness();
    layer.initialize();
    const internal = layer as unknown as BackgroundInternals;
    expect(internal.nebulaeContainer).not.toBeNull();
    expect(internal.nebulaeContainer!.children.length).toBeGreaterThan(0);
    layer.destroy();
  });
});
