import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { StarRenderer } from "@/presentation/flight/StarRenderer";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";

/**
 * Build a minimal Renderer stand-in backed by a real PixiJS Container. The star
 * renderer reads `app.screen` dimensions for its centre and adds display objects
 * to the injected game layer, so a real Container exercises the actual
 * scene-graph wiring without a WebGL context.
 */
function makeHarness(): {
  star: StarRenderer;
  gameLayer: Container;
} {
  const stage = new Container();
  const uiLayer = new Container();
  const gameLayer = new Container();

  const renderer = {
    app: { screen: { width: 800, height: 600 } },
    stage,
    uiLayer,
    gameLayer,
  } as unknown as Renderer;

  // No player/galaxy → starMapPrefix() returns undefined, so the procedural sun
  // path runs (no lazy star-map texture, no canvas/sphere-mesh dependency).
  const gameEngine: GameEngine | null = null;

  const star = new StarRenderer(renderer, gameEngine, gameLayer);
  return { star, gameLayer };
}

describe("StarRenderer (extracted FlightModule)", () => {
  it("exposes star geometry derived from the screen centre", () => {
    const { star } = makeHarness();

    expect(typeof star.centerX).toBe("number");
    expect(star.centerX).toBe(400); // 800 / 2
    expect(star.centerY).toBe(300); // 600 / 2
    expect(star.radius).toBeGreaterThan(0);
    expect(star.avoidRadius).toBeGreaterThan(0);
  });

  it("mounts the sun (halo + surface) into the game layer on initialize()", () => {
    const { star, gameLayer } = makeHarness();

    expect(gameLayer.children.length).toBe(0);

    star.initialize();

    // Procedural path adds the halo container and the surface container.
    expect(gameLayer.children.length).toBeGreaterThan(0);

    star.destroy();
  });

  it("runs an update tick and tears down cleanly without leaking children", () => {
    const { star, gameLayer } = makeHarness();
    star.initialize();

    expect(() => star.update(1 / 60, 100)).not.toThrow();
    expect(() => star.destroy()).not.toThrow();

    // destroy() removes (and destroys) its own display objects from the layer.
    expect(gameLayer.children.length).toBe(0);
  });

  it("burns the hull only while the ship is inside the star radius", () => {
    const { star } = makeHarness();
    star.initialize();

    // Far from the star: no contact, no toast.
    const outside = star.updateSunContactDamage(
      1000,
      star.centerX + star.radius + 50,
      star.centerY,
      true,
      1,
    );
    expect(outside).toBe(false);

    // Inside the radius with the turn running: a fresh episode starts → toast.
    const inside = star.updateSunContactDamage(
      1000,
      star.centerX,
      star.centerY,
      true,
      1,
    );
    expect(inside).toBe(true);

    // Still inside on the next frame: latched, so no repeat toast.
    const stillInside = star.updateSunContactDamage(
      1000,
      star.centerX,
      star.centerY,
      true,
      1,
    );
    expect(stillInside).toBe(false);

    star.destroy();
  });
});
