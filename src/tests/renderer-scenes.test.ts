import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SceneType } from "@/types";
import { GameEngine } from "@/systems/GameEngine";
import { Renderer } from "@/presentation/Renderer";
import { GameScene } from "@/presentation/GameScene";
import { MainMenuScene } from "@/presentation/MainMenuScene";

vi.mock("pixi.js", () => ({
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
    on: vi.fn(),
    destroy: vi.fn(),
  })),
  Rectangle: vi.fn().mockImplementation(() => ({})),
  Graphics: vi.fn().mockImplementation(() => ({
    clear: vi.fn().mockReturnThis(),
    fill: vi.fn().mockReturnThis(),
    rect: vi.fn().mockReturnThis(),
    roundRect: vi.fn().mockReturnThis(),
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

      interface MainMenuSceneInternal {
        background: { destroy: () => void } | null;
        buttonsContainer: { destroy: () => void } | null;
        title: { destroy: () => void } | null;
        gameEngine: GameEngine | null;
      }

      const sceneInternal = scene as unknown as MainMenuSceneInternal;
      sceneInternal.background = { destroy: vi.fn() };
      sceneInternal.buttonsContainer = { destroy: vi.fn() };
      sceneInternal.title = { destroy: vi.fn() };
      sceneInternal.gameEngine = {} as GameEngine;

      scene.destroy();

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

      await engine.transitionTo(SceneType.MAIN_MENU, { gameEngine: engine });
      expect(engine.currentScene).toBeInstanceOf(MainMenuScene);

      await engine.transitionTo(SceneType.STAR_MAP, { gameEngine: engine });
      expect(engine.currentScene).not.toBeInstanceOf(MainMenuScene);
    });
  });
});
