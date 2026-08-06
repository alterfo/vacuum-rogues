import { describe, it, expect, vi } from "vitest";
import { SceneType } from "@/types";
import type { GameEngine } from "@/systems/GameEngine";
import { createLiveSceneController } from "./installAutopilotHook";

interface SceneStub {
  pendingWarp: unknown;
  plannedRoute: { x: number; y: number } | null;
  executeRouteTo: ReturnType<typeof vi.fn>;
  shipPhysics: { isMoving: boolean } | null;
  isTurnRunning: boolean;
  combatModule: { isActive: boolean } | null;
  e2eStartTurn: ReturnType<typeof vi.fn>;
}

function makeEngine(overrides: Partial<SceneStub> = {}) {
  const scene: SceneStub = {
    pendingWarp: null,
    plannedRoute: { x: 400, y: 300 },
    executeRouteTo: vi.fn(),
    shipPhysics: { isMoving: false },
    isTurnRunning: false,
    combatModule: { isActive: false },
    e2eStartTurn: vi.fn(),
    ...overrides,
  };
  const engine = {
    currentSceneType: SceneType.SPACE_FLIGHT,
    currentScene: scene,
  } as unknown as GameEngine;
  return { engine, scene };
}

describe("live autopilot tick resumes an idle planned route (no thinking stall)", () => {
  it("re-launches a planned-but-not-flying route on tick", () => {
    const { engine, scene } = makeEngine();
    const controller = createLiveSceneController(engine);

    controller.tick();

    expect(scene.executeRouteTo).toHaveBeenCalledWith(400, 300);
    expect(scene.e2eStartTurn).not.toHaveBeenCalled();
  });

  it("does not touch the route while a fight is active", () => {
    const { engine, scene } = makeEngine({
      combatModule: { isActive: true },
    });
    createLiveSceneController(engine).tick();

    expect(scene.executeRouteTo).not.toHaveBeenCalled();
  });

  it("does not re-launch while the ship is already flying", () => {
    const { engine, scene } = makeEngine({
      shipPhysics: { isMoving: true },
    });
    createLiveSceneController(engine).tick();

    expect(scene.executeRouteTo).not.toHaveBeenCalled();
  });

  it("does not re-launch while a turn is running", () => {
    const { engine, scene } = makeEngine({ isTurnRunning: true });
    createLiveSceneController(engine).tick();

    expect(scene.executeRouteTo).not.toHaveBeenCalled();
  });

  it("still starts a wait turn when no route is planned", () => {
    const { engine, scene } = makeEngine({ plannedRoute: null });
    createLiveSceneController(engine).tick();

    expect(scene.executeRouteTo).not.toHaveBeenCalled();
    expect(scene.e2eStartTurn).toHaveBeenCalled();
  });
});
