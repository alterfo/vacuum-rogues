import { describe, it, expect, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

describe("adaptive audio — updateMusic wiring", () => {
  let harness: RealEngineHarness;

  afterEach(() => {
    harness?.dispose();
  });

  it("requests the combat track when a non-boss fight engages in flight", async () => {
    harness = await RealEngineHarness.boot({ seed: "AUDIO_COMBAT" });
    await harness.newGame();
    const galaxy = harness.galaxy()!;
    const nonCore = galaxy.systems.find(
      (s) => s.id !== galaxy.overmindCoreSystemId,
    )!;
    harness.player()!.currentSystemId = nonCore.id;

    const spy = vi
      .spyOn(harness.engine.audio, "playTrack")
      .mockResolvedValue(undefined);

    harness.engine.updateMusic(true);
    expect(spy.mock.calls.at(-1)?.[0]).toBe("combat");
    expect(harness.errors()).toEqual([]);
  });

  it("holds the boss track through a brief disengage (no flicker to plain combat)", async () => {
    harness = await RealEngineHarness.boot({ seed: "AUDIO_BOSS" });
    await harness.newGame();
    const galaxy = harness.galaxy()!;
    const core = galaxy.overmindCoreSystemId;
    expect(core).not.toBe(""); // sanity: the core exists after new game
    harness.player()!.currentSystemId = core;

    const spy = vi
      .spyOn(harness.engine.audio, "playTrack")
      .mockResolvedValue(undefined);

    harness.engine.updateMusic(true);
    expect(spy.mock.calls.at(-1)?.[0]).toBe("combat_boss");

    harness.engine.updateMusic(false);
    expect(spy.mock.calls.at(-1)?.[0]).toBe("combat_boss");

    expect(harness.errors()).toEqual([]);
  });

  it("re-arms the low-hull alarm on load so a save loaded at critical hull still warns", async () => {
    harness = await RealEngineHarness.boot({ seed: "AUDIO_LOAD_ALARM" });
    await harness.newGame();

    harness.player()!.ship.hullHP = 1;
    harness.engine.updateMusic(false);

    await harness.engine.saveGame("slot-1");

    const sfx = vi
      .spyOn(harness.engine.audio, "playSfx")
      .mockResolvedValue(undefined);

    const loaded = await harness.engine.loadGame("slot-1");
    expect(loaded).toBe(true);
    expect(sfx).toHaveBeenCalledWith("alarm");
    expect(harness.errors()).toEqual([]);
  });
});
