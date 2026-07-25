import { describe, it, expect, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";

/**
 * #19: on system entry the ship should FACE THE SUN (system centre), not sit on
 * a hard-reset heading of 0 (pointing east regardless of where it spawned). A
 * warp arrival already continues its sun-facing departure heading
 * (`warpArrivalHeading.test.ts`); this pins the default/context-less entry — a
 * fresh game boots into SPACE_FLIGHT with only `{ gameEngine }`, so the ship
 * spawns at the system edge and must orient toward the star, not east.
 */
vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

describe("#19: ship faces the sun on system entry", () => {
  let harness: RealEngineHarness;

  afterEach(() => {
    harness?.dispose();
  });

  it("fresh-game entry heading points at the star centre, not a hard-reset east (0)", async () => {
    harness = await RealEngineHarness.boot();
    await harness.newGame();

    const scene = harness.currentScene() as unknown as {
      shipPhysics: { shipX: number; shipY: number; shipAngle: number } | null;
      starRenderer: { centerX: number; centerY: number };
    };
    const ship = scene.shipPhysics;
    expect(ship).toBeTruthy();

    // The spawn is offset from the star centre (system edge), so the sun-facing
    // heading is genuinely non-zero — a stray hard-reset 0 could not satisfy it.
    const expectedHeading = Math.atan2(
      scene.starRenderer.centerY - ship!.shipY,
      scene.starRenderer.centerX - ship!.shipX,
    );
    expect(ship!.shipAngle).toBeCloseTo(expectedHeading, 5);
    expect(harness.errors()).toEqual([]);
  });
});
