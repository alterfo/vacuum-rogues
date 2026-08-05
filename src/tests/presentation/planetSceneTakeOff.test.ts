import { describe, it, expect, vi } from "vitest";

vi.mock("pixi.js", () => ({
  Container: vi.fn(),
  Graphics: vi.fn(),
  Text: vi.fn(),
  Sprite: vi.fn(),
}));

import { PlanetScene } from "@/presentation/PlanetScene";
import { SceneType } from "@/types";

function makeScene(opts: { planetId?: string; canTakeOff?: boolean }): {
  takeOff: () => Promise<void>;
  transitionTo: ReturnType<typeof vi.fn>;
} {
  const scene = Object.create(PlanetScene.prototype) as PlanetScene;
  const transitionTo = vi.fn().mockResolvedValue(undefined);
  const fields = scene as unknown as Record<string, unknown>;
  fields.gameEngine = {
    transitionTo,
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
