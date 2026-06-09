import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { AsteroidBelt } from "@/presentation/flight/AsteroidBelt";
import type { Renderer } from "@/presentation/Renderer";

/**
 * Build a minimal Renderer stand-in backed by a real PixiJS Container. The
 * asteroid belt reads `app.screen` dimensions for the field centre and mounts
 * its container on the injected game layer, so a real Container exercises the
 * actual scene-graph wiring without a WebGL context.
 */
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
    // The asteroid container is mounted on the game layer.
    expect(gameLayer.children.length).toBe(1);

    belt.destroy();
  });

  it("runs an update tick and tears down cleanly without leaking children", () => {
    const { belt, gameLayer } = makeHarness();
    belt.initialize();

    expect(() => belt.update(1 / 60, 100)).not.toThrow();
    expect(() => belt.destroy()).not.toThrow();

    // destroy() removes (and destroys) its own container from the layer.
    expect(gameLayer.children.length).toBe(0);
    expect(belt.count).toBe(0);
  });
});
