import { describe, it, expect, afterEach } from "vitest";
import { vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { SceneType } from "@/types";
import type { PlanetSprite } from "@/presentation/PlanetSprite";
import type { ShipPhysics } from "@/systems/ShipPhysics";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

interface FlightPrivates {
  shipPhysics: ShipPhysics;
  plannedRoute: { x: number; y: number } | null;
  planetManager: {
    planetSprites: PlanetSprite[];
    onPlanetRouteRequested:
      | ((planetId: string, x: number, y: number) => void)
      | null;
  };
}

describe("Low-hull safety auto-stop must not cancel a route toward a planet", () => {
  let harness: RealEngineHarness;

  afterEach(() => {
    harness?.dispose();
  });

  it("keeps flying to a planet on the first plan+execute attempt while hull < 30%", async () => {
    harness = await RealEngineHarness.boot();
    await harness.newGame();
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    const player = harness.player()!;
    player.ship.hullHP = Math.floor(player.ship.maxHull * 0.2); // < 30% threshold

    const scene = harness.currentScene() as unknown as FlightPrivates;
    const sprite = scene.planetManager.planetSprites[0];
    expect(sprite).toBeDefined();

    scene.planetManager.onPlanetRouteRequested?.(
      sprite.planet.id,
      sprite.screenX,
      sprite.screenY,
    );
    scene.planetManager.onPlanetRouteRequested?.(
      sprite.planet.id,
      sprite.screenX,
      sprite.screenY,
    );

    expect(scene.plannedRoute).not.toBeNull(); // route executed, not just planned
    expect(scene.shipPhysics.isMoving).toBe(true);

    for (let i = 0; i < 10; i++) harness.tick(16);

    expect(scene.plannedRoute).not.toBeNull();
    expect(scene.shipPhysics.isMoving).toBe(true);
    expect(harness.errors()).toEqual([]);
  });

  it("still auto-stops a low-hull ship on a non-planet route (open-space safety net preserved)", async () => {
    harness = await RealEngineHarness.boot();
    await harness.newGame();

    const player = harness.player()!;
    player.ship.hullHP = Math.floor(player.ship.maxHull * 0.2);

    const scene = harness.currentScene() as unknown as FlightPrivates & {
      onPointerDown?: unknown;
    };

    (
      scene as unknown as { executeRouteTo(x: number, y: number): void }
    ).executeRouteTo(
      scene.shipPhysics.shipX + 5000,
      scene.shipPhysics.shipY + 5000,
    );
    expect(scene.shipPhysics.isMoving).toBe(true);

    harness.tick(16);

    expect(scene.plannedRoute).toBeNull();
    expect(scene.shipPhysics.isMoving).toBe(false);
  });
});
