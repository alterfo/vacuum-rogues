import { describe, it, expect, vi } from "vitest";
import { SceneType } from "@/types";
import type { GameEngine } from "@/systems/GameEngine";
import { createLiveSceneController } from "./installAutopilotHook";

function engineWithPlanning(isPlanning: boolean, confirm: () => boolean) {
  const combatant = { npc: { id: "n1" }, x: 100, y: 0 };
  return {
    currentSceneType: SceneType.SPACE_FLIGHT,
    player: { credits: 1000 },
    currentScene: {
      combatPlanning: {
        isPlanning,
        assignWeapon: vi.fn(),
        setDestination: vi.fn(),
        confirm,
      },
      combatModule: {
        isActive: true,
        fittedWeapons: () => [{ weaponClass: "PULSE" }],
        combatants: [combatant],
        selectedTarget: null,
      },
      shipPhysics: { shipX: 0, shipY: 0, isMoving: false },
    },
  } as unknown as GameEngine;
}

describe("live autopilot tick advances an open combat planning freeze", () => {
  it("confirms planning on tick so the sim never idles frozen behind an unconfirmed turn", () => {
    const confirm = vi.fn(() => true);
    createLiveSceneController(engineWithPlanning(true, confirm)).tick();
    expect(confirm).toHaveBeenCalled();
  });

  it("is a safe no-op when no planning freeze is open", () => {
    const confirm = vi.fn(() => true);
    createLiveSceneController(engineWithPlanning(false, confirm)).tick();
    expect(confirm).not.toHaveBeenCalled();
  });
});
