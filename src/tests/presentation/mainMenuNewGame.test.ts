import { describe, it, expect, vi, afterEach } from "vitest";
import { MainMenuScene } from "@/presentation/MainMenuScene";
import { SceneType } from "@/types";
import type { GameEngine } from "@/systems/GameEngine";

afterEach(() => {
  vi.restoreAllMocks();
});

function makeScene() {
  const restartNewGame = vi.fn().mockResolvedValue(undefined);
  const transitionTo = vi.fn().mockResolvedValue(undefined);
  const scene = new MainMenuScene({} as never);
  (scene as unknown as { gameEngine: GameEngine | null }).gameEngine = {
    restartNewGame,
    transitionTo,
  } as unknown as GameEngine;
  return {
    scene: scene as unknown as { handleNewGame: () => Promise<void> },
    restartNewGame,
    transitionTo,
  };
}

describe("MainMenuScene — «Новая игра»", () => {
  it("runs the full reset via restartNewGame, not a bare RACE_SELECTION transition", async () => {
    const { scene, restartNewGame, transitionTo } = makeScene();

    await scene.handleNewGame();

    expect(restartNewGame).toHaveBeenCalledTimes(1);
    expect(transitionTo).not.toHaveBeenCalledWith(
      SceneType.RACE_SELECTION,
      expect.anything(),
    );
  });
});
