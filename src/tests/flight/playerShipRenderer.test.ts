import { describe, it, expect } from "vitest";
import { Container, Graphics } from "pixi.js";
import { PlayerShipRenderer } from "@/presentation/flight/PlayerShipRenderer";
import { ShipPhysics } from "@/systems/ShipPhysics";
import type { Renderer } from "@/presentation/Renderer";

const SHIP_SIZE = 20; // mirrors PlayerShipRenderer.SHIP_SIZE (private)

function makeRenderer(gameLayer: Container): Renderer {
  return {
    app: { screen: { width: 800, height: 600 } },
    stage: new Container(),
    uiLayer: new Container(),
    gameLayer,
  } as unknown as Renderer;
}

function make(): { module: PlayerShipRenderer; gameLayer: Container } {
  const gameLayer = new Container();
  const physics = new ShipPhysics(100, 200, 0.1);
  const module = new PlayerShipRenderer(
    makeRenderer(gameLayer),
    gameLayer,
    physics,
  );
  return { module, gameLayer };
}

interface FillOp {
  action: string;
  data: {
    style?: { alpha?: number };
    path?: { instructions: { action: string; data: unknown[] }[] };
  };
}

function fillCircles(g: Graphics): { r: number; alpha: number }[] {
  const instructions = (g.context as unknown as { instructions: FillOp[] })
    .instructions;
  const out: { r: number; alpha: number }[] = [];
  for (const ins of instructions) {
    if (ins.action !== "fill") continue;
    const alpha = ins.data.style?.alpha ?? 1;
    for (const op of ins.data.path?.instructions ?? []) {
      if (op.action === "circle") out.push({ r: op.data[2] as number, alpha });
    }
  }
  return out;
}

describe("PlayerShipRenderer glow (playtest 2 ⑤: tight halo, not a smear)", () => {
  it("draws a layered radial falloff that hugs the hull", () => {
    const { module } = make();
    module.initialize();

    const container = module.container!;
    const glow = (module as unknown as { shipGlow: Graphics }).shipGlow;
    expect(glow).toBeTruthy();
    expect(container.children.includes(glow)).toBe(true);
    expect(container.getChildIndex(glow)).toBe(0);

    const circles = fillCircles(glow);
    expect(circles.length).toBeGreaterThanOrEqual(3);

    const sorted = [...circles].sort((a, b) => a.r - b.r);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].alpha).toBeLessThanOrEqual(sorted[i - 1].alpha);
    }

    const maxR = Math.max(...circles.map((c) => c.r));
    expect(maxR).toBeLessThanOrEqual(SHIP_SIZE * 1.05);
    expect(maxR).toBeGreaterThan(0);

    module.destroy();
  });

  it("carries NO blur filter on the glow (per-frame blurs removed for FPS)", () => {
    const { module } = make();
    module.initialize();
    const glow = (module as unknown as { shipGlow: Graphics }).shipGlow;
    const filters = Array.isArray(glow.filters)
      ? glow.filters
      : glow.filters
        ? [glow.filters]
        : [];
    expect(filters.length).toBe(0);
    module.destroy();
  });

  it("tears down the glow cleanly on destroy() (no filter to leak)", () => {
    const { module, gameLayer } = make();
    module.initialize();

    module.destroy();

    expect(gameLayer.children.length).toBe(0);
  });
});
