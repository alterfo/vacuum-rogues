/**
 * Playtest 2 finding ⑤: the player-ship glow read as a flat oversized smear —
 * a single big circle (radius ~SHIP_SIZE·1.6) blown out by a strength-8 blur,
 * so the halo dwarfed the hull.
 *
 * Contract under test: the glow is a TIGHT radial falloff that hugs the hull —
 * several concentric circles with decreasing alpha (brightest centre, faint
 * rim) and an outer radius that does not balloon past the hull. The module also
 * mounts/destroys its display objects cleanly and disposes its blur filter
 * (filter GPU textures are not released by Container.destroy()).
 *
 * Uses real PixiJS Graphics and reads the recorded GraphicsContext instructions
 * (no WebGL needed). In jsdom no ship textures are cached, so the procedural
 * triangle path runs (shipSprite === null) and the glow uses the triangle radius.
 */
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

/** The filled circles recorded in a Graphics context, as {r, alpha} pairs. */
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
    // Glow is behind the hull: a child of the ship container, drawn first.
    expect(container.children.includes(glow)).toBe(true);
    expect(container.getChildIndex(glow)).toBe(0);

    const circles = fillCircles(glow);
    // Layered falloff, not a single big circle (the old smear was exactly one).
    expect(circles.length).toBeGreaterThanOrEqual(3);

    // Alpha decreases outward: the largest radius is the faintest.
    const sorted = [...circles].sort((a, b) => a.r - b.r);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].alpha).toBeLessThanOrEqual(sorted[i - 1].alpha);
    }

    // Tight: the outer radius hugs the hull and never balloons. The procedural
    // triangle hull reaches SHIP_SIZE in front, so cap the halo near that.
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
