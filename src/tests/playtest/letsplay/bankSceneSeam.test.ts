import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { GameScene } from "@/presentation/GameScene";
import { RealEngineHarness } from "../realEngineHarness";
import { SceneType } from "@/types";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
} from "@/systems/banking/economy";
import { currentSystem } from "./engineQueries";
import {
  executeTakeLoan,
  executeRepayLoan,
  playerLoanBalance,
  canTakeLoan,
} from "./bankingQueries";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

function seamScene() {
  const takeLoan = vi.fn();
  const repayLoan = vi.fn();
  return {
    scene: {
      e2eTakeLoan: takeLoan,
      e2eRepayLoan: repayLoan,
    } as unknown as GameScene,
    takeLoan,
    repayLoan,
  };
}

describe("bank-scene loan seam wiring (Task 6)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot({ seed: "BANK-SEAM-TEST" });
    await harness.newGame();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("executeTakeLoan drives the real e2eTakeLoan button seam", () => {
    const engine = harness.engine;
    const { scene, takeLoan, repayLoan } = seamScene();
    engine.currentScene = scene;

    executeTakeLoan(engine);

    expect(takeLoan).toHaveBeenCalledTimes(1);
    expect(repayLoan).not.toHaveBeenCalled();
    expect(harness.errors()).toHaveLength(0);
  });

  it("executeRepayLoan drives the real e2eRepayLoan button seam", () => {
    const engine = harness.engine;
    const player = engine.player!;
    engine.currentScene = null;
    executeTakeLoan(engine);
    expect(playerLoanBalance(engine)).toBeGreaterThan(0);
    adjustPlayerCredits(
      engine.bank,
      player,
      2000,
      GL_COUNTERPARTY.REWARDS,
      "test seed",
    );

    const { scene, takeLoan, repayLoan } = seamScene();
    engine.currentScene = scene;

    executeRepayLoan(engine);

    expect(repayLoan).toHaveBeenCalledTimes(1);
    expect(takeLoan).not.toHaveBeenCalled();
    expect(harness.errors()).toHaveLength(0);
  });

  it("does NOT fire e2eTakeLoan when a loan is already outstanding", () => {
    const engine = harness.engine;
    engine.currentScene = null;
    executeTakeLoan(engine); // real loan now outstanding
    expect(canTakeLoan(engine)).toBe(false);

    const { scene, takeLoan } = seamScene();
    engine.currentScene = scene;

    executeTakeLoan(engine); // a second take-loan must be a no-op

    expect(takeLoan).not.toHaveBeenCalled();
    expect(harness.errors()).toHaveLength(0);
  });

  it("does NOT fire e2eRepayLoan when there is no outstanding loan", () => {
    const engine = harness.engine;
    expect(playerLoanBalance(engine)).toBe(0);

    const { scene, repayLoan } = seamScene();
    engine.currentScene = scene;

    executeRepayLoan(engine);

    expect(repayLoan).not.toHaveBeenCalled();
    expect(harness.errors()).toHaveLength(0);
  });

  it("falls back to the bank-bus takeLoan when the scene has no seam", () => {
    const engine = harness.engine;
    const player = engine.player!;
    const creditsBefore = player.credits;
    engine.currentScene = {} as unknown as GameScene;

    expect(() => executeTakeLoan(engine)).not.toThrow();

    expect(player.credits).toBe(creditsBefore + 5000);
    expect(playerLoanBalance(engine)).toBeGreaterThan(0);
    expect(harness.errors()).toHaveLength(0);
  });

  it("falls back to the bank-bus repayLoan when currentScene is null", () => {
    const engine = harness.engine;
    engine.currentScene = null;
    executeTakeLoan(engine);
    const owedBefore = playerLoanBalance(engine);
    const creditsBefore = engine.player!.credits;

    expect(() => executeRepayLoan(engine)).not.toThrow();

    expect(playerLoanBalance(engine)).toBeLessThan(owedBefore);
    expect(engine.player!.credits).toBeLessThan(creditsBefore);
    expect(harness.errors()).toHaveLength(0);
  });

  it("routes take-loan then repay-loan through a docked BankScene", async () => {
    const engine = harness.engine;
    const planet = currentSystem(engine)!.planets[0];
    await harness.goTo(SceneType.BANK, { planet });

    const player = engine.player!;
    const creditsBefore = player.credits;

    executeTakeLoan(engine);
    expect(player.credits).toBe(creditsBefore + 5000);
    expect(playerLoanBalance(engine)).toBeGreaterThan(0);

    const owedBefore = playerLoanBalance(engine);
    executeRepayLoan(engine);
    expect(playerLoanBalance(engine)).toBeLessThan(owedBefore);
    expect(harness.errors()).toHaveLength(0);
  });
});
