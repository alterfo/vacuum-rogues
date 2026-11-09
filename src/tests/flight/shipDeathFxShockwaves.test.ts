import { describe, expect, it, vi } from "vitest";

vi.mock("pixi.js", () => ({
  Container: vi.fn().mockImplementation(() => ({
    addChild: vi.fn(),
    removeChild: vi.fn(),
  })),
  Graphics: vi.fn().mockImplementation(() => ({
    eventMode: "auto",
    blendMode: 0,
    zIndex: 0,
    x: 0,
    y: 0,
    parent: null,
    destroyed: false,
    clear: vi.fn().mockReturnThis(),
    circle: vi.fn().mockReturnThis(),
    stroke: vi.fn().mockReturnThis(),
    addChild: vi.fn(),
    removeChild: vi.fn(),
    destroy: vi.fn(),
  })),
  Particle: vi.fn(),
  ParticleContainer: vi.fn(),
}));

vi.mock("@/presentation/gradientTexture", () => ({
  softGlowTexture: () => null,
}));

import { ShipDeathFxRenderer } from "@/presentation/flight/shipDeathFxRenderer";

const gameLayer = {
  addChild: vi.fn(),
  removeChild: vi.fn(),
} as never;

describe("ShipDeathFxRenderer shockwaves", () => {
  it("keeps overlapping shockwaves instead of reusing one ring", () => {
    const renderer = new ShipDeathFxRenderer(gameLayer);
    renderer.spawn(10, 10);
    renderer.spawn(40, 60);
    renderer.update(16);

    const shockwaves = (renderer as unknown as { shockwaves: unknown[] })
      .shockwaves;
    expect(shockwaves.length).toBe(2);
  });

  it("releases expired shockwaves", () => {
    const renderer = new ShipDeathFxRenderer(gameLayer);
    renderer.spawn(10, 10);
    renderer.update(400);

    const shockwaves = (renderer as unknown as { shockwaves: unknown[] })
      .shockwaves;
    expect(shockwaves.length).toBe(0);
  });
});
