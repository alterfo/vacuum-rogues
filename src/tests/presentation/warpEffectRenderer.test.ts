import { describe, it, expect, vi } from "vitest";
import { Container } from "pixi.js";
import { WarpEffectRenderer } from "@/presentation/flight/WarpEffectRenderer";

/**
 * Spy on (and neutralise) `destroy` for every filter attached to the effect
 * container's children. `Container.destroy({children})` does not release filter
 * GPU textures, so the renderer must dispose them itself — these spies verify it
 * does, guarding against the leak regression.
 */
function spyOnEffectFilters(container: Container): unknown[] {
  const spies: unknown[] = [];
  for (const child of container.children) {
    const fs = (child as unknown as { filters?: unknown }).filters;
    const arr = Array.isArray(fs) ? fs : fs ? [fs] : [];
    for (const filter of arr) {
      spies.push(
        vi
          .spyOn(filter as { destroy: () => void }, "destroy")
          .mockImplementation(() => {}),
      );
    }
  }
  return spies;
}

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

  it("disposes its flash/glow BlurFilters when the animation completes (no GPU leak)", () => {
    const gameLayer = new Container();
    const fx = new WarpEffectRenderer(gameLayer);
    fx.play(0, 0);

    const spies = spyOnEffectFilters(gameLayer.children[0] as Container);
    expect(spies.length).toBeGreaterThan(0); // glow + flash each carry a BlurFilter

    fx.update(1200); // past the 1100ms duration → completes
    expect(fx.isActive).toBe(false);
    for (const s of spies) expect(s).toHaveBeenCalled();
  });

  it("disposes its flash/glow BlurFilters on destroy() (no GPU leak)", () => {
    const gameLayer = new Container();
    const fx = new WarpEffectRenderer(gameLayer);
    fx.play(0, 0);

    const spies = spyOnEffectFilters(gameLayer.children[0] as Container);
    expect(spies.length).toBeGreaterThan(0);

    fx.destroy();
    for (const s of spies) expect(s).toHaveBeenCalled();
  });
});
