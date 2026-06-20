/**
 * Playtest 3 — F4: take-off after the equipment shop must park the ship beside
 * the planet, not at the system edge. The re-entry marker is the `fromPlanetId`
 * the PLANET take-off passes to SPACE_FLIGHT; `SpaceFlightScene.initialize`
 * parks the ship beside that planet (and the shop round-trip must not lose it).
 *
 * This locks the take-off CONTEXT PAYLOAD at the unit level: `takeOff()` always
 * passes the current planet's id, independent of the one-shot `landedPlanetId`.
 * The end-to-end parking (real shop round-trip) is covered by the real-pointer
 * smoke `playtest3 F4` in `e2e/playtest-regression.spec.ts`.
 */
import { describe, it, expect, vi } from "vitest";

// PlanetScene imports pixi.js at module load; mock it so the scene can be
// imported without a real renderer (takeOff() never constructs display objects).
vi.mock("pixi.js", () => ({
  Container: vi.fn(),
  Graphics: vi.fn(),
  Text: vi.fn(),
  Sprite: vi.fn(),
}));

import { PlanetScene } from "@/presentation/PlanetScene";
import { SceneType } from "@/types";

/** Build a takeOff-ready PlanetScene without running its constructor/initialize. */
function makeScene(opts: { planetId?: string; canTakeOff?: boolean }): {
  takeOff: () => Promise<void>;
  transitionTo: ReturnType<typeof vi.fn>;
} {
  const scene = Object.create(PlanetScene.prototype) as PlanetScene;
  const transitionTo = vi.fn().mockResolvedValue(undefined);
  const fields = scene as unknown as Record<string, unknown>;
  fields.gameEngine = {
    transitionTo,
    // take-off now checkpoints to the "auto" slot before the flight transition
    // (death-rollback); provide the collaborator so the scene can run.
    saveGame: vi.fn().mockResolvedValue(undefined),
    playerLoadout: {
      derivedStats: () => ({ canTakeOff: opts.canTakeOff ?? true }),
    },
  };
  fields.planet = opts.planetId === undefined ? null : { id: opts.planetId };
  return {
    takeOff: () => (scene as unknown as { takeOff(): Promise<void> }).takeOff(),
    transitionTo,
  };
}

describe("PlanetScene.takeOff context payload (playtest3 F4)", () => {
  it("passes fromPlanetId for the current planet on take-off", async () => {
    const { takeOff, transitionTo } = makeScene({ planetId: "planet-7" });
    await takeOff();
    expect(transitionTo).toHaveBeenCalledTimes(1);
    expect(transitionTo).toHaveBeenCalledWith(
      SceneType.SPACE_FLIGHT,
      expect.objectContaining({ fromPlanetId: "planet-7" }),
    );
  });

  it("blocks take-off (no transition) when the loadout cannot take off", async () => {
    const { takeOff, transitionTo } = makeScene({
      planetId: "planet-7",
      canTakeOff: false,
    });
    await takeOff();
    expect(transitionTo).not.toHaveBeenCalled();
  });
});
