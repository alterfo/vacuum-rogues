/**
 * GAME_OVER scene — register + render (plan 20260619, Task 3).
 *
 * Locks two things:
 *   1. The SceneFactory builds a GameOverScene for SceneType.GAME_OVER (the
 *      5-file scene registration is wired).
 *   2. The scene exposes its two recovery actions — «Загрузить сохранение» and
 *      «Начать заново» — via the e2e seam, so a page object / test can find them
 *      without pixel-clicking. Action wiring (load / start over) is Task 4.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SceneType } from "@/types";

// Minimal PixiJS mock — GameOverScene only touches Container/Graphics/Text.
vi.mock("pixi.js", () => ({
  Filter: class {},
  Container: vi.fn().mockImplementation(() => ({
    addChild: vi.fn(),
    removeChild: vi.fn(),
    destroy: vi.fn(),
    children: [],
    x: 0,
    y: 0,
    eventMode: "auto",
    cursor: "auto",
    on: vi.fn(),
  })),
  Graphics: vi.fn().mockImplementation(() => ({
    rect: vi.fn().mockReturnThis(),
    fill: vi.fn().mockReturnThis(),
    stroke: vi.fn().mockReturnThis(),
    clear: vi.fn().mockReturnThis(),
    addChild: vi.fn(),
    eventMode: "static",
    on: vi.fn(),
  })),
  Text: vi.fn().mockImplementation(() => ({
    anchor: { set: vi.fn() },
    x: 0,
    y: 0,
    eventMode: "none",
    style: {},
  })),
}));

import { GameOverScene } from "@/presentation/GameOverScene";
import { SceneFactory } from "@/core/services/SceneFactory";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";

function makeRenderer(): Renderer {
  return {
    app: { screen: { width: 800, height: 600 } },
    gameLayer: { addChild: vi.fn(), children: [] },
    uiLayer: { addChild: vi.fn(), children: [] },
    stage: { addChild: vi.fn() },
    clearGameLayer: vi.fn(),
    clearUILayer: vi.fn(),
  } as unknown as Renderer;
}

describe("GameOverScene registration (Task 3)", () => {
  it("SceneFactory builds a GameOverScene for SceneType.GAME_OVER", () => {
    const scene = new SceneFactory().createScene(
      SceneType.GAME_OVER,
      makeRenderer(),
    );
    expect(scene).toBeInstanceOf(GameOverScene);
  });

  it("SceneType enum exposes GAME_OVER", () => {
    expect(SceneType.GAME_OVER).toBe("GAME_OVER");
    expect(Object.values(SceneType)).toContain("GAME_OVER");
  });
});

describe("GameOverScene render + actions (Task 3)", () => {
  let scene: GameOverScene;

  beforeEach(() => {
    scene = new GameOverScene(makeRenderer());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("constructs and initializes without an engine", () => {
    expect(() => scene.initialize({})).not.toThrow();
  });

  it("exposes exactly the two recovery actions in order", () => {
    scene.initialize({ gameEngine: {} as GameEngine });
    expect(scene.e2eActions()).toEqual([
      "Загрузить сохранение",
      "Начать заново",
    ]);
  });

  it("«Начать заново» resets to a fresh game via restartNewGame", () => {
    // Must route through restartNewGame (which nulls the dead player + regenerates
    // the galaxy) — NOT a bare transitionTo(RACE_SELECTION), which would carry the
    // destroyed ship into the "new" game (engine new-game guard never fires).
    const restartNewGame = vi.fn().mockResolvedValue(undefined);
    scene.initialize({
      gameEngine: { restartNewGame } as unknown as GameEngine,
    });
    scene.e2eRunAction("Начать заново");
    expect(restartNewGame).toHaveBeenCalledTimes(1);
  });

  it('«Загрузить сохранение» loads the "auto" takeoff autosave', () => {
    const loadGame = vi.fn().mockResolvedValue(true);
    const showLoadingOverlay = vi.fn();
    const hideLoadingOverlay = vi.fn();
    scene.initialize({
      gameEngine: {
        loadGame,
        showLoadingOverlay,
        hideLoadingOverlay,
      } as unknown as GameEngine,
    });
    scene.e2eRunAction("Загрузить сохранение");
    expect(loadGame).toHaveBeenCalledWith("auto");
  });

  it("«Загрузить сохранение» hides the overlay (no transition) when no autosave exists", async () => {
    const loadGame = vi.fn().mockResolvedValue(false);
    const showLoadingOverlay = vi.fn();
    const hideLoadingOverlay = vi.fn();
    const transitionTo = vi.fn().mockResolvedValue(undefined);
    scene.initialize({
      gameEngine: {
        loadGame,
        showLoadingOverlay,
        hideLoadingOverlay,
        transitionTo,
      } as unknown as GameEngine,
    });
    scene.e2eRunAction("Загрузить сохранение");
    await vi.waitFor(() => expect(hideLoadingOverlay).toHaveBeenCalledTimes(1));
    expect(showLoadingOverlay).toHaveBeenCalledTimes(1);
    expect(transitionTo).not.toHaveBeenCalled();
  });

  it("«Загрузить сохранение» hides the overlay when the load rejects", async () => {
    const loadGame = vi.fn().mockRejectedValue(new Error("disk error"));
    const showLoadingOverlay = vi.fn();
    const hideLoadingOverlay = vi.fn();
    scene.initialize({
      gameEngine: {
        loadGame,
        showLoadingOverlay,
        hideLoadingOverlay,
      } as unknown as GameEngine,
    });
    expect(() => scene.e2eRunAction("Загрузить сохранение")).not.toThrow();
    await vi.waitFor(() => expect(hideLoadingOverlay).toHaveBeenCalledTimes(1));
  });

  it("destroy() clears the scene container reference", () => {
    scene.initialize({ gameEngine: {} as GameEngine });
    expect(() => scene.destroy()).not.toThrow();
  });
});
