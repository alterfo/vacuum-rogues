import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SceneType } from "@/types";
import { GameEngine } from "@/systems/GameEngine";
import { Renderer } from "@/presentation/Renderer";
import { GameScene } from "@/presentation/GameScene";
import { MainMenuScene } from "@/presentation/MainMenuScene";

// Mock PixiJS
vi.mock("pixi.js", () => ({
  // PlanetRotationFilter (via PlanetSprite → SpaceFlightScene) extends Filter at
  // module load, so the partial mock must expose a constructable Filter.
  Filter: class {},
  Application: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    canvas: document.createElement("canvas"),
    renderer: {
      type: "webgl",
      resize: vi.fn(),
    },
    stage: {
      addChild: vi.fn(),
    },
    ticker: {
      start: vi.fn(),
      stop: vi.fn(),
    },
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
    // PixiJS v8 Graphics extends Container, so it supports child management.
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    eventMode: "static",
    cursor: "pointer",
    on: vi.fn(),
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

describe("Renderer and Scenes", () => {
  let mockContainer: HTMLElement;

  beforeEach(() => {
    mockContainer = document.createElement("div");
    mockContainer.id = "game-container";
    mockContainer.style.width = "800px";
    mockContainer.style.height = "600px";
    document.body.appendChild(mockContainer);
  });

  afterEach(() => {
    document.body.removeChild(mockContainer);
    vi.clearAllMocks();
  });

  describe("SceneType enum", () => {
    it("AC4: SceneType enum contains MAIN_MENU", () => {
      expect(SceneType.MAIN_MENU).toBe("MAIN_MENU");
      expect(Object.values(SceneType)).toContain("MAIN_MENU");
    });
  });

  describe("GameEngine transitionTo", () => {
    it('GameEngine.transitionTo("MAIN_MENU") instantiates MainMenuScene', async () => {
      const engine = new GameEngine();

      // Mock renderer initialization
      const mockRenderer = {
        app: {
          screen: { width: 800, height: 600 },
          canvas: document.createElement("canvas"),
          renderer: { type: "webgl", resize: vi.fn() },
          ticker: { start: vi.fn() },
          stage: { eventMode: "auto", addChild: vi.fn() },
        },
        gameLayer: {
          addChild: vi.fn(),
          addChildAt: vi.fn(),
          children: [],
          removeChild: vi.fn(),
        },
        uiLayer: { addChild: vi.fn(), children: [], removeChild: vi.fn() },
        stage: { addChild: vi.fn() },
        clearGameLayer: vi.fn(),
        clearUILayer: vi.fn(),
      } as unknown as Renderer;

      engine.renderer = mockRenderer;

      await engine.transitionTo(SceneType.MAIN_MENU, { gameEngine: engine });

      expect(engine.currentScene).toBeInstanceOf(MainMenuScene);
    });

    it("Calling transitionTo() a second time calls destroy() on the previous scene", async () => {
      const engine = new GameEngine();

      const mockRenderer = {
        app: {
          screen: { width: 800, height: 600 },
          canvas: document.createElement("canvas"),
          renderer: { type: "webgl", resize: vi.fn() },
          ticker: { start: vi.fn() },
          stage: { eventMode: "auto", addChild: vi.fn() },
        },
        gameLayer: {
          addChild: vi.fn(),
          addChildAt: vi.fn(),
          children: [],
          removeChild: vi.fn(),
        },
        uiLayer: {
          addChild: vi.fn(),
          children: [],
          removeChild: vi.fn(),
        },
        stage: { addChild: vi.fn() },
        clearGameLayer: vi.fn(),
        clearUILayer: vi.fn(),
      } as unknown as Renderer;

      engine.renderer = mockRenderer;

      // Create a mock scene to track destroy calls
      let destroyCalled = false;
      const mockScene = new (class extends GameScene {
        initialize(_context?: object): void {}
        update(_deltaTime: number): void {}
        destroy(): void {
          destroyCalled = true;
        }
      })(mockRenderer);

      engine.currentScene = mockScene;

      await engine.transitionTo(SceneType.MAIN_MENU, { gameEngine: engine });

      expect(destroyCalled).toBe(true);
    });
  });

  describe("MainMenuScene.destroy", () => {
    it("MainMenuScene.destroy() sets all DisplayObject references to null", async () => {
      const mockRenderer = {
        app: {
          screen: { width: 800, height: 600 },
          canvas: document.createElement("canvas"),
          renderer: { type: "webgl", resize: vi.fn() },
          ticker: { start: vi.fn() },
          stage: { eventMode: "auto", addChild: vi.fn() },
        },
        gameLayer: {
          addChild: vi.fn(),
          children: [],
          removeChild: vi.fn(),
        },
        uiLayer: {
          addChild: vi.fn(),
          children: [],
          removeChild: vi.fn(),
        },
        stage: { addChild: vi.fn() },
        clearGameLayer: vi.fn(),
        clearUILayer: vi.fn(),
      } as unknown as Renderer;

      const scene = new MainMenuScene(mockRenderer);
      scene.initialize({ gameEngine: {} as GameEngine });

      // Type for accessing private properties in tests
      interface MainMenuSceneInternal {
        background: { destroy: () => void } | null;
        buttonsContainer: { destroy: () => void } | null;
        title: { destroy: () => void } | null;
        gameEngine: GameEngine | null;
      }

      // Manually set internal references for testing
      const sceneInternal = scene as unknown as MainMenuSceneInternal;
      sceneInternal.background = { destroy: vi.fn() };
      sceneInternal.buttonsContainer = { destroy: vi.fn() };
      sceneInternal.title = { destroy: vi.fn() };
      sceneInternal.gameEngine = {} as GameEngine;

      scene.destroy();

      // Verify cleanup
      expect(sceneInternal.background).toBeNull();
      expect(sceneInternal.buttonsContainer).toBeNull();
      expect(sceneInternal.title).toBeNull();
      expect(sceneInternal.gameEngine).toBeNull();
    });
  });

  describe("Scene transitions", () => {
    it("AC2: Transition from MAIN_MENU to STAR_MAP works correctly", async () => {
      const engine = new GameEngine();

      const mockRenderer = {
        app: {
          screen: { width: 800, height: 600 },
          canvas: document.createElement("canvas"),
          renderer: { type: "webgl", resize: vi.fn() },
          ticker: { start: vi.fn() },
          stage: { eventMode: "auto", addChild: vi.fn() },
        },
        gameLayer: {
          addChild: vi.fn(),
          addChildAt: vi.fn(),
          children: [],
          removeChild: vi.fn(),
        },
        uiLayer: { addChild: vi.fn(), children: [], removeChild: vi.fn() },
        stage: { addChild: vi.fn() },
        clearGameLayer: vi.fn(),
        clearUILayer: vi.fn(),
      } as unknown as Renderer;

      engine.renderer = mockRenderer;

      // Start at MAIN_MENU
      await engine.transitionTo(SceneType.MAIN_MENU, { gameEngine: engine });
      expect(engine.currentScene).toBeInstanceOf(MainMenuScene);

      // Transition to STAR_MAP
      await engine.transitionTo(SceneType.STAR_MAP, { gameEngine: engine });
      expect(engine.currentScene).not.toBeInstanceOf(MainMenuScene);
    });

    // (Removed: the hex CombatScene no longer exists — combat is real-time
    // in-flight only, so there is no SceneType.COMBAT transition to assert.)
  });
});
