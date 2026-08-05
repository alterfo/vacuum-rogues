import { describe, it, expect } from "vitest";
import { Container, Sprite } from "pixi.js";
import { AsteroidBelt } from "@/presentation/flight/AsteroidBelt";
import { cometHeadTexture } from "@/presentation/gradientTexture";
import type { Renderer } from "@/presentation/Renderer";

function makeHarness(): { belt: AsteroidBelt; gameLayer: Container } {
  const gameLayer = new Container();
  const renderer = {
    app: { screen: { width: 800, height: 600 } },
    gameLayer,
  } as unknown as Renderer;

  const belt = new AsteroidBelt(renderer, gameLayer);
  return { belt, gameLayer };
}

describe("AsteroidBelt (extracted FlightModule)", () => {
  it("spawns a populated field and mounts it on the game layer on initialize()", () => {
    const { belt, gameLayer } = makeHarness();

    expect(belt.count).toBe(0);
    expect(gameLayer.children.length).toBe(0);

    belt.initialize();

    expect(belt.count).toBeGreaterThan(0);
    expect(gameLayer.children.length).toBe(1);

    belt.destroy();
  });

  it("runs an update tick and tears down cleanly without leaking children", () => {
    const { belt, gameLayer } = makeHarness();
    belt.initialize();

    expect(() => belt.update(1 / 60, 100)).not.toThrow();
    expect(() => belt.destroy()).not.toThrow();

    expect(gameLayer.children.length).toBe(0);
    expect(belt.count).toBe(0);
  });

  it("falls back to the minimal drawn nucleus when cometHeadTexture is null (jsdom, no canvas)", () => {
    expect(cometHeadTexture()).toBeNull();

    const { belt, gameLayer } = makeHarness();
    expect(() => belt.initialize()).not.toThrow();

    const fieldContainer = gameLayer.children[0] as Container;
    const sprites = fieldContainer.children.filter(
      (c): c is Sprite => c instanceof Sprite,
    );
    expect(sprites.length).toBe(0);

    belt.destroy();
  });
});
