import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { SceneType } from "@/types";
import { BLACK_HOLE_EVENT_HORIZON_RADIUS } from "@/config/balance";
import { rollBlackHoleMishap } from "@/systems/galaxy/blackHoleMishap";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

if (typeof globalThis.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    },
  });
}

interface FlightSceneProbe {
  pendingWarp: unknown;
  starRenderer: { centerX: number; centerY: number };
  blackHoleRenderer: {
    position: { x: number; y: number };
    eventHorizonRadius: number;
  } | null;
  shipPhysics: { shipX: number; shipY: number } | null;
  performWarp(): Promise<void>;
}

describe("Hyperjump mishap redirect (Task 3)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    harness = await RealEngineHarness.boot({ seed: "BH_MISHAP_WARP" });
    await harness.newGame();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
  });

  it("a forced-true mishap redirects performWarp to a black-hole system and spawns beside the anomaly", async () => {
    const galaxy = harness.galaxy()!;
    const sourceId = harness.engine.player!.currentSystemId;
    const source = galaxy.systems.find((system) => system.id === sourceId)!;
    const targetId = source.connections[0].toSystemId;
    const target = galaxy.systems.find((system) => system.id === targetId)!;

    for (const system of galaxy.systems) system.hasBlackHoleAnomaly = false;
    source.hasBlackHoleAnomaly = false;
    target.hasBlackHoleAnomaly = true;

    let gameDays = 0;
    while (
      gameDays < 2000 &&
      !rollBlackHoleMishap(`mishap_${sourceId}_${targetId}_${gameDays}`)
    ) {
      gameDays++;
    }
    expect(
      rollBlackHoleMishap(`mishap_${sourceId}_${targetId}_${gameDays}`),
    ).toBe(true);
    galaxy.gameDays = gameDays;

    await harness.goTo(SceneType.STAR_MAP);
    const starMap = harness.currentScene() as unknown as {
      performWarpJumpTo(id: string): Promise<void>;
    };
    await starMap.performWarpJumpTo(targetId);
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    const departingScene =
      harness.currentScene() as unknown as FlightSceneProbe;
    await departingScene.performWarp();

    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    expect(harness.engine.player!.currentSystemId).toBe(targetId);

    const arrivedScene = harness.currentScene() as unknown as FlightSceneProbe;
    const blackHole = arrivedScene.blackHoleRenderer;
    const ship = arrivedScene.shipPhysics;
    expect(blackHole).not.toBeNull();
    expect(ship).not.toBeNull();

    const center = arrivedScene.starRenderer;
    const blackHoleX = center.centerX + blackHole!.position.x;
    const blackHoleY = center.centerY + blackHole!.position.y;
    const distance = Math.hypot(
      ship!.shipX - blackHoleX,
      ship!.shipY - blackHoleY,
    );
    expect(distance).toBeGreaterThan(BLACK_HOLE_EVENT_HORIZON_RADIUS);
    expect(distance).toBeLessThan(BLACK_HOLE_EVENT_HORIZON_RADIUS + 80);
    expect(harness.errors()).toEqual([]);
  });
});
