import { describe, it, expect, vi } from "vitest";
import { Container, Sprite, Texture, type TilingSprite } from "pixi.js";
import { StarRenderer } from "@/presentation/flight/StarRenderer";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { StarType, type GameMode } from "@/types";
import {
  SUN_CONTACT_HULL_DAMAGE,
  SUN_CONTACT_DAMAGE_INTERVAL_MS,
} from "@/config/balance";

vi.mock("@/presentation/sphereMesh", () => ({ buildSphereMesh: () => null }));

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

  const star = new StarRenderer(renderer, gameEngine, gameLayer);
  return { star, gameLayer };
}

function makeBurnEngine(
  hullHP: number,
  gameMode?: GameMode,
  maxHull = 100,
): {
  engine: GameEngine;
  ship: { hullHP: number; maxHull: number };
} {
  const ship = { hullHP, maxHull };
  const engine = { player: { ship, gameMode } } as unknown as GameEngine;
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

    expect(gameLayer.children.length).toBeGreaterThan(0);

    star.destroy();
  });

  it("runs an update tick and tears down cleanly without leaking children", () => {
    const { star, gameLayer } = makeHarness();
    star.initialize();

    expect(() => star.update(1 / 60, 100)).not.toThrow();
    expect(() => star.destroy()).not.toThrow();

    expect(gameLayer.children.length).toBe(0);
  });

  it("latches the burning toast: fires once entering the star, not every frame", () => {
    const { star } = makeHarness();
    star.initialize();

    const outside = star.updateSunContactDamage(
      1000,
      star.centerX + star.radius + 50,
      star.centerY,
      true,
      1,
    );
    expect(outside).toBe(false);

    const inside = star.updateSunContactDamage(
      1000,
      star.centerX,
      star.centerY,
      true,
      1,
    );
    expect(inside).toBe(true);

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

    star.updateSunContactDamage(
      SUN_CONTACT_DAMAGE_INTERVAL_MS,
      star.centerX,
      star.centerY,
      true,
      1,
    );
    expect(ship.hullHP).toBe(100 - SUN_CONTACT_HULL_DAMAGE);

    star.updateSunContactDamage(
      SUN_CONTACT_DAMAGE_INTERVAL_MS,
      star.centerX,
      star.centerY,
      true,
      2,
    );
    expect(ship.hullHP).toBe(100 - SUN_CONTACT_HULL_DAMAGE * 3);
  });

  it("GOD mode floors the sun-contact burn at the hull floor (never 0)", () => {
    const { engine, ship } = makeBurnEngine(100, "GOD", 100);
    const { star } = makeHarness(engine);

    star.updateSunContactDamage(
      SUN_CONTACT_DAMAGE_INTERVAL_MS * 1000, // enough to drain a NORMAL ship to 0
      star.centerX,
      star.centerY,
      true,
      1,
    );
    expect(ship.hullHP).toBe(5);
  });

  it("NORMAL mode (no gameMode set) still clamps the sun-contact burn to 0", () => {
    const { engine, ship } = makeBurnEngine(100);
    const { star } = makeHarness(engine);

    star.updateSunContactDamage(
      SUN_CONTACT_DAMAGE_INTERVAL_MS * 1000,
      star.centerX,
      star.centerY,
      true,
      1,
    );
    expect(ship.hullHP).toBe(0);
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
    const { star } = makeHarness();

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

    expect(tiling!.mask ?? null).toBeNull();

    const wrapper = tiling!.parent as Container;
    const mask = wrapper.mask as unknown as Container;
    expect(mask).toBeTruthy();
    expect(wrapper.children).toContain(mask);
    expect(tiling!.children).not.toContain(mask);

    star.destroy();
  });

  it("varies the sun tint per systemId even within one StarType (Task 2)", () => {
    const engineFor = (id: string): GameEngine =>
      ({
        player: { currentSystemId: id },
        galaxy: { systems: [{ id, starType: StarType.RED_DWARF }] },
      }) as unknown as GameEngine;

    const tintOf = (id: string): number =>
      (
        makeHarness(engineFor(id)).star as unknown as {
          starTint: () => number;
        }
      ).starTint();

    const a = tintOf("sys-A");
    const b = tintOf("sys-B");
    expect(a).not.toBe(b); // distinct systems → distinct suns
    expect(tintOf("sys-A")).toBe(a); // stable per system
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
