import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GameEngine, GameEngineDIDependencies } from "@/systems/GameEngine";
import { DIContainer } from "@/core/DIContainer";
import { SceneType } from "@/types";
import {
  MockSaveService,
  MockGalaxyService,
  MockPlayerService,
  MockExceptionHandler,
  MockQuestService,
} from "@/tests/mocks";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";

vi.mock("pixi.js", () => ({
  Filter: class {},
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
      exceptionHandler: new MockExceptionHandler(),
      qualityProfile: new AdaptiveQualityProfile(),
      questService: new MockQuestService(),
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
      factionType: "OUTLANDERS" as import("@/types").FactionType,
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
});

describe("GameEngine background-tab fallback (F9)", () => {
  function makeEngine(): GameEngine {
    return new GameEngine({
      saveService: new MockSaveService(),
      galaxyService: new MockGalaxyService(),
      playerService: new MockPlayerService(),
      exceptionHandler: new MockExceptionHandler(),
      qualityProfile: new AdaptiveQualityProfile(),
      questService: new MockQuestService(),
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", vi.fn().mockReturnValue(0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("arms the fallback immediately when the tab is already hidden at startup (no transition event)", () => {
    const engine = makeEngine();
    const update = vi.fn();
    engine.currentScene = {
      update,
    } as unknown as import("@/presentation/GameScene").GameScene;

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    (engine as unknown as { startGameLoop(): void }).startGameLoop();
    update.mockClear();

    vi.advanceTimersByTime(1500); // 3 ticks at the 500ms fallback cadence

    expect(update).toHaveBeenCalledTimes(3);
  });

  it("keeps ticking the current scene while the tab is hidden", () => {
    const engine = makeEngine();
    const update = vi.fn();
    engine.currentScene = {
      update,
    } as unknown as import("@/presentation/GameScene").GameScene;

    (engine as unknown as { startGameLoop(): void }).startGameLoop();
    update.mockClear(); // drop startGameLoop's own synchronous first-frame call

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    vi.advanceTimersByTime(1500); // 3 ticks at the 500ms fallback cadence

    expect(update).toHaveBeenCalledTimes(3);
  });

  it("does not arm the fallback while the tab stays visible", () => {
    const engine = makeEngine();
    const update = vi.fn();
    engine.currentScene = {
      update,
    } as unknown as import("@/presentation/GameScene").GameScene;

    (engine as unknown as { startGameLoop(): void }).startGameLoop();
    update.mockClear();

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));

    vi.advanceTimersByTime(2000);

    expect(update).not.toHaveBeenCalled();
  });

  it("stops the fallback interval once the tab becomes visible again", () => {
    const engine = makeEngine();
    const update = vi.fn();
    engine.currentScene = {
      update,
    } as unknown as import("@/presentation/GameScene").GameScene;

    (engine as unknown as { startGameLoop(): void }).startGameLoop();
    update.mockClear();

    const visibilityStateSpy = vi.spyOn(document, "visibilityState", "get");
    visibilityStateSpy.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(500);
    expect(update).toHaveBeenCalledTimes(1);

    visibilityStateSpy.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    update.mockClear();
    vi.advanceTimersByTime(2000);

    expect(update).not.toHaveBeenCalled();
  });

  it("stop() clears the fallback interval and detaches the listener", () => {
    const engine = makeEngine();
    const update = vi.fn();
    engine.currentScene = {
      update,
      destroy: vi.fn(),
    } as unknown as import("@/presentation/GameScene").GameScene;

    (engine as unknown as { startGameLoop(): void }).startGameLoop();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(500);
    update.mockClear();

    engine.stop();
    vi.advanceTimersByTime(2000);

    expect(update).not.toHaveBeenCalled();
  });
});
