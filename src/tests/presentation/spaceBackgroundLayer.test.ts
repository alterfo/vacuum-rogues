import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  SpaceBackgroundLayer,
  type BackgroundCamera,
  type BackgroundShipVelocity,
} from "@/presentation/SpaceBackgroundLayer";
import type { Renderer } from "@/presentation/Renderer";

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

  return { layer, stage, uiLayer, skyContainer };
}

interface BackgroundInternals {
  twinkleStars: unknown[];
  swarmLayers: unknown[];
  starLayers: unknown[];
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
