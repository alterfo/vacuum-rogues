import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { OrbitRenderer } from "@/presentation/flight/OrbitRenderer";
import type { Renderer } from "@/presentation/Renderer";
import type { Galaxy } from "@/domain/Galaxy";

/**
 * Build a minimal Renderer stand-in backed by a real PixiJS Container. The
 * orbit renderer reads `app.screen` dimensions for the field centre and mounts
 * its graphics on the injected game layer, so a real Container exercises the
 * actual scene-graph wiring without a WebGL context.
 */
function makeRenderer(gameLayer: Container): Renderer {
  return {
    app: { screen: { width: 800, height: 600 } },
    gameLayer,
  } as unknown as Renderer;
}

/** Galaxy stub with a single system carrying planets at given orbital radii. */
function makeGalaxy(systemId: string, radii: number[]): Galaxy {
  return {
    systems: [
      {
        id: systemId,
        planets: radii.map((orbitalRadius, i) => ({
          id: `p${i}`,
          orbitalRadius,
        })),
      },
    ],
  } as unknown as Galaxy;
}

describe("OrbitRenderer (extracted FlightModule)", () => {
  it("draws orbit circles + boundary ring on the game layer on initialize()", () => {
    const gameLayer = new Container();
    const renderer = makeRenderer(gameLayer);
    // Two planets share one radius → one unique orbit-graphics + one boundary.
    const galaxy = makeGalaxy("sys-1", [1000, 2000, 1000]);
    const orbits = new OrbitRenderer(renderer, gameLayer, galaxy, "sys-1");

    expect(gameLayer.children.length).toBe(0);

    orbits.initialize();

    // A single container is mounted on the game layer...
    expect(gameLayer.children.length).toBe(1);
    // ...holding the orbit-graphics object + the boundary ring.
    expect((gameLayer.children[0] as Container).children.length).toBe(2);

    orbits.destroy();
    expect(gameLayer.children.length).toBe(0);
  });

  it("draws only the boundary ring when the system has no planets", () => {
    const gameLayer = new Container();
    const renderer = makeRenderer(gameLayer);
    const galaxy = makeGalaxy("sys-1", []);
    const orbits = new OrbitRenderer(renderer, gameLayer, galaxy, "sys-1");

    orbits.initialize();

    // No orbit circles (no planets) but the boundary ring is always drawn.
    expect(gameLayer.children.length).toBe(1);
    expect((gameLayer.children[0] as Container).children.length).toBe(1);

    orbits.destroy();
    expect(gameLayer.children.length).toBe(0);
  });

  it("runs a no-op update and tears down cleanly without leaking children", () => {
    const gameLayer = new Container();
    const renderer = makeRenderer(gameLayer);
    const galaxy = makeGalaxy("sys-1", [1500]);
    const orbits = new OrbitRenderer(renderer, gameLayer, galaxy, "sys-1");
    orbits.initialize();

    expect(() => orbits.update(1 / 60, 100)).not.toThrow();
    expect(() => orbits.destroy()).not.toThrow();

    expect(gameLayer.children.length).toBe(0);
  });

  it("tolerates a null galaxy (draws only the boundary ring)", () => {
    const gameLayer = new Container();
    const renderer = makeRenderer(gameLayer);
    const orbits = new OrbitRenderer(renderer, gameLayer, null, "sys-1");

    orbits.initialize();

    expect(gameLayer.children.length).toBe(1);
    expect((gameLayer.children[0] as Container).children.length).toBe(1);

    orbits.destroy();
    expect(gameLayer.children.length).toBe(0);
  });
});
