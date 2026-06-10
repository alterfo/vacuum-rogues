import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GameEngine, GameEngineDIDependencies } from "@/systems/GameEngine";
import { SceneType, FactionType } from "@/types";
import {
  MockSaveService,
  MockGalaxyService,
  MockPlayerService,
  MockOnnxService,
  MockExceptionHandler,
  MockQuestService,
  MockEquipmentService,
} from "@/tests/mocks";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import { SaveState } from "@/domain/SaveState";

vi.mock("pixi.js", () => ({
  // PlanetRotationFilter (via PlanetSprite → SpaceFlightScene) extends Filter at
  // module load, so the partial mock must expose a constructable Filter.
  Filter: class {},
  // UiButton sets container.hitArea = new Rectangle(...) (real-pointer fix)
  Rectangle: class {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
  },
  Application: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    canvas: document.createElement("canvas"),
    renderer: { type: "webgl", resize: vi.fn() },
    stage: { addChild: vi.fn(), eventMode: "auto", off: vi.fn(), on: vi.fn() },
    ticker: { start: vi.fn(), stop: vi.fn() },
  })),
  Container: vi.fn().mockImplementation(() => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    filters: [],
    pivot: { set: vi.fn() },
    on: vi.fn(),
    destroy: vi.fn(),
    eventMode: "static",
    cursor: "pointer",
  })),
  Graphics: vi.fn().mockImplementation(() => ({
    fill: vi.fn().mockReturnThis(),
    rect: vi.fn().mockReturnThis(),
    roundRect: vi.fn().mockReturnThis(),
    circle: vi.fn().mockReturnThis(),
    ellipse: vi.fn().mockReturnThis(),
    stroke: vi.fn().mockReturnThis(),
    poly: vi.fn().mockReturnThis(),
    moveTo: vi.fn().mockReturnThis(),
    lineTo: vi.fn().mockReturnThis(),
    eventMode: "static",
    cursor: "pointer",
    on: vi.fn(),
    clear: vi.fn(),
    addChild: vi.fn(),
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
  BlurFilter: vi.fn().mockImplementation(() => ({})),
}));

