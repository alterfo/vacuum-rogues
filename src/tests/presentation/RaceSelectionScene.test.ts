import { describe, it, expect, vi } from "vitest";
import { RaceSelectionScene } from "@/presentation/RaceSelectionScene";
import { SceneType, RaceType } from "@/types";

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

  it("should transition to SPACE_FLIGHT on startGame with selected race", async () => {
    const scene = new RaceSelectionScene(mockRenderer);
    const mockEngine = {
      transitionTo: vi.fn().mockResolvedValue(undefined),
    } as unknown as import("@/systems/GameEngine").GameEngine;

    scene.initialize({ gameEngine: mockEngine });

    // Select a race and start game
    (scene as any).selectedRace = RaceType.PELENG;
    await (scene as any).startGame();

    expect(mockEngine.transitionTo).toHaveBeenCalledTimes(1);
    expect(mockEngine.transitionTo).toHaveBeenCalledWith(
      SceneType.SPACE_FLIGHT,
      expect.objectContaining({
        gameEngine: mockEngine,
        selectedRace: RaceType.PELENG,
      }),
    );
  });

  it("should default to HUMAN race if not explicitly changed", async () => {
    const scene = new RaceSelectionScene(mockRenderer);
    const mockEngine = {
      transitionTo: vi.fn().mockResolvedValue(undefined),
    } as unknown as import("@/systems/GameEngine").GameEngine;

    scene.initialize({ gameEngine: mockEngine });

    // startGame without changing selection defaults to HUMAN
    await (scene as any).startGame();

    expect(mockEngine.transitionTo).toHaveBeenCalledWith(
      SceneType.SPACE_FLIGHT,
      expect.objectContaining({
        selectedRace: RaceType.HUMAN,
      }),
    );
  });
});
