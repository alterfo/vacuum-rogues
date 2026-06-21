/**
 * Natural comet/asteroid rework (2026-06-20) — Task 3.
 *
 * The flat `poly`+crater Graphics rocks are replaced by baked, shaded
 * `rockTexture` Sprites that tumble (rotation advances with dt). Verified here
 * against the real `AsteroidBelt` mounted on a real PixiJS Container:
 *   - each drifting asteroid carries a rock-texture Sprite,
 *   - that sprite's rotation advances as the field updates,
 *   - distinct asteroids vary (no uniform field).
 *
 * `rockTexture` needs a 2D canvas (null in jsdom), so getContext is mocked to a
 * throwaway context — exactly enough for the baked textures to be non-null —
 * while PixiJS Sprite/Container stay real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Container, Sprite, type Texture } from "pixi.js";
import { AsteroidBelt } from "@/presentation/flight/AsteroidBelt";
import {
  rockTexture,
  ROCK_VARIANT_COUNT,
} from "@/presentation/gradientTexture";
import type { Renderer } from "@/presentation/Renderer";

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

function makeHarness(): { belt: AsteroidBelt; gameLayer: Container } {
  const gameLayer = new Container();
  const renderer = {
    app: { screen: { width: 800, height: 600 } },
    gameLayer,
  } as unknown as Renderer;
  return { belt: new AsteroidBelt(renderer, gameLayer), gameLayer };
}

/** The asteroid field container is the single child mounted on the game layer. */
function fieldContainer(gameLayer: Container): Container {
  return gameLayer.children[0] as Container;
}

/** All baked rock-texture variants (a rock sprite's texture is one of these). */
function rockTextureSet(): Set<Texture> {
  const set = new Set<Texture>();
  for (let i = 0; i < ROCK_VARIANT_COUNT; i++) {
    const t = rockTexture(i);
    if (t) set.add(t);
  }
  return set;
}

/** Rock sprites in the field = sprites textured with a baked rock variant. */
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
    // 8 motes, 2 of which are comets → 6 rock asteroids.
    expect(rocks.length).toBeGreaterThan(0);
    for (const r of rocks) {
      expect(r).toBeInstanceOf(Sprite);
      expect(r.anchor.x).toBeCloseTo(0.5, 6);
    }

    belt.destroy();
  });

  it("tumbles: a rock sprite's rotation advances as the field updates", () => {
    // Fixed RNG → a deterministic, non-zero spin so the tumble is observable.
    const rnd = vi.spyOn(Math, "random").mockReturnValue(0.85);
    const { belt, gameLayer } = makeHarness();
    belt.initialize();

    const rock = rockSprites(gameLayer)[0];
    expect(rock).toBeDefined();
    const before = rock.rotation;

    // Several ms-scale ticks (spin is rad/ms; vx/spin in ms units).
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

    // Random per-asteroid rotation + scale → the field is not uniform.
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
