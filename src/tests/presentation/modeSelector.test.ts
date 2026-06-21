import { describe, it, expect, vi } from "vitest";
import { RaceSelectionScene } from "@/presentation/RaceSelectionScene";
import { SceneType, FactionType } from "@/types";

// Mirror the lightweight PixiJS mock used by RaceSelectionScene.test.ts so the
// scene can render its mode chips without a real renderer.
vi.mock("pixi.js", () => ({
  Container: vi.fn().mockImplementation(() => ({
    addChild: vi.fn(),
    destroy: vi.fn(),
    children: [],
    pivot: { set: vi.fn() },
    on: vi.fn(),
    x: 0,
    y: 0,
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
  Sprite: vi.fn().mockImplementation(() => ({
    anchor: { set: vi.fn() },
    scale: { set: vi.fn() },
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    eventMode: "none",
    mask: null,
  })),
}));

describe("RaceSelectionScene difficulty-mode selector (Task 2)", () => {
  const mockRenderer = {
    app: { screen: { width: 1024, height: 768 } },
    uiLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
    gameLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
    clearGameLayer: vi.fn(),
    clearUILayer: vi.fn(),
  } as unknown as import("@/presentation/Renderer").Renderer;

  function makeScene() {
    const scene = new RaceSelectionScene(mockRenderer);
    const engine = {
      transitionTo: vi.fn().mockResolvedValue(undefined),
    } as unknown as import("@/systems/GameEngine").GameEngine;
    scene.initialize({ gameEngine: engine });
    return { scene, engine };
  }

  it("defaults to NORMAL (Средний) and Start carries that mode", async () => {
    const { scene, engine } = makeScene();

    await (scene as any).startGame();

    expect(engine.transitionTo).toHaveBeenCalledWith(
      SceneType.SPACE_FLIGHT,
      expect.objectContaining({
        selectedFaction: FactionType.OUTLANDERS,
        selectedGameMode: "NORMAL",
      }),
    );
  });

  it("Start carries the GOD mode after selecting it", async () => {
    const { scene, engine } = makeScene();

    scene.e2eSelectMode("god");
    await (scene as any).startGame();

    expect(engine.transitionTo).toHaveBeenCalledWith(
      SceneType.SPACE_FLIGHT,
      expect.objectContaining({ selectedGameMode: "GOD" }),
    );
  });

  it("Start carries the HARD mode after selecting it", async () => {
    const { scene, engine } = makeScene();

    scene.e2eSelectMode("hard");
    await (scene as any).startGame();

    expect(engine.transitionTo).toHaveBeenCalledWith(
      SceneType.SPACE_FLIGHT,
      expect.objectContaining({ selectedGameMode: "HARD" }),
    );
  });

  it("falls back to NORMAL for an unknown mode string", async () => {
    const { scene, engine } = makeScene();

    scene.e2eSelectMode("impossible");
    await (scene as any).startGame();

    expect(engine.transitionTo).toHaveBeenCalledWith(
      SceneType.SPACE_FLIGHT,
      expect.objectContaining({ selectedGameMode: "NORMAL" }),
    );
  });

  it("keeps both faction and mode selections independent", async () => {
    const { scene, engine } = makeScene();

    scene.e2eSelectFaction("SYNDICATE");
    scene.e2eSelectMode("HARD");
    await (scene as any).startGame();

    expect(engine.transitionTo).toHaveBeenCalledWith(
      SceneType.SPACE_FLIGHT,
      expect.objectContaining({
        selectedFaction: FactionType.SYNDICATE,
        selectedGameMode: "HARD",
      }),
    );
  });
});
