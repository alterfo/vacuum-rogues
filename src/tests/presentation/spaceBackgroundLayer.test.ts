import { describe, it, expect, vi } from "vitest";
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import {
  SpaceBackgroundLayer,
  type BackgroundCamera,
  type BackgroundShipVelocity,
} from "@/presentation/SpaceBackgroundLayer";
import type { Renderer } from "@/presentation/Renderer";
import { BACKGROUND_DIM } from "@/config/balance";

// Make the lazy nebula backdrop resolve synchronously from the "cache", so the
// real mount path (`skyContainer.addChildAt(bg, 0)`) runs during initialize()
// and its ordering relative to the F2 dimmer can be asserted (in production
// the texture loads async; jsdom would otherwise never mount it).
vi.mock("@/presentation/textures", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/presentation/textures")>();
  return {
    ...actual,
    pickVariantKey: vi.fn(() => "nebula/test_backdrop"),
    pickVariant: vi.fn(() => Texture.WHITE),
    loadTextureAsync: vi.fn(async () => null),
  };
});

/**
 * Build a minimal Renderer stand-in backed by real PixiJS Containers. The
 * background layer only reads `app.screen` dimensions and adds display objects
 * to `stage`/`uiLayer`, so real Containers exercise the actual scene-graph
 * wiring without a WebGL context.
 */
function makeHarness(): {
  layer: SpaceBackgroundLayer;
  stage: Container;
  uiLayer: Container;
  gameLayer: Container;
  skyContainer: Container;
} {
  const stage = new Container();
  const uiLayer = new Container();
  const gameLayer = new Container();
  const skyContainer = new Container();
  // SpaceBackgroundLayer inserts the mid-ground container just above the sky, so
  // the sky must already live in the stage for getChildIndex() to resolve.
  stage.addChild(skyContainer);

  const renderer = {
    app: { screen: { width: 800, height: 600 } },
    stage,
    uiLayer,
    gameLayer,
  } as unknown as Renderer;

  const camera: BackgroundCamera = { panX: 0, panY: 0, zoom: 1 };
  const velocity: BackgroundShipVelocity = { angle: 0, speed: 0 };

  const layer = new SpaceBackgroundLayer(
    renderer,
    skyContainer,
    "test-system",
    () => camera,
    () => velocity,
  );

  return { layer, stage, uiLayer, gameLayer, skyContainer };
}

interface BackgroundInternals {
  twinkleStars: unknown[];
  swarmLayers: unknown[];
  starLayers: unknown[];
  dimmer: Graphics | null;
  nebulaBackdropSprite: Sprite | null;
  driftAsteroids: { x: number; y: number }[];
  nebulaeContainer: Container | null;
}

