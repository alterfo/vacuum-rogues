import { describe, it, expect, vi, beforeEach } from "vitest";
import { GameEngine, GameEngineDIDependencies } from "@/systems/GameEngine";
import { DIContainer } from "@/core/DIContainer";
import { NoOpAutopilotStateProvider } from "@/core/adapters";
import type { IAutopilotStateProvider } from "@/core/ports";
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

describe("NoOpAutopilotStateProvider", () => {
  it("reports never-engaged", () => {
    const noop = new NoOpAutopilotStateProvider();
    expect(noop.isEngaged()).toBe(false);
  });

  it("resume() is a silent no-op for any flag", () => {
    const noop: IAutopilotStateProvider = new NoOpAutopilotStateProvider();
    expect(() => noop.resume(true)).not.toThrow();
    expect(() => noop.resume(false)).not.toThrow();
  });
});

describe("GameEngine autopilot-state DI seam", () => {
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

  it("has no loaded autopilot flag before any load", () => {
    const engine = new GameEngine(diDeps);
    expect(engine.getLoadedAutopilotEngaged()).toBeUndefined();
  });

  it("accepts a later-injected provider without throwing (post-boot catch-up)", () => {
    const engine = new GameEngine(diDeps);
    let resumed: boolean | undefined;
    const provider: IAutopilotStateProvider = {
      isEngaged: () => true,
      resume: (engaged) => {
        resumed = engaged;
      },
    };
    expect(() => engine.setAutopilotStateProvider(provider)).not.toThrow();
    provider.resume(true);
    expect(resumed).toBe(true);
  });

  it("constructs fine when an autopilot provider is supplied at DI time", () => {
    const provider = new NoOpAutopilotStateProvider();
    const engine = new GameEngine({
      ...diDeps,
      autopilotStateProvider: provider,
    });
    expect(engine).toBeDefined();
    expect(engine.getLoadedAutopilotEngaged()).toBeUndefined();
  });
});
