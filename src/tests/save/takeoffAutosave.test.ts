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
  e2eTakeOff: () => Promise<void>;
  saveGame: ReturnType<typeof vi.fn>;
  transitionTo: ReturnType<typeof vi.fn>;
  callOrder: string[];
} {
  const scene = Object.create(PlanetScene.prototype) as PlanetScene;
  const callOrder: string[] = [];
  const saveGame = vi.fn().mockImplementation(() => {
    callOrder.push("save");
    return Promise.resolve();
  });
  const transitionTo = vi.fn().mockImplementation(() => {
    callOrder.push("transition");
    return Promise.resolve();
  });
  const fields = scene as unknown as Record<string, unknown>;
  fields.gameEngine = {
    saveGame,
    transitionTo,
    playerLoadout: {
      derivedStats: () => ({ canTakeOff: opts.canTakeOff ?? true }),
    },
  };
  fields.planet = opts.planetId === undefined ? null : { id: opts.planetId };
  const typed = scene as unknown as {
    takeOff(): Promise<void>;
    e2eTakeOff(): Promise<void>;
  };
  return {
    takeOff: () => typed.takeOff(),
    e2eTakeOff: () => typed.e2eTakeOff(),
    saveGame,
    transitionTo,
    callOrder,
  };
}

describe("PlanetScene take-off autosave (death checkpoint)", () => {
  it("writes the auto save exactly once on take-off", async () => {
    const { takeOff, saveGame } = makeScene({ planetId: "planet-7" });
    await takeOff();
    expect(saveGame).toHaveBeenCalledTimes(1);
    expect(saveGame).toHaveBeenCalledWith("auto");
  });

  it("autosaves before the SPACE_FLIGHT transition", async () => {
    const { takeOff, callOrder, transitionTo } = makeScene({
      planetId: "planet-7",
    });
    await takeOff();
    expect(callOrder).toEqual(["save", "transition"]);
    expect(transitionTo).toHaveBeenCalledWith(
      SceneType.SPACE_FLIGHT,
      expect.objectContaining({ fromPlanetId: "planet-7" }),
    );
  });

  it("autosaves on the e2e take-off entry too", async () => {
    const { e2eTakeOff, saveGame, transitionTo } = makeScene({
      planetId: "planet-3",
    });
    await e2eTakeOff();
    expect(saveGame).toHaveBeenCalledTimes(1);
    expect(saveGame).toHaveBeenCalledWith("auto");
    expect(transitionTo).toHaveBeenCalledTimes(1);
  });

  it("does NOT autosave when take-off is blocked (no engine)", async () => {
    const { takeOff, saveGame, transitionTo } = makeScene({
      planetId: "planet-7",
      canTakeOff: false,
    });
    await takeOff();
    expect(saveGame).not.toHaveBeenCalled();
    expect(transitionTo).not.toHaveBeenCalled();
  });

  it("still launches when the autosave fails", async () => {
    const { takeOff, saveGame, transitionTo } = makeScene({
      planetId: "planet-7",
    });
    saveGame.mockRejectedValueOnce(new Error("disk full"));
    await takeOff();
    expect(transitionTo).toHaveBeenCalledTimes(1);
  });
});
