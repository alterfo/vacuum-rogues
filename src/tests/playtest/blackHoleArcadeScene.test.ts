import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { SceneType } from "@/types";

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
  starRenderer: { centerX: number; centerY: number };
  blackHoleRenderer: {
    position: { x: number; y: number };
    eventHorizonRadius: number;
  } | null;
  shipPhysics: { shipX: number; shipY: number } | null;
}

interface ArcadeSceneProbe {
  returnSystemId: string | null;
  blackHoleSystemId: string | null;
}

describe("Black-hole arcade scene scaffold (Task 4)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    harness = await RealEngineHarness.boot({ seed: "BH_ARCADE_SCENE" });
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
  });

  it("contact-triggering enterBlackHole transitions to BLACK_HOLE_ARCADE with context", async () => {
    await harness.newGame();
    const galaxy = harness.galaxy()!;
    const systemId = harness.engine.player!.currentSystemId;
    const system = galaxy.systems.find((s) => s.id === systemId)!;
    system.hasBlackHoleAnomaly = true;

    await harness.goTo(SceneType.SPACE_FLIGHT);
    const flight = harness.currentScene() as unknown as FlightSceneProbe;
    const blackHole = flight.blackHoleRenderer;
    expect(blackHole).not.toBeNull();
    expect(flight.shipPhysics).not.toBeNull();

    const center = flight.starRenderer;
    flight.shipPhysics!.shipX = center.centerX + blackHole!.position.x;
    flight.shipPhysics!.shipY = center.centerY + blackHole!.position.y;

    harness.tick(16);
    await vi.waitFor(() => {
      expect(harness.currentSceneType()).toBe(SceneType.BLACK_HOLE_ARCADE);
    });

    const arcade = harness.currentScene() as unknown as ArcadeSceneProbe;
    expect(arcade.returnSystemId).toBe(systemId);
    expect(arcade.blackHoleSystemId).toBe(systemId);
    expect(harness.errors()).toEqual([]);
  });

  it("loading a save captured mid-run falls back to SPACE_FLIGHT", async () => {
    await harness.newGame();
    const slotId = "arcade-mid-run";

    await harness.engine.saveGame(slotId);
    const save = await harness.engine.saveManager.read(slotId);
    expect(save).not.toBeNull();
    save!.currentSceneType = SceneType.BLACK_HOLE_ARCADE;

    await harness.engine.loadGame(slotId);

    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    expect(harness.errors()).toEqual([]);
  });
});
