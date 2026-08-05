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

function engineWithPlanningAndSystem(
  isPlanning: boolean,
  confirm: () => boolean,
) {
  const combatant = { npc: { id: "n1" }, x: 100, y: 0 };
  const executeRouteTo = vi.fn();
  const assignWeapon = vi.fn();
  const engine = {
    currentSceneType: SceneType.SPACE_FLIGHT,
    player: { credits: 1000, currentSystemId: "s1" },
    questManager: { getActiveQuests: () => [] },
    galaxy: {
      systems: [
        {
          id: "s1",
          planets: [{ id: "p1", isHabitable: true }],
          stations: [{ id: "st1" }],
        },
      ],
    },
    currentScene: {
      combatPlanning: {
        isPlanning,
        assignWeapon,
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
      planetManager: {
        planetSprites: [
          {
            planet: { id: "p1" },
            screenX: 500,
            screenY: 300,
            displayRadius: 40,
          },
        ],
        routeTargetPlanetId: null,
        stationMarkers: [{ station: { id: "st1" }, x: 700, y: 200 }],
        routeTargetStationId: null,
      },
      executeRouteTo,
      starRenderer: { centerX: 0, centerY: 0 },
      SYSTEM_BOUNDARY_RADIUS: 4000,
      pendingWarp: null,
    },
  } as unknown as GameEngine;
  return { engine, executeRouteTo, assignWeapon };
}

describe("land/dock during an open combat planning freeze must confirm the turn", () => {
  it("land() confirms planning firing back so the frozen sim can fly the escape route", () => {
    const confirm = vi.fn(() => true);
    const { engine, executeRouteTo, assignWeapon } =
      engineWithPlanningAndSystem(true, confirm);
    createLiveSceneController(engine).land("p1");
    expect(confirm).toHaveBeenCalled();
    expect(assignWeapon).toHaveBeenCalled();
    expect(executeRouteTo).toHaveBeenCalled();
  });

  it("dock() confirms planning firing back so the frozen sim can fly the repair route", async () => {
    const confirm = vi.fn(() => true);
    const { engine, executeRouteTo, assignWeapon } =
      engineWithPlanningAndSystem(true, confirm);
    await createLiveSceneController(engine).dock("st1");
    expect(confirm).toHaveBeenCalled();
    expect(assignWeapon).toHaveBeenCalled();
    expect(executeRouteTo).toHaveBeenCalled();
  });

  it("flee() during planning fires back while running for the edge", () => {
    const confirm = vi.fn(() => true);
    const { engine, assignWeapon } = engineWithPlanningAndSystem(true, confirm);
    createLiveSceneController(engine).flee();
    expect(confirm).toHaveBeenCalled();
    expect(assignWeapon).toHaveBeenCalled();
  });

  it("warp() during planning fires back while confirming the frozen turn", async () => {
    const confirm = vi.fn(() => true);
    const { engine, assignWeapon } = engineWithPlanningAndSystem(true, confirm);
    await createLiveSceneController(engine).warp();
    expect(confirm).toHaveBeenCalled();
    expect(assignWeapon).toHaveBeenCalled();
  });

  it("land() outside a planning freeze never touches confirm", () => {
    const confirm = vi.fn(() => true);
    const { engine } = engineWithPlanningAndSystem(false, confirm);
    createLiveSceneController(engine).land("p1");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("dock() outside a planning freeze never touches confirm", async () => {
    const confirm = vi.fn(() => true);
    const { engine } = engineWithPlanningAndSystem(false, confirm);
    await createLiveSceneController(engine).dock("st1");
    expect(confirm).not.toHaveBeenCalled();
  });
});
