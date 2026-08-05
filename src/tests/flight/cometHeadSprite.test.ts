import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Container, Sprite } from "pixi.js";
import { AsteroidBelt } from "@/presentation/flight/AsteroidBelt";
import { cometHeadTexture } from "@/presentation/gradientTexture";
import type { Renderer } from "@/presentation/Renderer";

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

function makeHarness(): { belt: AsteroidBelt; gameLayer: Container } {
  const gameLayer = new Container();
  const renderer = {
    app: { screen: { width: 800, height: 600 } },
    gameLayer,
  } as unknown as Renderer;
  return { belt: new AsteroidBelt(renderer, gameLayer), gameLayer };
}

function fieldContainer(gameLayer: Container): Container {
  return gameLayer.children[0] as Container;
}

describe("AsteroidBelt comet head sprites (2D context available)", () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx()) as never;
  });
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext;
  });

  it("builds head + core sprites textured with the baked cometHeadTexture", () => {
    const tex = cometHeadTexture();
    expect(tex).not.toBeNull();

    const { belt, gameLayer } = makeHarness();
    belt.initialize();

    const cometSprites = fieldContainer(gameLayer).children.filter(
      (c): c is Sprite => c instanceof Sprite && c.texture === tex,
    );
    expect(cometSprites.length).toBe(4);
    const scales = new Set(cometSprites.map((s) => s.scale.x));
    expect(scales.size).toBe(2);

    belt.destroy();
  });

  it("rotates head/core sprites so the baked coma bulge (+x offset) points anti-sunward", () => {
    const tex = cometHeadTexture();
    const { belt, gameLayer } = makeHarness();
    belt.initialize();
    const centerX = 400;
    const centerY = 300;

    belt.update(500, 500);

    const cometSprites = fieldContainer(gameLayer).children.filter(
      (c): c is Sprite => c instanceof Sprite && c.texture === tex,
    );
    expect(cometSprites.length).toBe(4); // 2 comets × (head + core)

    for (const sprite of cometSprites) {
      const expectedRotation = Math.atan2(
        sprite.y - centerY,
        sprite.x - centerX,
      );
      expect(sprite.rotation).toBeCloseTo(expectedRotation, 5);
    }

    belt.destroy();
  });
});
