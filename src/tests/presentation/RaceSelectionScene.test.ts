import { describe, it, expect, vi } from "vitest";
import { RaceSelectionScene } from "@/presentation/RaceSelectionScene";
import { SceneType, FactionType } from "@/types";

vi.mock("pixi.js", () => ({
  Container: vi.fn().mockImplementation(() => ({
    addChild: vi.fn(),
    destroy: vi.fn(),
    children: [],
    pivot: { set: vi.fn() },
    on: vi.fn(),
    eventMode: "static",
    cursor: "pointer",
  })),
  Graphics: vi.fn().mockImplementation(() => ({
    fill: vi.fn().mockReturnThis(),
    rect: vi.fn().mockReturnThis(),
    stroke: vi.fn().mockReturnThis(),
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
    text: "",
    style: {},
    eventMode: "none",
    alpha: 1,
    on: vi.fn(),
    destroy: vi.fn(),
    parent: null,
  })),
}));

describe("RaceSelectionScene (US-021)", () => {
  const mockRenderer = {
    app: { screen: { width: 800, height: 600 } },
    uiLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
    gameLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
    clearGameLayer: vi.fn(),
    clearUILayer: vi.fn(),
  } as unknown as import("@/presentation/Renderer").Renderer;

  it("should transition to SPACE_FLIGHT on startGame with selected faction", async () => {
    const scene = new RaceSelectionScene(mockRenderer);
    const mockEngine = {
      transitionTo: vi.fn().mockResolvedValue(undefined),
    } as unknown as import("@/systems/GameEngine").GameEngine;

    scene.initialize({ gameEngine: mockEngine });

    (scene as any).selectedFaction = FactionType.SYNDICATE;
    await (scene as any).startGame();

    expect(mockEngine.transitionTo).toHaveBeenCalledTimes(1);
    expect(mockEngine.transitionTo).toHaveBeenCalledWith(
      SceneType.SPACE_FLIGHT,
      expect.objectContaining({
        gameEngine: mockEngine,
        selectedFaction: FactionType.SYNDICATE,
      }),
    );
  });

  it("should default to OUTLANDERS faction if not explicitly changed", async () => {
    const scene = new RaceSelectionScene(mockRenderer);
    const mockEngine = {
      transitionTo: vi.fn().mockResolvedValue(undefined),
    } as unknown as import("@/systems/GameEngine").GameEngine;

    scene.initialize({ gameEngine: mockEngine });

    await (scene as any).startGame();

    expect(mockEngine.transitionTo).toHaveBeenCalledWith(
      SceneType.SPACE_FLIGHT,
      expect.objectContaining({
        selectedFaction: FactionType.OUTLANDERS,
      }),
    );
  });
});
