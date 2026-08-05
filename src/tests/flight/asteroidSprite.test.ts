import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Container, Sprite, type Texture } from "pixi.js";
import { AsteroidBelt } from "@/presentation/flight/AsteroidBelt";
import {
  rockTexture,
  ROCK_VARIANT_COUNT,
} from "@/presentation/gradientTexture";
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

function rockTextureSet(): Set<Texture> {
  const set = new Set<Texture>();
  for (let i = 0; i < ROCK_VARIANT_COUNT; i++) {
    const t = rockTexture(i);
    if (t) set.add(t);
  }
  return set;
}

function rockSprites(gameLayer: Container): Sprite[] {
  const rocks = rockTextureSet();
  return fieldContainer(gameLayer).children.filter(
    (c): c is Sprite => c instanceof Sprite && rocks.has(c.texture),
  );
}

describe("AsteroidBelt asteroid rock sprites (Task 3)", () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx()) as never;
  });
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext;
  });

  it("renders drifting asteroids as baked rock-texture sprites", () => {
    const { belt, gameLayer } = makeHarness();
    belt.initialize();

    const rocks = rockSprites(gameLayer);
    expect(rocks.length).toBeGreaterThan(0);
    for (const r of rocks) {
      expect(r).toBeInstanceOf(Sprite);
      expect(r.anchor.x).toBeCloseTo(0.5, 6);
    }

    belt.destroy();
  });

  it("tumbles: a rock sprite's rotation advances as the field updates", () => {
    const rnd = vi.spyOn(Math, "random").mockReturnValue(0.85);
    const { belt, gameLayer } = makeHarness();
    belt.initialize();

    const rock = rockSprites(gameLayer)[0];
    expect(rock).toBeDefined();
    const before = rock.rotation;

    for (let i = 0; i < 5; i++) belt.update(100, 0);

    expect(rock.rotation).not.toBeCloseTo(before, 6);

    rnd.mockRestore();
    belt.destroy();
  });

  it("distinct asteroids vary (rotation/scale not uniform)", () => {
    const { belt, gameLayer } = makeHarness();
    belt.initialize();

    const rocks = rockSprites(gameLayer);
    expect(rocks.length).toBeGreaterThan(1);

    const rotations = new Set(rocks.map((r) => r.rotation));
    const scales = new Set(rocks.map((r) => r.scale.x));
    expect(rotations.size).toBeGreaterThan(1);
    expect(scales.size).toBeGreaterThan(1);

    belt.destroy();
  });

  it("baked rock sprites are torn down with the field (no leak)", () => {
    const { belt, gameLayer } = makeHarness();
    belt.initialize();
    expect(rockSprites(gameLayer).length).toBeGreaterThan(0);

    belt.destroy();
    expect(gameLayer.children.length).toBe(0);
    expect(belt.count).toBe(0);
  });
});