describe("GameEngine persist location (US-021)", () => {
  let diDeps: GameEngineDIDependencies;
  let engine: GameEngine;
  let mockRenderer: import("@/presentation/Renderer").Renderer;

  beforeEach(() => {
    localStorage.clear();

    diDeps = {
      saveService: new MockSaveService(),
      galaxyService: new MockGalaxyService(),
      playerService: new MockPlayerService(),
      onnxService: new MockOnnxService(),
      exceptionHandler: new MockExceptionHandler(),
      qualityProfile: new AdaptiveQualityProfile(),
      questService: new MockQuestService(),
      equipmentService: new MockEquipmentService(),
    };

    engine = new GameEngine(diDeps);

    mockRenderer = {
      app: {
        screen: { width: 800, height: 600 },
        canvas: document.createElement("canvas"),
        renderer: { type: "webgl", resize: vi.fn() },
        ticker: { start: vi.fn() },
        stage: {
          eventMode: "auto",
          addChild: vi.fn(),
          off: vi.fn(),
          on: vi.fn(),
        },
      },
      gameLayer: {
        addChild: vi.fn(),
        addChildAt: vi.fn(),
        children: [],
        removeChild: vi.fn(),
        scale: { set: vi.fn() },
        x: 0,
        y: 0,
        filters: [],
        clear: vi.fn(),
      },
      uiLayer: {
        addChild: vi.fn(),
        addChildAt: vi.fn(),
        children: [],
        removeChild: vi.fn(),
        clear: vi.fn(),
      },
      stage: { addChild: vi.fn(), addChildAt: vi.fn(), removeChild: vi.fn() },
      clearGameLayer: vi.fn(),
      clearUILayer: vi.fn(),
    } as unknown as import("@/presentation/Renderer").Renderer;

    engine.renderer = mockRenderer;
  });

  afterEach(() => {
    engine.currentScene?.destroy();
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe("transitionTo", () => {
    it("should persist currentSceneType to localStorage", async () => {
      await engine.transitionTo(SceneType.STAR_MAP, { gameEngine: engine });
      expect(localStorage.getItem("sr_currentScene")).toBe(SceneType.STAR_MAP);

      await engine.transitionTo(SceneType.SPACE_FLIGHT, { gameEngine: engine });
      expect(localStorage.getItem("sr_currentScene")).toBe(
        SceneType.SPACE_FLIGHT,
      );
    });

    it("should update currentSceneType property", async () => {
      await engine.transitionTo(SceneType.STAR_MAP, { gameEngine: engine });
      expect(engine.currentSceneType).toBe(SceneType.STAR_MAP);

      await engine.transitionTo(SceneType.MAIN_MENU, { gameEngine: engine });
      expect(engine.currentSceneType).toBe(SceneType.MAIN_MENU);
    });
  });

  describe("saveGame", () => {
    it("should save currentSceneType in SaveState", async () => {
      engine.galaxy = await diDeps.galaxyService.generate("test", 5);
      engine.player = diDeps.playerService.createPlayer({
        factionType: FactionType.OUTLANDERS,
      });
      engine.currentSceneType = SceneType.SPACE_FLIGHT;

      await engine.saveGame("auto");

      const saved = await diDeps.saveService.read("auto");
      expect(saved).not.toBeNull();
      expect(saved!.currentSceneType).toBe(SceneType.SPACE_FLIGHT);
    });

    it("should include currentSceneType when saving from StarMap", async () => {
      engine.galaxy = await diDeps.galaxyService.generate("test", 5);
      engine.player = diDeps.playerService.createPlayer({
        factionType: FactionType.OUTLANDERS,
      });
      engine.currentSceneType = SceneType.STAR_MAP;

      await engine.saveGame("slot1");

      const saved = await diDeps.saveService.read("slot1");
      expect(saved!.currentSceneType).toBe(SceneType.STAR_MAP);
    });
  });

  describe("loadGame", () => {
    it("should restore scene type from SaveState (SPACE_FLIGHT)", async () => {
      engine.galaxy = await diDeps.galaxyService.generate("test", 5);
      engine.player = diDeps.playerService.createPlayer({
        factionType: FactionType.OUTLANDERS,
      });

      const save = new SaveState(
        1,
        engine.galaxy,
        engine.player,
        [],
        Date.now(),
        SceneType.SPACE_FLIGHT,
      );
      (diDeps.saveService as MockSaveService).setSave("auto", save);

      const transitionSpy = vi
        .spyOn(engine, "transitionTo")
        .mockResolvedValue(undefined);

      const result = await engine.loadGame("auto");
      expect(result).toBe(true);
      expect(transitionSpy).toHaveBeenCalledWith(SceneType.SPACE_FLIGHT, {
        gameEngine: engine,
      });
    });

    it("should restore scene type from SaveState (STAR_MAP)", async () => {
      engine.galaxy = await diDeps.galaxyService.generate("test", 5);
      engine.player = diDeps.playerService.createPlayer({
        factionType: FactionType.OUTLANDERS,
      });

      const save = new SaveState(
        1,
        engine.galaxy,
        engine.player,
        [],
        Date.now(),
        SceneType.STAR_MAP,
      );
      (diDeps.saveService as MockSaveService).setSave("auto", save);

      const transitionSpy = vi
        .spyOn(engine, "transitionTo")
        .mockResolvedValue(undefined);

      const result = await engine.loadGame("auto");
      expect(result).toBe(true);
      expect(transitionSpy).toHaveBeenCalledWith(SceneType.STAR_MAP, {
        gameEngine: engine,
      });
    });

    it("should fallback to SPACE_FLIGHT when currentSceneType is missing in save", async () => {
      engine.galaxy = await diDeps.galaxyService.generate("test", 5);
      engine.player = diDeps.playerService.createPlayer({
        factionType: FactionType.OUTLANDERS,
      });

      const save = new SaveState(
        1,
        engine.galaxy,
        engine.player,
        [],
        Date.now(),
        undefined,
      );
      (diDeps.saveService as MockSaveService).setSave("auto", save);

      const transitionSpy = vi
        .spyOn(engine, "transitionTo")
        .mockResolvedValue(undefined);

      const result = await engine.loadGame("auto");
      expect(result).toBe(true);
      expect(transitionSpy).toHaveBeenCalledWith(SceneType.SPACE_FLIGHT, {
        gameEngine: engine,
      });
    });
  });
});
