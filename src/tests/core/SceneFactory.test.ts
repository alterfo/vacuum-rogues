import { describe, it, expect, vi } from "vitest";
import { SceneFactory } from "@/core/services/SceneFactory";
import { SceneType } from "@/types";

// Mock PixiJS Container for Renderer constructor
vi.mock("pixi.js", () => ({
  Application: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    canvas: document.createElement("canvas"),
    renderer: { type: "webgl" },
    stage: { addChild: vi.fn() },
    ticker: { start: vi.fn() },
  })),
  Container: vi.fn().mockImplementation(() => ({
    addChild: vi.fn(),
    children: [],
  })),
}));

describe("SceneFactory", () => {
  const factory = new SceneFactory();

  // Minimal mock renderer
  const mockRenderer = {
    app: { screen: { width: 800, height: 600 } },
    gameLayer: { addChild: vi.fn(), children: [] },
    uiLayer: { addChild: vi.fn(), children: [] },
    stage: { addChild: vi.fn() },
    clearGameLayer: vi.fn(),
    clearUILayer: vi.fn(),
  } as unknown as import("@/presentation/Renderer").Renderer;

  it("should create MainMenuScene", () => {
    const scene = factory.createScene(SceneType.MAIN_MENU, mockRenderer);
    expect(scene).toBeDefined();
    expect(scene).not.toBeNull();
  });

  it("should create RaceSelectionScene", () => {
    const scene = factory.createScene(SceneType.RACE_SELECTION, mockRenderer);
    expect(scene).toBeDefined();
  });

  it("should create StarMapScene", () => {
    const scene = factory.createScene(SceneType.STAR_MAP, mockRenderer);
    expect(scene).toBeDefined();
  });

  it("should create CombatScene", () => {
    const scene = factory.createScene(SceneType.COMBAT, mockRenderer);
    expect(scene).toBeDefined();
  });

  it("should create DialogueScene", () => {
    const scene = factory.createScene(SceneType.DIALOGUE, mockRenderer);
    expect(scene).toBeDefined();
  });

  it("should create InventoryScene", () => {
    const scene = factory.createScene(SceneType.INVENTORY, mockRenderer);
    expect(scene).toBeDefined();
  });

  it("should create SpaceFlightScene", () => {
    const scene = factory.createScene(SceneType.SPACE_FLIGHT, mockRenderer);
    expect(scene).toBeDefined();
  });

  it("should return null for unknown scene type", () => {
    const scene = factory.createScene("UNKNOWN" as SceneType, mockRenderer);
    expect(scene).toBeNull();
  });
});
