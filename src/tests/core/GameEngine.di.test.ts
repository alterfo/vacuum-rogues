import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GameEngine, GameEngineDIDependencies } from "@/systems/GameEngine";
import { DIContainer } from "@/core/DIContainer";
import { SceneType } from "@/types";
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

// Mock PixiJS
vi.mock("pixi.js", () => ({
  Application: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    canvas: document.createElement("canvas"),
    renderer: { type: "webgl", resize: vi.fn() },
    stage: { addChild: vi.fn(), eventMode: "auto" },
    ticker: { start: vi.fn(), stop: vi.fn() },
  })),
  Container: vi.fn().mockImplementation(() => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    filters: [],
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
  BlurFilter: vi.fn().mockImplementation(() => ({})),
}));

describe("GameEngine with DI", () => {
  let diDeps: GameEngineDIDependencies;

  beforeEach(() => {
    DIContainer.reset();

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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should instantiate with DI dependencies", () => {
    const engine = new GameEngine(diDeps);
    expect(engine).toBeDefined();
  });

  it("should instantiate without DI (legacy mode)", () => {
    const engine = new GameEngine();
    expect(engine).toBeDefined();
  });

  it("should transition to MAIN_MENU with DI", async () => {
    const engine = new GameEngine(diDeps);

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
    } as unknown as import("@/presentation/Renderer").Renderer;

    engine.renderer = mockRenderer;
    await engine.transitionTo(SceneType.MAIN_MENU, { gameEngine: engine });

    expect(engine.currentScene).toBeDefined();
  });

  it("should use injected galaxy service for generation", async () => {
    const galaxyService = diDeps.galaxyService as MockGalaxyService;
    const engine = new GameEngine(diDeps);

    engine.galaxy = await galaxyService.generate("di_test", 5);
    const params = galaxyService.getLastGenerationParams();

    expect(params.seed).toBe("di_test");
    expect(params.count).toBe(5);
    expect(engine.galaxy.systems).toHaveLength(5);
  });

  it("should use injected player service for creation", () => {
    const playerService = diDeps.playerService as MockPlayerService;
    const engine = new GameEngine(diDeps);

    const player = playerService.createPlayer({
      raceType: "HUMAN" as import("@/types").RaceType,
    });
    engine.player = player;

    expect(playerService.createCallCount).toBe(1);
    expect(engine.player).toBeDefined();
  });

  it("should route errors through injected exception handler", () => {
    const handler = diDeps.exceptionHandler as MockExceptionHandler;
    const engine = new GameEngine(diDeps);

    const testError = new Error("Test error");
    engine.handleError(testError);

    expect(handler.handledErrors).toHaveLength(1);
    expect(handler.handledErrors[0].error).toBe(testError);
  });

  it("should use injected quest service", () => {
    const questService = diDeps.questService as MockQuestService;
    const engine = new GameEngine(diDeps);

    engine.questManager.acceptQuest("quest_delivery_ore");

    expect(questService.acceptCallCount).toBe(1);
    expect(questService.lastTemplateId).toBe("quest_delivery_ore");
  });

  it("should use injected equipment service", () => {
    const equipmentService = diDeps.equipmentService as MockEquipmentService;
    const engine = new GameEngine(diDeps);

    // Mock player with minimal required fields
    const mockPlayer = {
      inventory: { modules: [] },
      ship: { modules: [] },
    } as unknown as import("@/domain/Player").Player;
    engine.equipmentSystem.equipModule(mockPlayer, "weapon_laser_1", 0);

    expect(equipmentService.equipCalls).toHaveLength(1);
    expect(equipmentService.equipCalls[0]).toEqual({
      moduleId: "weapon_laser_1",
      slot: 0,
    });
  });
});
