/**
 * Space visual cleanup (2026-07-08) — Tasks 2/3.
 *
 * `createTwinkleStars()`/`createNebulae()` mount tinted `Sprite`s of the baked
 * `starPointTexture()`/`nebulaCloudTexture()` when a 2D canvas context is
 * available, falling back to `Graphics` only in jsdom (no canvas). The default
 * `spaceBackgroundLayer.test.ts` harness runs under plain jsdom, so it only ever
 * exercises the `Graphics` fallback branch — this file mocks a real 2D context
 * (mirroring `cometHeadSprite.test.ts`) so the actual Sprite-mounting code (the
 * one production runs) gets asserted too.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Container, Graphics, Sprite } from "pixi.js";

vi.mock("@/presentation/textures", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/presentation/textures")>();
  return {
    ...actual,
    pickVariantKey: vi.fn(() => null),
    pickVariant: vi.fn(() => null),
    loadTextureAsync: vi.fn(async () => null),
  };
});

/** A throwaway Canvas2D context covering only the calls the bakers make. */
function mockCtx(): Record<string, unknown> {
  const grad = { addColorStop: vi.fn() };
  return {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    createRadialGradient: vi.fn(() => grad),
    createLinearGradient: vi.fn(() => grad),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    clip: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  };
}

const realGetContext = HTMLCanvasElement.prototype.getContext;

interface BackgroundInternals {
  twinkleStars: { graphics: Graphics | Sprite }[];
  nebulaLayers: { container: Container }[];
}

describe("SpaceBackgroundLayer sprite-mounting paths (2D context available)", () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx()) as never;
  });
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext;
  });

  async function makeLayer() {
    const { SpaceBackgroundLayer } =
      await import("@/presentation/SpaceBackgroundLayer");
    const stage = new Container();
    const skyContainer = new Container();
    stage.addChild(skyContainer);
    const renderer = {
      app: { screen: { width: 800, height: 600 } },
      stage,
      uiLayer: new Container(),
      gameLayer: new Container(),
    } as unknown as import("@/presentation/Renderer").Renderer;

    return new SpaceBackgroundLayer(
      renderer,
      skyContainer,
      "test-system",
      () => ({ panX: 0, panY: 0, zoom: 1 }),
      () => ({ angle: 0, speed: 0 }),
    );
  }

  it("mounts every twinkle star as a Sprite of the baked starPointTexture, not the Graphics fallback", async () => {
    const layer = await makeLayer();
    layer.initialize();
    const internal = layer as unknown as BackgroundInternals;

    expect(internal.twinkleStars.length).toBeGreaterThan(0);
    for (const star of internal.twinkleStars) {
      expect(star.graphics).toBeInstanceOf(Sprite);
    }

    layer.destroy();
  });

  it("mounts each nebula cloud as a Sprite of the baked nebulaCloudTexture, not the stacked-Graphics fallback", async () => {
    const layer = await makeLayer();
    layer.initialize();
    const internal = layer as unknown as BackgroundInternals;

    expect(internal.nebulaLayers.length).toBeGreaterThan(0);
    for (const cloud of internal.nebulaLayers) {
      expect(cloud.container.children[0]).toBeInstanceOf(Sprite);
    }

    layer.destroy();
  });
});