describe("SpaceBackgroundLayer (extracted FlightModule)", () => {
  it("populates twinkle stars and swarms after initialize()", () => {
    const { layer } = makeHarness();
    const internal = layer as unknown as BackgroundInternals;

    // Nothing built until initialize() runs.
    expect(internal.twinkleStars.length).toBe(0);
    expect(internal.swarmLayers.length).toBe(0);

    layer.initialize();

    expect(internal.twinkleStars.length).toBeGreaterThan(0);
    expect(internal.swarmLayers.length).toBeGreaterThan(0);
    expect(internal.starLayers.length).toBeGreaterThan(0);

    layer.destroy();
  });

  it("mounts the sky/mid-ground/UI display objects into the injected layers", () => {
    const { layer, stage, uiLayer, skyContainer } = makeHarness();

    layer.initialize();

    // Sky systems are children of the injected skyContainer (nebulae + stars).
    expect(skyContainer.children.length).toBeGreaterThan(0);
    // The mid-ground parallax container sits just above the sky on the stage.
    expect(stage.children.length).toBeGreaterThan(1);
    // Dust streaks + vignette live on the UI layer.
    expect(uiLayer.children.length).toBeGreaterThan(0);

    layer.destroy();
  });

  it("mounts a readability dimmer above all sky content at BACKGROUND_DIM strength (F2)", () => {
    const { layer, gameLayer, skyContainer } = makeHarness();
    layer.initialize();

    const internal = layer as unknown as BackgroundInternals;
    const dimmer = internal.dimmer;
    expect(dimmer).not.toBeNull();
    // The dimmer must sit ON TOP of every sky element (nebula backdrop, clouds,
    // star fields, twinkle stars) so it dims the whole backdrop uniformly.
    expect(dimmer!.parent).toBe(skyContainer);
    expect(skyContainer.getChildIndex(dimmer!)).toBe(
      skyContainer.children.length - 1,
    );
    expect(dimmer!.alpha).toBeCloseTo(BACKGROUND_DIM);

    // The module never touches the game world; destroy() must keep that true.
    layer.destroy();
    expect(gameLayer.children.length).toBe(0);
    expect(internal.dimmer).toBeNull();
  });

  it("keeps the async-mounted nebula backdrop BELOW the dimmer (F2 regression path)", () => {
    const { layer, skyContainer } = makeHarness();
    layer.initialize();

    const internal = layer as unknown as BackgroundInternals;
    const backdrop = internal.nebulaBackdropSprite;
    const dimmer = internal.dimmer;
    // The mocked texture cache makes the backdrop mount during initialize().
    expect(backdrop).not.toBeNull();
    expect(dimmer).not.toBeNull();
    // The backdrop is the brightest sky element and mounts AFTER the dimmer in
    // real load order — `addChildAt(bg, 0)` must splice it underneath. A
    // regression to plain addChild() would render it above the dimmer and
    // bring back the unreadable game layer (F2).
    expect(skyContainer.getChildIndex(backdrop!)).toBe(0);
    expect(skyContainer.getChildIndex(backdrop!)).toBeLessThan(
      skyContainer.getChildIndex(dimmer!),
    );
    expect(skyContainer.getChildIndex(dimmer!)).toBe(
      skyContainer.children.length - 1,
    );

    layer.destroy();
  });

  it("honours reduced motion: idle parallax/particles freeze, camera parallax still positions", () => {
    // Default (no reduced-motion preference): idle drift advances each tick.
    localStorage.clear();
    const moving = makeHarness();
    moving.layer.initialize();
    const movingInternal = moving.layer as unknown as BackgroundInternals;
    const before = movingInternal.driftAsteroids.map((a) => ({
      x: a.x,
      y: a.y,
    }));
    moving.layer.update(1000, 1000);
    const movedDelta = movingInternal.driftAsteroids.reduce(
      (sum, a, i) =>
        sum + Math.abs(a.x - before[i].x) + Math.abs(a.y - before[i].y),
      0,
    );
    expect(movedDelta).toBeGreaterThan(0);
    moving.layer.destroy();

    // Reduced motion ON (player setting): the same idle drift is frozen.
    localStorage.setItem("reducedMotion", "true");
    const calm = makeHarness();
    calm.layer.initialize();
    const calmInternal = calm.layer as unknown as BackgroundInternals;
    const frozenBefore = calmInternal.driftAsteroids.map((a) => ({
      x: a.x,
      y: a.y,
    }));
    calm.layer.update(1000, 1000);
    calmInternal.driftAsteroids.forEach((a, i) => {
      expect(a.x).toBe(frozenBefore[i].x);
      expect(a.y).toBe(frozenBefore[i].y);
    });
    // Camera-driven parallax positioning still runs: the nebula container is
    // centred (screen 800×600 → centre 400,300) rather than left at the origin.
    expect(calmInternal.nebulaeContainer).not.toBeNull();
    expect(calmInternal.nebulaeContainer!.x).toBeCloseTo(400);
    expect(calmInternal.nebulaeContainer!.y).toBeCloseTo(300);
    calm.layer.destroy();

    localStorage.clear();
  });

  it("runs an update tick and tears down cleanly without throwing", () => {
    const { layer } = makeHarness();
    layer.initialize();

    expect(() => layer.update(1 / 60, 100)).not.toThrow();
    expect(() => layer.destroy()).not.toThrow();

    // After destroy the tracked arrays are emptied.
    const internal = layer as unknown as BackgroundInternals;
    expect(internal.twinkleStars.length).toBe(0);
    expect(internal.swarmLayers.length).toBe(0);
  });
});
