import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { WarpEffectRenderer } from "@/presentation/flight/WarpEffectRenderer";

describe("WarpEffectRenderer (extracted from SpaceFlightScene)", () => {
  it("mounts a single transient effect container on play()", () => {
    const gameLayer = new Container();
    const fx = new WarpEffectRenderer(gameLayer);

    expect(fx.isActive).toBe(false);
    expect(gameLayer.children.length).toBe(0);

    fx.play(100, 200);

    expect(fx.isActive).toBe(true);
    expect(gameLayer.children.length).toBe(1);
    const container = gameLayer.children[0] as Container;
    expect(container.x).toBe(100);
    expect(container.y).toBe(200);
  });

  it("self-disposes once the animation completes (no leaked children)", () => {
    const gameLayer = new Container();
    const fx = new WarpEffectRenderer(gameLayer);
    fx.play(0, 0);

    // Partway through: still active.
    fx.update(500);
    expect(fx.isActive).toBe(true);

    // Past the 1100ms duration: cleaned up.
    fx.update(700);
    expect(fx.isActive).toBe(false);
    expect(gameLayer.children.length).toBe(0);
  });

  it("update() is a no-op with no active effect", () => {
    const gameLayer = new Container();
    const fx = new WarpEffectRenderer(gameLayer);
    expect(() => fx.update(16)).not.toThrow();
    expect(fx.isActive).toBe(false);
  });

  it("destroy() tears down an in-flight effect", () => {
    const gameLayer = new Container();
    const fx = new WarpEffectRenderer(gameLayer);
    fx.play(0, 0);
    fx.destroy();
    expect(fx.isActive).toBe(false);
    expect(gameLayer.children.length).toBe(0);
  });
});
