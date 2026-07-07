import { describe, it, expect, vi, beforeEach } from "vitest";
import { SceneType } from "@/types";
import { GameEngine } from "@/systems/GameEngine";
import type { Renderer } from "@/presentation/Renderer";
import { GameScene } from "@/presentation/GameScene";

vi.mock("pixi.js", () => ({
  // PlanetRotationFilter (via PlanetSprite → SpaceFlightScene) extends Filter at
  // module load, so the partial mock must expose a constructable Filter.
  Filter: class {},
  Application: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    canvas: document.createElement("canvas"),
    renderer: { type: "webgl", resize: vi.fn() },
    ticker: { start: vi.fn() },
    stage: { eventMode: "auto", addChild: vi.fn() },
  })),
  Container: vi.fn().mockImplementation(() => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
  })),
  Graphics: vi.fn().mockImplementation(() => ({
    fill: vi.fn().mockReturnThis(),
    rect: vi.fn().mockReturnThis(),
    circle: vi.fn().mockReturnThis(),
    stroke: vi.fn().mockReturnThis(),
    poly: vi.fn().mockReturnThis(),
    moveTo: vi.fn().mockReturnThis(),
    lineTo: vi.fn().mockReturnThis(),
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    eventMode: "static",
    cursor: "pointer",
    on: vi.fn(),
    destroy: vi.fn(),
  })),
  Text: vi.fn().mockImplementation(() => ({
    anchor: { set: vi.fn() },
    x: 0,
    y: 0,
    width: 100,
    height: 30,
    text: "",
    style: {},
    eventMode: "none",
    cursor: "auto",
    alpha: 1,
    on: vi.fn(),
    destroy: vi.fn(),
    parent: null,
  })),
}));

function makeLayerWithChildren(count: number) {
  const children: object[] = Array.from({ length: count }, () => ({
    destroy: vi.fn(),
  }));
  return {
    children,
    removeChild: vi.fn((child: object) => {
      const idx = children.indexOf(child);
      if (idx !== -1) children.splice(idx, 1);
    }),
    addChild: vi.fn(),
    addChildAt: vi.fn(),
  };
}

function makeMockRenderer(
  gameLayerChildCount: number,
  uiLayerChildCount: number,
) {
  const gameLayer = makeLayerWithChildren(gameLayerChildCount);
  const uiLayer = makeLayerWithChildren(uiLayerChildCount);

  const renderer = {
    app: {
      screen: { width: 800, height: 600 },
      canvas: document.createElement("canvas"),
      renderer: { type: "webgl", resize: vi.fn() },
      ticker: { start: vi.fn() },
      stage: { eventMode: "auto", addChild: vi.fn() },
    },
    gameLayer,
    uiLayer,
    stage: { addChild: vi.fn() },
    clearGameLayer() {
      while (gameLayer.children.length > 0) {
        const child = gameLayer.children[0];
        gameLayer.removeChild(child);
        (child as { destroy: () => void }).destroy();
      }
    },
    clearUILayer() {
      while (uiLayer.children.length > 0) {
        const child = uiLayer.children[0];
        uiLayer.removeChild(child);
        (child as { destroy: () => void }).destroy();
      }
    },
  } as unknown as Renderer;

  return renderer;
}

class NoOpScene extends GameScene {
  initialize(_context?: object): void {}
  update(_deltaTime: number): void {}
  destroy(): void {}
}

describe("transitionTo central layer-clear safety net", () => {
  let engine: GameEngine;

  beforeEach(() => {
    engine = new GameEngine();
  });

  it("clears both layers after transitioning away from a scene that left stale children", async () => {
    const renderer = makeMockRenderer(2, 3);
    engine.renderer = renderer;

    // Place a previous scene that does NOT clean up layers (simulates incomplete destroy)
    const previousScene = new NoOpScene(renderer);
    engine.currentScene = previousScene;

    // Register a no-op target scene so transitionTo succeeds
    const nextScene = new NoOpScene(renderer);
    // Patch SceneFactory via the engine's internal factory (duck-patch for the test)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (engine as any).sceneFactory = {
      createScene: () => nextScene,
    };

    expect(renderer.gameLayer.children.length).toBe(2);
    expect(renderer.uiLayer.children.length).toBe(3);

    await engine.transitionTo(SceneType.MAIN_MENU, { gameEngine: engine });

    expect(renderer.gameLayer.children.length).toBe(0);
    expect(renderer.uiLayer.children.length).toBe(0);
  });

  it("clears layers even when there is no previous scene", async () => {
    const renderer = makeMockRenderer(1, 1);
    engine.renderer = renderer;
    engine.currentScene = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (engine as any).sceneFactory = {
      createScene: () => new NoOpScene(renderer),
    };

    await engine.transitionTo(SceneType.MAIN_MENU, { gameEngine: engine });

    expect(renderer.gameLayer.children.length).toBe(0);
    expect(renderer.uiLayer.children.length).toBe(0);
  });

  it("calls the overlay presenter's dismissAll() before clearing the UI layer (F4 — no destroyed-object leak across scenes)", async () => {
    const renderer = makeMockRenderer(1, 1);
    engine.renderer = renderer;
    engine.currentScene = null;
    const dismissAll = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (engine as any).overlay = {
      showError: vi.fn(),
      showLoading: vi.fn(),
      hideLoading: vi.fn(),
      showGameOutcome: vi.fn(),
      dismissAll,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (engine as any).sceneFactory = {
      createScene: () => new NoOpScene(renderer),
    };

    await engine.transitionTo(SceneType.MAIN_MENU, { gameEngine: engine });

    expect(dismissAll).toHaveBeenCalledTimes(1);
  });
});
