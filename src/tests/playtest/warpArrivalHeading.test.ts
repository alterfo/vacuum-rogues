import { describe, it, expect, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

describe("Bug 4: ship enters a system on its departure heading", () => {
  let harness: RealEngineHarness;

  afterEach(() => {
    harness?.dispose();
  });

  it("arrival shipAngle matches atan2(exitVector), not a hard reset to 0", async () => {
    harness = await RealEngineHarness.boot();
    await harness.newGame();

    const player = harness.player()!;
    const galaxy = harness.galaxy()!;
    const target = galaxy.systems.find((s) => s.id !== player.currentSystemId)!;

    const exitVector = { x: 0.6, y: -0.8 };

    const scene = harness.currentScene() as unknown as {
      pendingWarp: unknown;
      performWarp(): Promise<void>;
    };
    scene.pendingWarp = {
      targetSystemId: target.id,
      fuelCost: 0,
      exitVector,
    };

    await scene.performWarp();

    const arrivedScene = harness.currentScene() as unknown as {
      shipPhysics: { shipAngle: number } | null;
    };
    const expectedHeading = Math.atan2(exitVector.y, exitVector.x);
    expect(arrivedScene.shipPhysics?.shipAngle).toBeCloseTo(expectedHeading, 5);
    expect(harness.errors()).toEqual([]);
  });
});
