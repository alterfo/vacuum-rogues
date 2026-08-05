import { describe, it, expect, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { SceneType, FactionType } from "@/types";
import { ADAPTIVE_GRACE_DAYS } from "@/config/balance";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

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
    harness = await RealEngineHarness.boot({
      seed: "NO_SPURIOUS_CLEARED",
      systemCount: 30,
    });
    await harness.newGame();
    const galaxy = harness.galaxy()!;
    const outcome = vi.spyOn(harness.engine, "showGameOutcomeScreen");

    harness.engine.advanceGalaxyDay();
    expect(galaxy.overmindArc.status).toBe("dormant");
    expect(galaxy.overmindArc.peakThreat).toBeGreaterThan(0);
    expect(galaxy.overmindArc.lastSpreadDay).toBeLessThan(0); // never engaged

    for (const id of [...galaxy.overmindSystems])
      galaxy.tryLiberate(id, "player");
    expect(galaxy.overmindSystems).toHaveLength(0);

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

    for (let d = 0; d < 8; d++) {
      harness.engine.advanceGalaxyDay();
      expect(galaxy.overmindArc.status).not.toBe("won");
      expect(harness.currentSceneType()).not.toBe(SceneType.WIN_SCREEN);
    }

    expect(outcome).not.toHaveBeenCalledWith(true);
    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });

  it("STILL wins when a genuinely engaged Overmind is eradicated", async () => {
    harness = await RealEngineHarness.boot({
      seed: "LEGIT_ERADICATION_WIN",
      systemCount: 24,
    });
    await harness.newGame();
    const galaxy = harness.galaxy()!;
    const outcome = vi.spyOn(harness.engine, "showGameOutcomeScreen");

    harness.engine.advanceGalaxyDay(); // day 1 — the arc clock starts
    galaxy.gameDays = ADAPTIVE_GRACE_DAYS;
    harness.engine.advanceGalaxyDay(); // first past-grace EOD → the arc spreads
    expect(galaxy.overmindArc.lastSpreadDay).toBeGreaterThanOrEqual(0); // engaged
    expect(galaxy.overmindArc.status).toBe("advancing");

    for (const id of [...galaxy.overmindSystems])
      galaxy.tryLiberate(id, "player");
    expect(galaxy.overmindSystems).toHaveLength(0);

    harness.engine.advanceGalaxyDay();
    expect(galaxy.overmindArc.status).toBe("won");
    expect(outcome).toHaveBeenCalledWith(true);
    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });

  it("a rank+rep milestone no longer triggers any victory — only total eradication wins", async () => {
    harness = await RealEngineHarness.boot({
      seed: "LEGIT_RANKREP_WIN",
      systemCount: 24,
    });
    await harness.newGame();
    const player = harness.player()!;
    const galaxy = harness.galaxy()!;
    const outcome = vi.spyOn(harness.engine, "showGameOutcomeScreen");

    player.rank = 2;
    player.adjustReputation(FactionType.OUTLANDERS, 80);
    player.adjustReputation(FactionType.BASTIONS, 80);
    player.adjustReputation(FactionType.SYNDICATE, 80);

    harness.engine.advanceGalaxyDay();
    harness.engine.advanceGalaxyDay();

    expect(galaxy.overmindArc.status).not.toBe("won");
    expect(outcome).not.toHaveBeenCalledWith(true);
    expect(harness.engine.currentSceneType).not.toBe(SceneType.WIN_SCREEN);
    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });
});
