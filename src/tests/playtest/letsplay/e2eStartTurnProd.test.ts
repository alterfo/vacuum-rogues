import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import { SceneType } from "@/types";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

interface FlightSceneProbe {
  isTurnRunning: boolean;
  e2eHooks: { startTurn: () => void };
  e2eStartTurn: () => void;
}

describe("e2eStartTurn works when the scene's e2e hooks are inert (prod build: __DEBUG__ is false)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot({ seed: "START-TURN-PROD" });
    await harness.newGame();
    await harness.goTo(SceneType.SPACE_FLIGHT);
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("starts a turn even though the gated hook does nothing", () => {
    const scene = harness.engine.currentScene as unknown as FlightSceneProbe;
    scene.e2eHooks.startTurn = () => {};
    expect(scene.isTurnRunning).toBe(false);

    scene.e2eStartTurn();

    expect(scene.isTurnRunning).toBe(true);
    expect(harness.errors()).toHaveLength(0);
  });

  it("does not toggle a turn that is already running off", () => {
    const scene = harness.engine.currentScene as unknown as FlightSceneProbe;
    scene.e2eHooks.startTurn = () => {};
    scene.e2eStartTurn();
    expect(scene.isTurnRunning).toBe(true);

    scene.e2eStartTurn();

    expect(scene.isTurnRunning).toBe(true);
  });
});
