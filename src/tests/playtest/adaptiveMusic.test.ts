import { describe, it, expect, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";

/**
 * Real-engine playtest for the adaptive-audio wiring in
 * `GameEngine.updateMusic` (`20260625-adaptive-audio`). Boots the genuine
 * `GameEngine` and only stubs PixiJS, so it exercises the *derivation* the pure
 * `MusicDirector`/`MusicDriver` units cannot see: how `updateMusic` turns the
 * live combat signal + player location into the `lowHull`/`boss` context.
 *
 * Regression focus: `boss` must be keyed off *location* (player inside the
 * OVERMIND core), not the transient `inCombat` flag — otherwise the director's
 * post-disengage combat hold flickers the held track from `combat_boss` back to
 * plain `combat` mid-boss-fight.
 */
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
    // Somewhere that is NOT the OVERMIND core — a plain combat.
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
    // Put the player inside the OVERMIND core so it is a boss fight.
    harness.player()!.currentSystemId = core;

    const spy = vi
      .spyOn(harness.engine.audio, "playTrack")
      .mockResolvedValue(undefined);

    // Engage: boss track.
    harness.engine.updateMusic(true);
    expect(spy.mock.calls.at(-1)?.[0]).toBe("combat_boss");

    // Disengage immediately — within the combat-hold window the boss track must
    // persist (regression: gating `boss` on `inCombat` dropped it to "combat").
    harness.engine.updateMusic(false);
    expect(spy.mock.calls.at(-1)?.[0]).toBe("combat_boss");

    expect(harness.errors()).toEqual([]);
  });

  it("re-arms the low-hull alarm on load so a save loaded at critical hull still warns", async () => {
    // Regression: loadGame must reset the HullAlarm (like new-game / teardown do),
    // otherwise a stale `wasLow=true` from the prior in-session game suppresses the
    // first warning edge when a critical-hull save is loaded (`low && !wasLow` stays
    // false), and the player gets no audible low-hull cue on resume.
    harness = await RealEngineHarness.boot({ seed: "AUDIO_LOAD_ALARM" });
    await harness.newGame();

    // Drop the live ship into the critical-hull band and tick the music once so the
    // alarm arms (`wasLow` becomes true) — exactly the state a low-hull save records.
    harness.player()!.ship.hullHP = 1;
    harness.engine.updateMusic(false);

    // Persist that low-hull state, then load it back in the same session.
    await harness.engine.saveGame("slot-1");

    // Spy AFTER the arming tick above so the pre-save alarm isn't what we assert on:
    // the alarm must fire again *because the load re-armed it*, not from stale state.
    const sfx = vi
      .spyOn(harness.engine.audio, "playSfx")
      .mockResolvedValue(undefined);

    const loaded = await harness.engine.loadGame("slot-1");
    expect(loaded).toBe(true);
    // `applyLoadoutHullToShip` clamps but preserves the low hull, and loadGame's
    // final transitionTo runs updateMusic — so with the alarm re-armed the rising
    // edge fires once. Without the reset, `wasLow` stayed true and this is silent.
    expect(sfx).toHaveBeenCalledWith("alarm");
    expect(harness.errors()).toEqual([]);
  });
});
