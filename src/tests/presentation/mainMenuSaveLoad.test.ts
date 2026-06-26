/**
 * Main-menu wiring for the save-slots UI (Task 3):
 *  - «Продолжить» resumes the **latest meaningful** save via
 *    `GameEngine.continueGame()` (the across-all-slots resolver), NOT a hardcoded
 *    `loadGame("auto")`.
 *  - «Сохранения» routes to the {@link SceneType.SAVE_LOAD} screen, asking it to
 *    return to the main menu on close.
 *
 * Driven through the scene's handlers directly (no PixiJS render), mirroring
 * `mainMenuNewGame.test.ts`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { MainMenuScene } from "@/presentation/MainMenuScene";
import { SceneType } from "@/types";
import type { GameEngine } from "@/systems/GameEngine";

afterEach(() => {
  vi.restoreAllMocks();
});

function makeScene(opts: { continueResolves?: boolean } = {}) {
  const continueGame = vi.fn().mockResolvedValue(opts.continueResolves ?? true);
  const loadGame = vi.fn().mockResolvedValue(true);
  const transitionTo = vi.fn().mockResolvedValue(undefined);
  const showLoadingOverlay = vi.fn();
  const hideLoadingOverlay = vi.fn();
  const scene = new MainMenuScene({} as never);
  const gameEngine = {
    continueGame,
    loadGame,
    transitionTo,
    showLoadingOverlay,
    hideLoadingOverlay,
  } as unknown as GameEngine;
  (scene as unknown as { gameEngine: GameEngine | null }).gameEngine =
    gameEngine;
  return {
    scene: scene as unknown as {
      handleContinue: () => Promise<void>;
      handleSaveLoad: () => void;
    },
    continueGame,
    loadGame,
    transitionTo,
    gameEngine,
  };
}

describe("MainMenuScene — Continue + Save/Load entry", () => {
  it("«Продолжить» resumes via continueGame, not loadGame('auto')", async () => {
    const { scene, continueGame, loadGame } = makeScene();

    await scene.handleContinue();

    expect(continueGame).toHaveBeenCalledTimes(1);
    // The old hardcoded auto-slot path must be gone.
    expect(loadGame).not.toHaveBeenCalled();
  });

  it("«Сохранения» routes to the SAVE_LOAD screen, returning to the menu", () => {
    const { scene, transitionTo, gameEngine } = makeScene();

    scene.handleSaveLoad();

    expect(transitionTo).toHaveBeenCalledWith(SceneType.SAVE_LOAD, {
      gameEngine,
      returnTo: SceneType.MAIN_MENU,
    });
  });
});
