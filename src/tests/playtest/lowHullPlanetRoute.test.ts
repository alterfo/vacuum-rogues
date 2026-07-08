import { describe, it, expect, afterEach } from "vitest";
import { vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { SceneType } from "@/types";
import type { PlanetSprite } from "@/presentation/PlanetSprite";
import type { ShipPhysics } from "@/systems/ShipPhysics";

/**
 * With hull below 30%, the safety auto-stop (`SpaceFlightScene.updateShip`)
 * used to cancel ANY freshly-executed route on the very first frame it moves —
 * including a route toward a planet, which is exactly what its own warning
 * message ("Найдите планету для ремонта") tells the player to do. The player
 * plans + executes a route to a planet (the two-click sequence), the safety
 * stop immediately cancelled it and showed the warning, and only a *second*
 * plan+execute attempt actually flew (the `lowHullStopped` latch was now set,
 * so the stop didn't re-fire). This test pins the fix: a route toward a
 * planet must survive the first attempt while hull is low.
 */
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

    // The two-click sequence: first click plans the route, second (same
    // planet) click executes it — mirrors PlanetManager's real click handler.
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

    // Several frames — including the orbiting-planet mid-flight "reaim"
    // course correction, which used to drop the landing hint the naive fix
    // relied on — are enough for the safety-stop to fire if it's buggy.
    for (let i = 0; i < 10; i++) harness.tick(16);

    // The route to the planet must survive — this must NOT require a second
    // plan+execute attempt.
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

    // Plot a plain open-space route (no planet target) via the public
    // executeRouteTo seam — mirrors clicking empty space, not a planet.
    (
      scene as unknown as { executeRouteTo(x: number, y: number): void }
    ).executeRouteTo(
      scene.shipPhysics.shipX + 5000,
      scene.shipPhysics.shipY + 5000,
    );
    expect(scene.shipPhysics.isMoving).toBe(true);

    harness.tick(16);

    // The pre-existing safety net must still fire for a non-planet route.
    expect(scene.plannedRoute).toBeNull();
    expect(scene.shipPhysics.isMoving).toBe(false);
  });
});
