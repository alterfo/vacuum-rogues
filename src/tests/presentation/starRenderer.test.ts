import { describe, it, expect, vi } from "vitest";
import { Container, Sprite, Texture, type TilingSprite } from "pixi.js";
import { StarRenderer } from "@/presentation/flight/StarRenderer";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import {
  SUN_CONTACT_HULL_DAMAGE,
  SUN_CONTACT_DAMAGE_INTERVAL_MS,
} from "@/config/balance";

// Force the equirect star-map path onto the TilingSprite fallback: the sphere
// mesh is "unavailable", exactly as in a browser where Mesh construction fails.
// The procedural-sun tests below never call buildSphereMesh, so they are
// unaffected by the mock.
vi.mock("@/presentation/sphereMesh", () => ({ buildSphereMesh: () => null }));

/**
 * Build a minimal Renderer stand-in backed by a real PixiJS Container. The star
 * renderer reads `app.screen` dimensions for its centre and adds display objects
 * to the injected game layer, so a real Container exercises the actual
 * scene-graph wiring without a WebGL context.
 */
function makeHarness(gameEngine: GameEngine | null = null): {
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

  // Default: no player/galaxy → starMapPrefix() returns undefined, so the
  // procedural sun path runs (no lazy star-map texture, no canvas/sphere-mesh
  // dependency). Pass a stub gameEngine to exercise sun-contact hull burning.
  const star = new StarRenderer(renderer, gameEngine, gameLayer);
  return { star, gameLayer };
}

/** A gameEngine stub exposing only the ship whose hull the sun burns. */
function makeBurnEngine(hullHP: number): {
  engine: GameEngine;
  ship: { hullHP: number };
} {
  const ship = { hullHP };
  const engine = { player: { ship } } as unknown as GameEngine;
  return { engine, ship };
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

  it("latches the burning toast: fires once entering the star, not every frame", () => {
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

  it("burns the hull in discrete chunks per damage interval while inside the star", () => {
    const { engine, ship } = makeBurnEngine(100);
    const { star } = makeHarness(engine);

    // One full interval of game time inside the radius → exactly one chunk.
    star.updateSunContactDamage(
      SUN_CONTACT_DAMAGE_INTERVAL_MS,
      star.centerX,
      star.centerY,
      true,
      1,
    );
    expect(ship.hullHP).toBe(100 - SUN_CONTACT_HULL_DAMAGE);

    // timeScale multiplies the accrued game-time: two intervals' worth in one
    // call → two chunks burned.
    star.updateSunContactDamage(
      SUN_CONTACT_DAMAGE_INTERVAL_MS,
      star.centerX,
      star.centerY,
      true,
      2,
    );
    expect(ship.hullHP).toBe(100 - SUN_CONTACT_HULL_DAMAGE * 3);
  });

  it("does not burn the hull while the turn is paused", () => {
    const { engine, ship } = makeBurnEngine(100);
    const { star } = makeHarness(engine);

    star.updateSunContactDamage(
      SUN_CONTACT_DAMAGE_INTERVAL_MS * 4,
      star.centerX,
      star.centerY,
      false, // turn not running
      1,
    );
    expect(ship.hullHP).toBe(100);
  });

  it("masks the tiling-fallback disc via a plain wrapper Container, never the TilingSprite (F4)", () => {
    // Same bug class as the "planets render as rectangles" regression: a
    // TilingSprite's specialised renderer drops a mask assigned to it, so the
    // sun disc renders as its full rectangle. The circular mask must live on a
    // plain wrapper Container instead (see PlanetSprite.buildTilingDisc).
    const { star } = makeHarness();

    // jsdom has no 2D canvas: stub the limb-fade mask builder (Canvas radial
    // gradient) with an empty sprite — the assertions target the tiling wrapper.
    (
      star as unknown as { buildStarLimbMask: (R: number) => Sprite }
    ).buildStarLimbMask = () => new Sprite();

    (
      star as unknown as {
        mountStarMapSurface: (R: number, tex: Texture) => void;
      }
    ).mountStarMapSurface(star.radius, Texture.WHITE);

    const tiling = (star as unknown as { starTiling: TilingSprite | null })
      .starTiling;
    expect(tiling).not.toBeNull();

    // The mask must NOT be on the TilingSprite itself…
    expect(tiling!.mask ?? null).toBeNull();

    // …but on its plain wrapper Container, parented under that same wrapper.
    const wrapper = tiling!.parent as Container;
    const mask = wrapper.mask as unknown as Container;
    expect(mask).toBeTruthy();
    expect(wrapper.children).toContain(mask);
    expect(tiling!.children).not.toContain(mask);

    star.destroy();
  });

  it("does not burn the hull while outside the star radius", () => {
    const { engine, ship } = makeBurnEngine(100);
    const { star } = makeHarness(engine);

    star.updateSunContactDamage(
      SUN_CONTACT_DAMAGE_INTERVAL_MS * 4,
      star.centerX + star.radius + 50,
      star.centerY,
      true,
      1,
    );
    expect(ship.hullHP).toBe(100);
  });
});
