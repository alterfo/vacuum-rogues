import { describe, it, expect, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { SceneType, FactionType } from "@/types";
import { ADAPTIVE_GRACE_DAYS } from "@/config/balance";

/**
 * Real-engine playtest for the "spurious mid-flight Victory" bug
 * (`20260626-playtest-bugs-2` Task 2). Flying to a hyperjump point advances a
 * galaxy day → EOD → the endgame win check used to fire a «ПОБЕДА!» the player
 * never earned: the Overmind arc declared victory the instant the two isolated
 * starting systems were cleared — by an early player skirmish, an autonomous NPC
 * convoy liberation, or a quest liberation — because `peakThreat` captures the
 * initial Overmind share (>0) on the very first EOD even while the arc is still
 * dormant in its grace window, so `eradicated`/`coreBroken` tripped over a front
 * that never became a real threat.
 *
 * The fix (in the pure arc status machine `advanceOvermind`) gates the win on the
 * arc having GENUINELY ENGAGED — actually spread at least once past grace
 * (`lastSpreadDay >= 0`). Boots the genuine `GameEngine` + `GalaxyService` +
 * `NpcSimulator`, stubbing only PixiJS, so it exercises the real EOD wiring
 * (`advanceGalaxyDay` → `advanceOvermindArc` → the win check → the victory
 * overlay). Each scenario ends on the error-invariant (`errors()` empty).
 */
vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

// Adaptive campaign clock (three-year-campaign Task 3): the arc's dormancy
// window is now ADAPTIVE_GRACE_DAYS; the engagement scenario fast-forwards it
// by pre-setting `gameDays` (the grace is ~a quarter-year of EOD ticks).

describe("Overmind arc — no spurious Victory", () => {
  let harness: RealEngineHarness;

  afterEach(() => {
    harness?.dispose();
  });

  it("does not fire a Victory on the first galaxy day of a fresh game", async () => {
    harness = await RealEngineHarness.boot({
      seed: "NO_SPURIOUS_FIRSTDAY",
      systemCount: 30,
    });
    await harness.newGame();
    const galaxy = harness.galaxy()!;
    const outcome = vi.spyOn(harness.engine, "showGameOutcomeScreen");

    expect(galaxy.overmindSystems.length).toBeGreaterThan(0);
    expect(galaxy.overmindArc.status).toBe("dormant");

    harness.engine.advanceGalaxyDay();

    expect(galaxy.overmindArc.status).not.toBe("won");
    expect(outcome).not.toHaveBeenCalledWith(true);
    expect(harness.currentSceneType()).not.toBe(SceneType.WIN_SCREEN);
    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });

  it("does NOT pop a Victory when the never-engaged dormant front is cleared", async () => {
    // This is the actual reproduction: an early clearance of the two isolated
    // starting Overmind systems (the core included) while the arc is still
    // dormant. Before the engagement gate this fired «ПОБЕДА!» on the next EOD.
    harness = await RealEngineHarness.boot({
      seed: "NO_SPURIOUS_CLEARED",
      systemCount: 30,
    });
    await harness.newGame();
    const galaxy = harness.galaxy()!;
    const outcome = vi.spyOn(harness.engine, "showGameOutcomeScreen");

    // Day 1: dormant, but peakThreat is now the initial share (>0).
    harness.engine.advanceGalaxyDay();
    expect(galaxy.overmindArc.status).toBe("dormant");
    expect(galaxy.overmindArc.peakThreat).toBeGreaterThan(0);
    expect(galaxy.overmindArc.lastSpreadDay).toBeLessThan(0); // never engaged

    // What the living galaxy (or an early player skirmish) does: liberate the
    // whole Overmind front while it is still dormant.
    for (const id of [...galaxy.overmindSystems]) galaxy.tryLiberate(id);
    expect(galaxy.overmindSystems).toHaveLength(0);

    // Next EOD: the win check must NOT declare victory over a never-engaged front.
    harness.engine.advanceGalaxyDay();

    expect(galaxy.overmindArc.status).not.toBe("won");
    expect(outcome).not.toHaveBeenCalledWith(true);
    expect(harness.currentSceneType()).not.toBe(SceneType.WIN_SCREEN);
    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });

  it("never pops a Victory across several no-action day-advances", async () => {
    harness = await RealEngineHarness.boot({
      seed: "NO_SPURIOUS_MANYDAYS",
      systemCount: 30,
    });
    await harness.newGame();
    const galaxy = harness.galaxy()!;
    const outcome = vi.spyOn(harness.engine, "showGameOutcomeScreen");

    // Advance a handful of days with no player action. The front grows (or the
    // autonomous NPCs churn it) but the player never earns a win — so the victory
    // overlay must never show. (Bounded below the loss line; the legit defeat
    // overlay is a separate, expected outcome.)
    for (let d = 0; d < 8; d++) {
      harness.engine.advanceGalaxyDay();
      expect(galaxy.overmindArc.status).not.toBe("won");
      expect(harness.currentSceneType()).not.toBe(SceneType.WIN_SCREEN);
    }

    expect(outcome).not.toHaveBeenCalledWith(true);
    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });

  it("STILL wins when a genuinely engaged Overmind is eradicated", async () => {
    // The legitimate eradication win must be preserved: once the arc has actually
    // engaged (spread past grace), clearing the front is a real Victory.
    harness = await RealEngineHarness.boot({
      seed: "LEGIT_ERADICATION_WIN",
      systemCount: 24,
    });
    await harness.newGame();
    const galaxy = harness.galaxy()!;
    const outcome = vi.spyOn(harness.engine, "showGameOutcomeScreen");

    // Engage the arc: start its clock, fast-forward the dormancy window, and
    // let the first past-grace EOD fire a real spread tick.
    harness.engine.advanceGalaxyDay(); // day 1 — the arc clock starts
    galaxy.gameDays = ADAPTIVE_GRACE_DAYS;
    harness.engine.advanceGalaxyDay(); // first past-grace EOD → the arc spreads
    expect(galaxy.overmindArc.lastSpreadDay).toBeGreaterThanOrEqual(0); // engaged
    expect(galaxy.overmindArc.status).toBe("advancing");

    // Now the player wipes out the engaged front.
    for (const id of [...galaxy.overmindSystems]) galaxy.tryLiberate(id);
    expect(galaxy.overmindSystems).toHaveLength(0);

    // The next EOD recognises the genuine eradication as a win.
    harness.engine.advanceGalaxyDay();
    expect(galaxy.overmindArc.status).toBe("won");
    expect(outcome).toHaveBeenCalledWith(true);
    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });

  it("STILL wins on a real rank+rep milestone (checkWinCondition is unchanged)", async () => {
    harness = await RealEngineHarness.boot({
      seed: "LEGIT_RANKREP_WIN",
      systemCount: 24,
    });
    await harness.newGame();
    const player = harness.player()!;

    // Below the bar: a fresh veteran with too few allies does not win.
    player.rank = 2; // VETERAN
    expect(harness.engine.checkWinCondition()).toBe(false);

    // Meet the real bar: rank >= VETERAN + 3 factions over 50 reputation.
    player.adjustReputation(FactionType.OUTLANDERS, 80);
    player.adjustReputation(FactionType.BASTIONS, 80);
    player.adjustReputation(FactionType.SYNDICATE, 80);
    expect(harness.engine.checkWinCondition()).toBe(true);

    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });
});
