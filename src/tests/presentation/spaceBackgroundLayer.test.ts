import { describe, it, expect } from "vitest";
import { Container, Graphics } from "pixi.js";
import {
  SpaceBackgroundLayer,
  type BackgroundCamera,
  type BackgroundShipVelocity,
} from "@/presentation/SpaceBackgroundLayer";
import type { Renderer } from "@/presentation/Renderer";
import { BACKGROUND_DIM } from "@/config/balance";

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

  it("hides the dimmer when the background is hidden (no double-dark in E2E)", () => {
    const { layer } = makeHarness();
    layer.initialize();

    const internal = layer as unknown as BackgroundInternals;
    layer.setVisible(false);
    expect(internal.dimmer!.visible).toBe(false);
    layer.setVisible(true);
    expect(internal.dimmer!.visible).toBe(true);

    layer.destroy();
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
