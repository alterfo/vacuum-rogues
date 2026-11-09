import { describe, expect, it, vi } from "vitest";

vi.mock("pixi.js", () => ({
  Graphics: vi.fn().mockImplementation(() => ({
    blendMode: 0,
    eventMode: "auto",
    zIndex: 0,
    clear: vi.fn().mockReturnThis(),
    circle: vi.fn().mockReturnThis(),
    rect: vi.fn().mockReturnThis(),
    stroke: vi.fn().mockReturnThis(),
    fill: vi.fn().mockReturnThis(),
    moveTo: vi.fn().mockReturnThis(),
    lineTo: vi.fn().mockReturnThis(),
    addChild: vi.fn(),
    removeChild: vi.fn(),
    destroy: vi.fn(),
  })),
  Sprite: vi.fn().mockImplementation(() => ({
    x: 0,
    y: 0,
    alpha: 0,
    visible: true,
    rotation: 0,
    tint: 0,
    parent: null,
    texture: null,
    anchor: { set: vi.fn() },
    scale: { set: vi.fn() },
    destroy: vi.fn(),
    removeFromParent: vi.fn(),
  })),
}));

import { ArcadeFx } from "@/presentation/blackHoleArcade/arcadeFx";

const layer = { addChild: vi.fn(), removeChild: vi.fn() } as never;
const art = {
  spark: { width: 64 },
  glow: { width: 64 },
  ring: { width: 64 },
} as never;

describe("ArcadeFx reduced motion", () => {
  it("shakes on a large explosion by default", () => {
    const fx = new ArcadeFx(layer, art);
    fx.handle({ kind: "explosion", x: 0, y: 0, size: 200 } as never, 0, 0);
    expect(fx.shakeMs).toBeGreaterThan(0);
  });

  it("drops shake and flash once reduced motion is on", () => {
    const fx = new ArcadeFx(layer, art);
    fx.setReducedMotion(true);
    fx.handle({ kind: "explosion", x: 0, y: 0, size: 200 } as never, 0, 0);
    expect(fx.shakeMs).toBe(0);
    expect(fx.flash).toBe(0);
  });
});
